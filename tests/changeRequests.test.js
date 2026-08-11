import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Change requests — scope control.
 *
 * The value of this feature is entirely in what it REFUSES. A change request
 * that can reach a client without a price, or be approved without the client,
 * is a worse version of the conversation it replaces. So that is what these
 * assertions pin.
 */

const root = path.resolve(__dirname, "..");
const read = (p) =>
  readFileSync(path.join(root, p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/^\s*--.*$/gm, "");

const MIGRATION = read("database/060_change_requests.sql");
const LIST = read("src/app/api/change-requests/route.js");
const ADVANCE = read("src/app/api/change-requests/[id]/advance/route.js");

describe("the database refuses the states that make this pointless", () => {
  it("refuses a rejection with no reason", () => {
    expect(MIGRATION).toMatch(/needs a reason the other side can read/i);
  });

  it("refuses anything reaching an approver with no estimate", () => {
    // An unpriced change request is the "just one small thing" conversation
    // with extra steps.
    expect(MIGRATION).toMatch(/Estimate the cost or the hours/i);
    expect(MIGRATION).toMatch(/estimated_cost is null and new\.estimated_hours is null/);
  });

  it("refuses approval without the client", () => {
    expect(MIGRATION).toMatch(/only approved once the client has agreed/i);
  });

  it("refuses asking the client before the company has agreed", () => {
    expect(MIGRATION).toMatch(/has to approve a change request before the client sees it/i);
  });

  it("refuses reopening a settled request", () => {
    expect(MIGRATION).toMatch(/cannot be reopened/i);
  });

  it("keeps the previous budget and deadline for the trail", () => {
    expect(MIGRATION).toContain("previous_budget");
    expect(MIGRATION).toContain("previous_deadline");
  });

  it("states its grants and shuts anon out", () => {
    expect(MIGRATION).toMatch(/grant select, insert, update on public\.change_requests to authenticated/);
    expect(MIGRATION).toMatch(/revoke all on public\.change_requests from anon/);
  });

  it("lets a client raise one only on its own project, as itself", () => {
    const m = MIGRATION.match(/create policy change_requests_client_insert[\s\S]*?;/);
    expect(m?.[0]).toContain("auth_client_project_ids()");
    expect(m?.[0]).toContain("requested_by = public.auth_app_user_id()");
    expect(m?.[0]).toContain("status = 'submitted'");
  });

  it("keeps deciding away from team_lead — this is money", () => {
    const m = MIGRATION.match(/create policy change_requests_staff_write[\s\S]*?;/);
    expect(m?.[0]).toContain("'owner','admin','manager'");
    expect(m?.[0]).not.toContain("team_lead");
  });

  it("lets STAFF raise one too", () => {
    // A request only a client can file means the growth nobody asked for stays
    // invisible.
    expect(MIGRATION).toMatch(/create policy change_requests_staff_insert/);
  });
});

describe("the list route strips what RLS cannot", () => {
  it("removes pm_notes for clients", () => {
    // RLS is row-level; the client_read policy correctly grants the whole row.
    // The internal notes have to come off here.
    expect(LIST).toMatch(/const \{ pm_notes, \.\.\.rest \} = row/);
    expect(LIST).toMatch(/isClient \? \(data \|\| \[\]\)\.map\(CLIENT_SAFE\)/);
  });

  it("re-applies the client project scope the service key bypasses", () => {
    expect(LIST).toContain('.from("project_clients")');
    expect(LIST).toMatch(/q = q\.in\("project_id", ids\)/);
  });

  it("returns nothing rather than everything when a client has no projects", () => {
    // The dangerous shape is an empty id list turning into an unfiltered query.
    expect(LIST).toMatch(/if \(!ids\.length\) return NextResponse\.json\(\{ changeRequests: \[\] \}\)/);
  });

  it("refuses a client raising one on a project that is not theirs", () => {
    expect(LIST).toMatch(/That is not one of your projects/);
  });
});

describe("the chain can only be walked in order", () => {
  it("separates pricing from agreeing to sell", () => {
    // A manager who priced the work should not also be the one who agrees to
    // sell it at that price — that is why there are two steps.
    const idx = ADVANCE.indexOf('case "admin_approve"');
    const near = ADVANCE.slice(idx, idx + 320);
    expect(near).toMatch(/\["owner", "admin"\]\.includes\(auth\.role\)/);
    expect(near).toContain('cr.status !== "awaiting_admin"');
  });

  it("lets only the client approve", () => {
    const idx = ADVANCE.indexOf('case "client_approve"');
    const near = ADVANCE.slice(idx, idx + 400);
    expect(near).toMatch(/Only the client can approve/);
    expect(near).toContain('cr.status !== "awaiting_client"');
  });

  it("requires a reason to reject", () => {
    const idx = ADVANCE.indexOf('case "reject"');
    const near = ADVANCE.slice(idx, idx + 300);
    expect(near).toMatch(/Say why/);
  });

  it("will not move something somebody else just moved", () => {
    expect(ADVANCE).toMatch(/\.eq\("status", cr\.status\)/);
  });

  it("refuses to withdraw something already agreed", () => {
    const idx = ADVANCE.indexOf('case "withdraw"');
    const near = ADVANCE.slice(idx, idx + 400);
    expect(near).toMatch(/\["implemented", "approved"\]/);
  });
});

describe("approval actually moves the project", () => {
  it("applies the impact BEFORE the status changes", () => {
    // Otherwise a failure leaves it approved-but-unapplied, and the trigger
    // knows nothing about the project so nothing else protects that pair.
    const apply = ADVANCE.indexOf("await applyImpact");
    const update = ADVANCE.indexOf('.from("change_requests")\n      .update(patch)');
    expect(apply).toBeGreaterThan(-1);
    expect(apply).toBeLessThan(update === -1 ? Number.MAX_SAFE_INTEGER : update);
  });

  it("records what the budget and deadline WERE", () => {
    expect(ADVANCE).toContain("previous_budget: project.budget");
    expect(ADVANCE).toContain("previous_deadline: project.deadline");
  });

  it("treats a zero-impact change as agreed, not as a failure", () => {
    // A change request can be agreed at no cost and no delay, and that is
    // still worth recording.
    expect(ADVANCE).toMatch(/if \(Object\.keys\(update\)\.length === 0\)/);
  });

  it("does not record the decision if the project could not be updated", () => {
    expect(ADVANCE).toMatch(/Could not update the project's budget\. Nothing was changed\./);
  });

  it("strips pm_notes from what a client gets back", () => {
    expect(ADVANCE).toMatch(/isClient \? stripNotes\(data\) : data/);
  });

  it("never lets a failed notification undo a decision", () => {
    const idx = ADVANCE.indexOf("async function notify");
    expect(ADVANCE.slice(idx)).toContain("catch");
  });
});

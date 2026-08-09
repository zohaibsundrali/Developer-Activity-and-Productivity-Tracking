import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Failed is not empty.
 *
 * supabase-js RESOLVES with `{ data, error }` — it never rejects — so a
 * try/catch around a query cannot see a query failure, and code that reads only
 * `.data` renders an RLS denial, a 4xx and a 5xx identically to "no rows". The
 * admin screens were built on that mistake: four/seven-query loaders that
 * dropped every error and then claimed "No departments yet" / "No clients yet" /
 * "Every invitation you've sent has been accepted or revoked", mutations that
 * never checked whether the row was actually deleted, and — the destructive one
 * — an organization settings form that stayed fully interactive on DEFAULTS
 * after a failed load and would write those defaults over the real record on the
 * next Save, nulling five columns plus the `settings` jsonb.
 *
 * These tests pin the three states apart (loading / genuinely empty / failed)
 * and pin the Save guard that makes the overwrite impossible.
 */

/* ------------------------------------------------------------------ *
 * Supabase test double: resolves with { data, error } like the real one.
 * ------------------------------------------------------------------ */

/** key -> { data, error }. Keyed "table:op", falling back to "table". */
let results;
/** Every statement issued, in order: { table, op, payload }. */
let calls;

function resultFor(table, op) {
  if (results.has(`${table}:${op}`)) return results.get(`${table}:${op}`);
  if (results.has(table)) return results.get(table);
  return { data: [], error: null };
}

function makeBuilder(table, op) {
  const settle = () => Promise.resolve(resultFor(table, op));
  const builder = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    limit: () => builder,
    maybeSingle: settle,
    single: settle,
    then: (onOk, onErr) => settle().then(onOk, onErr),
  };
  return builder;
}

function record(table, op, payload) {
  calls.push({ table, op, payload });
  return makeBuilder(table, op);
}

vi.mock("@/utils/supabaseClient", () => ({
  supabase: {
    from: (table) => ({
      select: () => record(table, "select"),
      update: (payload) => record(table, "update", payload),
      delete: () => record(table, "delete"),
      insert: (payload) => record(table, "insert", payload),
    }),
    storage: { from: () => ({ upload: async () => ({ error: null }), getPublicUrl: () => ({ data: {} }) }) },
  },
}));

const alerts = {
  showSuccess: vi.fn(),
  showError: vi.fn(),
  showConfirm: vi.fn(async () => true),
};
vi.mock("@/utils/alerts", () => alerts);

const authFetch = vi.fn();
vi.mock("@/utils/authFetch", () => ({ authFetch }));

vi.mock("@/utils/orgContext", () => ({
  getOrgId: () => "org-1",
  getOrgContext: () => ({ organizationName: "Acme" }),
}));

vi.mock("@/utils/permissions", () => ({ can: () => true }));

// The UI kit is React presentation only; these tests exercise the data layer.
vi.mock("@/components/ui", () => {
  const stub = () => null;
  const names = [
    "PageHeader", "Section", "Card", "CardHeader", "CardTitle", "CardDescription",
    "CardContent", "CardFooter", "Badge", "StatusPill", "EmptyState", "ErrorState",
    "Skeleton", "SkeletonTable", "SkeletonList", "SkeletonCard", "Tabs", "Field",
    "Button", "Input",
  ];
  return Object.fromEntries(names.map((n) => [n, stub]));
});

const { fetchOrganization, saveOrganization, mergeOrgSettings, NOT_LOADED_MESSAGE } = await import(
  "@/components/admin/OrganizationSettings"
);
const { fetchOrganizationSections, deleteTeamWithMembers, copyToClipboard } = await import(
  "@/components/admin/OrganizationManagement"
);
const { fetchClientWorkspace, fetchClientInvitations, fetchThreadMessages } = await import(
  "@/components/admin/ClientManagement"
);

/** A resolved supabase failure — an RLS denial, a 4xx or a 5xx all look like this. */
const failure = (message) => ({ data: null, error: { message } });
const rows = (data) => ({ data, error: null });

beforeEach(() => {
  results = new Map();
  calls = [];
  alerts.showSuccess.mockClear();
  alerts.showError.mockClear();
  authFetch.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/* ================================================================== *
 * OrganizationSettings — the destructive one
 * ================================================================== */

describe("OrganizationSettings load: failed vs empty", () => {
  it("returns the row when the read succeeds", async () => {
    results.set("organizations", rows({ id: "org-1", name: "Acme", country: "Pakistan" }));
    await expect(fetchOrganization("org-1")).resolves.toMatchObject({ name: "Acme" });
  });

  it("returns null when the read succeeds and no row is visible (genuinely empty)", async () => {
    results.set("organizations", rows(null));
    await expect(fetchOrganization("org-1")).resolves.toBeNull();
  });

  it("throws the resolved error instead of reporting it as no rows", async () => {
    results.set("organizations", failure("permission denied for table organizations"));
    await expect(fetchOrganization("org-1")).rejects.toThrow(/permission denied/);
  });
});

describe("OrganizationSettings save guard", () => {
  const defaultsForm = {
    name: "", logo_url: "", industry: "", company_size: "", country: "", timezone: "UTC",
  };

  it("refuses to write, and issues NO statement, when no record was ever loaded", async () => {
    await expect(
      saveOrganization({
        orgId: "org-1",
        hydrated: false,
        form: defaultsForm,
        settings: mergeOrgSettings(null),
        org: null,
      })
    ).rejects.toThrow(NOT_LOADED_MESSAGE);

    // The point of the guard: nothing reached the database at all.
    expect(calls.filter((c) => c.table === "organizations")).toHaveLength(0);
  });

  it("would have nulled five columns had the unguarded write gone through", async () => {
    // Documents exactly what the guard prevents: every one of these fields is
    // `"" || null` on a never-loaded form, and timezone is forced to "UTC".
    const wouldWrite = {
      logo_url: defaultsForm.logo_url || null,
      industry: defaultsForm.industry || null,
      company_size: defaultsForm.company_size || null,
      country: defaultsForm.country.trim() || null,
      timezone: defaultsForm.timezone || "UTC",
    };
    expect(wouldWrite).toEqual({
      logo_url: null, industry: null, company_size: null, country: null, timezone: "UTC",
    });
  });

  it("writes once a real record has been loaded into the form", async () => {
    results.set("organizations:update", { data: null, error: null });
    const org = { id: "org-1", name: "Acme", country: "Pakistan" };
    await saveOrganization({
      orgId: "org-1",
      hydrated: true,
      form: { ...defaultsForm, name: "Acme", country: "Pakistan", industry: "Technology" },
      settings: mergeOrgSettings(null),
      org,
    });
    const update = calls.find((c) => c.table === "organizations" && c.op === "update");
    expect(update).toBeTruthy();
    expect(update.payload).toMatchObject({ name: "Acme", country: "Pakistan", industry: "Technology" });
  });

  it("surfaces a refused write instead of reporting success", async () => {
    results.set("organizations:update", failure("new row violates row-level security policy"));
    await expect(
      saveOrganization({
        orgId: "org-1", hydrated: true, form: { ...defaultsForm, name: "Acme" },
        settings: mergeOrgSettings(null), org: { id: "org-1", name: "Acme" },
      })
    ).rejects.toThrow(/row-level security/);
  });

  it("refuses without an org id", async () => {
    await expect(
      saveOrganization({ orgId: null, hydrated: true, form: defaultsForm, settings: {}, org: null })
    ).rejects.toThrow(NOT_LOADED_MESSAGE);
    expect(calls).toHaveLength(0);
  });
});

describe("mergeOrgSettings: a stored null must not beat the default", () => {
  it("keeps working days renderable when the column stores null", () => {
    const merged = mergeOrgSettings({ working_hours: { start: "08:00", days: null } });
    expect(Array.isArray(merged.working_hours.days)).toBe(true);
    // This is the dereference that used to throw a TypeError during render.
    expect(() => merged.working_hours.days.includes("mon")).not.toThrow();
    expect(merged.working_hours.days).toEqual(["mon", "tue", "wed", "thu", "fri"]);
    expect(merged.working_hours.start).toBe("08:00");
    expect(merged.working_hours.end).toBe("17:00");
  });

  it("keeps real stored values and ignores nulls in every section", () => {
    const merged = mergeOrgSettings({
      working_hours: { days: ["mon"] },
      notifications: { email: false, weekly_reports: null },
      security: { session_days: null, require_strong_password: true },
    });
    expect(merged.working_hours.days).toEqual(["mon"]);
    expect(merged.notifications.email).toBe(false);
    expect(merged.notifications.weekly_reports).toBe(false);
    expect(merged.security.session_days).toBe(7);
    expect(merged.security.require_strong_password).toBe(true);
  });

  it("survives a missing or malformed settings blob", () => {
    for (const stored of [null, undefined, {}, { working_hours: null }, { working_hours: "nope" }]) {
      const merged = mergeOrgSettings(stored);
      expect(merged.working_hours.days).toEqual(["mon", "tue", "wed", "thu", "fri"]);
      expect(merged.security.session_days).toBe(7);
    }
  });
});

/* ================================================================== *
 * OrganizationManagement
 * ================================================================== */

describe("fetchOrganizationSections: failed vs empty", () => {
  it("reports genuinely empty tables as empty", async () => {
    for (const t of ["departments", "teams", "memberships", "invitations"]) results.set(t, rows([]));
    await expect(fetchOrganizationSections("org-1")).resolves.toEqual({
      departments: [], teams: [], members: [], invitations: [],
    });
  });

  it("returns every section when all four reads succeed", async () => {
    results.set("departments", rows([{ id: "d1" }]));
    results.set("teams", rows([{ id: "t1" }]));
    results.set("memberships", rows([{ id: "m1" }, { id: "m2" }]));
    results.set("invitations", rows([{ id: "i1" }]));
    const out = await fetchOrganizationSections("org-1");
    expect(out.departments).toHaveLength(1);
    expect(out.members).toHaveLength(2);
  });

  it("throws when a single query fails rather than rendering 'No teams yet'", async () => {
    results.set("departments", rows([{ id: "d1" }]));
    results.set("teams", failure("permission denied for table teams"));
    results.set("memberships", rows([{ id: "m1" }]));
    results.set("invitations", rows([]));
    await expect(fetchOrganizationSections("org-1")).rejects.toThrow(/permission denied for table teams/);
  });

  it("throws when the invitations read fails", async () => {
    for (const t of ["departments", "teams", "memberships"]) results.set(t, rows([]));
    results.set("invitations", failure("500: upstream connect error"));
    await expect(fetchOrganizationSections("org-1")).rejects.toThrow(/upstream connect error/);
  });
});

/**
 * This block used to pin the two-round-trip pair — detach, then delete, with
 * the half-applied state reported rather than prevented. There is no such pair
 * any more: both writes moved into one Postgres transaction behind
 * DELETE /api/admin/teams/[id] (migration 043), so there is no ordering to
 * assert and no orphaned-members case to report. What is left to check HERE is
 * only the browser half of that move — that it goes through authFetch and not
 * through supabase, and that it never claims a success the server did not give.
 * The transaction itself, the authorisation rule and both effects are pinned in
 * tests/teamDelete.test.js.
 */
describe("deleteTeamWithMembers: one round trip to a transactional route", () => {
  const team = { id: "t1", name: "Frontend" };
  const response = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

  it("calls the server route and issues NO supabase statement of its own", async () => {
    authFetch.mockResolvedValue(response(200, { success: true, teamId: "t1", detached: 2 }));
    await expect(deleteTeamWithMembers(team)).resolves.toEqual({
      ok: true, detachedCount: 2, message: null,
    });
    expect(authFetch).toHaveBeenCalledWith("/api/admin/teams/t1", { method: "DELETE" });
    // The browser no longer writes either table — that is the whole point.
    expect(calls).toEqual([]);
  });

  it("reports a refusal without claiming anything was detached", async () => {
    authFetch.mockResolvedValue(response(403, { error: "Forbidden: your role cannot delete teams" }));
    const res = await deleteTeamWithMembers(team);
    expect(res).toEqual({
      ok: false, detachedCount: 0, message: "Forbidden: your role cannot delete teams",
    });
  });

  it("treats a 200 without `success` as a failure rather than a delete", async () => {
    authFetch.mockResolvedValue(response(200, {}));
    const res = await deleteTeamWithMembers(team);
    expect(res.ok).toBe(false);
    expect(res.detachedCount).toBe(0);
  });

  it("reports a network failure as a failure — fetch REJECTS, it does not resolve", async () => {
    authFetch.mockRejectedValue(new Error("Failed to fetch"));
    const res = await deleteTeamWithMembers(team);
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/failed to fetch/i);
  });
});

describe("copyToClipboard: no toast for a clipboard that was never written", () => {
  it("reports failure when the clipboard API is unavailable", async () => {
    vi.stubGlobal("navigator", {});
    await expect(copyToClipboard("https://app/invite/abc")).resolves.toBe(false);
    expect(alerts.showSuccess).not.toHaveBeenCalled();
    expect(alerts.showError).toHaveBeenCalled();
  });

  it("reports failure when writeText rejects (NotAllowedError)", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn(async () => { throw new Error("NotAllowedError"); }) },
    });
    await expect(copyToClipboard("https://app/invite/abc")).resolves.toBe(false);
    expect(alerts.showSuccess).not.toHaveBeenCalled();
    // The link is still offered for manual copying.
    expect(alerts.showError.mock.calls[0][1]).toContain("https://app/invite/abc");
  });

  it("confirms only after the write actually resolved", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await expect(copyToClipboard("https://app/invite/abc")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("https://app/invite/abc");
    expect(alerts.showSuccess).toHaveBeenCalled();
    expect(alerts.showError).not.toHaveBeenCalled();
  });
});

/* ================================================================== *
 * ClientManagement
 * ================================================================== */

describe("fetchClientWorkspace: failed vs empty", () => {
  const allEmpty = () => {
    for (const t of ["clients", "project_clients", "projects", "announcements", "invoices", "approvals", "support_threads"]) {
      results.set(t, rows([]));
    }
  };

  it("reports a genuinely empty workspace as empty", async () => {
    allEmpty();
    const out = await fetchClientWorkspace("org-1");
    expect(out.clients).toEqual([]);
    expect(out.threads).toEqual([]);
  });

  it("throws when the clients read fails rather than rendering 'No clients yet'", async () => {
    allEmpty();
    results.set("clients", failure("permission denied for table clients"));
    await expect(fetchClientWorkspace("org-1")).rejects.toThrow(/permission denied for table clients/);
  });

  it("throws when any later read fails", async () => {
    allEmpty();
    results.set("approvals", failure("statement timeout"));
    await expect(fetchClientWorkspace("org-1")).rejects.toThrow(/statement timeout/);
  });
});

describe("fetchClientInvitations: a 500 is not 'everything was accepted'", () => {
  it("throws on a failed request", async () => {
    authFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    await expect(fetchClientInvitations()).rejects.toThrow(/HTTP 500/);
  });

  it("throws when the payload reports failure", async () => {
    authFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: false, error: "Not authorised" }) });
    await expect(fetchClientInvitations()).rejects.toThrow(/Not authorised/);
  });

  it("throws when the response body is not JSON", async () => {
    authFetch.mockResolvedValue({ ok: false, status: 502, json: async () => { throw new Error("bad json"); } });
    await expect(fetchClientInvitations()).rejects.toThrow(/HTTP 502/);
  });

  it("returns only client invitations when the request succeeds", async () => {
    authFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        invitations: [
          { id: "1", role: "client", status: "pending" },
          { id: "2", role: "developer", status: "pending" },
        ],
      }),
    });
    await expect(fetchClientInvitations()).resolves.toEqual([{ id: "1", role: "client", status: "pending" }]);
  });

  it("treats a successful empty list as genuinely empty", async () => {
    authFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true, invitations: [] }) });
    await expect(fetchClientInvitations()).resolves.toEqual([]);
  });
});

describe("fetchThreadMessages: failed vs empty", () => {
  it("returns [] for a thread that genuinely has no messages", async () => {
    results.set("support_messages", rows([]));
    await expect(fetchThreadMessages("thread-1")).resolves.toEqual([]);
  });

  it("throws instead of rendering 'No messages in this thread yet'", async () => {
    results.set("support_messages", failure("permission denied for table support_messages"));
    await expect(fetchThreadMessages("thread-1")).rejects.toThrow(/permission denied/);
  });
});

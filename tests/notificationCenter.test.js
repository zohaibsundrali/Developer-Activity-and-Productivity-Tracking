import { describe, it, expect, afterEach, vi } from "vitest";

import {
  notificationHref,
  recipientClauses,
  dailyDedupeKey,
  windowedDedupeKey,
} from "@/utils/notifications";
import { mentionsPhrase, resolveMentions } from "@/utils/pmData";
import { mergeRows, upsertRow } from "@/hooks/useNotifications";

/**
 * The notification centre's pure logic.
 *
 * Every case here is a defect that shipped: a link to a page that reads a
 * different query param, an email interpolated into a LIKE pattern, a mention
 * parser that matched the wrong person and missed the right one, a dedupe key
 * coarse enough to swallow a real event, and a realtime handler that refilled
 * a newest-first list with old rows. They are grouped by the thing they broke.
 */

// ---------------------------------------------------------------------------
// notificationHref — the link has to match the param the target page reads
// ---------------------------------------------------------------------------

describe("notificationHref: developer surface", () => {
  // /developer/project-details reads searchParams.get('id') and nothing else.
  // Any other spelling renders the page's empty shell.
  it("identifies a project by id, the only param that page reads", () => {
    expect(notificationHref({ project_id: "p1" }, { audience: "developer" })).toBe(
      "/developer/project-details?id=p1"
    );
  });

  it("reaches a task through the project that carries it", () => {
    expect(notificationHref({ task_id: "t1", project_id: "p1" }, { audience: "developer" })).toBe(
      "/developer/project-details?id=p1"
    );
  });

  it("is not clickable when a task row cannot say which project it is in", () => {
    expect(notificationHref({ task_id: "t1" }, { audience: "developer" })).toBeNull();
  });

  it("never emits the params the page ignores", () => {
    const rows = [
      { task_id: "t1", project_id: "p1" },
      { project_id: "p1" },
      { task_id: "t1" },
      { submission_id: "s1" },
    ];
    for (const row of rows) {
      const href = notificationHref(row, { audience: "developer" });
      if (href === null) continue;
      expect(href).not.toMatch(/[?&](task|project)=/);
      expect(href).toMatch(/[?&]id=/);
    }
  });

  it("offers no link for the admin-only surfaces", () => {
    for (const row of [
      { submission_id: "s1" },
      { entity_type: "sprint" },
      { entity_type: "employee" },
      { entity_type: "team" },
    ]) {
      expect(notificationHref(row, { audience: "developer" })).toBeNull();
    }
  });
});

describe("notificationHref: admin surface", () => {
  // Every one of these `section` values is a real case in the admin dashboard's
  // switch, so each lands on the screen it names.
  it("routes each row shape to its section", () => {
    expect(notificationHref({ task_id: "t1" })).toBe("/admin/dashboard?section=board&task=t1");
    expect(notificationHref({ submission_id: "s1" })).toBe("/admin/dashboard?section=task-reviews");
    expect(notificationHref({ entity_type: "sprint" })).toBe("/admin/dashboard?section=sprints");
    expect(notificationHref({ entity_type: "employee" })).toBe("/admin/dashboard?section=employees");
    expect(notificationHref({ entity_type: "team" })).toBe("/admin/dashboard?section=team-stats");
  });

  it("uses the path-segment route for a project, not a query string", () => {
    expect(notificationHref({ project_id: "p1" })).toBe("/admin/project-details/p1");
  });

  it("prefers the most specific identifier the row carries", () => {
    expect(notificationHref({ task_id: "t1", submission_id: "s1", project_id: "p1" })).toBe(
      "/admin/dashboard?section=board&task=t1"
    );
  });
});

describe("notificationHref: rows with nothing to point at", () => {
  it("returns null rather than a link that goes nowhere", () => {
    expect(notificationHref(null)).toBeNull();
    expect(notificationHref(undefined)).toBeNull();
    expect(notificationHref({})).toBeNull();
    expect(notificationHref({ entity_type: "comment" })).toBeNull();
    expect(notificationHref({}, { audience: "developer" })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// recipientClauses — an address is a value, not a pattern
// ---------------------------------------------------------------------------

describe("recipientClauses: admin addressing", () => {
  const clausesFor = (email) => recipientClauses({ email, audience: "admin" });

  it("matches the address exactly instead of as a LIKE pattern", () => {
    const clauses = clausesFor("sara@acme.com");
    expect(clauses).toContain('admin_email.eq."sara@acme.com"');
    for (const clause of clauses) {
      expect(clause).not.toContain("ilike");
      expect(clause).not.toContain("%");
    }
  });

  // `_` is a single-character LIKE wildcard: under `ilike` this address also
  // selected john.doe@acme.com, handing one admin another admin's inbox.
  it("does not let an underscore in the local part act as a wildcard", () => {
    const clauses = clausesFor("john_doe@acme.com");
    expect(clauses).toEqual(['admin_email.eq."john_doe@acme.com"']);
    expect(clauses[0]).not.toContain("ilike");
  });

  // `%…%` containment matched sara@acme.com inside sara@acme.com.au.
  it("does not match a longer address that contains this one", () => {
    expect(clausesFor("sara@acme.com").join(",")).not.toContain("%");
  });

  // A comma or a parenthesis ends a clause in PostgREST's `or=` list, so an
  // unquoted address containing one 400s the entire query.
  it("quotes an address that would otherwise break the or= syntax", () => {
    for (const email of ['"a,b"@acme.com', "sara(work)@acme.com", "a)b@acme.com"]) {
      const clause = recipientClauses({ email, audience: "admin" })[0];
      expect(clause.startsWith('admin_email.eq."')).toBe(true);
      expect(clause.endsWith('"')).toBe(true);
      // The value survives intact once the wrapping quotes and escapes are undone.
      const inner = clause.slice('admin_email.eq."'.length, -1);
      expect(inner.replace(/\\"/g, '"').replace(/\\\\/g, "\\")).toBe(email);
    }
  });

  it("keeps a mixed-case session matching a lower-cased stored address", () => {
    const clauses = clausesFor("Sara@Acme.com");
    expect(clauses).toContain('admin_email.eq."Sara@Acme.com"');
    expect(clauses).toContain('admin_email.eq."sara@acme.com"');
  });

  it("does not duplicate a clause for an already lower-case address", () => {
    expect(clausesFor("sara@acme.com")).toHaveLength(1);
  });

  it("matches by id as well as by address", () => {
    expect(recipientClauses({ userId: "a1", email: "sara@acme.com", audience: "admin" })).toEqual([
      'admin_id.eq."a1"',
      'admin_email.eq."sara@acme.com"',
    ]);
  });
});

describe("recipientClauses: developer addressing", () => {
  it("covers both columns a developer is addressed by", () => {
    expect(recipientClauses({ userId: "d1", audience: "developer" })).toEqual([
      'developer_id.eq."d1"',
      'assigned_developer_id.eq."d1"',
    ]);
  });

  it("ignores an email, which never addresses a developer", () => {
    expect(recipientClauses({ email: "d@acme.com", audience: "developer" })).toEqual([]);
  });
});

describe("recipientClauses: no identity", () => {
  // An empty clause list is what makes the caller fall back to an impossible
  // id. Returning nothing must never be read as "no filter".
  it("produces no clauses at all", () => {
    expect(recipientClauses({ audience: "admin" })).toEqual([]);
    expect(recipientClauses({ audience: "developer" })).toEqual([]);
    expect(recipientClauses()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The mention parser — misfired in both directions
// ---------------------------------------------------------------------------

const SARA = { userId: "u-sara", userType: "developer", email: "sara@acme.com", name: "Sara Okonkwo" };
const ALI = { userId: "u-ali", userType: "developer", email: "ali@acme.com", name: "Ali" };
const ALINA = { userId: "u-alina", userType: "developer", email: "alina@acme.com", name: "Alina Costa" };

describe("mentionsPhrase", () => {
  it("accepts a mention that stands on its own", () => {
    expect(mentionsPhrase("hey @ali can you look", "ali")).toBe(true);
    expect(mentionsPhrase("@ali", "ali")).toBe(true);
    expect(mentionsPhrase("thanks @ali!", "ali")).toBe(true);
  });

  it("accepts a full stop that ends the sentence", () => {
    expect(mentionsPhrase("over to @ali.", "ali")).toBe(true);
    expect(mentionsPhrase("over to @sara okonkwo.", "sara okonkwo")).toBe(true);
  });

  it("refuses a name that is only the start of a longer one", () => {
    expect(mentionsPhrase("@alina costa please review", "ali")).toBe(false);
    expect(mentionsPhrase("@ali.hassan please review", "ali")).toBe(false);
    expect(mentionsPhrase("@ali-hassan please review", "ali")).toBe(false);
  });

  it("refuses an @ that belongs to an email address", () => {
    expect(mentionsPhrase("write to sara@acme.com", "acme.com")).toBe(false);
    expect(mentionsPhrase("write to sara@acme.com", "acme")).toBe(false);
  });

  it("is case-insensitive and finds a later occurrence", () => {
    expect(mentionsPhrase("cc @Alina Costa and @Ali", "ali")).toBe(true);
    expect(mentionsPhrase("CC @ALI", "Ali")).toBe(true);
  });

  it("treats an empty phrase as no mention", () => {
    expect(mentionsPhrase("@ali", "")).toBe(false);
    expect(mentionsPhrase("@ali", null)).toBe(false);
  });
});

describe("resolveMentions", () => {
  // A member whose first name is their email handle claimed one short form
  // twice, was marked ambiguous against themselves, and was dropped.
  it("resolves a short form when first name and email handle are the same", () => {
    expect([...resolveMentions("@sara can you review this", [SARA])]).toEqual(["u-sara"]);
  });

  it("still resolves that short form alongside other members", () => {
    const hits = resolveMentions("@sara can you review this", [SARA, ALI, ALINA]);
    expect([...hits]).toEqual(["u-sara"]);
  });

  // Mention outranks watch, so a false mention also suppressed the ordinary
  // comment notification the same person was owed.
  it("does not notify Ali about a mention of Alina", () => {
    const hits = resolveMentions("@Alina Costa please take a look", [ALI, ALINA]);
    expect(hits.has("u-ali")).toBe(false);
    expect(hits.has("u-alina")).toBe(true);
  });

  it("notifies Ali when Ali is the one named", () => {
    const hits = resolveMentions("@Ali please take a look", [ALI, ALINA]);
    expect(hits.has("u-ali")).toBe(true);
    expect(hits.has("u-alina")).toBe(false);
  });

  it("notifies both when both are named", () => {
    const hits = resolveMentions("@Alina Costa and @ali, over to you", [ALI, ALINA]);
    expect([...hits].sort()).toEqual(["u-ali", "u-alina"]);
  });

  // Genuine ambiguity is still dropped rather than guessed at.
  it("drops a short form two different members both claim", () => {
    const otherSara = { userId: "u-sara2", userType: "admin", email: "sara@other.com", name: "Sara Lee" };
    expect([...resolveMentions("@sara ping", [SARA, otherSara])]).toEqual([]);
  });

  it("stays ambiguous however many more members claim the form", () => {
    const s2 = { userId: "u-s2", userType: "admin", email: "sara@b.com", name: "Sara Lee" };
    const s3 = { userId: "u-s3", userType: "admin", email: "sara@c.com", name: "Sara Bell" };
    expect([...resolveMentions("@sara ping", [SARA, s2, s3])]).toEqual([]);
    // …and the same member listed twice is not two claimants.
    expect([...resolveMentions("@sara ping", [SARA, { ...SARA }])]).toEqual(["u-sara"]);
  });

  it("finds nothing in a body with no mention", () => {
    expect([...resolveMentions("looks good to me", [SARA, ALI])]).toEqual([]);
    expect([...resolveMentions("mail me at sara@acme.com", [SARA, ALI])]).toEqual([]);
    expect([...resolveMentions("", [SARA])]).toEqual([]);
    expect([...resolveMentions("@sara", [])]).toEqual([]);
  });

  it("ignores trailing punctuation on a hand-typed mention", () => {
    expect([...resolveMentions("over to @sara.", [SARA])]).toEqual(["u-sara"]);
    expect([...resolveMentions("over to @sara, thanks", [SARA])]).toEqual(["u-sara"]);
  });
});

// ---------------------------------------------------------------------------
// Dedupe keys — suppress replays, not genuine repeats
// ---------------------------------------------------------------------------

describe("dedupe keys", () => {
  afterEach(() => vi.useRealTimers());

  const at = (iso) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(iso));
  };

  it("keys a once-a-day event on the day", () => {
    at("2026-08-08T09:00:00Z");
    const morning = dailyDedupeKey("due_reminder", "t1", "d1");
    at("2026-08-08T21:00:00Z");
    expect(dailyDedupeKey("due_reminder", "t1", "d1")).toBe(morning);
    at("2026-08-09T09:00:00Z");
    expect(dailyDedupeKey("due_reminder", "t1", "d1")).not.toBe(morning);
  });

  it("suppresses a replay inside the window", () => {
    const WINDOW = 2 * 60 * 1000;
    at("2026-08-08T09:00:00Z");
    const first = windowedDedupeKey("status:in_progress>awaiting_approval", "t1", "d1", WINDOW);
    at("2026-08-08T09:00:03Z");
    expect(windowedDedupeKey("status:in_progress>awaiting_approval", "t1", "d1", WINDOW)).toBe(first);
  });

  // "Sent back for changes, then resubmitted" walks the same transition twice
  // in one day, and the second submission is the one a reviewer is waiting on.
  // Keyed on the destination status and the calendar day it was never sent.
  it("announces a genuine repeat of the same transition later the same day", () => {
    const WINDOW = 2 * 60 * 1000;
    at("2026-08-08T09:00:00Z");
    const submitted = windowedDedupeKey("status:in_progress>awaiting_approval", "t1", "d1", WINDOW);
    const dayKeyed = dailyDedupeKey("status_awaiting_approval", "t1", "d1");

    at("2026-08-08T14:30:00Z"); // sent back at 11:00, resubmitted at 14:30
    expect(windowedDedupeKey("status:in_progress>awaiting_approval", "t1", "d1", WINDOW)).not.toBe(submitted);
    // The key this replaced: identical, so the resubmission was swallowed.
    expect(dailyDedupeKey("status_awaiting_approval", "t1", "d1")).toBe(dayKeyed);
  });

  it("separates tasks, recipients and transitions", () => {
    const W = 60_000;
    at("2026-08-08T09:00:00Z");
    const base = windowedDedupeKey("status:a>b", "t1", "d1", W);
    expect(windowedDedupeKey("status:a>b", "t2", "d1", W)).not.toBe(base);
    expect(windowedDedupeKey("status:a>b", "t1", "d2", W)).not.toBe(base);
    expect(windowedDedupeKey("status:b>a", "t1", "d1", W)).not.toBe(base);
  });
});

// ---------------------------------------------------------------------------
// The realtime list — what may join it, and what may fall off it
// ---------------------------------------------------------------------------

const row = (id, over = {}) => ({ id, category: "comment", read: false, ...over });

describe("mergeRows", () => {
  it("keeps every row the user paged to, past the realtime ceiling", () => {
    const first = Array.from({ length: 200 }, (_, i) => row(`r${i}`));
    const next = Array.from({ length: 15 }, (_, i) => row(`n${i}`));
    // Truncating here is what made "load more" spin and change nothing.
    expect(mergeRows(first, next)).toHaveLength(215);
    expect(mergeRows(first, next).at(-1).id).toBe("n14");
  });

  it("does not show a row twice when it also arrived live", () => {
    const merged = mergeRows([row("a"), row("b")], [row("b"), row("c")]);
    expect(merged.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });
});

describe("upsertRow", () => {
  const opts = { category: null, unreadOnly: false };

  it("folds an update into the row already on screen", () => {
    const next = upsertRow([row("a"), row("b")], { id: "b", read: true }, { ...opts, isInsert: false });
    expect(next.map((r) => r.id)).toEqual(["a", "b"]);
    expect(next[1].read).toBe(true);
    // The rest of the row survives a partial payload.
    expect(next[1].category).toBe("comment");
  });

  // "Mark all as read" emits one event per row. Prepending the ones that were
  // not loaded refilled a newest-first list with old, read rows in WAL order.
  it("does not prepend an update for a row that is not loaded", () => {
    const existing = [row("a")];
    expect(upsertRow(existing, row("z", { read: true }), { ...opts, isInsert: false })).toBe(existing);
  });

  it("prepends a genuinely new notification", () => {
    expect(upsertRow([row("a")], row("z"), { ...opts, isInsert: true }).map((r) => r.id)).toEqual(["z", "a"]);
  });

  it("keeps a new row out of a list filtered past it", () => {
    const existing = [row("a")];
    expect(upsertRow(existing, row("z", { category: "mention" }), { category: "comment", isInsert: true })).toBe(
      existing
    );
    expect(upsertRow(existing, row("z", { read: true }), { unreadOnly: true, isInsert: true })).toBe(existing);
  });

  it("lets a live insert bound the list without undoing pages the user asked for", () => {
    const paged = Array.from({ length: 260 }, (_, i) => row(`r${i}`));
    const next = upsertRow(paged, row("new"), { ...opts, isInsert: true });
    expect(next).toHaveLength(260);
    expect(next[0].id).toBe("new");
    expect(next.at(-1).id).toBe("r258");
  });

  it("grows a short list up to the ceiling", () => {
    const short = Array.from({ length: 10 }, (_, i) => row(`r${i}`));
    expect(upsertRow(short, row("new"), { ...opts, isInsert: true })).toHaveLength(11);
  });
});

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";

/**
 * The session context the data layer reads its identity from. Mutable so a test
 * can take the session away; never a parameter to the functions under test,
 * which is itself one of the things asserted below.
 */
const ctx = { organizationId: "org-1", userId: "u-1", userType: "developer" };

vi.mock("@/utils/orgContext", () => ({
  getOrgId: () => ctx.organizationId,
  getOrgContext: () => (ctx.userId ? { ...ctx } : null),
  isMembershipActive: () => true,
  scopeToOrg: (query) => query,
  loadOrgContext: async () => ({}),
}));

/**
 * A Supabase stand-in that records the query instead of sending it.
 *
 * What these tests are about is the shape of the request — which predicates a
 * read carries, which columns a write fills in, which unique index an upsert
 * names — so the response is fixed and the query is the assertion. Every
 * builder method returns the builder, and awaiting it resolves `db.response`.
 */
const db = { queries: [], response: { data: [], error: null, count: 0 } };

vi.mock("@/utils/supabaseClient", () => {
  const makeBuilder = (table) => {
    const record = { table, op: "select", columns: null, payload: null, options: null, filters: [] };
    db.queries.push(record);

    const builder = {
      select(columns, options) {
        record.columns = columns;
        record.selectOptions = options || null;
        return builder;
      },
      insert(payload) {
        record.op = "insert";
        record.payload = payload;
        return builder;
      },
      update(payload) {
        record.op = "update";
        record.payload = payload;
        return builder;
      },
      upsert(payload, options) {
        record.op = "upsert";
        record.payload = payload;
        record.options = options || null;
        return builder;
      },
      eq(column, value) {
        record.filters.push(["eq", column, value]);
        return builder;
      },
      is(column, value) {
        record.filters.push(["is", column, value]);
        return builder;
      },
      or(expression) {
        record.filters.push(["or", expression]);
        return builder;
      },
      order(column, options) {
        record.filters.push(["order", column, options]);
        return builder;
      },
      range(from, to) {
        record.filters.push(["range", from, to]);
        return builder;
      },
      then(onFulfilled, onRejected) {
        return Promise.resolve(db.response).then(onFulfilled, onRejected);
      },
    };
    return builder;
  };

  return { supabase: { from: (table) => makeBuilder(table) } };
});

import {
  notificationHref,
  recipientClauses,
  dailyDedupeKey,
  windowedDedupeKey,
  dismissNotification,
  fetchNotifications,
  getUnreadCount,
  markAllRead,
  fetchNotificationPreferences,
  setNotificationPreference,
  CATEGORY_KEYS,
  categoryMeta,
} from "@/utils/notifications";
import { mentionsPhrase, resolveMentions } from "@/utils/pmData";
import { mergeRows, upsertRow } from "@/hooks/useNotifications";

const lastQuery = () => db.queries[db.queries.length - 1];
const hasFilter = (record, op, column, value) =>
  record.filters.some(([o, c, v]) => o === op && c === column && v === value);

beforeEach(() => {
  db.queries = [];
  db.response = { data: [], error: null, count: 0 };
  ctx.organizationId = "org-1";
  ctx.userId = "u-1";
  ctx.userType = "developer";
});

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

  // A dismissal reaches the panel as an ordinary UPDATE. Folded in place it
  // would restyle a row that no longer exists as far as every query is
  // concerned, and offer to dismiss it again.
  it("takes a row off the list when it is dismissed elsewhere", () => {
    const existing = [row("a"), row("b"), row("c")];
    const next = upsertRow(existing, { id: "b", dismissed_at: "2026-08-08T09:00:00Z" }, { ...opts, isInsert: false });
    expect(next.map((r) => r.id)).toEqual(["a", "c"]);
  });

  it("ignores a dismissal for a row that is not loaded", () => {
    const existing = [row("a")];
    expect(upsertRow(existing, { id: "z", dismissed_at: "2026-08-08T09:00:00Z" }, { ...opts, isInsert: true })).toBe(
      existing
    );
  });

  it("never lets a dismissed row arrive as a new one", () => {
    const existing = [row("a")];
    const next = upsertRow(existing, row("z", { dismissed_at: "2026-08-08T09:00:00Z" }), { ...opts, isInsert: true });
    expect(next.map((r) => r.id)).toEqual(["a"]);
  });
});

// ---------------------------------------------------------------------------
// Dismissal — the row leaves the list, not the table
// ---------------------------------------------------------------------------

describe("dismissNotification", () => {
  it("refuses a call with no id rather than writing to every row", async () => {
    const { error } = await dismissNotification(null);
    expect(error).toBeInstanceOf(Error);
    // An UPDATE with no `eq` is an UPDATE of the whole table.
    expect(db.queries).toHaveLength(0);
  });

  // Deleting the row takes the record of what was sent with it, and "I never
  // got that" is the question the log exists to answer.
  it("stamps dismissed_at instead of deleting the notification", async () => {
    await dismissNotification("n1");
    const query = lastQuery();
    expect(query.table).toBe("notifications");
    expect(query.op).toBe("update");
    expect(Object.keys(query.payload)).toEqual(["dismissed_at"]);
    expect(query.payload.dismissed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(hasFilter(query, "eq", "id", "n1")).toBe(true);
  });

  it("leaves an already-dismissed row's timestamp where it is", async () => {
    await dismissNotification("n1");
    // A second click, or a retry after a slow response, must not restate when
    // the notification left the list.
    expect(hasFilter(lastQuery(), "is", "dismissed_at", null)).toBe(true);
  });

  it("reports a failed dismissal rather than swallowing it", async () => {
    db.response = { data: null, error: new Error("nope") };
    const { error } = await dismissNotification("n1");
    expect(error).toBeInstanceOf(Error);
  });
});

describe("dismissed rows are excluded everywhere they are counted or listed", () => {
  it("keeps them out of the list", async () => {
    await fetchNotifications({ userId: "u-1", audience: "developer" });
    expect(hasFilter(lastQuery(), "is", "dismissed_at", null)).toBe(true);
  });

  // The badge and the list have to agree: a number counting a row the list
  // cannot show is a number the user has no way to clear.
  it("keeps them out of the unread count", async () => {
    await getUnreadCount({ userId: "u-1", audience: "developer" });
    const query = lastQuery();
    expect(query.selectOptions).toEqual({ count: "exact", head: true });
    expect(hasFilter(query, "eq", "read", false)).toBe(true);
    expect(hasFilter(query, "is", "dismissed_at", null)).toBe(true);
  });

  it("keeps them out of what 'mark all as read' writes to", async () => {
    await markAllRead({ userId: "u-1", audience: "developer" });
    expect(hasFilter(lastQuery(), "is", "dismissed_at", null)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Preferences — an absent row means enabled
// ---------------------------------------------------------------------------

describe("fetchNotificationPreferences", () => {
  it("treats a user with no saved rows as wanting everything", async () => {
    db.response = { data: [], error: null };
    const { preferences, error } = await fetchNotificationPreferences();
    expect(error).toBeNull();
    expect(Object.keys(preferences).sort()).toEqual([...CATEGORY_KEYS].sort());
    expect(Object.values(preferences).every((value) => value === true)).toBe(true);
  });

  it("reports only the categories that were switched off", async () => {
    db.response = {
      data: [
        { category: "comment", enabled: false },
        { category: "mention", enabled: true },
      ],
      error: null,
    };
    const { preferences } = await fetchNotificationPreferences();
    expect(preferences.comment).toBe(false);
    expect(preferences.mention).toBe(true);
    expect(preferences.deadline).toBe(true);
  });

  it("reads only this user's rows, in this organization", async () => {
    await fetchNotificationPreferences();
    const query = lastQuery();
    expect(query.table).toBe("notification_preferences");
    expect(hasFilter(query, "eq", "user_id", "u-1")).toBe(true);
    expect(hasFilter(query, "eq", "organization_id", "org-1")).toBe(true);
  });

  // A row for a category this build no longer offers would become a switch with
  // no label and no explanation.
  it("ignores a stored category the app no longer has", async () => {
    db.response = { data: [{ category: "carrier_pigeon", enabled: false }], error: null };
    const { preferences } = await fetchNotificationPreferences();
    expect("carrier_pigeon" in preferences).toBe(false);
  });

  // A panel that cannot read the table must still render its switches; it says
  // so alongside them rather than showing nothing.
  it("still returns a usable set of defaults when the read fails", async () => {
    db.response = { data: null, error: new Error("offline") };
    const { preferences, error } = await fetchNotificationPreferences();
    expect(error).toBeInstanceOf(Error);
    expect(preferences.mention).toBe(true);
  });

  it("does not query at all without a session", async () => {
    ctx.userId = null;
    const { preferences, error } = await fetchNotificationPreferences();
    expect(error).toBeInstanceOf(Error);
    expect(db.queries).toHaveLength(0);
    expect(preferences.mention).toBe(true);
  });
});

describe("setNotificationPreference", () => {
  it("mutes a category by writing enabled=false for the signed-in user", async () => {
    await setNotificationPreference("comment", false);
    const query = lastQuery();
    expect(query.table).toBe("notification_preferences");
    expect(query.op).toBe("upsert");
    expect(query.payload).toMatchObject({
      organization_id: "org-1",
      user_id: "u-1",
      user_type: "developer",
      category: "comment",
      enabled: false,
    });
  });

  // The trigger tests `not enabled`, so an enabled row and an absent row behave
  // the same — keeping the row records that the choice was made and reversed.
  it("unmutes by flipping the row rather than deleting it", async () => {
    await setNotificationPreference("comment", true);
    const query = lastQuery();
    expect(query.op).toBe("upsert");
    expect(query.payload.enabled).toBe(true);
  });

  // `uq_notification_prefs_user_category` is on exactly these two columns.
  // Naming any other set matches no unique index, and the second time a user
  // touched a switch it would fail instead of updating.
  it("names the unique index that actually exists", async () => {
    await setNotificationPreference("mention", false);
    expect(lastQuery().options).toEqual({ onConflict: "user_id,category" });
  });

  // Muting is per-person. A caller that could name the user is a way to stop
  // someone else hearing about something.
  it("takes its identity from the session and not from the caller", async () => {
    await setNotificationPreference("mention", false, {
      userId: "someone-else",
      organizationId: "another-org",
    });
    expect(lastQuery().payload).toMatchObject({ user_id: "u-1", organization_id: "org-1" });
  });

  it("carries the user type the session says, for either audience", async () => {
    ctx.userType = "admin";
    await setNotificationPreference("review", false);
    expect(lastQuery().payload.user_type).toBe("admin");
  });

  it("refuses a category that is not one of ours", async () => {
    const { error } = await setNotificationPreference("carrier_pigeon", false);
    expect(error).toBeInstanceOf(Error);
    expect(db.queries).toHaveLength(0);
  });

  it("refuses an empty category rather than writing a row nothing matches", async () => {
    for (const category of [null, undefined, ""]) {
      const { error } = await setNotificationPreference(category, false);
      expect(error).toBeInstanceOf(Error);
    }
    expect(db.queries).toHaveLength(0);
  });

  it("writes nothing when there is no session to attribute it to", async () => {
    ctx.userId = null;
    const { error } = await setNotificationPreference("mention", false);
    expect(error).toBeInstanceOf(Error);
    expect(db.queries).toHaveLength(0);
  });

  it("writes nothing when the session carries no organization", async () => {
    // The RLS policy checks organization_id AND user_id; a row with a null org
    // is refused by the database, so it is refused here with a reason instead.
    ctx.organizationId = null;
    const { error } = await setNotificationPreference("mention", false);
    expect(error).toBeInstanceOf(Error);
    expect(db.queries).toHaveLength(0);
  });
});

/**
 * Signals in the notification centre.
 *
 * The engine that writes these lives in src/utils/signals.js and the delivery
 * in job 4 of /api/cron. What is tested here is only the seam: that a signal
 * row is recognised as its own thing rather than quietly becoming "General".
 */
describe("the signal category", () => {
  it("exists, so signals can be filtered and switched off on their own", () => {
    // Falling through to `general` would have looked like it worked while
    // making both impossible: no filter, and no preference row to toggle.
    expect(CATEGORY_KEYS).toContain("signal");
    expect(categoryMeta("signal").label).toBe("Needs attention");
    expect(categoryMeta("signal")).not.toEqual(categoryMeta("general"));
  });

  it("carries a tone the semantic classes already define", () => {
    // The dropdown maps `tone` onto existing colours; an invented one renders
    // unstyled.
    const tones = CATEGORY_KEYS.map((k) => categoryMeta(k).tone);
    expect(new Set(tones)).toEqual(new Set(["info", "primary", "muted", "warning", "success"]));
  });

  it("links a signal to somewhere that exists", () => {
    // A project signal goes to the project…
    expect(notificationHref({ category: "signal", project_id: "p1" }, { audience: "admin" })).toBe(
      "/admin/project-details/p1"
    );
    // …a sprint signal to the sprints board…
    expect(
      notificationHref({ category: "signal", entity_type: "sprint" }, { audience: "admin" })
    ).toMatch(/section=sprints/);
    // …and everything else to the overview, where the panel is.
    expect(notificationHref({ category: "signal" }, { audience: "admin" })).toMatch(
      /section=overview/
    );
  });

  it("gives a developer audience no signal link at all", () => {
    // Signals are addressed only to owner, admin, hr and managers. A developer
    // reaching this is already a bug elsewhere; it must not become a link.
    expect(notificationHref({ category: "signal" }, { audience: "developer" })).toBeNull();
  });
});

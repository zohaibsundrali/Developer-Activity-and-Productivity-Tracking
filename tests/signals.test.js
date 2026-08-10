import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  detectActivityDrop,
  detectTrackingSilence,
  detectReviewBacklog,
  detectStalledTasks,
  detectOverdue,
  detectSprintRisk,
  detectPlanPressure,
  runDetectors,
  filterForViewer,
  personKey,
  isBeforeDay,
  workingDaysBetween,
  dayKey,
  plural,
  hours,
  DEFAULTS,
} from "@/utils/signals";

/**
 * The detectors.
 *
 * Every one of these makes a claim about a named human being, so the tests are
 * weighted towards the cases where a signal must NOT fire. A missed signal
 * costs a conversation that happens a week later; a false one starts a
 * conversation that should never have happened at all, about somebody who was
 * on annual leave.
 */

const root = path.resolve(__dirname, "..");
const NOW = new Date("2026-08-10T12:00:00Z");
const HOUR = 3600;
const ago = (days) => new Date(NOW.getTime() - days * 86400000).toISOString();
const ahead = (days) => new Date(NOW.getTime() + days * 86400000).toISOString();

/** `count` sessions of `secs` each, spread one per day starting `fromDays` ago. */
function sessions(userId, fromDays, count, secs) {
  return Array.from({ length: count }, (_, i) => ({
    user_id: userId,
    user_email: `${userId}@example.test`,
    start_time: ago(fromDays - i),
    active_duration: secs,
  }));
}

describe("activity drop — compares a person to themselves", () => {
  // 28 baseline days at 4h/day = 112h over 4 weeks = 28h/week.
  const baseline = sessions("u1", 35, 28, 4 * HOUR);

  it("fires when this week is less than half their own normal", () => {
    const thisWeek = sessions("u1", 6, 7, 1 * HOUR); // 7h vs 28h
    const out = detectActivityDrop([...baseline, ...thisWeek], { "u1@example.test": "Ali" }, NOW);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("activity_drop");
    expect(out[0].title).toMatch(/Ali/);
    expect(out[0].metric.value).toBe(7);
    expect(out[0].metric.baseline).toBe(28);
  });

  it("does NOT fire on a normal week", () => {
    const thisWeek = sessions("u1", 6, 7, 4 * HOUR);
    expect(detectActivityDrop([...baseline, ...thisWeek], {}, NOW)).toEqual([]);
  });

  it("does NOT fire on a mild dip", () => {
    // 21h against a 28h baseline — three quarters. A person having a slower
    // week is not an incident.
    const thisWeek = sessions("u1", 6, 7, 3 * HOUR);
    expect(detectActivityDrop([...baseline, ...thisWeek], {}, NOW)).toEqual([]);
  });

  it("does NOT fire for somebody with no baseline worth comparing", () => {
    // Rule 2: 40 minutes of history is not a trend, and "down 100%" about a
    // rounding error is the noise that teaches people to ignore the rest.
    const thin = sessions("u2", 30, 2, 20 * 60);
    expect(detectActivityDrop(thin, {}, NOW)).toEqual([]);
  });

  it("does NOT fire for a brand-new joiner with no history at all", () => {
    const justStarted = sessions("u3", 2, 2, 6 * HOUR);
    expect(detectActivityDrop(justStarted, {}, NOW)).toEqual([]);
  });

  it("escalates to critical only on a severe drop", () => {
    const mild = detectActivityDrop([...baseline, ...sessions("u1", 6, 7, 1.2 * HOUR)], {}, NOW);
    const severe = detectActivityDrop([...baseline, ...sessions("u1", 6, 2, 1 * HOUR)], {}, NOW);
    expect(mild[0].severity).toBe("warning");
    expect(severe[0].severity).toBe("critical");
  });

  it("never compares two people to each other", () => {
    // A high performer and a low one, each perfectly steady. Neither is a
    // signal — a league table of keystrokes is what makes this kind of product
    // hated, and it is also just wrong.
    const busy = [...sessions("a", 35, 28, 8 * HOUR), ...sessions("a", 6, 7, 8 * HOUR)];
    const quiet = [...sessions("b", 35, 28, 2 * HOUR), ...sessions("b", 6, 7, 2 * HOUR)];
    expect(detectActivityDrop([...busy, ...quiet], {}, NOW)).toEqual([]);
  });

  it("ignores sessions dated in the future", () => {
    // A clock-skewed row 99 hours long must not be able to invent a healthy
    // week — nor, by landing in the baseline, to invent a drop. Held against a
    // normal week so the future row is the only variable.
    const thisWeek = sessions("u1", 6, 7, 4 * HOUR);
    const future = [{ user_id: "u1", start_time: ahead(5), active_duration: 99 * HOUR }];
    expect(detectActivityDrop([...baseline, ...thisWeek, ...future], {}, NOW)).toEqual([]);

    // And it cannot rescue a week that really did collapse.
    const collapsed = sessions("u1", 6, 7, 0.5 * HOUR);
    const out = detectActivityDrop([...baseline, ...collapsed, ...future], {}, NOW);
    expect(out).toHaveLength(1);
    expect(out[0].metric.value).toBe(3.5); // the future 99h is nowhere in it
  });

  it("fires when a strong baseline meets a week of nothing at all", () => {
    // No current-week rows whatsoever. This is the shape a departure, a broken
    // agent or a fortnight's leave takes, and it is the case most worth
    // catching — so it must not depend on there being a row to compare.
    const out = detectActivityDrop(baseline, { "u1@example.test": "Ali" }, NOW);
    expect(out).toHaveLength(1);
    expect(out[0].severity).toBe("critical");
    expect(out[0].metric.value).toBe(0);
  });

  it("survives malformed rows without throwing", () => {
    const junk = [
      { user_id: null, start_time: null, active_duration: null },
      { user_id: "u1", start_time: "not-a-date", active_duration: "x" },
      {},
    ];
    expect(() => detectActivityDrop(junk, {}, NOW)).not.toThrow();
  });

  it("names the person, and says what it might be other than slacking", () => {
    const out = detectActivityDrop([...baseline, ...sessions("u1", 6, 7, 1 * HOUR)], { "u1@example.test": "Ali" }, NOW);
    expect(out[0].message).toMatch(/leave, illness/i);
  });
});

describe("tracking silence — usually a broken agent", () => {
  it("fires when somebody who was tracking has gone quiet", () => {
    const out = detectTrackingSilence(sessions("u1", 20, 10, 4 * HOUR), { "u1@example.test": "Sara" }, NOW);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("tracking_silent");
    expect(out[0].message).toMatch(/desktop agent/i);
  });

  it("does NOT fire for somebody who tracked yesterday", () => {
    expect(detectTrackingSilence(sessions("u1", 5, 5, 4 * HOUR), {}, NOW)).toEqual([]);
  });

  it("does NOT fire for somebody who was never tracking", () => {
    // Silence from a person with no recent history is not new information.
    expect(detectTrackingSilence(sessions("u1", 200, 5, 4 * HOUR), {}, NOW)).toEqual([]);
  });
});

describe("review backlog — the one nobody blocked by it can clear", () => {
  const waiting = (days, n = 1) =>
    Array.from({ length: n }, (_, i) => ({ id: `s${i}`, is_reviewed: false, submitted_at: ago(days) }));

  it("fires once for the whole queue, not once per submission", () => {
    const out = detectReviewBacklog(waiting(5, 6), NOW);
    expect(out).toHaveLength(1);
    expect(out[0].metric.value).toBe(6);
  });

  it("ignores anything already reviewed", () => {
    const reviewed = [{ id: "x", is_reviewed: true, submitted_at: ago(30) }];
    expect(detectReviewBacklog(reviewed, NOW)).toEqual([]);
  });

  it("ignores a submission from this morning", () => {
    expect(detectReviewBacklog(waiting(0.2, 3), NOW)).toEqual([]);
  });

  it("goes critical only once something has waited a week", () => {
    expect(detectReviewBacklog(waiting(4), NOW)[0].severity).toBe("warning");
    expect(detectReviewBacklog(waiting(9), NOW)[0].severity).toBe("critical");
  });

  it("counts in grammatical English", () => {
    expect(detectReviewBacklog(waiting(4, 1), NOW)[0].title).toMatch(/A submission has waited/);
    expect(detectReviewBacklog(waiting(4, 2), NOW)[0].title).toMatch(/2 submissions are waiting/);
  });
});

describe("stalled and overdue work", () => {
  it("flags assigned tasks that have not moved", () => {
    const tasks = [
      { id: "t1", developer_id: "d1", status: "in_progress", updated_at: ago(20) },
      { id: "t2", developer_id: "d1", status: "in_progress", updated_at: ago(1) },
    ];
    const out = detectStalledTasks(tasks, NOW);
    expect(out[0].metric.value).toBe(1);
  });

  it("ignores finished work and unassigned work", () => {
    const tasks = [
      { id: "t1", developer_id: "d1", status: "completed", updated_at: ago(60) },
      { id: "t2", developer_id: "d1", status: "reviewed", updated_at: ago(60) },
      { id: "t3", developer_id: null, status: "pending", updated_at: ago(60) },
    ];
    expect(detectStalledTasks(tasks, NOW)).toEqual([]);
  });

  it("groups overdue work per project and needs a real pile", () => {
    const two = [
      { id: "1", project_id: "p1", status: "in_progress", due_date: ago(2) },
      { id: "2", project_id: "p1", status: "in_progress", due_date: ago(3) },
    ];
    expect(detectOverdue(two, { p1: "Apollo" }, NOW)).toEqual([]);

    const four = [...two,
      { id: "3", project_id: "p1", status: "in_progress", due_date: ago(4) },
      { id: "4", project_id: "p1", status: "in_progress", due_date: ago(5) },
    ];
    const out = detectOverdue(four, { p1: "Apollo" }, NOW);
    expect(out).toHaveLength(1);
    expect(out[0].title).toMatch(/4 overdue tasks on Apollo/);
  });

  it("falls back to end_date when there is no due_date", () => {
    const tasks = Array.from({ length: 3 }, (_, i) => ({
      id: `t${i}`, project_id: "p1", status: "in_progress", due_date: null, end_date: ago(9),
    }));
    expect(detectOverdue(tasks, { p1: "Apollo" }, NOW)).toHaveLength(1);
  });
});

describe("sprint risk", () => {
  const sprint = { id: "sp1", name: "Sprint 7", status: "active", end_date: ahead(2) };
  const tasksFor = (done, open) => [
    ...Array.from({ length: done }, (_, i) => ({ id: `d${i}`, sprint_id: "sp1", status: "completed" })),
    ...Array.from({ length: open }, (_, i) => ({ id: `o${i}`, sprint_id: "sp1", status: "in_progress" })),
  ];

  it("fires when a sprint ending soon still has most of its work open", () => {
    const out = detectSprintRisk([sprint], tasksFor(2, 8), NOW);
    expect(out).toHaveLength(1);
    expect(out[0].metric).toMatchObject({ value: 8, total: 10, daysLeft: 2 });
  });

  it("stays quiet when the sprint is nearly done", () => {
    expect(detectSprintRisk([sprint], tasksFor(9, 1), NOW)).toEqual([]);
  });

  it("stays quiet early in a sprint, however much is open", () => {
    const early = { ...sprint, end_date: ahead(11) };
    expect(detectSprintRisk([early], tasksFor(0, 10), NOW)).toEqual([]);
  });

  it("ignores sprints that are not active, and ones already ended", () => {
    expect(detectSprintRisk([{ ...sprint, status: "planned" }], tasksFor(0, 10), NOW)).toEqual([]);
    expect(detectSprintRisk([{ ...sprint, end_date: ago(1) }], tasksFor(0, 10), NOW)).toEqual([]);
  });

  it("ignores an empty sprint rather than dividing by zero", () => {
    expect(detectSprintRisk([sprint], [], NOW)).toEqual([]);
  });
});

describe("plan pressure", () => {
  it("warns near the limit and escalates at it", () => {
    const near = { developers: { label: "Developers", used: 8, limit: 10, unlimited: false } };
    const full = { developers: { label: "Developers", used: 10, limit: 10, unlimited: false } };
    expect(detectPlanPressure(near, NOW)[0].severity).toBe("warning");
    expect(detectPlanPressure(full, NOW)[0].severity).toBe("critical");
    expect(detectPlanPressure(full, NOW)[0].title).toMatch(/limit reached/);
  });

  it("says nothing about an unlimited meter, or one with room", () => {
    expect(detectPlanPressure({ x: { label: "X", used: 999, unlimited: true } }, NOW)).toEqual([]);
    expect(detectPlanPressure({ x: { label: "X", used: 2, limit: 10 } }, NOW)).toEqual([]);
  });
});

describe("the whole run", () => {
  it("returns nothing for an empty workspace", () => {
    // The state of this deployment today. A brand-new workspace must not open
    // to a wall of warnings about having no data.
    expect(runDetectors({}, NOW)).toEqual([]);
    expect(
      runDetectors({ sessions: [], submissions: [], tasks: [], sprints: [], usage: {} }, NOW)
    ).toEqual([]);
  });

  it("sorts worst first", () => {
    const out = runDetectors(
      {
        submissions: [{ id: "s", is_reviewed: false, submitted_at: ago(30) }], // critical
        tasks: [{ id: "t", developer_id: "d", status: "in_progress", updated_at: ago(30) }], // info
      },
      NOW
    );
    expect(out.map((s) => s.severity)).toEqual(["critical", "info"]);
  });

  it("gives every signal a dedupe key that changes once a day", () => {
    const out = runDetectors(
      { submissions: [{ id: "s", is_reviewed: false, submitted_at: ago(9) }] },
      NOW
    );
    expect(out[0].dedupeKey).toContain(dayKey(NOW));

    const tomorrow = new Date(NOW.getTime() + 86400000);
    const later = runDetectors(
      { submissions: [{ id: "s", is_reviewed: false, submitted_at: ago(9) }] },
      tomorrow
    );
    expect(later[0].dedupeKey).not.toBe(out[0].dedupeKey);
  });

  it("is deterministic — same input, same order", () => {
    const input = {
      submissions: [{ id: "s", is_reviewed: false, submitted_at: ago(9) }],
      tasks: [
        { id: "1", project_id: "p1", status: "in_progress", due_date: ago(2), developer_id: "d" },
        { id: "2", project_id: "p1", status: "in_progress", due_date: ago(3), developer_id: "d" },
        { id: "3", project_id: "p1", status: "in_progress", due_date: ago(4), developer_id: "d" },
      ],
    };
    expect(runDetectors(input, NOW)).toEqual(runDetectors(input, NOW));
  });
});

describe("helpers", () => {
  it("never writes '1 days'", () => {
    expect(plural(1, "day")).toBe("1 day");
    expect(plural(2, "day")).toBe("2 days");
    expect(plural(0, "day")).toBe("0 days");
  });

  it("reports hours to one decimal", () => {
    expect(hours(3600)).toBe(1);
    expect(hours(5400)).toBe(1.5);
    expect(hours(null)).toBe(0);
  });
});

describe("thresholds are all in one place", () => {
  it("so tuning does not mean hunting through functions", () => {
    const src = readFileSync(path.join(root, "src/utils/signals.js"), "utf8");
    const body = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    // Detectors read from the merged options object, never from a literal.
    const detectorBodies = body.slice(body.indexOf("export function detectActivityDrop"));
    expect(detectorBodies).toMatch(/const o = \{ \.\.\.DEFAULTS, \.\.\.opts \}/);
    expect(Object.keys(DEFAULTS).length).toBeGreaterThan(10);
  });
});

/**
 * The bugs an adversarial review found in the first version of this file.
 *
 * Each of these shipped a false accusation about a named person, or silently
 * disabled the feature for a whole role. They are grouped together because the
 * lesson is shared: every one of them was invisible to the original tests,
 * which asserted the SHAPE of the code rather than running it.
 */
describe("regressions the review caught", () => {
  it("keys a person by email, so one human is never two buckets", () => {
    // `productivity_sessions.user_id` is nullable and unreliable — migration
    // 050 records that every user_id on 458 orphan rows was in fact an address.
    // Keying on `user_id || user_email` split a person the moment their rows
    // disagreed, and produced "tracked time down 100%" about a normal week.
    const baseline = Array.from({ length: 28 }, (_, i) => ({
      user_id: "dev-uuid",
      user_email: "sara@x.test",
      start_time: ago(35 - i),
      active_duration: 6 * HOUR,
    }));
    const thisWeek = Array.from({ length: 7 }, (_, i) => ({
      user_id: null, // the agent stopped sending it
      user_email: "sara@x.test",
      start_time: ago(6 - i),
      active_duration: 6 * HOUR,
    }));
    expect(detectActivityDrop([...baseline, ...thisWeek], {}, NOW)).toEqual([]);

    expect(personKey({ user_id: "uuid", user_email: "A@X.test" })).toBe("a@x.test");
    expect(personKey({ user_id: "uuid", user_email: null })).toBe("uuid");
    expect(personKey({})).toBeNull();
  });

  it("divides the baseline by weeks OBSERVED, not by a fixed four", () => {
    // Joined two weeks ago at 40h/wk, then a genuinely awful 8h week. A fixed
    // /4 divisor called the baseline 10h, the ratio 0.8, and said nothing —
    // an 80% collapse reported as normal.
    const joined = Array.from({ length: 7 }, (_, i) => ({
      user_id: "n1", user_email: "new@x.test",
      start_time: ago(13 - i), active_duration: 8 * HOUR,
    }));
    const bad = Array.from({ length: 2 }, (_, i) => ({
      user_id: "n1", user_email: "new@x.test",
      start_time: ago(3 - i), active_duration: 4 * HOUR,
    }));
    const out = detectActivityDrop([...joined, ...bad], {}, NOW);
    expect(out).toHaveLength(1);
    // Six baseline days at 8h — their real week. The fixed divisor would have
    // called it 12h, made the ratio 1.33, and said nothing at all.
    expect(out[0].metric.baseline).toBe(48);
    // 16h against 48h is a third — a real drop, and one the fixed divisor
    // reported as a healthy week.
    expect(out[0].metric.value).toBe(16);
  });

  it("does not fire on a four-day week, every Monday, for ever", () => {
    // NOW is a Monday. Last session Thursday = 3 calendar days but only 2
    // working days. Counting calendar days made this fire weekly for anyone
    // not working Fridays.
    const monday = new Date("2026-08-10T09:00:00Z");
    expect(monday.getUTCDay()).toBe(1);
    const fourDayWeek = [];
    for (let w = 0; w < 3; w += 1) {
      for (const d of [7, 6, 5, 4]) {
        fourDayWeek.push({
          user_id: "p1", user_email: "part@x.test",
          start_time: new Date(monday.getTime() - (w * 7 + d) * 86400000).toISOString(),
          active_duration: 7 * HOUR,
        });
      }
    }
    expect(detectTrackingSilence(fourDayWeek, {}, monday)).toEqual([]);
    expect(workingDaysBetween(new Date("2026-08-06T09:00:00Z").getTime(), monday.getTime())).toBe(2);
  });

  it("does not call a contractor with one old session a regular tracker", () => {
    const once = [{ user_id: "c1", user_email: "c@x.test", start_time: ago(29), active_duration: 8 * HOUR }];
    expect(detectTrackingSilence(once, {}, NOW)).toEqual([]);
  });

  it("does not count work due TODAY as overdue", () => {
    // due_date is a date column: parsed it is midnight UTC, already past when
    // a nightly job runs. A plain `due < now` reported the whole day's work as
    // late before anybody had started it.
    const today = dayKey(NOW);
    const dueToday = Array.from({ length: 5 }, (_, i) => ({
      id: `t${i}`, project_id: "p1", status: "in_progress", due_date: today,
    }));
    expect(detectOverdue(dueToday, { p1: "Apollo" }, NOW)).toEqual([]);

    const yesterday = new Date(NOW.getTime() - 86400000).toISOString().slice(0, 10);
    const late = dueToday.map((t) => ({ ...t, due_date: yesterday }));
    expect(detectOverdue(late, { p1: "Apollo" }, NOW)).toHaveLength(1);

    expect(isBeforeDay(today, NOW)).toBe(false);
    expect(isBeforeDay(yesterday, NOW)).toBe(true);
  });

  it("still warns about a sprint on its final day", () => {
    // `ends < now` went false at midnight on the last day — the warning fell
    // silent on the one day it matters most.
    const endsToday = { id: "sp", name: "Sprint 7", status: "active", end_date: dayKey(NOW) };
    const tasks = Array.from({ length: 10 }, (_, i) => ({
      id: `t${i}`, sprint_id: "sp", status: i < 2 ? "completed" : "in_progress",
    }));
    const out = detectSprintRisk([endsToday], tasks, NOW);
    expect(out).toHaveLength(1);
    expect(out[0].severity).toBe("critical");
    expect(out[0].message).toMatch(/ends today/);
  });
});

/**
 * Who is allowed to see what.
 *
 * Run, not regex-matched. The first version asserted that the filter's source
 * text was present — which passed while the filter compared an email against a
 * set of UUIDs and returned nothing for every manager on earth.
 */
describe("filterForViewer", () => {
  const personSignal = { kind: "activity_drop", subject: { type: "person", id: "sara@x.test" } };
  const otherPerson = { kind: "activity_drop", subject: { type: "person", id: "bilal@x.test" } };
  const teamSignal = { kind: "review_backlog", subject: { type: "organization", id: "review-backlog" } };
  const billing = { kind: "plan_pressure", subject: { type: "plan", id: "developers" } };
  const all = [personSignal, otherPerson, teamSignal, billing];

  it("gives owner and admin everything", () => {
    for (const role of ["owner", "admin"]) {
      expect(filterForViewer(all, { role })).toHaveLength(4);
    }
  });

  it("gives hr the people but not the bill", () => {
    const out = filterForViewer(all, { role: "hr" });
    expect(out.map((s) => s.kind)).not.toContain("plan_pressure");
    expect(out).toHaveLength(3);
  });

  it("gives a manager their own reports and the team signals, nothing else", () => {
    const out = filterForViewer(all, {
      role: "manager",
      visiblePeople: new Set(["sara@x.test"]),
    });
    expect(out).toEqual([personSignal, teamSignal]);
  });

  it("matches a report by email OR by id, whichever the sessions carried", () => {
    const byId = { kind: "activity_drop", subject: { type: "person", id: "dev-uuid-9" } };
    expect(
      filterForViewer([byId], { role: "manager", visiblePeople: new Set(["dev-uuid-9"]) })
    ).toHaveLength(1);
    // …and is case-insensitive, because addresses are.
    expect(
      filterForViewer(
        [{ kind: "activity_drop", subject: { type: "person", id: "Sara@X.test" } }],
        { role: "manager", visiblePeople: new Set(["sara@x.test"]) }
      )
    ).toHaveLength(1);
  });

  it("gives a manager with no reports only the team signals", () => {
    // The state of this deployment today: reports_to is unset for everyone.
    const out = filterForViewer(all, { role: "manager", visiblePeople: new Set() });
    expect(out).toEqual([teamSignal]);
  });

  it("gives a developer, a client and an unknown role nothing at all", () => {
    for (const role of ["developer", "employee", "client", undefined, ""]) {
      expect(filterForViewer(all, { role }), String(role)).toEqual([]);
    }
  });
});

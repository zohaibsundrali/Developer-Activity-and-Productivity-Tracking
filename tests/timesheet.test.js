import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  buildWeek,
  logSeconds,
  parseDuration,
  weekDays,
  weekStart,
  ymd,
} from "@/utils/timesheet";
import { staffNav } from "@/components/shell/navConfig";
import { sectionTitle } from "@/components/shell/sectionTitles";

/**
 * A week of one person's logged time.
 *
 * WHAT WAS ACTUALLY MISSING. Everything underneath this existed and worked: the
 * `task_time_logs` table (migration 017), start/stop/manual helpers in
 * pmData.js, and a partial unique index that refuses a second running timer for
 * one person. The only UI for any of it — `TaskTimer` — is rendered inside
 * `TaskDetailDrawer`, an ADMIN component. Developers have no task drawer, so
 * the people doing the work could not log time against it.
 *
 * The table has zero rows because nobody could put one there.
 */

const root = path.resolve(__dirname, "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

describe("weeks run Monday to Sunday", () => {
  it("finds the Monday from any day of that week", () => {
    // 2026-08-17 is a Monday.
    for (const [day, monday] of [
      ["2026-08-17", "2026-08-17"], // Monday itself
      ["2026-08-19", "2026-08-17"], // Wednesday
      ["2026-08-22", "2026-08-17"], // Saturday
    ]) {
      expect(weekStart(new Date(day)), day).toBe(monday);
    }
  });

  it("puts SUNDAY at the end of its week, not the start of the next", () => {
    /**
     * `getDay()` calls Sunday 0. The obvious `1 - day` shift sends Sunday
     * FORWARD a day into the following Monday, so every Sunday's hours land in
     * next week's total — a bug that only appears one day in seven and is
     * invisible in any demo held on a weekday.
     */
    expect(weekStart(new Date("2026-08-23"))).toBe("2026-08-17");
    expect(weekStart(new Date("2026-08-24"))).toBe("2026-08-24"); // the next Monday
  });

  it("gives seven consecutive days", () => {
    const days = weekDays("2026-08-17");
    expect(days).toHaveLength(7);
    expect(days[0]).toBe("2026-08-17");
    expect(days[6]).toBe("2026-08-23");
  });

  it("refuses a date that is not one", () => {
    expect(weekStart(new Date("nonsense"))).toBeNull();
    expect(weekDays(null)).toEqual([]);
    expect(ymd(null)).toBeNull();
    expect(ymd("not a date")).toBeNull();
  });
});

describe("a running timer has no seconds yet", () => {
  const NOW = new Date("2026-08-18T12:00:00.000Z");

  it("measures an unfinished log against now", () => {
    // `seconds` is only written on stop. Treating null as zero would freeze
    // today's total at whatever it was when the timer started — the number
    // somebody watching a timer is most likely to be watching.
    const log = { started_at: "2026-08-18T11:30:00.000Z", ended_at: null, seconds: null };
    expect(logSeconds(log, NOW)).toBe(1800);
  });

  it("trusts the stored number once it has stopped", () => {
    const log = { started_at: "2026-08-18T09:00:00.000Z", ended_at: "2026-08-18T10:00:00.000Z", seconds: 3600 };
    expect(logSeconds(log, NOW)).toBe(3600);
  });

  it("never returns a negative length", () => {
    // A clock skew or a row written slightly in the future must not subtract
    // from the day's total.
    const log = { started_at: "2026-08-18T13:00:00.000Z", ended_at: null };
    expect(logSeconds(log, NOW)).toBe(0);
    expect(logSeconds({ ended_at: "x", seconds: -50 }, NOW)).toBe(0);
    expect(logSeconds(null, NOW)).toBe(0);
  });
});

describe("the week adds up", () => {
  const START = "2026-08-17";
  const NOW = new Date("2026-08-18T12:00:00.000Z");
  const log = (over) => ({
    task_id: "t1",
    started_at: "2026-08-18T09:00:00.000Z",
    ended_at: "2026-08-18T10:00:00.000Z",
    seconds: 3600,
    ...over,
  });

  it("groups by day and totals each one", () => {
    const week = buildWeek(
      [
        log({ started_at: "2026-08-17T09:00:00.000Z", ended_at: "2026-08-17T10:00:00.000Z" }),
        log(),
        log({ task_id: "t2", seconds: 1800, ended_at: "2026-08-18T09:30:00.000Z" }),
      ],
      START,
      NOW
    );
    const byDate = Object.fromEntries(week.days.map((d) => [d.date, d.seconds]));
    expect(byDate["2026-08-17"]).toBe(3600);
    expect(byDate["2026-08-18"]).toBe(5400);
    expect(week.total).toBe(9000);
  });

  it("merges several entries on the same task into one row", () => {
    const week = buildWeek([log(), log({ seconds: 1800 })], START, NOW);
    const day = week.days.find((d) => d.date === "2026-08-18");
    expect(day.rows).toHaveLength(1);
    expect(day.rows[0].seconds).toBe(5400);
    expect(day.rows[0].entries).toBe(2);
  });

  it("makes the day total equal the sum of its rows", () => {
    // The one arithmetic property a timesheet must have. Rounding to hours
    // during aggregation breaks it, and the mismatch reads as a bug in the
    // sums rather than in the rounding.
    const week = buildWeek([log(), log({ task_id: "t2", seconds: 900 })], START, NOW);
    for (const day of week.days) {
      expect(day.seconds, day.date).toBe(day.rows.reduce((s, r) => s + r.seconds, 0));
    }
    expect(week.total).toBe(week.days.reduce((s, d) => s + d.seconds, 0));
  });

  it("ignores logs from outside the week", () => {
    const week = buildWeek(
      [log({ started_at: "2026-08-10T09:00:00.000Z", ended_at: "2026-08-10T10:00:00.000Z" })],
      START,
      NOW
    );
    expect(week.total).toBe(0);
  });

  it("counts a running timer and reports it", () => {
    const week = buildWeek(
      [log({ ended_at: null, seconds: null, started_at: "2026-08-18T11:00:00.000Z" })],
      START,
      NOW
    );
    expect(week.total).toBe(3600);
    expect(week.running).toBeTruthy();
    expect(week.days.find((d) => d.date === "2026-08-18").rows[0].isRunning).toBe(true);
  });

  it("puts a session that crossed midnight on the day it STARTED", () => {
    // Splitting it would invent a boundary the person never marked, and it is
    // not how they remember the work either.
    const week = buildWeek(
      [log({ started_at: "2026-08-18T23:00:00.000Z", ended_at: "2026-08-19T01:00:00.000Z", seconds: 7200 })],
      START,
      NOW
    );
    expect(week.days.find((d) => d.date === "2026-08-18").seconds).toBe(7200);
    expect(week.days.find((d) => d.date === "2026-08-19").seconds).toBe(0);
  });

  it("survives an empty or absent week", () => {
    expect(buildWeek([], START).total).toBe(0);
    expect(buildWeek(null, START).total).toBe(0);
    expect(buildWeek(undefined, START).days).toHaveLength(7);
  });

  it("sorts the longest task first within a day", () => {
    const week = buildWeek(
      [log({ task_id: "small", seconds: 600 }), log({ task_id: "big", seconds: 7200 })],
      START,
      NOW
    );
    expect(week.days.find((d) => d.date === "2026-08-18").rows.map((r) => r.taskId)).toEqual([
      "big",
      "small",
    ]);
  });
});

describe("manual entry accepts what people actually type", () => {
  it("reads a bare number as MINUTES", () => {
    // "30" almost always means half an hour. Reading it as seconds would
    // silently record nothing, and the person would not know why.
    expect(parseDuration("30")).toBe(1800);
    expect(parseDuration("45")).toBe(2700);
  });

  it("reads hours and minutes together", () => {
    expect(parseDuration("1h 30m")).toBe(5400);
    expect(parseDuration("1h30")).toBe(5400);
    expect(parseDuration("2h")).toBe(7200);
    expect(parseDuration("1.5h")).toBe(5400);
    expect(parseDuration("90m")).toBe(5400);
  });

  it("does not care about case or spacing", () => {
    expect(parseDuration("  2H  ")).toBe(7200);
    expect(parseDuration("90M")).toBe(5400);
  });

  it("returns null for genuine nonsense rather than guessing", () => {
    for (const junk of ["", "   ", "abc", "1h2h", "-30", "h", null, undefined, {}, "1d"]) {
      expect(parseDuration(junk), String(junk)).toBeNull();
    }
  });
});

describe("the screen is reachable, and does not duplicate My Work", () => {
  it("is in every staff sidebar", () => {
    for (const role of ["developer", "designer", "devops", "employee", "manager", "team_lead", "hr"]) {
      expect(staffNav(role).map((i) => i.id), role).toContain("timesheet");
    }
  });

  it("has a title", () => {
    expect(sectionTitle("timesheet", "developer")).toBe("My Timesheet");
  });

  it("is rendered by the dashboard switch", () => {
    const page = read("src/app/developer/dashboard/page.jsx");
    expect(page).toMatch(/case "timesheet":/);
    expect(page).toContain("<MyTimesheet");
  });

  it("reads task_time_logs, unlike the old unwired Timesheet component", () => {
    /**
     * `components/developer/Timesheet.jsx` is named for time and shows none: it
     * lists developer_tasks by STATUS, which is what My Work already does. That
     * is why it stayed unwired here — adding it would have put two screens
     * showing the same tasks in one sidebar.
     */
    const mine = read("src/components/developer/MyTimesheet.jsx");
    expect(mine).toContain("loadTimeLogs");
    const old = read("src/components/developer/Timesheet.jsx");
    expect(old).not.toContain("task_time_logs");
    // And the old one is still not in any sidebar.
    for (const role of ["developer", "manager"]) {
      const ids = staffNav(role).map((i) => i.id);
      expect(ids, role).not.toContain("my-timesheet-old");
    }
  });

  it("does not re-implement formatDuration", () => {
    // pmData already exports one, used by TaskTimer. A second copy differing
    // only in whether it says "30s" or "0m" is the drift this whole phase has
    // been removing.
    expect(read("src/utils/timesheet.js")).not.toMatch(/export function formatDuration/);
    expect(read("src/components/developer/MyTimesheet.jsx")).toMatch(
      /formatDuration[\s\S]{0,200}from "@\/utils\/pmData"/
    );
  });
});

describe("logging time happens where the tasks are", () => {
  const MYWORK = read("src/components/developer/MyWork.jsx");

  it("puts a start/stop control on each task row", () => {
    expect(MYWORK).toContain("startTaskTimer");
    expect(MYWORK).toContain("stopTaskTimer");
    expect(MYWORK).toContain("getActiveTimer");
  });

  it("does not nest a button inside a button", () => {
    // The row used to be one big <button>. Putting the timer control inside it
    // would be invalid HTML, and which of the two the browser drops is not
    // something to discover in production.
    const row = MYWORK.slice(MYWORK.indexOf("function TaskRow"), MYWORK.indexOf("function Bucket"));
    expect(row).toMatch(/<li className=/);
    expect(row).not.toMatch(/<button[\s\S]*<button[\s\S]*<\/button>[\s\S]*<\/button>/);
  });

  it("re-reads the active timer after every action", () => {
    // Two tabs can both pass the "is anything running" read; the database
    // refuses the second insert. The worst case is then a stale button, not a
    // double count — but only if local state is not trusted.
    expect(MYWORK).toMatch(/await refreshTimer\(\)/);
  });
});

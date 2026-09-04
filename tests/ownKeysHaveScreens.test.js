import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  SECTION_PERMISSIONS,
  OWN_WORK_SECTIONS,
  canAccessAdminSection,
  canEnterAdminArea,
} from "@/components/shell/sectionAccess";
import { staffNav } from "@/components/shell/navConfig";
import { SECTION_TITLES } from "@/components/shell/sectionTitles";
import { PERMISSIONS, permissionsForRole } from "@/utils/permissionCatalogue";
import { ROLES } from "@/utils/roles";

/**
 * EVERY `*_own` KEY HAS SOMEWHERE TO CLICK.
 *
 * THE FAULT THIS CLOSES, and it is the one this whole series began with. #74
 * introduced nine `*_own` keys because `user_type` — a STORAGE column saying
 * which profile table a row lives in — was being read as an authorization
 * level, and there was no way to express "your own work" as a permission at
 * all.
 *
 * Six of the nine got a screen at the time. Three did not:
 *
 *   productivity.view_own   monitoring.view_own   team.view_own
 *
 * A permission with no surface is exactly the defect #74 existed to fix: the
 * key is right, the API is right, RLS is right, and there is nowhere to click.
 * It was listed as open in every pull request from #74 to #85 and fixed by
 * none of them, because nothing failed when it was missing.
 *
 * This file is what makes it fail. It is deliberately a test about the MODEL
 * rather than about any one screen — the same shape as viewSecurity.test.js,
 * and for the same reason: the things that went wrong in this series were
 * never things the application did incorrectly. They were things nothing was
 * looking at.
 */

const root = path.resolve(__dirname, "..");
const read = (p) =>
  readFileSync(path.join(root, p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const ADMIN_DASHBOARD = read("src/app/admin/dashboard/page.js");
const STAFF_DASHBOARD = read("src/app/developer/dashboard/page.jsx");

/** Every key in the `own` module — the ones that mean "your own work". */
const OWN_KEYS = PERMISSIONS.filter((p) => p.module === "own").map((p) => p.key);

/** Which section, if any, is gated on each key. */
const SECTION_FOR = new Map(
  Object.entries(SECTION_PERMISSIONS)
    .filter(([, key]) => key)
    .map(([section, key]) => [key, section])
);

/**
 * Keys whose surface is not a section of their own, with the reason.
 *
 * A key is allowed in here only when a screen genuinely covers it under
 * another section's roof — never because nobody got round to it. The `it.each`
 * below re-checks each claim, so an entry that stops being true fails.
 */
const COVERED_ELSEWHERE = {
  "task.update_own": {
    section: "my-work",
    why: "moving your own task along happens on My Work, beside seeing it",
  },
  "timesheet.log_own": {
    section: "timesheet",
    why: "logging hours is what My Timesheet is for",
  },
  "timesheet.submit_own": {
    section: "timesheet",
    why: "the submit button is on My Timesheet, on the week it submits",
  },
  "profile.manage_own": {
    section: "account",
    why: "Account is the personal screen, and it predates all of this",
  },
  "attendance.log_own": {
    section: "my-attendance",
    why: "check in and check out are the two buttons on My Attendance",
  },
  "leave.request_own": {
    section: "my-leave",
    why: "raising a request is what My Leave is for",
  },
  "leave.view_own": {
    // Found by this file on its first run, which is a fair advertisement for
    // it. `my-leave` is gated on `leave.request_own`, so the READ key had no
    // section pointing at it — even though the screen has always listed your
    // own requests and their outcomes. Covered, and now said so.
    section: "my-leave",
    why: "My Leave lists your own requests and what happened to them",
  },
  "monitoring.view_own": {
    section: "my-activity",
    why: "recorded activity is a panel on My Activity, beside the metrics",
  },
  "team.view_own": {
    section: "my-activity",
    why: "who else is on your projects is a panel on My Activity",
  },
};

describe("every *_own key has a screen", () => {
  it("finds the own-work keys at all", () => {
    // A test that stops matching is a test that stops testing.
    expect(OWN_KEYS.length).toBeGreaterThanOrEqual(9);
  });

  it.each(OWN_KEYS)("%s is reachable", (key) => {
    const own = SECTION_FOR.get(key);
    const covered = COVERED_ELSEWHERE[key];
    expect(
      own || covered,
      `${key} has no section of its own and is not recorded as covered elsewhere`
    ).toBeTruthy();

    const section = own || covered.section;
    // The section must actually be rendered somewhere, not merely declared.
    const renderedInAdmin = ADMIN_DASHBOARD.includes(`case "${section}":`);
    const renderedInStaff = STAFF_DASHBOARD.includes(`case "${section}":`);
    expect(
      renderedInAdmin || renderedInStaff,
      `${key} -> section "${section}" is declared but no dashboard renders it`
    ).toBe(true);
  });

  it("every claim of being covered elsewhere still holds", () => {
    // A stale exemption is how the next missing screen gets waved through.
    for (const [key, { section }] of Object.entries(COVERED_ELSEWHERE)) {
      expect(OWN_KEYS, `${key} is no longer an own-work key`).toContain(key);
      expect(
        Object.keys(SECTION_PERMISSIONS),
        `${key} claims to be covered by "${section}", which does not exist`
      ).toContain(section);
    }
  });
});

describe("the own-work sections reach the people who hold the keys", () => {
  const CONTRIBUTORS = ["developer", "designer", "devops", "employee"];
  // OWN_WORK_SECTIONS, not the whole non-widening exemption. The two lists were
  // identical until `my-tests` joined the second: that screen is in the
  // exemption because four roles that hold its key do not belong in /admin, not
  // because it is a screen about you. It has no admin title and no admin switch
  // case on purpose — the admin shell has the fuller Quality screen — so
  // iterating the exemption here asserted three things that were never meant to
  // be true. The test below covers it on its own terms.
  const OWN_SECTIONS = [...OWN_WORK_SECTIONS];

  it("offers every own-work section in every staff nav", () => {
    // A contributor cannot enter /admin, so the staff shell is the only place
    // these can be for them. A section they hold the key to and cannot see is
    // the same fault in a different shell.
    for (const role of CONTRIBUTORS) {
      const ids = staffNav(role).map((i) => i.id);
      for (const section of OWN_SECTIONS) {
        expect(ids, `${role} cannot reach "${section}"`).toContain(section);
      }
    }
  });

  it("renders every own-work section in the staff shell", () => {
    for (const section of OWN_SECTIONS) {
      expect(
        STAFF_DASHBOARD.includes(`case "${section}":`),
        `the staff dashboard does not render "${section}"`
      ).toBe(true);
    }
  });

  it("renders every own-work section in the admin shell too", () => {
    // The five roles admitted to /admin in #74 have working days as well —
    // which was the whole point of that pull request.
    for (const section of OWN_SECTIONS) {
      expect(
        ADMIN_DASHBOARD.includes(`case "${section}":`),
        `the admin dashboard does not render "${section}"`
      ).toBe(true);
    }
  });

  it("titles every own-work section in both shells", () => {
    for (const section of OWN_SECTIONS) {
      expect(SECTION_TITLES[section], section).toBeTruthy();
      expect(SECTION_TITLES[section].admin, `${section} has no admin title`).toBeTruthy();
      expect(SECTION_TITLES[section].developer, `${section} has no staff title`).toBeTruthy();
    }
  });

  it("gives the staff Tests screen to everyone who holds its key", () => {
    // The same rule as the own-work sections, applied to the one exempt section
    // that is not one of them: a key whose holder cannot reach a screen is the
    // fault this file exists to catch, and `test_case.view` was exactly that
    // between 081 and 095.
    for (const role of ROLES) {
      const holdsKey = permissionsForRole(role).includes("test_case.view");
      if (!holdsKey) continue;
      const reachable =
        staffNav(role).some((i) => i.id === "my-tests") ||
        // or the admin shell's fuller screen, which every admin-area role that
        // can read a test can also write on
        (canAccessAdminSection("quality", role) && canEnterAdminArea(role));
      expect(reachable, `${role} holds test_case.view and can reach no screen`).toBe(true);
    }
    expect(STAFF_DASHBOARD.includes('case "my-tests":')).toBe(true);
    expect(SECTION_TITLES["my-tests"]?.developer, "my-tests has no staff title").toBeTruthy();
  });

  it("opens them to every staff role and no client", () => {
    const staff = ROLES.filter((r) => r !== "client");
    for (const section of OWN_SECTIONS) {
      for (const role of staff) {
        expect(canAccessAdminSection(section, role), `${role}/${section}`).toBe(true);
      }
      expect(canAccessAdminSection(section, "client"), section).toBe(false);
    }
    expect(permissionsForRole("client")).toEqual([]);
  });

  it("still lets none of them widen the admin front door", () => {
    // The trap from #74, restated here because this file is where somebody
    // adding the tenth own-work section will look.
    for (const role of CONTRIBUTORS) {
      expect(canEnterAdminArea(role), role).toBe(false);
    }
  });
});

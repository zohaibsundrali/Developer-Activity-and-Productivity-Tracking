import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  ADMIN_NAV,
  DEVELOPER_NAV,
  MANAGER_NAV,
  EMPLOYEE_NAV,
  CLIENT_NAV,
} from "@/components/shell/navConfig";
import { SECTION_TITLES } from "@/components/shell/sectionTitles";

/**
 * Every sidebar link goes somewhere, and everything that exists has a link.
 *
 * WHAT THIS FOUND
 *
 * `new-project` and `change-requests` were in DEVELOPER_NAV. The developer
 * dashboard has a case for neither, so both fell through to `default` and
 * silently rendered the Dashboard. Meanwhile the CLIENT page RENDERS both —
 * <ClientProposals/> and <ClientChangeRequests/> — and their section titles are
 * defined for `client` and for nobody else.
 *
 * So the two entries were simply in the wrong nav, and the consequence was not
 * a cosmetic one:
 *
 *   - a client could not submit a project proposal at all, which makes the
 *     whole client-proposal → admin-accept → assign-a-PM flow unreachable;
 *   - a client could not raise a change request, so that module was unreachable
 *     for the only people it was built for;
 *   - a developer saw two menu items that quietly did nothing.
 *
 * Neither the build nor lint nor any existing test could see it: a nav entry is
 * just data, and a `switch` with a `default` never complains about a case it
 * does not have. Only a person clicking the link would find out, which is
 * exactly what a manual test script was about to do.
 *
 * THE TWO DIRECTIONS BOTH MATTER. An entry with no case is a dead link. A case
 * with no entry is a screen nobody can find — which is the same bug wearing the
 * other hat, and how these two came to be stranded in the first place.
 */

const root = path.resolve(__dirname, "..");
const read = (p) => readFileSync(path.join(root, p), "utf8");

/** The section ids a portal's switch actually handles. */
const casesIn = (file) =>
  new Set([...read(file).matchAll(/case "([a-z0-9-]+)":/g)].map((m) => m[1]));

const ADMIN_PAGE = "src/app/admin/dashboard/page.js";
const STAFF_PAGE = "src/app/developer/dashboard/page.jsx";
const CLIENT_PAGE = "src/app/client/page.jsx";

// `overview` is every portal's `default` arm rather than a case of its own.
const DEFAULTED = new Set(["overview"]);

const PORTALS = [
  { name: "admin", nav: ADMIN_NAV, page: ADMIN_PAGE, audience: "admin" },
  { name: "developer", nav: DEVELOPER_NAV, page: STAFF_PAGE, audience: "developer" },
  { name: "manager", nav: MANAGER_NAV, page: STAFF_PAGE, audience: "developer" },
  { name: "employee", nav: EMPLOYEE_NAV, page: STAFF_PAGE, audience: "developer" },
  { name: "client", nav: CLIENT_NAV, page: CLIENT_PAGE, audience: "client" },
];

describe("every sidebar link renders something", () => {
  it.each(PORTALS)("$name", ({ nav, page }) => {
    const cases = casesIn(page);
    for (const item of nav) {
      if (DEFAULTED.has(item.id)) continue;
      expect(cases.has(item.id), `"${item.label}" (${item.id}) has no case in ${page}`).toBe(true);
    }
  });

  it("proves the check can fail, rather than passing on an empty set", () => {
    // If casesIn() ever stopped matching, every assertion above would pass
    // against nothing at all.
    for (const p of [ADMIN_PAGE, STAFF_PAGE, CLIENT_PAGE]) {
      expect(casesIn(p).size, `${p} parsed no cases`).toBeGreaterThan(2);
    }
  });
});

describe("every sidebar link has a title", () => {
  // A section with no title renders a blank topbar and a blank <h1>.
  it.each(PORTALS)("$name", ({ nav, audience }) => {
    for (const item of nav) {
      const title = SECTION_TITLES[item.id]?.[audience];
      expect(title, `"${item.label}" (${item.id}) has no ${audience} title`).toBeTruthy();
    }
  });
});

describe("the two that were stranded", () => {
  it("puts New Project and Change Requests in the CLIENT sidebar", () => {
    const ids = CLIENT_NAV.map((i) => i.id);
    expect(ids).toContain("new-project");
    expect(ids).toContain("change-requests");
  });

  it("takes them OUT of the developer sidebar, which rendered neither", () => {
    const ids = DEVELOPER_NAV.map((i) => i.id);
    expect(ids).not.toContain("new-project");
    expect(ids).not.toContain("change-requests");
  });

  it("keeps the screens themselves, which were never the problem", () => {
    const client = read(CLIENT_PAGE);
    expect(client).toContain("<ClientProposals />");
    expect(client).toContain("<ClientChangeRequests />");
  });

  it("matches where the titles said they belonged all along", () => {
    // The clue that settled it: neither has a `developer` title, and both have
    // a `client` one.
    expect(SECTION_TITLES["new-project"].client).toBeTruthy();
    expect(SECTION_TITLES["new-project"].developer).toBeUndefined();
    expect(SECTION_TITLES["change-requests"].client).toBeTruthy();
    expect(SECTION_TITLES["change-requests"].developer).toBeUndefined();
  });
});

describe("no screen is left with no way in", () => {
  it("the client portal has a link for every section it renders", () => {
    // The other direction. A case with no nav entry is a screen nobody can
    // find — the same bug wearing the other hat, and how these two came to be
    // stranded.
    const ids = new Set(CLIENT_NAV.map((i) => i.id));
    // `comments` and `timeline` are opened from inside a project, not the
    // sidebar, and are listed here so the exemption is deliberate rather than
    // an oversight that this test quietly permits.
    const reachedFromAProject = new Set(["comments", "timeline"]);
    for (const id of casesIn(CLIENT_PAGE)) {
      if (DEFAULTED.has(id) || reachedFromAProject.has(id)) continue;
      expect(ids.has(id), `client section "${id}" has no sidebar entry`).toBe(true);
    }
  });
});

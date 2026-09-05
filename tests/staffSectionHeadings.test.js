import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Every staff section is a page, and every page needs a heading.
 *
 * The staff shell (src/app/developer/dashboard) swaps one section component into
 * AppShell's <main> at a time, and the topbar deliberately carries no <h1> —
 * so the section itself is the ONLY thing that can give the page its heading.
 * A screen-reader user landing on a section with no <h1> gets a document with
 * no title and no landmark to jump to.
 *
 * The masthead is the PageHeader primitive, which renders exactly one <h1>
 * (tests/chromePolish.test.js guards the primitive). This file guards that each
 * section actually renders one. DashboardOverview, Account and TeamPanel had no
 * masthead at all; the rest already did. If a new section is added to the staff
 * shell, add it here too.
 */

const root = path.resolve(__dirname, "..");
const read = (p) => readFileSync(path.join(root, p), "utf8");

// Section id (staffNav) -> component file rendered for it.
const STAFF_SECTIONS = {
  overview: "src/components/developer/DashboardOverview.jsx",
  work: "src/components/developer/MyWork.jsx",
  timesheet: "src/components/developer/MyTimesheet.jsx",
  projects: "src/components/developer/MyProjects.jsx",
  account: "src/components/developer/Account.jsx",
  team: "src/components/developer/TeamPanel.jsx",
  attendance: "src/components/shared/MyAttendance.jsx",
  leave: "src/components/shared/MyLeave.jsx",
  reviews: "src/components/shared/MyReviews.jsx",
  activity: "src/components/shared/MyActivity.jsx",
  tests: "src/components/shared/TestCases.jsx",
};

describe("every staff section renders a masthead", () => {
  for (const [id, file] of Object.entries(STAFF_SECTIONS)) {
    it(`${id} (${path.basename(file)}) renders a PageHeader`, () => {
      const src = read(file);
      expect(src, `${file} imports PageHeader`).toMatch(/\bPageHeader\b/);
      expect(src, `${file} renders <PageHeader`).toMatch(/<PageHeader[\s/>]/);
    });
  }
});

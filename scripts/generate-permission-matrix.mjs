/**
 * Regenerates docs/roles-and-permissions.md FROM the catalogue.
 *
 * A permission matrix written by hand is a fifth copy of the access rules, and
 * this repository has already paid for four: `can()`, ADMIN_SECTION_ROLES,
 * fifteen inline route arrays and the role_permissions table all disagreed with
 * each other, and roles the product had shipped were missing from some of them.
 * A document is worse than code at staying true, because nothing fails when it
 * goes stale — somebody just reads the wrong answer and believes it.
 *
 * So the matrix is generated, and tests/permissionMatrixDoc.test.js re-runs the
 * generation and fails if the committed file differs. Editing the .md by hand
 * is therefore a test failure, not a silent lie.
 *
 *   node scripts/generate-permission-matrix.mjs
 */
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

/**
 * The catalogue imports through the `@/` alias, which plain node does not
 * resolve. Copying the two pure modules to a temp dir with the alias rewritten
 * is enough — both are deliberately dependency-free (see the header of
 * roles.js), so there is nothing else to stub.
 */
const dir = mkdtempSync(join(tmpdir(), "permmatrix-"));
writeFileSync(join(dir, "roles.mjs"), readFileSync(join(root, "src/utils/roles.js")));
writeFileSync(
  join(dir, "catalogue.mjs"),
  readFileSync(join(root, "src/utils/permissionCatalogue.js"), "utf8").replace(
    /@\/utils\/roles/g,
    "./roles.mjs"
  )
);

const { ROLES } = await import(join(dir, "roles.mjs"));
const { PERMISSIONS, PERMISSION_MODULES } = await import(join(dir, "catalogue.mjs"));

const HEADING = {
  organization: "Organization",
  people: "People",
  projects: "Projects",
  delivery: "Delivery",
  clients: "Clients",
  own: "Your own work",
  billing: "Money",
  oversight: "Oversight",
};

const out = [];
out.push("<!-- GENERATED FILE. Do not edit.");
out.push("     Run: node scripts/generate-permission-matrix.mjs");
out.push("     Guarded by tests/permissionMatrixDoc.test.js -->");
out.push("");
out.push("# Roles and permissions");
out.push("");
out.push(
  `${ROLES.length} roles, ${PERMISSIONS.length} permissions. Generated from ` +
    "`src/utils/permissionCatalogue.js`, which is the only place the defaults " +
    "are written down."
);
out.push("");
out.push(
  "A role says what somebody may **do**. It is not a job title — those live in " +
    "`employee_profiles.designation` and can say anything. Two roles with " +
    "identical permissions are one role with two names."
);
out.push("");
out.push(
  "These are **defaults**. A tenant that wants something else gets it through " +
    "the per-user override layer (`user_permissions`, migration 069), not by " +
    "editing the catalogue. An explicit deny beats every grant below, including " +
    "an owner's."
);
out.push("");

out.push("## Permissions by role");
out.push("");
out.push("How many of the " + PERMISSIONS.length + " keys each role holds by default.");
out.push("");
out.push("| Role | Keys | What the role is for |");
out.push("|---|---:|---|");
const PURPOSE = {
  owner: "Everything, and the only role that may buy, cancel or change the plan, delete the organization, or grant another person a permission.",
  admin: "Runs the organization day to day. Everything except the four owner-only keys.",
  manager: "Delivery. Projects, task assignment, the client-facing decisions, and reports.",
  hr: "People operations. Hiring, onboarding, the reporting line — and no access to delivery or money.",
  finance: "Money only. Billing and client accounts, deliberately WITHOUT the monitoring surface.",
  team_lead: "A contributor who also runs a team: reviews work, sees every task and project, reads reports.",
  qa: "A contributor who may also review other people's submissions and triage the bug queue.",
  developer: "Contributes. Own work, plus submitting it for review.",
  designer: "Identical to developer today. Separate so the two can diverge without a data migration.",
  devops: "Identical to developer today (migration 067).",
  employee: "A staff member with no delivery role. Own work only.",
  client: "A customer, not staff. Holds no staff permission at all — the portal is a separate surface.",
};
for (const role of ROLES) {
  const n = PERMISSIONS.filter((p) => p.roles.includes(role)).length;
  out.push(`| \`${role}\` | ${n} | ${PURPOSE[role] || ""} |`);
}
out.push("");

out.push("## The full matrix");
out.push("");
for (const mod of PERMISSION_MODULES) {
  const entries = PERMISSIONS.filter((p) => p.module === mod);
  if (!entries.length) continue;
  out.push(`### ${HEADING[mod] || mod}`);
  out.push("");
  out.push("| Permission | What it allows | Roles |");
  out.push("|---|---|---|");
  for (const e of entries) {
    const roles =
      e.roles.length === ROLES.length - 1 && !e.roles.includes("client")
        ? "everyone except `client`"
        : e.roles.map((r) => `\`${r}\``).join(", ");
    out.push(`| \`${e.key}\` | ${e.label} | ${roles} |`);
  }
  out.push("");
}

out.push("## Two things this table does not say");
out.push("");
out.push(
  "**A permission is not the only gate.** Four of them run in order and none " +
    "replaces the others: middleware decides which *area* you may enter, " +
    "`canAccessAdminSection` decides which *section*, `requirePermission` " +
    "checks the key against a verified JWT, and RLS decides which *rows*. The " +
    "browser holds a PostgREST client bound to the user's own token, so RLS is " +
    "the real perimeter — a rule that lives only in an API route is a " +
    "convention, not a control."
);
out.push("");
out.push(
  "**Some rules cannot be a key.** `project.complete` is granted to four roles " +
    "here, but the closure route also requires that the caller *owns* the " +
    "project they are completing. Ownership is a fact about a row, not about a " +
    "role, so it stays in the route — a role-only check would let every " +
    "manager complete every project. Project-scoped roles " +
    "(`project_members`, migration 071) are the same idea stored as data."
);
out.push("");

/**
 * An explicit destination, so the test can generate to a temp file and diff
 * rather than rewriting the committed one mid-run. A test that mutates the
 * working tree to check the working tree races every other test that reads it.
 */
const dest = process.argv[2] || join(root, "docs/roles-and-permissions.md");
writeFileSync(dest, out.join("\n") + "\n");
console.log(`${dest} regenerated`);

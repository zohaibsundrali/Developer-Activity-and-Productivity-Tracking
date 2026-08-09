#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * =====================================================================
 *  reset-data.mjs — wipe ALL tenant data from the tracking SaaS database
 * =====================================================================
 *
 *  WHAT THIS IS FOR
 *  ----------------
 *  Returning the database to "day zero" so manual testing can start from a
 *  clean signup. It deletes every organisation, every user (staff, developers
 *  and clients), every project/task/submission, all monitoring telemetry, the
 *  matching Supabase Auth accounts, and the storage objects those rows point
 *  at — INCLUDING the operator's own owner account.
 *
 *  WHAT IT NEVER TOUCHES
 *  ---------------------
 *  Structure. No DROP, no ALTER, no CREATE. Every table, column, index,
 *  constraint, RLS policy, function and trigger installed by migrations
 *  010–049 survives untouched. This removes rows, storage objects and Auth
 *  accounts, nothing else.
 *
 *  It also deliberately PRESERVES two non-tenant configuration tables — see
 *  PRESERVE_TABLES below for the argument.
 *
 *  MODES
 *  -----
 *    node scripts/reset-data.mjs --project=<ref>
 *        DRY RUN (the default). Reads only. Prints the delete plan, per-table
 *        row counts, the Auth users that would be removed by email, and the
 *        storage objects that would be removed. Changes nothing.
 *
 *    node scripts/reset-data.mjs --project=<ref> --confirm-delete-everything
 *        Performs the deletion. There is no undo.
 *
 *  The project ref is REQUIRED in both modes and must match the ref in
 *  NEXT_PUBLIC_SUPABASE_URL. A stale or mistyped .env.local pointed at the
 *  wrong project is the failure mode that ends a company, so the operator has
 *  to state which database they believe they are about to empty.
 *
 *  SAFE TO RE-RUN
 *  --------------
 *  Every step is idempotent. Deleting from an already-empty table is a no-op,
 *  removing an absent storage object is a no-op, and Auth users are re-listed
 *  each pass. If the script dies halfway, run it again and it finishes the job.
 * =====================================================================
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const ENV_FILE = path.join(PROJECT_ROOT, ".env.local");

/* ===================================================================
 *  1. THE DELETE ORDER
 * ===================================================================
 *
 *  Derived by reading the FOREIGN KEY declarations in database/*.sql, not
 *  guessed. Children are emptied before their parents in every case.
 *
 *  Most FKs in this schema are ON DELETE CASCADE, so a wrong order would
 *  usually silently over-delete rather than error — which is exactly why the
 *  order is explicit here: we want each table's count to be reported honestly
 *  as *its own* deletion, not as a side effect of a cascade from a parent we
 *  happened to hit first.
 *
 *  Two FKs are genuinely blocking and dictate hard ordering:
 *    - projects.assigned_to -> developers(id) ON DELETE CASCADE
 *      (cascade_deletion_migration.sql:60) — deleting developers first would
 *      silently take every project with it. projects go first.
 *    - developers.user_id -> auth.users(id) with NO on-delete action
 *      (schema.sql:10) — so Supabase Auth accounts CANNOT be deleted until
 *      the developers rows referencing them are gone. Auth deletion is
 *      therefore the last phase, after every public table.
 *
 *  `reason` is printed in the dry-run report so the order can be audited.
 */
const DELETE_ORDER = [
  // ---- TIER 1: desktop-tracker telemetry -----------------------------
  // Pure leaves. Written by the desktop agent, keyed loosely by
  // developer_id / project_id / session_id (010_saas_schema.sql:124-134
  // documents these as nullable with NO foreign key). Emptied first so
  // nothing references developers or projects by the time those go.
  { table: "screenshots", tier: 1, reason: "telemetry leaf; rows point at monitoring/documents storage objects" },
  { table: "keyboard_stats", tier: 1, reason: "telemetry leaf -> productivity_sessions/developers" },
  { table: "mouse_activities", tier: 1, reason: "telemetry leaf -> productivity_sessions/developers" },
  { table: "app_usage", tier: 1, reason: "telemetry leaf -> productivity_sessions/developers" },
  { table: "browser_usage", tier: 1, reason: "telemetry leaf -> productivity_sessions/developers" },
  { table: "developer_activities", tier: 1, reason: "telemetry leaf -> developers" },
  { table: "developer_logins", tier: 1, reason: "telemetry leaf -> developers" },
  { table: "productivity_sessions", tier: 1, reason: "parent of the telemetry leaves above -> developers" },

  // ---- TIER 2: task-level children -----------------------------------
  { table: "admin_reviews", tier: 2, reason: "-> developer_tasks, task_submissions, projects, developers (cascade_deletion_migration.sql:144-166)" },
  { table: "notifications", tier: 2, reason: "-> developers, projects, developer_tasks, task_submissions (cascade_deletion_migration.sql:172-194)" },
  { table: "activity_logs", tier: 2, reason: "-> developers, projects, developer_tasks (cascade_deletion_migration.sql:122-138)" },
  { table: "task_dependencies", tier: 2, reason: "-> developer_tasks x2 (016_enterprise_pm.sql)" },
  { table: "task_checklists", tier: 2, reason: "-> developer_tasks (016_enterprise_pm.sql)" },
  { table: "task_comments", tier: 2, reason: "-> developer_tasks (016_enterprise_pm.sql)" },
  { table: "task_watchers", tier: 2, reason: "-> developer_tasks (016_enterprise_pm.sql)" },
  { table: "task_attachments", tier: 2, reason: "-> developer_tasks; rows point at org-files storage objects" },
  { table: "task_time_logs", tier: 2, reason: "-> developer_tasks (017_pm_advanced.sql:29)" },
  { table: "session_tasks", tier: 2, reason: "-> developer_tasks ON DELETE SET NULL (016_enterprise_pm.sql:15)" },

  // ---- TIER 3/4: the task spine --------------------------------------
  { table: "task_submissions", tier: 3, reason: "-> developer_tasks, projects, developers; parent of admin_reviews.submission_id" },
  { table: "developer_tasks", tier: 4, reason: "-> projects, developers; parent of everything in tiers 2-3" },

  // ---- TIER 5: project-level children --------------------------------
  { table: "approval_events", tier: 5, reason: "-> approvals, projects (033_client_collaboration.sql:76)" },
  { table: "approvals", tier: 5, reason: "-> projects (014_client_portal.sql:147)" },
  { table: "support_messages", tier: 5, reason: "-> support_threads (014_client_portal.sql:177)" },
  { table: "support_threads", tier: 5, reason: "-> projects, clients (014_client_portal.sql:164)" },
  { table: "project_comments", tier: 5, reason: "-> projects (032_client_portal_v2.sql:62); attachments in org-files" },
  { table: "project_updates", tier: 5, reason: "-> projects (014_client_portal.sql:135)" },
  { table: "project_clients", tier: 5, reason: "-> projects, clients (014_client_portal.sql:61)" },
  { table: "milestones", tier: 5, reason: "-> projects (014_client_portal.sql:107)" },
  { table: "announcements", tier: 5, reason: "-> projects (014_client_portal.sql:122)" },
  { table: "invoices", tier: 5, reason: "-> projects, clients (014_client_portal.sql:189); PDFs in the invoices bucket" },
  { table: "project_labels", tier: 5, reason: "-> projects (016_enterprise_pm.sql:11)" },
  { table: "project_custom_fields", tier: 5, reason: "-> projects (016_enterprise_pm.sql:12)" },
  { table: "automation_rules", tier: 5, reason: "-> projects (016_enterprise_pm.sql:13)" },
  { table: "saved_views", tier: 5, reason: "-> projects (016_enterprise_pm.sql:14)" },
  { table: "sprints", tier: 5, reason: "-> projects (016_enterprise_pm.sql:4)" },
  { table: "epics", tier: 5, reason: "-> projects (016_enterprise_pm.sql:5)" },
  { table: "pm_activity", tier: 5, reason: "project_id is loose (no FK) but semantically a project child (017_pm_advanced.sql:25)" },
  { table: "productivity_metrics", tier: 5, reason: "-> developers, projects (cascade_deletion_migration.sql:106-116)" },

  // ---- TIER 6: projects ----------------------------------------------
  { table: "projects", tier: 6, reason: "parent of tiers 2-5; MUST precede developers (projects.assigned_to -> developers ON DELETE CASCADE)" },

  // ---- TIER 7: org-scoped records not tied to a project --------------
  { table: "workspaces", tier: 7, reason: "-> organizations (016_enterprise_pm.sql:3)" },
  { table: "employee_profiles", tier: 7, reason: "-> organizations, teams, departments (015_team_employee_management.sql:53); photos in org-files" },
  { table: "notification_preferences", tier: 7, reason: "-> organizations (034_notification_preferences.sql:53)" },
  { table: "terms_acceptances", tier: 7, reason: "-> organizations (039_terms_acceptance.sql:177)" },
  { table: "email_log", tier: 7, reason: "-> organizations (036_email_log.sql:60)" },
  { table: "system_events", tier: 7, reason: "-> organizations ON DELETE SET NULL (038_system_events.sql:64)" },
  { table: "organization_usage_snapshots", tier: 7, reason: "-> organizations (027_billing_subscriptions.sql:51)" },
  { table: "billing_invoices", tier: 7, reason: "-> organizations (027_billing_subscriptions.sql:49)" },
  { table: "billing_events", tier: 7, reason: "-> organizations ON DELETE SET NULL (027_billing_subscriptions.sql:47)" },
  { table: "organization_subscriptions", tier: 7, reason: "-> organizations (027_billing_subscriptions.sql:45); tenant state, unlike billing_plans" },

  // ---- TIER 8: org membership graph ----------------------------------
  { table: "invitations", tier: 8, reason: "-> organizations, teams, departments, projects (010_saas_schema.sql:73)" },
  { table: "memberships", tier: 8, reason: "-> organizations, teams, departments (010_saas_schema.sql:57)" },
  { table: "teams", tier: 8, reason: "-> organizations, departments (010_saas_schema.sql:45)" },
  { table: "departments", tier: 8, reason: "-> organizations (010_saas_schema.sql:37)" },

  // ---- TIER 9: identity tables ---------------------------------------
  { table: "clients", tier: 9, reason: "-> organizations (014_client_portal.sql:43)" },
  { table: "developers", tier: 9, reason: "must follow projects (assigned_to cascade) and must PRECEDE auth.users deletion (developers.user_id -> auth.users, schema.sql:10)" },
  { table: "admin_users", tier: 9, reason: "referenced by organizations.owner_id ON DELETE SET NULL (010_saas_schema.sql:29), so it may precede organizations" },

  // ---- TIER 10: organizations ----------------------------------------
  { table: "organizations", tier: 10, reason: "root of the tenant graph; everything above hangs off it" },
];

/* ===================================================================
 *  2. WHAT SURVIVES
 * ===================================================================
 *
 *  billing_plans
 *  -------------
 *  This is the table the request called "subscription_plans". There is no
 *  table by that name in this schema — migration 027 names the seeded plan
 *  catalogue `billing_plans` (027_billing_subscriptions.sql:43), and its own
 *  header comment describes it as "catalogue of purchasable plans. NOT
 *  org-scoped". It has no organization_id column, so it is not tenant data by
 *  construction.
 *
 *  KEEPING IT. The argument:
 *    - Deleting it breaks billing outright. Signup writes an
 *      organization_subscriptions row with plan_code = 'free'; with no
 *      matching plan the pricing UI renders empty and checkout has no
 *      stripe_price_id to send.
 *    - Worse, it breaks quietly rather than loudly. plan_limit_for() in
 *      028_plan_limit_triggers.sql:60 falls back to the 'free' plan's limits
 *      and then does `coalesce(lim, -1)`. With the catalogue empty, every
 *      plan limit resolves to -1 = UNLIMITED, so every plan-limit trigger
 *      silently stops enforcing. A test run after the reset would then "pass"
 *      limits that production would reject.
 *    - The seed inserts are `on conflict (code) do nothing`
 *      (027_billing_subscriptions.sql:114-120), so re-running 027 to restore
 *      them is safe — but only if someone remembers to. Not deleting them is
 *      the reliable option.
 *    - Nothing about it obstructs a clean test: the rows carry no tenant
 *      identifiers, no Stripe customer, no history.
 *  Pass --wipe-plan-catalogue if you specifically want it emptied.
 *
 *  role_permissions
 *  ----------------
 *  Same class of thing: the global RBAC matrix from 010_saas_schema.sql:90,
 *  seeded by the 011 backfill, with no organization_id. It is configuration
 *  that every role check reads. Kept, for the same reasons.
 */
const PRESERVE_TABLES = new Map([
  ["billing_plans", "plan catalogue from 027 — configuration, not tenant data; emptying it silently disables every plan limit (028:60)"],
  ["role_permissions", "global RBAC matrix from 010/011 — configuration, not tenant data"],
]);

/* ===================================================================
 *  3. STORAGE
 * ===================================================================
 *
 *  Deleting the rows does NOT delete the objects they point at. Each bucket
 *  is handled explicitly.
 */
const BUCKET_PLAN = [
  {
    bucket: "monitoring",
    mode: "all",
    note: "private bucket from migration 019 — every object is a monitoring screenshot for some org",
  },
  {
    bucket: "org-files",
    mode: "all",
    note: "private bucket from migration 020 — employee photos, project docs, comment attachments, all org-prefixed",
  },
  {
    bucket: "invoices",
    mode: "all",
    note: "private bucket from STORAGE_invoices_bucket.sql — invoice PDFs, org-prefixed",
  },
  {
    bucket: "task-submissions",
    mode: "all",
    note: "proof-of-work uploads referenced by task_submissions.storage_path",
  },
  {
    // A separate PUBLIC bucket, distinct from the `screenshots/` prefix inside
    // `documents`. This is where the pre-019 desktop tracker actually wrote its
    // captures, keyed `<developer>/<file>.png`. Verified against the live
    // project: `monitoring` is empty and every screenshots row still resolves
    // here, so this is where the sensitive images really are. Missing it would
    // leave every employee screen capture publicly reachable after a "wipe".
    bucket: "screenshots",
    mode: "all",
    note: "legacy PUBLIC screenshot bucket (pre-migration-019) — employee screen captures",
  },
  {
    // The `documents` bucket is PUBLIC and mixed:
    //   <root>/*        project requirement documents. 020_org_files_bucket.sql
    //                   flags these as written to the bucket ROOT with no org
    //                   prefix; projects.file_url points straight at them.
    //   org-logos/*     organisation logos (OrganizationSettings.jsx:216)
    //   screenshots/*   legacy screenshot tree
    // All three are tenant data, so all three go. The report breaks the bucket
    // down by top-level segment before anything is removed, so nothing is
    // deleted from here without having been named first.
    bucket: "documents",
    mode: "all",
    breakdown: true,
    keepRootFlag: "keepDocumentsRoot",
    note: "public mixed bucket — project requirement docs at the root, org-logos/, legacy screenshots/",
  },
];

/* =================================================================== */

const BATCH = 500;
const SWEEP_PASSES = 3;

function fail(msg) {
  console.error(`\n  ERROR  ${msg}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = {
    confirm: false,
    project: null,
    wipePlanCatalogue: false,
    keepDocumentsRoot: false,
    unknown: [],
  };
  for (const raw of argv) {
    if (raw === "--confirm-delete-everything") out.confirm = true;
    else if (raw.startsWith("--project=")) out.project = raw.slice("--project=".length).trim();
    else if (raw === "--wipe-plan-catalogue") out.wipePlanCatalogue = true;
    else if (raw === "--keep-documents-root") out.keepDocumentsRoot = true;
    else if (raw === "--help" || raw === "-h") out.help = true;
    else out.unknown.push(raw);
  }
  return out;
}

const USAGE = `
  reset-data.mjs — wipe all tenant data (dry run by default)

    node scripts/reset-data.mjs --project=<ref>
        Report only. Reads nothing but counts. Changes nothing.

    node scripts/reset-data.mjs --project=<ref> --confirm-delete-everything
        Actually delete. Irreversible.

  Options
    --project=<ref>                REQUIRED. Must match the ref in
                                   NEXT_PUBLIC_SUPABASE_URL or the run aborts.
    --confirm-delete-everything    The only accepted confirmation. Not -y,
                                   not --force.
    --wipe-plan-catalogue          Also empty billing_plans (kept by default;
                                   see the comment in this file).
    --keep-documents-root          Leave the root-level objects in the public
                                   "documents" bucket alone. They are project
                                   requirement files (tenant data) and are
                                   removed by default; this opts out.
`;

/** Minimal .env parser. Values are read into memory and never printed. */
function loadEnvLocal() {
  if (!fs.existsSync(ENV_FILE)) fail(`.env.local not found at ${ENV_FILE}`);
  const env = {};
  for (const line of fs.readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 1) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

function refFromUrl(url) {
  try {
    const host = new URL(url).hostname;              // <ref>.supabase.co
    const label = host.split(".")[0];
    return label || null;
  } catch {
    return null;
  }
}

/**
 * Ask PostgREST for its OpenAPI document. This is the authoritative list of
 * what actually exists in the live database right now, plus each relation's
 * primary key. Read-only.
 */
async function introspect(url, key) {
  const res = await fetch(`${url.replace(/\/$/, "")}/rest/v1/`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/openapi+json" },
  });
  if (!res.ok) fail(`could not read the PostgREST schema (HTTP ${res.status}). Check the URL and the service role key in .env.local.`);
  const spec = await res.json();
  const defs = spec.definitions || spec.components?.schemas || {};
  const relations = new Map();
  for (const [name, def] of Object.entries(defs)) {
    let pk = null;
    for (const [col, meta] of Object.entries(def.properties || {})) {
      const d = String(meta?.description || "");
      if (d.includes("<pk/>") || /Primary Key/i.test(d)) { pk = col; break; }
    }
    relations.set(name, { pk: pk || (def.properties?.id ? "id" : null) });
  }
  return relations;
}

async function countRows(sb, table) {
  const { count, error } = await sb.from(table).select("*", { count: "exact", head: true });
  if (error) return { count: null, error: error.message };
  return { count: count ?? 0, error: null };
}

/**
 * Delete every row, in batches keyed on the primary key. Batching keeps a
 * large table from timing out and makes the operation naturally resumable:
 * each pass simply picks up whatever is still there.
 */
async function deleteAllRows(sb, table, pk) {
  if (!pk) return { deleted: 0, error: `no primary key discovered for ${table}; skipped` };
  let deleted = 0;
  // Hard cap so a table that refuses to shrink (a BEFORE DELETE trigger
  // returning NULL, say) reports a failure instead of spinning forever.
  for (let iter = 0; ; iter++) {
    if (iter > 10000) return { deleted, error: `${table}: rows are not going away after ${iter} batches — aborting this table` };
    const { data, error } = await sb.from(table).select(pk).limit(BATCH);
    if (error) return { deleted, error: error.message };
    if (!data || data.length === 0) return { deleted, error: null };
    const ids = data.map((r) => r[pk]);
    const { error: delErr } = await sb.from(table).delete().in(pk, ids);
    if (delErr) return { deleted, error: delErr.message };
    deleted += ids.length;
    if (data.length < BATCH) {
      // One more loop to confirm empty; cheap and guards against races.
      const { count } = await sb.from(table).select("*", { count: "exact", head: true });
      if (!count) return { deleted, error: null };
    }
  }
}

/** Recursively enumerate object paths under a prefix. Read-only. */
async function listObjects(sb, bucket, prefix = "") {
  const found = [];
  const stack = [prefix];
  while (stack.length) {
    const dir = stack.pop();
    let offset = 0;
    for (;;) {
      const { data, error } = await sb.storage.from(bucket).list(dir, { limit: 1000, offset });
      if (error) return { objects: found, error: error.message };
      if (!data || data.length === 0) break;
      for (const entry of data) {
        const full = dir ? `${dir}/${entry.name}` : entry.name;
        // PostgREST/storage returns pseudo-folders with a null id.
        if (entry.id === null || entry.id === undefined) stack.push(full);
        else found.push(full);
      }
      if (data.length < 1000) break;
      offset += data.length;
    }
  }
  return { objects: found, error: null };
}

async function removeObjects(sb, bucket, paths) {
  let removed = 0;
  const errors = [];
  for (let i = 0; i < paths.length; i += 100) {
    const chunk = paths.slice(i, i + 100);
    const { error } = await sb.storage.from(bucket).remove(chunk);
    if (error) errors.push(error.message);
    else removed += chunk.length;
  }
  return { removed, errors };
}

async function listAllAuthUsers(sb) {
  const users = [];
  for (let page = 1; page <= 200; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) return { users, error: error.message };
    const batch = data?.users || [];
    users.push(...batch);
    if (batch.length < 1000) break;
  }
  return { users, error: null };
}

function pad(s, n) { return String(s).padEnd(n); }
function padL(s, n) { return String(s).padStart(n); }
function rule(ch = "-") { return ch.repeat(78); }

/* =================================================================== */

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(USAGE); process.exit(0); }
  if (args.unknown.length) {
    fail(`unrecognised argument(s): ${args.unknown.join(", ")}\n${USAGE}`);
  }

  const env = loadEnvLocal();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) fail("NEXT_PUBLIC_SUPABASE_URL is not set in .env.local");
  if (!serviceKey) fail("SUPABASE_SERVICE_ROLE_KEY is not set in .env.local — this script needs the service role");

  const envRef = refFromUrl(url);
  if (!envRef) fail(`could not read a project ref out of NEXT_PUBLIC_SUPABASE_URL (${url})`);

  // ---- The guard rail. Both modes. ----
  if (!args.project) {
    fail(
      `--project=<ref> is required.\n` +
      `         .env.local currently points at project ref "${envRef}".\n` +
      `         Confirm that is the database you mean, then re-run with --project=${envRef}`
    );
  }
  if (args.project !== envRef) {
    fail(
      `PROJECT MISMATCH — refusing to continue.\n` +
      `         you passed        --project=${args.project}\n` +
      `         .env.local points at  ${envRef}\n\n` +
      `         One of the two is wrong. Do not "fix" this by changing the flag\n` +
      `         until you are certain which project ${envRef} actually is.`
    );
  }

  const DRY = !args.confirm;

  console.log("");
  console.log(rule("="));
  console.log(`  DATA RESET  —  ${DRY ? "DRY RUN (nothing will be changed)" : "*** LIVE DELETION ***"}`);
  console.log(rule("="));
  console.log(`  project ref : ${envRef}`);
  console.log(`  api url     : ${url}`);
  console.log(`  credential  : SUPABASE_SERVICE_ROLE_KEY from .env.local (not printed)`);
  console.log(`  time        : ${new Date().toISOString()}`);
  console.log("");

  if (!DRY) {
    console.log("  This is irreversible. Every organisation, every user account —");
    console.log("  including yours — and every uploaded file will be gone.");
    console.log("  Starting in 5 seconds; Ctrl-C now to abort.");
    await new Promise((r) => setTimeout(r, 5000));
    console.log("");
  }

  const sb = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ---- What actually exists in this database right now ----
  const relations = await introspect(url, serviceKey);

  const plan = DELETE_ORDER.filter((e) => relations.has(e.table));
  const missing = DELETE_ORDER.filter((e) => !relations.has(e.table)).map((e) => e.table);

  const planned = new Set(plan.map((e) => e.table));
  const unlisted = [...relations.keys()]
    .filter((t) => !planned.has(t) && !PRESERVE_TABLES.has(t))
    .sort();

  if (args.wipePlanCatalogue && relations.has("billing_plans")) {
    plan.push({ table: "billing_plans", tier: 11, reason: "explicitly requested with --wipe-plan-catalogue" });
    PRESERVE_TABLES.delete("billing_plans");
  }

  /* ---------------- PHASE 1: database rows ---------------- */
  console.log(rule());
  console.log("  PHASE 1 — DATABASE ROWS (children first, derived from database/*.sql)");
  console.log(rule());
  console.log(`  ${pad("tier", 6)}${pad("table", 34)}${padL("rows", 10)}   why here`);
  console.log(rule());

  const rowResults = [];
  let totalRows = 0;
  for (const entry of plan) {
    const { count, error } = await countRows(sb, entry.table);
    if (error) {
      console.log(`  ${pad(entry.tier, 6)}${pad(entry.table, 34)}${padL("ERR", 10)}   ${error}`);
      rowResults.push({ ...entry, count: null, readError: error });
      continue;
    }
    totalRows += count;
    console.log(`  ${pad(entry.tier, 6)}${pad(entry.table, 34)}${padL(count, 10)}   ${entry.reason}`);
    rowResults.push({ ...entry, count });
  }
  console.log(rule());
  console.log(`  ${pad("", 6)}${pad("TOTAL ROWS IN SCOPE", 34)}${padL(totalRows, 10)}`);
  console.log("");

  if (PRESERVE_TABLES.size) {
    console.log("  PRESERVED (configuration, not tenant data):");
    for (const [t, why] of PRESERVE_TABLES) {
      const { count } = relations.has(t) ? await countRows(sb, t) : { count: "n/a" };
      console.log(`    ${pad(t, 26)} ${padL(count ?? 0, 6)} rows kept — ${why}`);
    }
    console.log("");
  }

  if (missing.length) {
    console.log(`  NOT PRESENT in this database (skipped): ${missing.join(", ")}`);
    console.log("");
  }

  if (unlisted.length) {
    console.log("  LEFT BEHIND — relations this script does not recognise.");
    console.log("  These are NOT deleted. Review them; if any hold tenant data, clear");
    console.log("  them by hand or add them to DELETE_ORDER in this file:");
    for (const t of unlisted) {
      const { count, error } = await countRows(sb, t);
      console.log(`    ${pad(t, 34)} ${error ? "unreadable (probably a view)" : `${count} rows`}`);
    }
    console.log("");
  }

  /* ---------------- PHASE 2: Supabase Auth ---------------- */
  console.log(rule());
  console.log("  PHASE 2 — SUPABASE AUTH ACCOUNTS");
  console.log(rule());
  console.log("  Deleting admin_users / developers / clients rows leaves the Auth");
  console.log("  accounts behind. /api/auth/signup calls auth.admin.createUser and");
  console.log("  SWALLOWS its error (src/app/api/auth/signup/route.js:165-172), so a");
  console.log("  leftover account does not fail signup loudly — it produces an");
  console.log("  admin_users row with auth_user_id NULL that can never log in.");
  console.log("  These must go, and they must go AFTER the developers rows, because");
  console.log("  developers.user_id references auth.users with no ON DELETE action.");
  console.log("");

  const { users: authUsers, error: authErr } = await listAllAuthUsers(sb);
  if (authErr) {
    console.log(`  could not enumerate Auth users: ${authErr}`);
  } else if (authUsers.length === 0) {
    console.log("  none present.");
  } else {
    console.log(`  ${authUsers.length} account(s) would be removed:`);
    for (const u of authUsers) {
      const meta = u.app_metadata || {};
      const label = [meta.user_type, meta.role].filter(Boolean).join("/") || "no org claims";
      console.log(`    ${pad(u.email || "(no email)", 42)} ${label}`);
    }
  }
  console.log("");

  /* ---------------- PHASE 3: storage ---------------- */
  console.log(rule());
  console.log("  PHASE 3 — STORAGE OBJECTS");
  console.log(rule());

  const { data: buckets, error: bucketErr } = await sb.storage.listBuckets();
  const liveBuckets = new Set((buckets || []).map((b) => b.name));
  if (bucketErr) console.log(`  could not list buckets: ${bucketErr.message}`);

  const storagePlan = [];
  const storageLeftBehind = [];

  for (const spec of BUCKET_PLAN) {
    if (!liveBuckets.has(spec.bucket)) {
      console.log(`  ${pad(spec.bucket, 20)} not present in this project — skipped`);
      continue;
    }
    const { objects, error } = await listObjects(sb, spec.bucket);
    if (error) {
      console.log(`  ${pad(spec.bucket, 20)} could not be listed: ${error}`);
      storageLeftBehind.push({ bucket: spec.bucket, reason: `listing failed: ${error}`, paths: [] });
      continue;
    }

    let toRemove = objects;
    let keep = [];
    if (spec.keepRootFlag && args[spec.keepRootFlag]) {
      keep = objects.filter((p) => !p.includes("/"));
      toRemove = objects.filter((p) => p.includes("/"));
    }

    console.log(`  ${pad(spec.bucket, 20)} ${padL(toRemove.length, 7)} object(s) to remove   (${spec.note})`);

    // For the mixed bucket, name what is going before it goes.
    if (spec.breakdown && toRemove.length) {
      const groups = new Map();
      for (const p of toRemove) {
        const key = p.includes("/") ? `${p.split("/")[0]}/` : "<bucket root>";
        groups.set(key, (groups.get(key) || 0) + 1);
      }
      for (const [key, n] of [...groups].sort()) {
        const why = key === "<bucket root>"
          ? "project requirement documents (projects.file_url points here)"
          : key === "org-logos/" ? "organisation logos"
          : key === "screenshots/" ? "legacy screenshot tree"
          : "unclassified — review before confirming";
        console.log(`  ${pad("", 20)} ${padL(n, 7)} under ${pad(key, 16)} ${why}`);
      }
    }

    storagePlan.push({ bucket: spec.bucket, paths: toRemove });
    if (keep.length) {
      storageLeftBehind.push({ bucket: spec.bucket, reason: "root-level objects kept via --keep-documents-root", paths: keep });
    }
  }

  const otherBuckets = [...liveBuckets].filter((b) => !BUCKET_PLAN.some((s) => s.bucket === b));
  if (otherBuckets.length) {
    console.log("");
    console.log(`  buckets this script does not touch: ${otherBuckets.join(", ")}`);
  }

  if (storageLeftBehind.length) {
    console.log("");
    console.log("  LEFT BEHIND in storage — not removed, listed so you can decide:");
    for (const lb of storageLeftBehind) {
      console.log(`    ${lb.bucket}: ${lb.paths.length} object(s) — ${lb.reason}`);
      for (const p of lb.paths.slice(0, 20)) console.log(`      ${p}`);
      if (lb.paths.length > 20) console.log(`      ... and ${lb.paths.length - 20} more`);
    }
  }
  console.log("");

  /* ---------------- DRY RUN STOPS HERE ---------------- */
  if (DRY) {
    const storageTotal = storagePlan.reduce((n, s) => n + s.paths.length, 0);
    console.log(rule("="));
    console.log("  DRY RUN COMPLETE — NOTHING WAS CHANGED");
    console.log(rule("="));
    console.log(`  would delete   ${totalRows} database row(s) across ${plan.length} table(s)`);
    console.log(`  would delete   ${authUsers.length} Supabase Auth account(s)`);
    console.log(`  would delete   ${storageTotal} storage object(s)`);
    console.log("");
    console.log("  To actually do it:");
    console.log("");
    console.log(`    node scripts/reset-data.mjs --project=${envRef} --confirm-delete-everything`);
    console.log("");
    console.log("  Take a Supabase backup first. See docs/data-reset.md.");
    console.log("");
    return;
  }

  /* ---------------- LIVE: delete rows ---------------- */
  console.log(rule());
  console.log("  DELETING ROWS");
  console.log(rule());

  const deletedByTable = new Map();
  const rowErrors = [];
  for (const entry of plan) {
    const pk = relations.get(entry.table)?.pk;
    const { deleted, error } = await deleteAllRows(sb, entry.table, pk);
    deletedByTable.set(entry.table, (deletedByTable.get(entry.table) || 0) + deleted);
    if (error) {
      rowErrors.push({ table: entry.table, error });
      console.log(`  ${pad(entry.table, 34)} ${padL(deleted, 8)} deleted   FAILED: ${error}`);
    } else {
      console.log(`  ${pad(entry.table, 34)} ${padL(deleted, 8)} deleted`);
    }
  }

  // Sweep passes. If anything was left behind by an ordering surprise or a
  // transient failure, retry in the same order until it settles. This is what
  // makes a half-finished run safe to resume.
  for (let pass = 1; pass <= SWEEP_PASSES; pass++) {
    const stragglers = [];
    for (const entry of plan) {
      const { count } = await countRows(sb, entry.table);
      if (count) stragglers.push({ entry, count });
    }
    if (stragglers.length === 0) {
      console.log(`\n  sweep pass ${pass}: all in-scope tables empty.`);
      break;
    }
    console.log(`\n  sweep pass ${pass}: ${stragglers.length} table(s) still hold rows — retrying`);
    for (const { entry } of stragglers) {
      const pk = relations.get(entry.table)?.pk;
      const { deleted, error } = await deleteAllRows(sb, entry.table, pk);
      deletedByTable.set(entry.table, (deletedByTable.get(entry.table) || 0) + deleted);
      console.log(`    ${pad(entry.table, 34)} ${padL(deleted, 8)} deleted${error ? `   FAILED: ${error}` : ""}`);
      if (error) rowErrors.push({ table: entry.table, error });
    }
  }

  /* ---------------- LIVE: delete Auth users ---------------- */
  console.log("");
  console.log(rule());
  console.log("  DELETING SUPABASE AUTH ACCOUNTS");
  console.log(rule());

  // Re-list rather than reusing the dry-run snapshot, so a resumed run sees
  // only what is genuinely left.
  const { users: freshUsers, error: freshErr } = await listAllAuthUsers(sb);
  const authRemoved = [];
  const authErrors = [];
  if (freshErr) {
    authErrors.push(freshErr);
    console.log(`  could not enumerate: ${freshErr}`);
  } else {
    for (const u of freshUsers) {
      const { error } = await sb.auth.admin.deleteUser(u.id);
      if (error) {
        authErrors.push(`${u.email}: ${error.message}`);
        console.log(`  ${pad(u.email || u.id, 44)} FAILED: ${error.message}`);
      } else {
        authRemoved.push(u.email || u.id);
        console.log(`  ${pad(u.email || u.id, 44)} removed`);
      }
    }
    if (freshUsers.length === 0) console.log("  none left.");
  }

  /* ---------------- LIVE: delete storage objects ---------------- */
  console.log("");
  console.log(rule());
  console.log("  DELETING STORAGE OBJECTS");
  console.log(rule());

  let storageRemoved = 0;
  const storageErrors = [];
  for (const s of storagePlan) {
    if (!s.paths.length) { console.log(`  ${pad(s.bucket, 20)} nothing to remove`); continue; }
    const { removed, errors } = await removeObjects(sb, s.bucket, s.paths);
    storageRemoved += removed;
    if (errors.length) storageErrors.push(`${s.bucket}: ${errors.join("; ")}`);
    console.log(`  ${pad(s.bucket, 20)} ${padL(removed, 7)} removed${errors.length ? `   ${errors.length} error(s)` : ""}`);
  }

  /* ---------------- SUMMARY ---------------- */
  console.log("");
  console.log(rule("="));
  console.log("  RESET COMPLETE");
  console.log(rule("="));
  console.log("");
  console.log("  Rows deleted per table:");
  let grand = 0;
  for (const entry of plan) {
    const n = deletedByTable.get(entry.table) || 0;
    grand += n;
    if (n) console.log(`    ${pad(entry.table, 34)} ${padL(n, 8)}`);
  }
  console.log(`    ${pad("TOTAL", 34)} ${padL(grand, 8)}`);
  console.log("");
  console.log(`  Supabase Auth accounts removed: ${authRemoved.length}`);
  for (const e of authRemoved) console.log(`    ${e}`);
  console.log("");
  console.log(`  Storage objects removed: ${storageRemoved}`);
  if (storageLeftBehind.length) {
    console.log("");
    console.log("  Storage LEFT BEHIND (deliberately not removed):");
    for (const lb of storageLeftBehind) {
      console.log(`    ${lb.bucket}: ${lb.paths.length} object(s) — ${lb.reason}`);
    }
  }
  if (unlisted.length) {
    console.log("");
    console.log(`  Relations left untouched because this script does not know them: ${unlisted.join(", ")}`);
  }
  console.log("");
  console.log("  Preserved:");
  for (const [t, why] of PRESERVE_TABLES) console.log(`    ${pad(t, 26)} ${why}`);

  if (rowErrors.length || authErrors.length || storageErrors.length) {
    console.log("");
    console.log("  ERRORS — re-run this script; it is safe to run again and will");
    console.log("  finish whatever is left:");
    for (const e of rowErrors) console.log(`    row   ${e.table}: ${e.error}`);
    for (const e of authErrors) console.log(`    auth  ${e}`);
    for (const e of storageErrors) console.log(`    file  ${e}`);
  }

  console.log("");
  console.log(rule());
  console.log("  WHAT TO DO NEXT");
  console.log(rule());
  console.log("  1. The database has no accounts at all. You cannot log in.");
  console.log("  2. Go to /admin/registration and sign up again. That flow creates");
  console.log("     the admin_users row, the organization, the owner membership and");
  console.log("     the Supabase Auth account in one step (/api/auth/signup).");
  console.log("  3. Your old email address is free again — the Auth account that used");
  console.log("     to hold it is gone, so createUser will not collide.");
  console.log("  4. Schema, policies, functions, triggers and the plan catalogue are");
  console.log("     unchanged. No migration needs re-running.");
  console.log("");
}

main().catch((e) => {
  console.error("");
  console.error(`  UNEXPECTED FAILURE: ${e?.message || e}`);
  console.error("  Nothing further was attempted. This script is safe to re-run.");
  console.error("");
  process.exit(1);
});

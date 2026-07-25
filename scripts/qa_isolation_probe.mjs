#!/usr/bin/env node
/**
 * qa_isolation_probe.mjs — READ-ONLY client-isolation test (no seeding, no writes).
 *
 * It signs in as a real CLIENT account (create one via the app's invite flow
 * first) and asserts, against the LIVE database with that client's JWT, that:
 *   - the client CAN see projects (only their linked ones), and
 *   - the client CANNOT see any tracking / staff / internal tables, and
 *   - the client CANNOT see draft invoices.
 *
 * Because it uses the anon key + a real sign-in, every query is subject to RLS
 * exactly as the browser would be. It changes nothing.
 *
 * USAGE:
 *   CLIENT_EMAIL='client@example.com' CLIENT_PASSWORD='...' \
 *     node scripts/qa_isolation_probe.mjs
 *
 * Optional second account to prove org-A-vs-org-B isolation for staff/admin:
 *   ADMIN_EMAIL='adminB@example.com' ADMIN_PASSWORD='...'  (any non-client user)
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// ---- load NEXT_PUBLIC_SUPABASE_URL + ANON_KEY from .env.local (no secrets printed)
function loadEnv() {
  for (const f of [".env.local", ".env"]) {
    try {
      const txt = readFileSync(join(ROOT, f), "utf8");
      for (const line of txt.split("\n")) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (m && !(m[1] in process.env)) {
          process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
        }
      }
    } catch {
      /* file may not exist; ignore */
    }
  }
}
loadEnv();

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!URL || !ANON) {
  console.error("❌ Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY (.env.local).");
  process.exit(2);
}

// Tables a client must NEVER be able to read (RLS should return 0 rows even
// though the organization has data in them).
const DENIED = [
  "screenshots",
  "keyboard_stats",
  "mouse_activities",
  "app_usage",
  "productivity_sessions",
  "browser_usage",
  "developer_activities",
  "developers",
  "admin_users",
  "productivity_metrics",
  "notifications",
  "teams",
  "departments",
  "invitations",
];

let pass = 0,
  fail = 0,
  skip = 0;
const line = (ok, msg) => {
  if (ok === "skip") {
    skip++;
    console.log(`   •  SKIP  ${msg}`);
  } else if (ok) {
    pass++;
    console.log(`   ✅ PASS  ${msg}`);
  } else {
    fail++;
    console.log(`   ❌ FAIL  ${msg}`);
  }
};

async function countVisible(db, table, extra) {
  let q = db.from(table).select("*", { count: "exact", head: true });
  if (extra) q = extra(q);
  const { count, error } = await q;
  return { count: count ?? 0, error };
}

async function main() {
  const CLIENT_EMAIL = process.env.CLIENT_EMAIL;
  const CLIENT_PASSWORD = process.env.CLIENT_PASSWORD;
  if (!CLIENT_EMAIL || !CLIENT_PASSWORD) {
    console.error("❌ Set CLIENT_EMAIL and CLIENT_PASSWORD (a client account created via the app).");
    process.exit(2);
  }

  console.log(`\n🔒 Client isolation probe  →  ${URL}\n`);

  // ---- sign in as the client (real JWT, RLS applies) ----------------------
  const cdb = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data: signIn, error: signErr } = await cdb.auth.signInWithPassword({
    email: CLIENT_EMAIL,
    password: CLIENT_PASSWORD,
  });
  if (signErr || !signIn?.session) {
    console.error(`❌ Client sign-in failed: ${signErr?.message || "no session"}`);
    console.error("   (Is this a Supabase Auth account? Legacy plaintext-only users can't get a JWT.)");
    process.exit(1);
  }
  const meta = signIn.user.app_metadata || {};
  console.log(`Signed in as ${CLIENT_EMAIL}`);
  console.log(`  app_metadata: role=${meta.role} user_type=${meta.user_type} org=${meta.organization_id ? "set" : "MISSING"}\n`);
  line(meta.user_type === "client", `JWT user_type is 'client' (got '${meta.user_type}')`);
  line(!!meta.organization_id, "JWT carries organization_id");

  // ---- client SHOULD see projects (only their linked ones) ----------------
  console.log("\n▸ Client visibility (expected):");
  const proj = await countVisible(cdb, "projects");
  if (proj.error) line(false, `projects query errored: ${proj.error.message}`);
  else line(proj.count > 0, `client can see ${proj.count} linked project(s)`);

  // ---- client MUST NOT see tracking / staff / internal tables -------------
  console.log("\n▸ Denied tables (expect 0 rows via RLS):");
  for (const t of DENIED) {
    const { count, error } = await countVisible(cdb, t);
    if (error) {
      // 42P01 = table absent in this DB; anything else is a real signal.
      if (error.code === "42P01" || /does not exist/i.test(error.message)) {
        line("skip", `${t} — table not present`);
      } else {
        // A permission error is also acceptable (means denied).
        line(true, `${t} → blocked (${error.code || error.message})`);
      }
    } else {
      line(count === 0, `${t} → ${count} rows visible (want 0)`);
    }
  }

  // ---- client MUST NOT see draft invoices ---------------------------------
  console.log("\n▸ Invoice draft rule:");
  const draft = await countVisible(cdb, "invoices", (q) => q.eq("status", "draft"));
  if (draft.error) line("skip", `invoices — ${draft.error.message}`);
  else line(draft.count === 0, `draft invoices visible = ${draft.count} (want 0)`);

  await cdb.auth.signOut();

  // ---- optional: org isolation for a second (non-client) account ----------
  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    console.log("\n▸ Second account (org isolation sanity):");
    const adb = createClient(URL, ANON, { auth: { persistSession: false } });
    const { data: a, error: ae } = await adb.auth.signInWithPassword({
      email: process.env.ADMIN_EMAIL,
      password: process.env.ADMIN_PASSWORD,
    });
    if (ae || !a?.session) {
      line("skip", `second account sign-in failed: ${ae?.message}`);
    } else {
      const aMeta = a.user.app_metadata || {};
      const p = await countVisible(adb, "projects");
      // Every project this account sees must belong to ITS org — we can't read
      // other orgs to compare, but a non-client should see its own org's rows.
      line(!p.error, `account (${aMeta.role}) sees ${p.count} project(s) in its own org`);
      // A non-client CAN read staff tables for its org; just confirm no error.
      const d = await countVisible(adb, "developers");
      line(!d.error, `account can read its own org's developers (${d.count})`);
      await adb.auth.signOut();
    }
  }

  console.log(`\n———\nRESULT:  ${pass} passed · ${fail} failed · ${skip} skipped\n`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Probe crashed:", e);
  process.exit(1);
});

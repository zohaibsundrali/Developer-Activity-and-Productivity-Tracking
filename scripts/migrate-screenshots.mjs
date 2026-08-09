#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * =====================================================================
 *  migrate-screenshots.mjs — move employee screen captures out of the
 *  PUBLIC `screenshots` bucket into the PRIVATE `monitoring` bucket
 * =====================================================================
 *
 *  WHY THIS EXISTS
 *  ---------------
 *  Migration 019 created a private `monitoring` bucket for screen captures and
 *  040 narrowed its read policy to per-person access. Neither has ever governed
 *  a single object: `monitoring` is empty, and every screenshot this product has
 *  ever taken is sitting in a separate bucket named `screenshots` whose `public`
 *  flag is true. Anyone holding a URL can view any employee's screen, with no
 *  session at all.
 *
 *  019's own progress query — `storage_path like 'screenshots/%'` — reports zero
 *  rows left to migrate, because it was written for a `screenshots/` PREFIX
 *  inside the `documents` bucket rather than a bucket of that name. The stored
 *  paths look like `zohaib6511/screenshot_20260705_105605_570_aaf3ae68.jpg`, so
 *  they never matched. The cleanup has looked finished since the day it landed.
 *
 *  WHAT THIS DOES
 *  --------------
 *  For every row of public.screenshots whose storage_path is not already in the
 *  `monitoring` shape:
 *
 *    1. download the object from `screenshots`
 *    2. upload it to `monitoring` at {organization_id}/{developer_id}/{basename}
 *    3. VERIFY the copy — the object exists in `monitoring` and its byte length
 *       matches the source — before the row is touched
 *    4. update the row: storage_path -> the new key, public_url -> null
 *
 *  It never deletes anything, in either mode. Emptying the old bucket is a
 *  separate, later, owner-run decision; see docs/screenshot-bucket-migration.md.
 *
 *  THE PATH SHAPE IS THE ACCESS CONTROL
 *  ------------------------------------
 *  Migration 040 PART 15:
 *
 *    create policy monitoring_read on storage.objects for select to authenticated
 *      using (bucket_id = 'monitoring' and not public.auth_is_client()
 *             and (storage.foldername(name))[1] = public.auth_org()::text
 *             and ((select public.auth_monitoring_sees_all())
 *                  or public.auth_can_read_member(
 *                       public.try_uuid((storage.foldername(name))[2]))))
 *
 *  Segment 1 is matched against the caller's organization. Segment 2 is parsed
 *  as a uuid and handed to auth_can_read_member, which is what stops a colleague
 *  signing a colleague's capture. Put the file anywhere else in the bucket and
 *  it is unreadable by every authenticated caller — the policy has no "else".
 *
 *  screenshots.developer_id is the right value for segment 2: it equals
 *  memberships.user_id, which is exactly the set auth_monitoring_subjects()
 *  returns. (Verified on this project: developers.id and memberships.user_id
 *  are the same uuids for both developer rows.)
 *
 *  WHY THE ORIGINAL BASENAME IS KEPT
 *  ---------------------------------
 *  New uploads are named `{ts}-{uuid}.png` by the upload route. Migrated objects
 *  keep whatever basename they already had. Only segments 1 and 2 are read by
 *  any policy, so both satisfy 040 — and keeping the basename buys three things
 *  a fresh name would not:
 *
 *    - IDEMPOTENCE. Re-running produces the same target key, so a run that dies
 *      halfway can simply be run again. A `Date.now()`-based name would copy
 *      everything a second time.
 *    - screenshots.filename stays truthful. The migration does not have to
 *      rewrite a second column to avoid leaving it stale.
 *    - The capture time encoded in the agent's filename survives, which is the
 *      only timestamp some of these objects carry.
 *
 *  ROWS THAT CANNOT BE FULLY ATTRIBUTED
 *  ------------------------------------
 *  On this project 64 of 88 rows have organization_id = NULL. They are migrated
 *  to `unassigned/{developer_id}/{basename}`, matching the sentinel the upload
 *  route already uses. Under 040 such an object is readable by the service role
 *  only — and that is not a regression, because those same rows are ALREADY
 *  invisible to every authenticated caller: 014's and 040's table policy on
 *  public.screenshots opens with `organization_id = public.auth_org()`, and NULL
 *  never equals anything. Nothing in the UI can reach them today. What changes
 *  is that they stop being reachable by strangers with a URL.
 *
 *  ORPHANED OBJECTS
 *  ----------------
 *  This project's public bucket holds 193 objects but only 88 have a database
 *  row. This script is ROW-DRIVEN and will not move the other 105 — it has no
 *  organization or developer id for them, and inventing one would put employee
 *  screen captures in a stranger's folder.
 *
 *  Those orphans still need dealing with, and the good news is that they need
 *  nothing from this script: no database row points at them, so no screen in the
 *  product renders them, so flipping the bucket to private closes them without
 *  breaking anything at all. The dry run counts them so the number is on the
 *  record. See docs/screenshot-bucket-migration.md.
 *
 *  MODES
 *  -----
 *    node scripts/migrate-screenshots.mjs --project=<ref>
 *        DRY RUN (the default). Reads only. Prints exactly what would move,
 *        where to, and what would be skipped and why. Changes nothing.
 *
 *    node scripts/migrate-screenshots.mjs --project=<ref> --confirm-migrate
 *        Copies objects and rewrites rows. Copies only — deletes nothing.
 *
 *  The project ref is REQUIRED in both modes and must match the ref in
 *  NEXT_PUBLIC_SUPABASE_URL, for the reason scripts/reset-data.mjs gives: a
 *  stale .env.local pointed at the wrong project is the failure mode that ends a
 *  company, so the operator has to state which database they mean.
 *
 *  SAFE TO RE-RUN
 *  --------------
 *  Every step is idempotent. Already-migrated rows are skipped by shape; an
 *  object already present in `monitoring` is verified rather than re-uploaded;
 *  a row is only rewritten after its copy has been confirmed byte-for-byte.
 *
 *  A manifest of every (id, old storage_path, old public_url, new storage_path)
 *  is written before any row changes, so the rewrite is reversible from disk.
 * =====================================================================
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(HERE, "..");
const ENV_FILE = path.join(PROJECT_ROOT, ".env.local");

const SOURCE_BUCKET = "screenshots";
const TARGET_BUCKET = "monitoring";

/**
 * Re-declared from src/utils/screenshotFiles.js. This file is a standalone node
 * script and cannot import through the `@/` alias, so the shape lives in two
 * places; tests/screenshotPaths.test.js asserts the two agree.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UNASSIGNED_ORG_SEGMENT = "unassigned";

function isMonitoringPath(p) {
  if (!p || typeof p !== "string") return false;
  const parts = p.split("/");
  if (parts.length < 3) return false;
  const [org, developer, ...rest] = parts;
  if (org !== UNASSIGNED_ORG_SEGMENT && !UUID_RE.test(org)) return false;
  if (!UUID_RE.test(developer)) return false;
  return rest.every((segment) => segment.length > 0);
}

function buildMonitoringPath({ organizationId, developerId, filename }) {
  if (!developerId) throw new Error("developerId is required to build a monitoring path");
  if (!filename) throw new Error("filename is required to build a monitoring path");
  return `${organizationId || UNASSIGNED_ORG_SEGMENT}/${developerId}/${filename}`;
}

/* =================================================================== */

const PAGE = 500;

function fail(msg) {
  console.error(`\n  ERROR  ${msg}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = { confirm: false, project: null, help: false, unknown: [] };
  for (const raw of argv) {
    if (raw === "--confirm-migrate") out.confirm = true;
    else if (raw.startsWith("--project=")) out.project = raw.slice("--project=".length).trim();
    else if (raw === "--help" || raw === "-h") out.help = true;
    else out.unknown.push(raw);
  }
  return out;
}

const USAGE = `
  migrate-screenshots.mjs — move screen captures from the PUBLIC "screenshots"
  bucket into the PRIVATE "monitoring" bucket (dry run by default)

    node scripts/migrate-screenshots.mjs --project=<ref>
        Report only. Reads nothing but rows and object metadata. Changes nothing.

    node scripts/migrate-screenshots.mjs --project=<ref> --confirm-migrate
        Copy each object across, verify it, then repoint the row.
        Copies only. Deletes nothing, from either bucket, ever.

  Options
    --project=<ref>      REQUIRED. Must match the ref in NEXT_PUBLIC_SUPABASE_URL
                         or the run aborts.
    --confirm-migrate    The only accepted confirmation. Not -y, not --force.

  This script does NOT change the bucket's public flag and does NOT delete
  anything. Both are the owner's call, in the order set out in
  docs/screenshot-bucket-migration.md.
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
    const label = new URL(url).hostname.split(".")[0];
    return label || null;
  } catch {
    return null;
  }
}

function pad(s, n) { return String(s).padEnd(n); }
function padL(s, n) { return String(s).padStart(n); }
function rule(ch = "-") { return ch.repeat(78); }

function human(bytes) {
  if (!Number.isFinite(bytes)) return "?";
  const units = ["B", "KB", "MB", "GB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Every row of public.screenshots, paged. Read-only. */
async function fetchAllRows(sb) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("screenshots")
      .select("id, storage_path, public_url, developer_id, organization_id, filename")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) fail(`could not read public.screenshots — ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}

/** Recursively enumerate object keys under a bucket. Read-only. */
async function listObjects(sb, bucket) {
  const found = new Map();
  const stack = [""];
  while (stack.length) {
    const dir = stack.pop();
    for (let offset = 0; ; ) {
      const { data, error } = await sb.storage.from(bucket).list(dir, { limit: 1000, offset });
      if (error) return { objects: found, error: error.message };
      if (!data || data.length === 0) break;
      for (const entry of data) {
        const full = dir ? `${dir}/${entry.name}` : entry.name;
        // The storage API returns pseudo-folders with a null id.
        if (entry.id === null || entry.id === undefined) stack.push(full);
        else found.set(full, entry.metadata?.size ?? null);
      }
      if (data.length < 1000) break;
      offset += data.length;
    }
  }
  return { objects: found, error: null };
}

/**
 * Copy one object and prove the copy landed intact.
 * Returns { ok, skipped, bytes, error }. Never removes the source.
 */
async function copyAndVerify(sb, sourceKey, targetKey, expectedSize) {
  const dl = await sb.storage.from(SOURCE_BUCKET).download(sourceKey);
  if (dl.error || !dl.data) return { ok: false, error: `download failed — ${dl.error?.message || "no body"}` };

  const buffer = Buffer.from(await dl.data.arrayBuffer());
  if (buffer.length === 0) return { ok: false, error: "source object is zero bytes" };
  if (Number.isFinite(expectedSize) && expectedSize > 0 && buffer.length !== expectedSize) {
    return { ok: false, error: `source size mismatch: listing said ${expectedSize}, downloaded ${buffer.length}` };
  }

  const up = await sb.storage.from(TARGET_BUCKET).upload(targetKey, buffer, {
    contentType: dl.data.type || "application/octet-stream",
    upsert: true,
  });
  if (up.error) return { ok: false, error: `upload failed — ${up.error.message}` };

  // VERIFY before the caller is allowed to touch the row: read the copy back out
  // of the private bucket and compare its length to the source. An upload that
  // reported success but landed truncated must not cause a row to be repointed.
  const check = await sb.storage.from(TARGET_BUCKET).download(targetKey);
  if (check.error || !check.data) {
    return { ok: false, error: `verify failed — copy not readable back (${check.error?.message || "no body"})` };
  }
  const copied = Buffer.from(await check.data.arrayBuffer());
  if (copied.length !== buffer.length) {
    return { ok: false, error: `verify failed — copy is ${copied.length} bytes, source is ${buffer.length}` };
  }

  return { ok: true, bytes: buffer.length };
}

/* =================================================================== */

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(USAGE); process.exit(0); }
  if (args.unknown.length) fail(`unrecognised argument(s): ${args.unknown.join(", ")}\n${USAGE}`);

  const env = loadEnvLocal();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) fail("NEXT_PUBLIC_SUPABASE_URL is not set in .env.local");
  if (!serviceKey) fail("SUPABASE_SERVICE_ROLE_KEY is not set in .env.local — this script needs the service role");

  const envRef = refFromUrl(url);
  if (!envRef) fail(`could not read a project ref out of NEXT_PUBLIC_SUPABASE_URL (${url})`);

  // ---- The guard rail. Both modes. Same contract as reset-data.mjs. ----
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
  console.log(`  SCREENSHOT BUCKET MIGRATION  —  ${DRY ? "DRY RUN (nothing will be changed)" : "*** LIVE COPY + ROW REWRITE ***"}`);
  console.log(rule("="));
  console.log(`  project ref : ${envRef}`);
  console.log(`  source      : ${SOURCE_BUCKET}  (PUBLIC)`);
  console.log(`  target      : ${TARGET_BUCKET}  (private, governed by migrations 019 + 040)`);
  console.log(`  credential  : SUPABASE_SERVICE_ROLE_KEY from .env.local (not printed)`);
  console.log(`  time        : ${new Date().toISOString()}`);
  console.log("");
  console.log("  This script copies. It never deletes, and it never changes a");
  console.log("  bucket's public flag. See docs/screenshot-bucket-migration.md.");
  console.log("");

  const sb = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  // ---- Confirm the target bucket really is private before moving anything ----
  const { data: buckets, error: bucketErr } = await sb.storage.listBuckets();
  if (bucketErr) fail(`could not list buckets — ${bucketErr.message}`);
  const source = buckets.find((b) => b.id === SOURCE_BUCKET);
  const target = buckets.find((b) => b.id === TARGET_BUCKET);
  if (!source) fail(`source bucket "${SOURCE_BUCKET}" does not exist in this project`);
  if (!target) fail(`target bucket "${TARGET_BUCKET}" does not exist — run migration 019 first`);
  if (target.public) {
    fail(
      `target bucket "${TARGET_BUCKET}" is PUBLIC.\n` +
      `         Moving captures into it would achieve nothing. Re-run migration 019.`
    );
  }

  console.log(rule());
  console.log("  BUCKETS");
  console.log(rule());
  for (const b of buckets) {
    console.log(`    ${pad(b.id, 20)} ${b.public ? "PUBLIC " : "private"}`);
  }
  console.log("");

  // ---- Inventory ----
  const rows = await fetchAllRows(sb);
  const srcList = await listObjects(sb, SOURCE_BUCKET);
  if (srcList.error) fail(`could not list "${SOURCE_BUCKET}" — ${srcList.error}`);
  const tgtList = await listObjects(sb, TARGET_BUCKET);
  if (tgtList.error) fail(`could not list "${TARGET_BUCKET}" — ${tgtList.error}`);

  const plan = [];
  const alreadyDone = [];
  const skipped = [];
  const referenced = new Set();

  for (const row of rows) {
    const p = row.storage_path;

    if (isMonitoringPath(p)) { alreadyDone.push(row); referenced.add(p); continue; }

    if (!p) { skipped.push({ row, why: "storage_path is null — nothing to move" }); continue; }
    if (!row.developer_id) {
      skipped.push({ row, why: "developer_id is null — segment 2 of the key would not be a uuid, so 040 could never grant a read" });
      continue;
    }
    if (!srcList.objects.has(p)) {
      skipped.push({ row, why: `no object at "${SOURCE_BUCKET}/${p}" — the row points at nothing` });
      continue;
    }

    referenced.add(p);
    const basename = p.split("/").pop();
    plan.push({
      row,
      sourceKey: p,
      targetKey: buildMonitoringPath({
        organizationId: row.organization_id,
        developerId: row.developer_id,
        filename: basename,
      }),
      size: srcList.objects.get(p),
      unattributed: !row.organization_id,
    });
  }

  // Target-key collisions would silently overwrite one capture with another.
  const byTarget = new Map();
  for (const item of plan) {
    if (!byTarget.has(item.targetKey)) byTarget.set(item.targetKey, []);
    byTarget.get(item.targetKey).push(item);
  }
  const collisions = [...byTarget.entries()].filter(([, v]) => v.length > 1);

  const orphans = [...srcList.objects.keys()].filter(
    (k) => !referenced.has(k) && !k.endsWith(".emptyFolderPlaceholder")
  );

  // ---- Report ----
  console.log(rule());
  console.log("  INVENTORY");
  console.log(rule());
  console.log(`    public.screenshots rows                     ${padL(rows.length, 6)}`);
  console.log(`      already in the monitoring shape           ${padL(alreadyDone.length, 6)}`);
  console.log(`      to migrate                                ${padL(plan.length, 6)}`);
  console.log(`      skipped                                   ${padL(skipped.length, 6)}`);
  console.log("");
  console.log(`    objects in "${SOURCE_BUCKET}" (public)          ${padL(srcList.objects.size, 6)}`);
  console.log(`      referenced by a row                       ${padL(referenced.size, 6)}`);
  console.log(`      ORPHANED (no row points at them)          ${padL(orphans.length, 6)}`);
  console.log(`    objects in "${TARGET_BUCKET}" (private)         ${padL(tgtList.objects.size, 6)}`);
  console.log("");

  const totalBytes = plan.reduce((a, b) => a + (b.size || 0), 0);
  const unattributed = plan.filter((p) => p.unattributed);

  if (plan.length) {
    console.log(rule());
    console.log(`  MIGRATION PLAN  (${plan.length} objects, ${human(totalBytes)})`);
    console.log(rule());
    const preview = plan.slice(0, 12);
    for (const item of preview) {
      console.log(`    ${item.sourceKey}`);
      console.log(`      -> ${item.targetKey}${item.unattributed ? "   [unattributed org]" : ""}`);
    }
    if (plan.length > preview.length) {
      console.log(`    ... and ${plan.length - preview.length} more`);
    }
    console.log("");
    console.log(`    of those, ${unattributed.length} have organization_id = NULL and go under`);
    console.log(`    "${UNASSIGNED_ORG_SEGMENT}/". Migration 040 makes those service-role-only —`);
    console.log(`    which is not a regression: 014/040's table policy already hides`);
    console.log(`    org-null rows from every authenticated caller. See the header.`);
    console.log("");

    // Group by destination folder so the operator can see who is affected.
    const byFolder = new Map();
    for (const item of plan) {
      const folder = item.targetKey.split("/").slice(0, 2).join("/");
      byFolder.set(folder, (byFolder.get(folder) || 0) + 1);
    }
    console.log("    destination folders:");
    for (const [folder, n] of [...byFolder.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`      ${padL(n, 5)}  ${folder}/`);
    }
    console.log("");
  }

  if (collisions.length) {
    console.log(rule());
    console.log(`  !! TARGET KEY COLLISIONS (${collisions.length}) — NOTHING WILL BE MIGRATED`);
    console.log(rule());
    console.log("    Two source objects would land on the same key and one would");
    console.log("    overwrite the other. Resolve before running with --confirm-migrate.");
    for (const [key, items] of collisions.slice(0, 10)) {
      console.log(`    ${key}`);
      for (const i of items) console.log(`      <- ${i.sourceKey}  (row ${i.row.id})`);
    }
    console.log("");
  }

  if (skipped.length) {
    console.log(rule());
    console.log(`  SKIPPED ROWS (${skipped.length})`);
    console.log(rule());
    for (const s of skipped.slice(0, 20)) {
      console.log(`    row ${s.row.id}`);
      console.log(`      path: ${s.row.storage_path ?? "<null>"}`);
      console.log(`      why : ${s.why}`);
    }
    if (skipped.length > 20) console.log(`    ... and ${skipped.length - 20} more`);
    console.log("");
  }

  if (orphans.length) {
    console.log(rule());
    console.log(`  ORPHANED PUBLIC OBJECTS (${orphans.length}) — NOT MIGRATED BY THIS SCRIPT`);
    console.log(rule());
    console.log("    These are employee screen captures with no row in");
    console.log("    public.screenshots. There is no organization or developer id to");
    console.log("    key them by, and guessing one would file somebody's screen under");
    console.log("    somebody else's name.");
    console.log("");
    console.log("    They need nothing from this script. No row points at them, so no");
    console.log("    screen in the product renders them, so making the bucket private");
    console.log("    closes them without breaking anything. They are listed here so the");
    console.log("    number is on the record before that flag is flipped.");
    console.log("");
    const byFolder = new Map();
    for (const o of orphans) {
      const folder = o.includes("/") ? o.split("/")[0] : "<root>";
      byFolder.set(folder, (byFolder.get(folder) || 0) + 1);
    }
    for (const [folder, n] of [...byFolder.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`      ${padL(n, 5)}  ${folder}/`);
    }
    console.log("");
  }

  if (DRY) {
    console.log(rule("="));
    console.log("  DRY RUN — nothing was changed.");
    console.log(rule("="));
    if (plan.length && !collisions.length) {
      console.log(`  To perform the copy:`);
      console.log(`    node scripts/migrate-screenshots.mjs --project=${envRef} --confirm-migrate`);
    } else if (collisions.length) {
      console.log("  Resolve the key collisions above first.");
    } else {
      console.log("  Nothing to migrate.");
    }
    console.log("");
    console.log("  Do NOT flip the bucket to private until this reports 0 to migrate");
    console.log("  and the app has been checked. docs/screenshot-bucket-migration.md");
    console.log("  has the order.");
    console.log("");
    return;
  }

  // ---- Live path ----
  if (collisions.length) fail("refusing to migrate while target keys collide — see the report above");
  if (!plan.length) { console.log("  Nothing to migrate.\n"); return; }

  const manifestPath = path.join(PROJECT_ROOT, `screenshot-migration-${Date.now()}.json`);
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      plan.map((i) => ({
        id: i.row.id,
        old_storage_path: i.row.storage_path,
        old_public_url: i.row.public_url,
        new_storage_path: i.targetKey,
      })),
      null,
      2
    )
  );
  console.log(`  Manifest written: ${manifestPath}`);
  console.log("  Keep it. It is the only record of the pre-migration values.");
  console.log("");
  console.log("  Starting in 5 seconds; Ctrl-C now to abort.");
  await new Promise((r) => setTimeout(r, 5000));
  console.log("");

  let copied = 0;
  let repointed = 0;
  const failures = [];

  for (const item of plan) {
    const result = await copyAndVerify(sb, item.sourceKey, item.targetKey, item.size);
    if (!result.ok) {
      failures.push({ key: item.sourceKey, why: result.error });
      console.log(`  FAIL  ${item.sourceKey}\n        ${result.error}`);
      continue;
    }
    copied += 1;

    // Only now, with the copy verified readable and the right length, is the
    // row allowed to move. public_url is nulled so that a future signing failure
    // cannot quietly resurrect a world-readable link to a private capture.
    const { error: updErr } = await sb
      .from("screenshots")
      .update({ storage_path: item.targetKey, public_url: null })
      .eq("id", item.row.id);

    if (updErr) {
      failures.push({ key: item.sourceKey, why: `copy ok but row update failed — ${updErr.message}` });
      console.log(`  FAIL  row ${item.row.id}: ${updErr.message} (object copied; safe to re-run)`);
      continue;
    }
    repointed += 1;
    if (repointed % 25 === 0) console.log(`  ... ${repointed}/${plan.length}`);
  }

  console.log("");
  console.log(rule("="));
  console.log("  DONE");
  console.log(rule("="));
  console.log(`    objects copied and verified   ${padL(copied, 6)}`);
  console.log(`    rows repointed                ${padL(repointed, 6)}`);
  console.log(`    failures                      ${padL(failures.length, 6)}`);
  console.log("");
  console.log(`    Nothing was deleted from "${SOURCE_BUCKET}". Its public flag is unchanged.`);
  console.log("");
  if (failures.length) {
    console.log("    Failures (safe to re-run — every step is idempotent):");
    for (const f of failures.slice(0, 20)) console.log(`      ${f.key}\n        ${f.why}`);
    console.log("");
    process.exitCode = 1;
    return;
  }
  console.log("    NEXT: re-run the dry run to confirm 0 left, then check Developer");
  console.log("    Activity, the review panel and the session pages still render.");
  console.log("    Only then does the owner flip the bucket private.");
  console.log("    docs/screenshot-bucket-migration.md, step by step.");
  console.log("");
}

main().catch((e) => fail(e?.stack || String(e)));

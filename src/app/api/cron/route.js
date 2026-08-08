import { NextResponse } from "next/server";
import { serviceClient } from "@/utils/serverAuth";
import { recordEvent } from "@/utils/systemEvents";

export const dynamic = "force-dynamic";

/**
 * Scheduled automation worker (Vercel Cron hits this daily).
 *
 *   1. Due-date reminders — notify assignees of tasks due today/tomorrow and of
 *      anything already overdue. De-duplicated so a task is reminded at most
 *      once per day.
 *   2. Recurring tasks — spawn the next occurrence of tasks flagged
 *      `is_recurring` whose next date has arrived.
 *
 * AUTH: requires `Authorization: Bearer ${CRON_SECRET}` (exactly what Vercel Cron
 * sends when CRON_SECRET is set). If CRON_SECRET is unset the route refuses to
 * run rather than defaulting to open — an unauthenticated writer would be a hole.
 */

const DONE = ["completed", "reviewed"];

// A very long `in.(…)` list becomes a URL the gateway rejects, and a very large
// insert payload risks a statement timeout, so both are issued in batches.
const ID_CHUNK = 200;
const INSERT_CHUNK = 500;

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function ymd(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString().slice(0, 10);
}

function addInterval(dateStr, freq, interval) {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const n = Math.max(1, Number(interval) || 1);
  if (freq === "daily") d.setDate(d.getDate() + n);
  else if (freq === "weekly") d.setDate(d.getDate() + 7 * n);
  else if (freq === "monthly") d.setMonth(d.getMonth() + n);
  else return null;
  return ymd(d);
}

function authorized(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail closed
  const header = request.headers.get("authorization") || "";
  return header === `Bearer ${secret}`;
}

async function runJobs() {
  const svc = serviceClient();
  const today = ymd(new Date());
  const tomorrow = ymd(new Date(Date.now() + 86400000));
  const summary = { remindersSent: 0, recurringSpawned: 0, errors: [] };

  /* ── 1. Due-date reminders ─────────────────────────────────────── */
  try {
    const { data: due, error } = await svc
      .from("developer_tasks")
      .select("id, organization_id, project_id, developer_id, task_title, due_date, end_date, status")
      .not("status", "in", `(${DONE.join(",")})`)
      .not("developer_id", "is", null)
      .lte("due_date", tomorrow);
    if (error) throw error;

    const candidates = (due || []).filter((t) => t.due_date || t.end_date);

    // One dedupe lookup for the whole batch instead of one per task — this was
    // two round trips per due task, which is what made the job scale with the
    // size of the backlog rather than with the work it actually does.
    const remindedToday = new Set();
    for (const ids of chunk(candidates.map((t) => t.id), ID_CHUNK)) {
      const { data: existing, error: dupErr } = await svc
        .from("notifications")
        .select("task_id")
        .in("task_id", ids)
        .eq("type", "due_reminder")
        .gte("created_at", `${today}T00:00:00Z`);
      if (dupErr) throw dupErr;
      (existing || []).forEach((n) => remindedToday.add(n.task_id));
    }

    const rows = candidates
      .filter((task) => !remindedToday.has(task.id))
      .map((task) => {
        const dueOn = task.due_date || task.end_date;
        const overdue = ymd(dueOn) < today;
        return {
          organization_id: task.organization_id,
          developer_id: task.developer_id,
          type: "due_reminder",
          title: overdue ? "Task overdue" : "Task due soon",
          message: overdue
            ? `"${task.task_title || "Untitled"}" was due on ${ymd(dueOn)}.`
            : `"${task.task_title || "Untitled"}" is due on ${ymd(dueOn)}.`,
          project_id: task.project_id || null,
          task_id: task.id,
        };
      });

    for (const batch of chunk(rows, INSERT_CHUNK)) {
      const { error: insErr } = await svc.from("notifications").insert(batch);
      if (insErr) summary.errors.push({ job: "due_reminders", message: insErr.message });
      else summary.remindersSent += batch.length;
    }
  } catch (err) {
    summary.errors.push({ job: "due_reminders", message: err?.message || String(err) });
  }

  /* ── 2. Recurring task spawning ────────────────────────────────── */
  try {
    const { data: recurring, error } = await svc
      .from("developer_tasks")
      .select("*")
      .eq("is_recurring", true);
    if (error) throw error;

    // Work out every occurrence first, so the inserts and the activity feed
    // rows can go out as batches rather than three round trips per template.
    const spawns = [];
    for (const task of recurring || []) {
      const rec = task.recurrence || {};
      const freq = rec.freq;
      if (!freq) continue;

      // Anchor on the last spawn, else the task's own due/end date.
      const anchor = rec.last_spawned || ymd(task.due_date || task.end_date);
      if (!anchor) continue;

      const next = addInterval(anchor, freq, rec.interval);
      if (!next || next > today) continue; // not time yet

      const {
        id, created_at, updated_at, submitted_at, reviewed_at, reviewed_by,
        actual_completion_date, admin_comments, rejection_reason, is_on_time,
        productivity_points, ...keep
      } = task;

      spawns.push({
        task,
        rec,
        next,
        row: {
          ...keep,
          status: "pending",
          start_date: next,
          end_date: next,
          due_date: next,
          is_recurring: false, // the spawned occurrence is a one-off
          recurrence: {},
          created_at: new Date().toISOString(),
        },
      });
    }

    // A batched insert is atomic, so on failure nothing was spawned and we can
    // safely retry one-by-one to keep a single bad template from blocking the
    // rest — the old per-task behaviour.
    const spawned = [];
    for (const batch of chunk(spawns, INSERT_CHUNK)) {
      const { error: insErr } = await svc.from("developer_tasks").insert(batch.map((s) => s.row));
      if (!insErr) {
        spawned.push(...batch);
        continue;
      }
      for (const s of batch) {
        const { error: oneErr } = await svc.from("developer_tasks").insert(s.row);
        if (oneErr) summary.errors.push({ job: "recurring", taskId: s.task.id, message: oneErr.message });
        else spawned.push(s);
      }
    }

    // Advance each template's cursor so it can't double-spawn. The new value
    // differs per template, so this one stays a per-task update.
    for (const s of spawned) {
      await svc
        .from("developer_tasks")
        .update({ recurrence: { ...s.rec, last_spawned: s.next } })
        .eq("id", s.task.id);
    }

    const activity = spawned.map((s) => ({
      organization_id: s.task.organization_id,
      project_id: s.task.project_id,
      entity_type: "task",
      entity_id: s.task.id,
      action: "recurring_spawned",
      meta: { next: s.next },
    }));
    for (const batch of chunk(activity, INSERT_CHUNK)) {
      await svc.from("pm_activity").insert(batch);
    }

    summary.recurringSpawned += spawned.length;
  } catch (err) {
    summary.errors.push({ job: "recurring", message: err?.message || String(err) });
  }

  // Monitoring (best effort, never throws — see src/utils/systemEvents.js).
  //
  // Placed here rather than inside either catch on purpose: this job swallows
  // every failure into `summary.errors` and still answers 200, so nothing
  // upstream ever learns that the nightly run did half its work. Both catches
  // AND the per-batch insert errors — which never throw at all — land in that
  // array, so this is the one point in the file that sees every way the run can
  // fail. No behaviour changes: the same summary is returned either way.
  //
  // orgId is null because a run spans every tenant; the failure belongs to the
  // platform, not to one organization.
  if (summary.errors.length) {
    const first = summary.errors[0];
    await recordEvent({
      orgId: null,
      type: "cron.job_failed",
      severity: "error",
      source: "cron",
      message: `Nightly cron finished with ${summary.errors.length} failure(s): ${first?.message || "unknown"}`,
      context: { job: first?.job, count: summary.errors.length, route: "/api/cron" },
    });
  }

  return summary;
}

export async function GET(request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const summary = await runJobs();
  return NextResponse.json({ ok: true, ranAt: new Date().toISOString(), ...summary });
}

// Same work, for manual triggering from a terminal.
export async function POST(request) {
  return GET(request);
}

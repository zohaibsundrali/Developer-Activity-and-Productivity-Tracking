import { NextResponse } from "next/server";
import { serviceClient } from "@/utils/serverAuth";

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

    for (const task of due || []) {
      const dueOn = task.due_date || task.end_date;
      if (!dueOn) continue;

      // Skip if this task was already reminded today.
      const { data: existing } = await svc
        .from("notifications")
        .select("id")
        .eq("task_id", task.id)
        .eq("type", "due_reminder")
        .gte("created_at", `${today}T00:00:00Z`)
        .limit(1);
      if (existing && existing.length) continue;

      const overdue = ymd(dueOn) < today;
      const { error: insErr } = await svc.from("notifications").insert({
        organization_id: task.organization_id,
        developer_id: task.developer_id,
        type: "due_reminder",
        title: overdue ? "Task overdue" : "Task due soon",
        message: overdue
          ? `"${task.task_title || "Untitled"}" was due on ${ymd(dueOn)}.`
          : `"${task.task_title || "Untitled"}" is due on ${ymd(dueOn)}.`,
        project_id: task.project_id || null,
        task_id: task.id,
      });
      if (!insErr) summary.remindersSent += 1;
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

      const { error: insErr } = await svc.from("developer_tasks").insert({
        ...keep,
        status: "pending",
        start_date: next,
        end_date: next,
        due_date: next,
        is_recurring: false, // the spawned occurrence is a one-off
        recurrence: {},
        created_at: new Date().toISOString(),
      });
      if (insErr) {
        summary.errors.push({ job: "recurring", taskId: task.id, message: insErr.message });
        continue;
      }

      // Advance the template's cursor so it can't double-spawn.
      await svc
        .from("developer_tasks")
        .update({ recurrence: { ...rec, last_spawned: next } })
        .eq("id", task.id);

      await svc.from("pm_activity").insert({
        organization_id: task.organization_id,
        project_id: task.project_id,
        entity_type: "task",
        entity_id: task.id,
        action: "recurring_spawned",
        meta: { next },
      });
      summary.recurringSpawned += 1;
    }
  } catch (err) {
    summary.errors.push({ job: "recurring", message: err?.message || String(err) });
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

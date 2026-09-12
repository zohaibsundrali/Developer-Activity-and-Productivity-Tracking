import { spawnRecurringTasks } from "@/utils/recurringTasks";
import { runBackgroundMaintenance } from '@/utils/backgroundMaintenance';
import { flushProposalDecisionEmails } from '@/utils/proposalDecisionEmails';
import { sensitiveNotificationAudience, canReceiveBillingNotice, canReceiveSignalNotice } from "@/utils/sensitiveNotificationAudience";
import { NextResponse } from "next/server";
import { serviceClient } from "@/utils/serverAuth";
import { recordEvent } from "@/utils/systemEvents";
import { daysUntil, reminderMessage, REMINDER_FROM_DAYS } from "@/utils/billingAccess";
import { checkFeatureAccess } from "@/utils/entitlements";
import { recoverInvitations } from "@/utils/invitationRecovery";
import {
  runDetectors,
  DEFAULTS as SIGNAL_DEFAULTS,
} from "@/utils/signals";
// The identical query set the dashboard uses. Two copies of "what the detectors
// need" would drift, and the first symptom would be the nightly notification
// disagreeing with the panel it links to.
import { collect as collectSignals } from "@/app/api/signals/route";

// Who hears about a trial running out. The two roles that can enter a card —
// see the note on job 3.
const TRIAL_NOTIFY_ROLES = ["owner", "admin"];

// Signal delivery uses the role list and the filter from src/utils/signals.js,
// so this job and the dashboard cannot disagree about who is told what.
const SIGNAL_LOOKBACK_DAYS = (SIGNAL_DEFAULTS.baselineWeeks + 1) * SIGNAL_DEFAULTS.windowDays;
/** Organizations processed per run. Exceeding it is reported, never silent. */
const SIGNAL_ORG_CAP = 1000;

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


function authorized(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail closed
  const header = request.headers.get("authorization") || "";
  return header === `Bearer ${secret}`;
}

async function runJobs() {
  const svc = serviceClient({ requestTimeoutMs: 10000 });
  const today = ymd(new Date());
  const tomorrow = ymd(new Date(Date.now() + 86400000));
  const summary = { remindersSent: 0, recurringSpawned: 0, trialReminders: 0, signalsRaised: 0, errors: [] };
  const maintenance = await runBackgroundMaintenance(svc);
  summary.maintenance = maintenance;
  summary.errors.push(...maintenance.errors);
  try {
    const recovered = await recoverInvitations(svc);
    summary.invitationAccountsCleaned = recovered.cleaned;
    summary.errors.push(...recovered.errors.map(error => ({ job: "invitation_recovery", ...error })));
  } catch {
    summary.errors.push({ job: "invitation_recovery", message: "Invitation recovery unavailable" });
  }
  try {
    const delivery = await flushProposalDecisionEmails(svc);
    summary.proposalEmailsDelivered = delivery.delivered;
    summary.proposalEmailsPending = delivery.pending;
  } catch {
    summary.errors.push({ job: 'proposal_email', message: 'Proposal delivery queue unavailable' });
  }
  const automationChecks = new Map();
  async function automationAllowed(orgId) {
    if (!orgId) return false;
    if (!automationChecks.has(orgId)) {
      automationChecks.set(orgId, checkFeatureAccess(svc, orgId, "automation", "Automation"));
    }
    const refusal = await automationChecks.get(orgId);
    if (refusal?.status === 503) throw new Error("Automation billing verification unavailable");
    return !refusal;
  }

  /* ── 1. Due-date reminders ─────────────────────────────────────── */
  try {
    const { data: due, error } = await svc
      .from("developer_tasks")
      .select("id, organization_id, project_id, developer_id, task_title, due_date, end_date, status")
      .not("status", "in", `(${DONE.join(",")})`)
      .not("developer_id", "is", null)
      .lte("due_date", tomorrow);
    if (error) throw error;

    const candidates = [];
    for (const task of due || []) {
      if ((task.due_date || task.end_date) && await automationAllowed(task.organization_id)) candidates.push(task);
    }

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
      .select("id, organization_id, recurrence, due_date, end_date")
      .eq("is_recurring", true);
    if (error) throw error;

    const spawned = await spawnRecurringTasks(svc, recurring, today, automationAllowed);
    summary.recurringSpawned += spawned.spawned;
    summary.errors.push(...spawned.errors);
  } catch (err) {
    summary.errors.push({ job: "recurring", message: err?.message || String(err) });
  }

  /* ── 3. Trial reminders ────────────────────────────────────────── */
  //
  // One message per organization per day while a paid trial is running, to the
  // people who can actually do something about it.
  //
  // WHO GETS IT: owner and admin only. A developer cannot enter a card, and
  // telling twenty engineers that their employer's trial expires on Friday is
  // noise for nineteen of them and an awkward question for the twentieth.
  //
  // DEDUPE: `notifications` already has one row per recipient per day for this
  // type, so the day's existing rows are read once for the whole batch and
  // used as the filter. Without it, a cron that runs hourly — or twice because
  // a deploy overlapped — sends the same warning six times, which is how people
  // learn to ignore it.
  //
  // The free plan never appears here: it has no trial to run out.
  try {
    const nowTs = new Date();

    const { data: trialing, error } = await svc
      .from("organization_subscriptions")
      .select("organization_id, plan_code, status, trial_end, grace_period_ends_at")
      .eq("status", "trialing")
      .neq("plan_code", "free")
      .not("trial_end", "is", null);
    if (error) throw error;

    // Only trials still running. An already-expired one is not a reminder, it
    // is a lock, and the workspace is telling them so on every screen.
    const live = (trialing || []).filter((s) => new Date(s.trial_end) > nowTs);

    if (live.length) {
      const orgIds = live.map((s) => s.organization_id);

      const { data: plans } = await svc.from("billing_plans").select("code, name");
      const planName = new Map((plans || []).map((p) => [p.code, p.name]));

      const { data: recipients } = await svc
        .from("memberships")
        .select("organization_id, user_id, user_type, email, role, status")
        .in("organization_id", orgIds)
        .in("role", TRIAL_NOTIFY_ROLES)
        .eq("status", "active");

      // One read for the whole batch — see the dedupe note above. Scoped to the
      // organizations in THIS batch and bounded, so a large deployment cannot
      // silently truncate the result into under-deduping.
      const { data: sentToday } = await svc
        .from("notifications")
        .select("admin_id, organization_id")
        .eq("type", "trial_reminder")
        .in("organization_id", orgIds)
        .gte("created_at", `${today}T00:00:00.000Z`)
        .limit(5000);
      const already = new Set(
        (sentToday || []).map((n) => `${n.organization_id}:${n.admin_id}`)
      );

      const billingAudience = await sensitiveNotificationAudience(svc, recipients || []);
      if (billingAudience.failed) summary.errors.push({ job: "trial_reminders", message: "Recipient permissions unavailable; affected notices withheld." });
      const byOrg = new Map(live.map((s) => [s.organization_id, s]));
      const rows = [];
      for (const { member, auth: recipientAuth } of billingAudience.audience) {
        if (!canReceiveBillingNotice(recipientAuth)) continue;
        const sub = byOrg.get(member.organization_id);
        if (!sub) continue;
        if (already.has(`${member.organization_id}:${member.user_id}`)) continue;

        const left = daysUntil(sub.trial_end, nowTs);
        if (left === null || left > REMINDER_FROM_DAYS) continue;

        // ADDRESSED WITH `admin_id` / `admin_email`, NOT `developer_id`.
        //
        // Job 1 above writes `developer_id` because its recipients are
        // developers. These are owners and admins, whose `memberships.user_id`
        // is an `admin_users.id` — and two things go wrong if that is written
        // to `developer_id`:
        //
        //   1. `notifications.developer_id` references `developers(id)`, so an
        //      admin id fails the foreign key and takes the whole batch insert
        //      down. The error lands in `summary.errors` and the route still
        //      answers 200, so the run reports success having sent nothing.
        //   2. Even if it inserted, nobody would see it. `recipientClauses` in
        //      src/utils/notifications.js queries the admin bell as
        //      `admin_id.eq.<id>` OR `admin_email.eq.<email>`, and the realtime
        //      matcher in useNotifications.js agrees. A row with neither is
        //      invisible for ever.
        //
        // `src/utils/notifications.js` already encodes this rule in `notify()`
        // — admin audience writes admin_id/admin_email, developer audience
        // writes developer_id. This follows it.
        rows.push({
          organization_id: member.organization_id,
          admin_id: member.user_id,
          admin_recipient_type: member.user_type,
          admin_email: member.email || null,
          type: "trial_reminder",
          category: "billing",
          title: left <= 1 ? "Trial ending" : `${left} days left on your trial`,
          message: reminderMessage(planName.get(sub.plan_code) || sub.plan_code, left),
          project_id: null,
          task_id: null,
        });
      }

      for (const batch of chunk(rows, INSERT_CHUNK)) {
        const { error: insErr } = await svc.from("notifications").insert(batch);
        if (insErr) summary.errors.push({ job: "trial_reminders", message: insErr.message });
        else summary.trialReminders += batch.length;
      }
    }
  } catch (err) {
    summary.errors.push({ job: "trial_reminders", message: err?.message || String(err) });
  }

  /* ── 4. Signals ────────────────────────────────────────────────── */
  //
  // The nightly pass of the detectors in src/utils/signals.js, delivered to the
  // people who can act on them.
  //
  // ONLY critical AND warning ARE DELIVERED. `info` signals — "nine tasks have
  // not moved in a week" — belong on the dashboard panel, where somebody goes
  // looking. Pushing them into a notification every night is how the whole
  // feature gets muted in a fortnight, and a muted signal is worse than none
  // because everybody believes it is still working.
  //
  // DEDUPE is the signal's own `dedupeKey`, which carries the calendar day, and
  // `notifications` has a unique index on it (migration 029). So a second run
  // in the same day collides rather than duplicating, which is why the insert
  // below goes one row at a time and treats 23505 as success — a batch insert
  // would lose every row in the batch to one collision.
  //
  // WHO IS TOLD: the same rule the API uses. Person-level signals go to owner,
  // admin and hr, and to that person's own manager via `reports_to`. Nothing
  // person-level is broadcast to the whole company.
  try {
    // `error` is checked, unlike the first version. A failed read left `orgs`
    // undefined, skipped the loop, and answered `{ok:true, signalsRaised:0}`
    // with an empty error array — indistinguishable from a quiet night.
    const { data: orgs, error: orgErr } = await svc
      .from("organizations")
      .select("id")
      .limit(SIGNAL_ORG_CAP);
    if (orgErr) throw orgErr;
    // No silent truncation: if there are more organizations than this run will
    // look at, say so rather than letting org 1001 never receive a signal.
    if ((orgs || []).length === SIGNAL_ORG_CAP) {
      summary.errors.push({
        job: "signals",
        message: `Capped at ${SIGNAL_ORG_CAP} organizations; some were not processed this run.`,
      });
    }

    for (const org of orgs || []) {
      const auth = { orgId: org.id, role: "owner", userType: "admin", appUserId: null };
      const since = new Date(Date.now() - SIGNAL_LOOKBACK_DAYS * 86400000).toISOString();

      let bundle;
      try {
        bundle = await collectSignals(svc, auth, new Date(), since);
      } catch (err) {
        summary.errors.push({ job: "signals", org: org.id, message: err?.message || String(err) });
        continue;
      }

      const worth = runDetectors(bundle, new Date()).filter((s) => s.severity !== "info");
      if (!worth.length) continue;

      const { data: recipients, error: recErr } = await svc
        .from("memberships")
        .select("organization_id, user_id, user_type, email, role, reports_to, status")
        .eq("organization_id", org.id)
        .eq("status", "active")
        .in("user_type", ["admin", "developer"]);
      if (recErr) {
        summary.errors.push({ job: "signals", org: org.id, message: recErr.message });
        continue;
      }

      const signalAudience = await sensitiveNotificationAudience(svc, recipients || [], org.id);
      if (signalAudience.failed) summary.errors.push({ job: "signals", org: org.id, message: "Recipient permissions unavailable; affected notices withheld." });

      // Collected first, inserted as one batch per organization. One awaited
      // INSERT per signal per recipient is ~1,700 serial round trips at 50 orgs
      // × 5 signals × 5 recipients, on top of jobs 1-3 in the same invocation —
      // which is how a serverless function times out and loses the entire run,
      // including the failure record.
      const rows = [];

      for (const s of worth) {
        for (const { member, auth: recipientAuth } of signalAudience.audience) {
          if (!canReceiveSignalNotice(recipientAuth, s, bundle.reportsTo)) continue;

          rows.push({
            organization_id: org.id,
            admin_id: member.user_id,
          admin_recipient_type: member.user_type,
            admin_email: member.email || null,
            type: "signal",
            category: "signal",
            title: s.title,
            message: s.message,
            // The organization is IN the key. Org-level signals use constant
            // subject ids ("review-backlog", "stalled", a plan meter name), and
            // the unique index on `dedupe_key` in migration 029 is global
            // rather than per-organization. One person can legitimately be a
            // member of several organizations — so without this, org B's
            // review-backlog notification collides with org A's, comes back
            // 23505, is counted as a successful dedupe, and that person is
            // simply never told about org B.
            dedupe_key: `${org.id}:${s.dedupeKey}:${member.user_id}`,
            metadata: { kind: s.kind, severity: s.severity, subject: s.subject, metric: s.metric },
            // `project_id` and `entity_type` are what make the row clickable —
            // notificationHref resolves a project signal to that project and a
            // sprint signal to the sprints board, and everything else falls
            // through to the overview where the panel is.
            project_id: s.subject?.type === "project" ? s.subject.id : null,
            entity_type: s.subject?.type === "sprint" ? "sprint" : null,
            entity_id: s.subject?.type === "sprint" ? s.subject.id : null,
            task_id: null,
          });
        }
      }

      // One statement per organization. `ignoreDuplicates` makes the unique
      // index on `dedupe_key` skip rows already sent today instead of failing
      // the batch — which is the behaviour the row-at-a-time version was
      // emulating with a 23505 check, at the cost of a round trip per row.
      //
      // `select()` returns only the rows that were actually written, so the
      // count is honest: migration 034 installs a BEFORE INSERT trigger that
      // returns NULL for a category a person has muted, and that produces no
      // error. Counting intent rather than result would have reported signals
      // raised for notifications nobody ever received.
      for (const batch of chunk(rows, INSERT_CHUNK)) {
        const { data: written, error: insErr } = await svc
          .from("notifications")
          .upsert(batch, { onConflict: "dedupe_key", ignoreDuplicates: true })
          .select("id");
        if (insErr) summary.errors.push({ job: "signals", org: org.id, message: insErr.message });
        else summary.signalsRaised += (written || []).length;
      }
    }
  } catch (err) {
    summary.errors.push({ job: "signals", message: err?.message || String(err) });
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
  try {
    const summary = await runJobs();
    const ok = summary.errors.length === 0;
    return NextResponse.json({ ok, ranAt: new Date().toISOString(), ...summary }, { status: ok ? 200 : 503 });
  } catch {
    return NextResponse.json({ ok: false, error: 'Scheduled maintenance could not complete. Recorded work remains available for retry.' }, { status: 503 });
  }
}

// Same work, for manual triggering from a terminal.
export async function POST(request) {
  return GET(request);
}

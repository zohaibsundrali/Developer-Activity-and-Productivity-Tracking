import { NextResponse } from "next/server";
import { getAuthedOrg, serviceClient } from "@/utils/serverAuth";
import { billingConfigured } from "@/utils/stripeServer";
import { providerStatus } from "@/utils/emailProvider";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/health — the read side of the production monitoring surface.
 *
 * Returns five subsystem checks, the organization's recent server-side events
 * and 24-hour severity counts.
 *
 * EVERY CHECK IS DERIVED FROM EVIDENCE. Nothing here is hardcoded "ok". A check
 * reports `ok` only when something observable says so — a row that exists, a
 * timestamp that is recent, a query that answered — and reports `unknown` when
 * the evidence simply is not there, because a green tile that means "we did not
 * look" is worse than an honest blank one.
 *
 * SCOPE. Reads run on the service role (the health picture spans tables a plain
 * admin token cannot fully count), but every query is filtered by the org id
 * from the VERIFIED JWT, never from the request. Rows with a null
 * organization_id — platform-wide events, see migration 038 — are excluded by
 * that same filter and are deliberately not surfaced to a tenant.
 */

// Only the two roles accountable for the deployment. A developer, manager,
// team lead or HR user has no business reading infrastructure failure detail,
// and a client never does. Mirrors the RLS policy in migration 038.
const HEALTH_ROLES = ["owner", "admin"];

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// How long a source may stay quiet before silence stops counting as evidence.
const CRON_STALE_AFTER = 48 * HOUR;
// A webhook recorded but not completed within this window is stuck, not in-flight.
const WEBHOOK_STUCK_AFTER = 15 * MINUTE;

const EVENT_COLUMNS = "id, event_type, severity, source, message, context, created_at";
const EVENT_LIMIT = 100;

const ERROR_SEVERITIES = new Set(["error", "critical"]);

function ageMs(value, now) {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? now - t : null;
}

function isRecent(value, now, window = DAY) {
  const age = ageMs(value, now);
  return age !== null && age <= window;
}

function check(status, detail, lastRunAt = null) {
  return { status, detail, lastRunAt: lastRunAt || null };
}

/** Newest event for one source in this organization, or null. */
async function latestForSource(svc, orgId, source) {
  const { data } = await svc
    .from("system_events")
    .select("severity, message, created_at")
    .eq("organization_id", orgId)
    .eq("source", source)
    .order("created_at", { ascending: false })
    .limit(1);
  return data?.[0] || null;
}

/** Newest failure (error/critical) for one source in this organization. */
async function latestFailureForSource(svc, orgId, source) {
  const { data } = await svc
    .from("system_events")
    .select("severity, message, created_at")
    .eq("organization_id", orgId)
    .eq("source", source)
    .in("severity", ["error", "critical"])
    .order("created_at", { ascending: false })
    .limit(1);
  return data?.[0] || null;
}

async function countSince(svc, orgId, severities, sinceIso) {
  const { count, error } = await svc
    .from("system_events")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .in("severity", severities)
    .gte("created_at", sinceIso);
  return error ? 0 : count || 0;
}

/** Newest row of an arbitrary org-scoped table, or null. */
async function latestRow(svc, table, orgId, columns, filters = {}) {
  let q = svc.from(table).select(columns).eq("organization_id", orgId);
  for (const [column, value] of Object.entries(filters)) q = q.eq(column, value);
  const { data } = await q.order("created_at", { ascending: false }).limit(1);
  return data?.[0] || null;
}

export async function GET(request) {
  try {
    const auth = await getAuthedOrg(request);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (
      auth.userType === "client" ||
      auth.role === "client" ||
      !HEALTH_ROLES.includes(auth.role)
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const svc = serviceClient();
    const orgId = auth.orgId;
    const now = Date.now();
    const probedAt = new Date(now).toISOString();
    const since24h = new Date(now - DAY).toISOString();

    // ── The event feed. This query doubles as the database probe: if reading
    //    system_events fails, the data layer is not answering and nothing else
    //    below can be trusted either.
    const { data: eventRows, error: eventsError } = await svc
      .from("system_events")
      .select(EVENT_COLUMNS)
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(EVENT_LIMIT);

    const events = eventRows || [];

    // ── Evidence gathering. Independent reads, so one round trip.
    const [
      errorsLast24h,
      warningsLast24h,
      cronEvent,
      cronFailure,
      automationEvent,
      automationFailure,
      emailEvent,
      emailFailure,
      databaseFailure,
      lastReminder,
      lastAutomationRun,
      enabledRuleCount,
      lastBillingEvent,
      billingFailure,
      lastEmail,
      lastEmailFailure,
    ] = await Promise.all([
      countSince(svc, orgId, ["error", "critical"], since24h),
      countSince(svc, orgId, ["warning"], since24h),
      latestForSource(svc, orgId, "cron"),
      latestFailureForSource(svc, orgId, "cron"),
      latestForSource(svc, orgId, "automation"),
      latestFailureForSource(svc, orgId, "automation"),
      latestForSource(svc, orgId, "email"),
      latestFailureForSource(svc, orgId, "email"),
      latestFailureForSource(svc, orgId, "database"),
      // The cron route is the ONLY writer of due_reminder notifications, so the
      // newest one is proof the scheduled job ran and did work for this tenant.
      latestRow(svc, "notifications", orgId, "created_at", { type: "due_reminder" }),
      // Likewise, pm_activity 'automation_ran' is written only by the engine.
      latestRow(svc, "pm_activity", orgId, "created_at", { action: "automation_ran" }),
      svc
        .from("automation_rules")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .eq("enabled", true)
        .then(({ count, error }) => (error ? null : count || 0)),
      latestRow(
        svc,
        "billing_events",
        orgId,
        "event_type, processed_at, processing_error, created_at"
      ),
      // Webhook failures are recorded with event_type 'billing.*' and source
      // 'api' (the source vocabulary has no billing member), so they are found
      // by name rather than by source.
      svc
        .from("system_events")
        .select("severity, message, created_at")
        .eq("organization_id", orgId)
        .like("event_type", "billing.%")
        .in("severity", ["error", "critical"])
        .order("created_at", { ascending: false })
        .limit(1)
        .then(({ data }) => data?.[0] || null),
      // The email_log ledger (migration 036) is the real delivery evidence:
      // every send writes a row, so it says whether mail actually goes out.
      latestRow(svc, "email_log", orgId, "status, provider, error, created_at, sent_at"),
      latestRow(svc, "email_log", orgId, "status, provider, error, created_at", { status: "failed" }),
    ]);

    const checks = {
      database: databaseCheck(eventsError, databaseFailure, events.length, now, probedAt),
      cron: cronCheck(cronEvent, cronFailure, lastReminder, now),
      automation: automationCheck(automationEvent, automationFailure, lastAutomationRun, enabledRuleCount, now),
      email: emailCheck(emailEvent, emailFailure, lastEmail, lastEmailFailure, now),
      billing: billingCheck(lastBillingEvent, billingFailure, now),
    };

    return NextResponse.json({
      success: true,
      checkedAt: probedAt,
      checks,
      events,
      counts: { errorsLast24h, warningsLast24h },
    });
  } catch (err) {
    console.error("[admin/health] Failed to build health report:", err);
    return NextResponse.json(
      { success: false, error: "Could not build the health report." },
      { status: 500 }
    );
  }
}

// ── Per-check derivations ─────────────────────────────────────────────────
// Each one answers: what did we actually observe, and what does that license
// us to claim?

/**
 * database — evidence is the round trip we just made. Reading system_events
 * exercised connectivity, auth to Postgres, RLS bypass and the index; if that
 * answered, the data layer is up, and if it did not, nothing else is reliable.
 */
function databaseCheck(eventsError, databaseFailure, eventCount, now, probedAt) {
  if (eventsError) {
    return check(
      "down",
      `system_events could not be read: ${eventsError.message}. Run migration 038 if this deployment has not applied it yet.`,
      null
    );
  }
  if (databaseFailure && isRecent(databaseFailure.created_at, now)) {
    return check(
      "degraded",
      `Queries are answering, but a database-level failure was recorded in the last 24 hours: ${databaseFailure.message || "no detail"}`,
      databaseFailure.created_at
    );
  }
  return check(
    "ok",
    `Queries answered on this request; ${eventCount} recent event${eventCount === 1 ? "" : "s"} readable.`,
    probedAt
  );
}

/**
 * cron — three pieces of evidence, in order of how much they prove:
 *  1. CRON_SECRET. The route fails closed without it, so its absence means the
 *     scheduled job cannot run at all, no matter what the platform scheduler
 *     does. That is a certainty, not a suspicion, so it reports `down`.
 *  2. A recorded cron failure in the last 24 hours → degraded.
 *  3. The newest due_reminder notification. The cron route is the only writer
 *     of those, so a recent one is positive proof the job ran.
 * Silence is reported as `unknown`, never as ok: a tenant with nothing due
 * legitimately generates no reminders, so an old timestamp is ambiguous and is
 * labelled as such rather than guessed either way.
 */
function cronCheck(cronEvent, cronFailure, lastReminder, now) {
  const lastRunAt = lastReminder?.created_at || cronEvent?.created_at || null;

  if (!process.env.CRON_SECRET) {
    return check(
      "down",
      "CRON_SECRET is not configured, so /api/cron refuses every request. Due-date reminders and recurring tasks are not being generated.",
      lastRunAt
    );
  }
  if (cronFailure && isRecent(cronFailure.created_at, now)) {
    return check(
      "degraded",
      `The scheduled job reported a failure in the last 24 hours: ${cronFailure.message || "no detail"}`,
      lastRunAt
    );
  }
  if (isRecent(lastReminder?.created_at, now, CRON_STALE_AFTER)) {
    return check("ok", "The scheduled job ran and generated reminders recently.", lastRunAt);
  }
  if (lastReminder?.created_at) {
    return check(
      "unknown",
      "Configured, with no failures recorded. The last reminder it generated is more than 48 hours old — expected when nothing has been due, but it is not proof the job is still running.",
      lastRunAt
    );
  }
  return check(
    "unknown",
    "Configured, with no failures recorded — but this organization has never had a reminder generated, so there is nothing to confirm the job runs.",
    lastRunAt
  );
}

/**
 * automation — the engine only exists for a tenant that has enabled rules, so
 * "no rules" is `unknown` (nothing to be healthy about) rather than ok.
 * Positive evidence is a pm_activity 'automation_ran' row, which only the
 * engine writes; negative evidence is a recorded rule failure.
 */
function automationCheck(automationEvent, automationFailure, lastRun, enabledRuleCount, now) {
  const lastRunAt = lastRun?.created_at || automationEvent?.created_at || null;

  if (enabledRuleCount === 0) {
    return check("unknown", "No automation rules are enabled for this organization.", lastRunAt);
  }
  if (automationFailure && isRecent(automationFailure.created_at, now)) {
    return check(
      "degraded",
      `A rule failed in the last 24 hours: ${automationFailure.message || "no detail"}`,
      lastRunAt
    );
  }
  if (lastRun?.created_at) {
    const suffix = enabledRuleCount === null ? "" : ` ${enabledRuleCount} rule${enabledRuleCount === 1 ? "" : "s"} enabled.`;
    return check("ok", `Rules are firing and none has failed recently.${suffix}`, lastRunAt);
  }
  return check(
    "unknown",
    `${enabledRuleCount ?? "Some"} rule${enabledRuleCount === 1 ? " is" : "s are"} enabled, but none has fired yet — nothing has matched a trigger.`,
    lastRunAt
  );
}

/**
 * email — two layers of evidence, both real:
 *  1. providerStatus() from emailProvider.js reports which transport a send
 *     would actually use right now. "mock" means nothing is being delivered at
 *     all, which is a hard capability failure and the exact class of silent
 *     breakage this page exists to expose — so it reports `down`, not unknown.
 *  2. The email_log ledger (migration 036). A row with status 'failed' is proof
 *     a real send was refused, which beats any amount of correct configuration.
 * A configured provider that has never sent anything is `unknown`: nothing has
 * been observed to work.
 */
function emailCheck(emailEvent, emailFailure, lastEmail, lastEmailFailure, now) {
  const provider = providerStatus();
  const lastRunAt = lastEmail?.created_at || emailEvent?.created_at || null;

  if (!provider.configured) {
    return check(
      "down",
      "No email provider is configured (RESEND_API_KEY, or GMAIL_EMAIL + GMAIL_APP_PASSWORD), so every send is mocked instead of delivered.",
      lastRunAt
    );
  }
  if (lastEmailFailure && isRecent(lastEmailFailure.created_at, now)) {
    return check(
      "degraded",
      `Sending via ${provider.mode}, but a delivery failed in the last 24 hours: ${lastEmailFailure.error || "no detail"}`,
      lastRunAt
    );
  }
  if (emailFailure && isRecent(emailFailure.created_at, now)) {
    return check(
      "degraded",
      `Sending via ${provider.mode}, but an email failure was recorded in the last 24 hours: ${emailFailure.message || "no detail"}`,
      lastRunAt
    );
  }
  if (lastEmail?.created_at) {
    return check(
      "ok",
      `Sending via ${provider.mode} from ${provider.from}. The most recent send was ${lastEmail.status}.`,
      lastRunAt
    );
  }
  return check(
    "unknown",
    `A ${provider.mode} provider is configured, but this organization has never sent an email — nothing has confirmed delivery works.`,
    lastRunAt
  );
}

/**
 * billing — Stripe being disconnected is a legitimate configuration (every org
 * runs free), so that is `unknown`, not down. Beyond that the evidence is the
 * billing_events ledger, which records every webhook Stripe delivered:
 *  - processing_error set          → the event was refused
 *  - processed_at null and old     → recorded but never completed, i.e. stuck
 *  - a recorded billing.* failure  → the webhook threw
 */
function billingCheck(lastBillingEvent, billingFailure, now) {
  const lastRunAt = lastBillingEvent?.created_at || null;

  if (!billingConfigured()) {
    return check(
      "unknown",
      "Stripe is not connected for this deployment, so no billing events are expected.",
      lastRunAt
    );
  }
  if (billingFailure && isRecent(billingFailure.created_at, now)) {
    return check(
      billingFailure.severity === "critical" ? "down" : "degraded",
      `A Stripe webhook failed to process in the last 24 hours: ${billingFailure.message || "no detail"}`,
      lastRunAt
    );
  }
  if (lastBillingEvent?.processing_error) {
    return check(
      "degraded",
      `The most recent Stripe event (${lastBillingEvent.event_type}) was recorded with an error: ${lastBillingEvent.processing_error}`,
      lastRunAt
    );
  }
  if (
    lastBillingEvent &&
    !lastBillingEvent.processed_at &&
    !isRecent(lastBillingEvent.created_at, now, WEBHOOK_STUCK_AFTER)
  ) {
    return check(
      "degraded",
      `The most recent Stripe event (${lastBillingEvent.event_type}) was recorded but never completed. Stripe retries, so this should clear on its own.`,
      lastRunAt
    );
  }
  if (lastBillingEvent) {
    return check("ok", `Last Stripe event (${lastBillingEvent.event_type}) processed cleanly.`, lastRunAt);
  }
  return check("unknown", "Stripe is connected, but no webhook has been received for this organization yet.", lastRunAt);
}

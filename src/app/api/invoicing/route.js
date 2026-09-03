import { NextResponse } from "next/server";
import { getAuthedOrg, serviceClient } from "@/utils/serverAuth";
import { requirePermission } from "@/utils/serverPermissions";
import { requireUnlocked } from "@/utils/entitlements";

export const dynamic = "force-dynamic";

/**
 * /api/invoicing — turning approved hours into an invoice, and reading the P&L.
 *
 *   GET   ?view=billable  approved, billable, not-yet-invoiced hours
 *         ?view=pnl       project profit and loss
 *   POST  raise an invoice from a set of those hour-groups.
 *
 * WHY THE ROUTE PRICES THE LINES AND THE BROWSER DOES NOT. The client sends
 * which hour-groups to bill — a project, a person, a week — and nothing else.
 * Hours and rate are read back from `billable_hours_v` on the server. A body
 * that carried `hours` or `rate` would let whoever opened the screen invoice a
 * client for any number they typed, and the resulting invoice would look
 * exactly like a correct one.
 *
 * WHAT THIS ROUTE IS NOT. The double-billing rule is a trigger in migration
 * 079, not a check here, because `invoices` and `invoice_lines` are reachable
 * from the browser through PostgREST. This route gives a clear error and one
 * transaction-shaped path; the database is what actually refuses.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_LINES = 200;

export async function GET(request) {
  try {
    const auth = await getAuthedOrg(request);
    if (!auth) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const view = searchParams.get("view") === "pnl" ? "pnl" : "billable";

    // P&L exposes cost, which is derived from what people are paid. It is a
    // different permission from reading an invoice for that reason.
    const denied = requirePermission(auth, view === "pnl" ? "pnl.view" : "invoice.view");
    if (denied) return denied;

    const svc = serviceClient();

    if (view === "pnl") {
      const { data, error } = await svc
        .from("project_pnl_v")
        .select("*")
        .eq("organization_id", auth.orgId)
        .order("invoiced", { ascending: false })
        .limit(500);
      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
      }
      return NextResponse.json({ success: true, projects: data || [] });
    }

    let query = svc
      .from("billable_hours_v")
      .select("*")
      .eq("organization_id", auth.orgId)
      .order("week_start", { ascending: false })
      .limit(1000);

    // Default to what is still to be billed — that is the working list. The
    // invoiced rows stay reachable, because "did we bill that week?" is the
    // other question this screen gets asked.
    if (searchParams.get("include") !== "all") query = query.eq("invoiced", false);
    const projectId = searchParams.get("projectId");
    if (projectId) {
      if (!UUID_RE.test(projectId)) {
        return NextResponse.json({ success: false, error: "Invalid projectId" }, { status: 400 });
      }
      query = query.eq("project_id", projectId);
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true, rows: data || [] });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e?.message || "Could not load invoicing data" },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  try {
    const auth = await getAuthedOrg(request);
    if (!auth) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const denied = requirePermission(auth, "invoice.manage");
    if (denied) return denied;

    const billingBlocked = await requireUnlocked(serviceClient(), auth.orgId);
    if (billingBlocked) {
      return NextResponse.json(
        { success: false, ...billingBlocked },
        { status: billingBlocked.status }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { projectId, clientId, title, dueAt, selections } = body || {};

    if (!UUID_RE.test(String(projectId || ""))) {
      return NextResponse.json({ success: false, error: "Choose a project" }, { status: 400 });
    }
    if (!Array.isArray(selections) || selections.length === 0) {
      return NextResponse.json(
        { success: false, error: "Choose at least one week to bill" },
        { status: 400 }
      );
    }
    if (selections.length > MAX_LINES) {
      return NextResponse.json(
        { success: false, error: `That is more than ${MAX_LINES} lines` },
        { status: 400 }
      );
    }

    const svc = serviceClient();

    // The project must be this organization's. Everything below hangs off it.
    const { data: project } = await svc
      .from("projects")
      .select("id, name, organization_id")
      .eq("organization_id", auth.orgId)
      .eq("id", projectId)
      .maybeSingle();
    if (!project) {
      return NextResponse.json({ success: false, error: "Project not found" }, { status: 404 });
    }

    // PRICED FROM THE VIEW, NOT FROM THE BODY. See the note at the top.
    const { data: available, error: availErr } = await svc
      .from("billable_hours_v")
      .select("*")
      .eq("organization_id", auth.orgId)
      .eq("project_id", projectId)
      .eq("invoiced", false);
    if (availErr) {
      return NextResponse.json({ success: false, error: availErr.message }, { status: 500 });
    }

    const key = (userId, week) => `${userId}|${week}`;
    const byKey = new Map((available || []).map((r) => [key(r.user_id, r.week_start), r]));

    const lines = [];
    const unpriced = [];
    for (const sel of selections) {
      const userId = String(sel?.userId || "");
      const week = String(sel?.weekStart || "");
      if (!UUID_RE.test(userId) || !DATE_RE.test(week)) {
        return NextResponse.json(
          { success: false, error: "A selection was malformed" },
          { status: 400 }
        );
      }
      const row = byKey.get(key(userId, week));
      if (!row) {
        // Already billed, not approved, or not this project's. Refusing the
        // whole request rather than quietly dropping the line: an invoice
        // missing a week somebody chose is worse than an error saying so.
        return NextResponse.json(
          {
            success: false,
            error: `Those hours are no longer available to bill (week of ${week}). Reload and try again.`,
          },
          { status: 409 }
        );
      }
      if (row.rate == null) {
        unpriced.push(week);
        continue;
      }
      const hours = Number(row.hours);
      const rate = Number(row.rate);
      lines.push({
        organization_id: auth.orgId,
        description: `${project.name} — ${hours}h, week of ${week}`,
        quantity: hours,
        unit_rate: rate,
        amount: Math.round(hours * rate * 100) / 100,
        source: "timesheet",
        project_id: projectId,
        user_id: userId,
        week_start: week,
        created_by: auth.appUserId,
      });
    }

    if (unpriced.length) {
      // Refused, not billed at zero. A line at 0.00 is an invoice that quietly
      // gives work away, and it looks identical to one that was meant to.
      return NextResponse.json(
        {
          success: false,
          error: `No rate is set for ${unpriced.length} of those weeks. Set a rate on the project or the person first.`,
        },
        { status: 409 }
      );
    }
    if (lines.length === 0) {
      return NextResponse.json({ success: false, error: "Nothing to bill" }, { status: 400 });
    }

    const total = Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100;

    // A human-readable, per-organization invoice number. Derived from the count
    // rather than a sequence because `invoices.number` is only unique by
    // convention here; a collision is caught below and retried once.
    const { count } = await svc
      .from("invoices")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", auth.orgId);

    const number = `INV-${String((count || 0) + 1).padStart(4, "0")}`;

    const { data: invoice, error: invErr } = await svc
      .from("invoices")
      .insert({
        organization_id: auth.orgId,
        project_id: projectId,
        client_id: UUID_RE.test(String(clientId || "")) ? clientId : null,
        number,
        title: typeof title === "string" && title.trim() ? title.slice(0, 200) : project.name,
        amount: total,
        status: "draft",
        due_at: DATE_RE.test(String(dueAt || "")) ? `${dueAt}T00:00:00.000Z` : null,
        created_by: auth.appUserId,
      })
      .select()
      .single();

    if (invErr) {
      return NextResponse.json({ success: false, error: invErr.message }, { status: 500 });
    }

    const { error: lineErr } = await svc
      .from("invoice_lines")
      .insert(lines.map((l) => ({ ...l, invoice_id: invoice.id })));

    if (lineErr) {
      // The lines are the invoice. An invoice header with no lines is a bill
      // for an unexplained amount, so the header goes too rather than being
      // left behind for somebody to puzzle over.
      await svc.from("invoices").delete().eq("id", invoice.id);
      const doubleBilled = /already on a live invoice/i.test(lineErr.message || "");
      return NextResponse.json(
        {
          success: false,
          error: doubleBilled
            ? "Some of those hours are already on another invoice. Reload and try again."
            : lineErr.message,
        },
        { status: doubleBilled ? 409 : 500 }
      );
    }

    return NextResponse.json({ success: true, invoice, lines: lines.length, total });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e?.message || "Could not raise the invoice" },
      { status: 500 }
    );
  }
}

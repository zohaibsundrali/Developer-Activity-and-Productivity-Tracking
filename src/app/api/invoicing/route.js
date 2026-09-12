import { NextResponse } from "next/server";
import { getAuthedOrg, serviceClient, orgScopedClient } from "@/utils/serverAuth";
import { requirePermission } from "@/utils/serverPermissions";
import { requireUnlocked } from "@/utils/entitlements";
import { canonicalInvoiceId, validateInvoiceRequest } from "@/utils/invoicingSelections";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 500;
const MAX_REPORT_ROWS = 20000;

function failure(message, status) {
  return NextResponse.json({ success: false, error: message }, { status });
}

/** Never return a partial financial report as a complete total. */
async function completeReport(makeQuery, identity) {
  const rows = [];
  const seen = new Set();
  let expectedCount = null;
  while (true) {
    const { data, count, error } = await makeQuery().range(rows.length, rows.length + PAGE_SIZE - 1);
    if (error || !Array.isArray(data) || !Number.isSafeInteger(count) || count < 0) {
      throw new Error('REPORT_UNAVAILABLE');
    }
    if (count > MAX_REPORT_ROWS) throw new Error('REPORT_TOO_LARGE');
    if (expectedCount !== null && count !== expectedCount) throw new Error('REPORT_CHANGED');
    expectedCount = count;
    for (const row of data) {
      const key = identity(row);
      if (!key || seen.has(key)) throw new Error('REPORT_CHANGED');
      seen.add(key);
      rows.push(row);
    }
    if (rows.length > expectedCount || (!data.length && rows.length < expectedCount)) throw new Error('REPORT_CHANGED');
    if (rows.length === expectedCount) return rows;
    // Advance by received rows: a provider may impose a cap below PAGE_SIZE.
  }
}

export async function GET(request) {
  try {
    const auth = await getAuthedOrg(request);
    if (!auth) return failure("Unauthorized", 401);
    const { searchParams } = new URL(request.url);
    const view = searchParams.get("view") === "pnl" ? "pnl" : "billable";
    const denied = requirePermission(auth, view === "pnl" ? "pnl.view" : "invoice.view");
    if (denied) return denied;
    const requestedProject = searchParams.get("projectId");
    const projectId = requestedProject === null ? null : canonicalInvoiceId(requestedProject);
    if (requestedProject !== null && !projectId) return failure("Invalid projectId", 400);
    // These views are service-only; effective permissions and tenant predicates remain mandatory.
    const svc = serviceClient();
    const makeQuery = () => {
      let query = svc.from(view === "pnl" ? "project_pnl_v" : "billable_hours_v")
        .select("*", { count: "exact" }).eq("organization_id", auth.orgId);
      if (projectId) query = query.eq("project_id", projectId);
      if (view === "pnl") return query.order("project_id", { ascending: true });
      if (searchParams.get("include") !== "all") query = query.eq("invoiced", false);
      return query.order("week_start", { ascending: false }).order("project_id", { ascending: true })
        .order("user_type", { ascending: true }).order("user_id", { ascending: true });
    };
    const rows = await completeReport(makeQuery, row => {
      if (row.organization_id !== auth.orgId || !row.project_id) return null;
      return view === "pnl" ? row.project_id : `${row.project_id}:${row.user_type}:${row.user_id}:${row.week_start}`;
    });
    if (view === "pnl") return NextResponse.json({ success: true, projects: rows, count: rows.length });
    const clients = await completeReport(() => svc.from("clients")
      .select("id, name", { count: "exact" }).eq("organization_id", auth.orgId)
      .order("id", { ascending: true }), row => row.id);
    return NextResponse.json({ success: true, rows, count: rows.length,
      clients: clients.map(client => ({ id: client.id, name: client.name || "Client" })) });
  } catch (error) {
    if (error.message === 'REPORT_TOO_LARGE') return failure("This report is too large to load completely. Filter by project before retrying.", 413);
    if (error.message === 'REPORT_CHANGED') return failure("The report changed while loading. Retry to load a complete financial report.", 409);
    return failure("Invoicing data is temporarily unavailable. Please retry.", 503);
  }
}

const MESSAGES = {
  INVOICE_FORBIDDEN: "You do not have permission to create invoices.",
  INVOICE_PROJECT_INVALID: "Choose an available project in your organization.",
  INVOICE_IDENTITY_REVIEW_REQUIRED: "Some legacy hours have unresolved ownership. An administrator must review their identity before billing.",
  INVOICE_PROJECT_NOT_FOUND: "Project not found.",
  INVOICE_CLIENT_INVALID: "The client is not available for this project.",
  INVOICE_SELECTION_INVALID: "A selected week is invalid. Reload the approved hours.",
  INVOICE_HOURS_UNAVAILABLE: "Those hours are no longer available to bill. Reload and try again.",
  INVOICE_RATE_REQUIRED: "No rate is set for some selected hours. Set a rate on the project or person first.",
  INVOICE_ALREADY_BILLED: "Some selected hours are already on another invoice. Reload and try again.",
  BILLING_LOCKED: "Your subscription requires attention before invoices can be created.",
};
function rpcFailure(error) {
  const token = String(error?.message || '').split(':')[0];
  const status = token === 'BILLING_LOCKED' ? 402 : error?.code === '42501' ? 403
    : error?.code === 'P0002' ? 404 : error?.code === '22023' ? 400
    : ['23505', '23514', '55000', '40001'].includes(error?.code) ? 409 : 503;
  return failure(MESSAGES[token] || (status === 503 ? "Invoice creation was not confirmed. Reload before retrying."
    : "The selected hours could not be invoiced. Reload and check their approval, rates and availability."), status);
}

export async function POST(request) {
  try {
    const auth = await getAuthedOrg(request);
    if (!auth) return failure("Unauthorized", 401);
    const denied = requirePermission(auth, "invoice.manage");
    if (denied) return denied;
    let input;
    try { input = validateInvoiceRequest(await request.json()); }
    catch (error) { return failure(error instanceof SyntaxError ? "Invalid JSON request." : error.message, 400); }
    const billingBlocked = await requireUnlocked(serviceClient(), auth.orgId);
    if (billingBlocked) return NextResponse.json({ success: false, ...billingBlocked }, { status: billingBlocked.status });
    const { data, error } = await orgScopedClient(auth.token).rpc("raise_timesheet_invoice", {
      p_project_id: input.projectId, p_selections: input.selections, p_client_id: input.clientId,
      p_title: input.title, p_due_at: input.dueAt,
    });
    if (error) return rpcFailure(error);
    const invoice = data?.invoice;
    const total = Number(data?.total);
    const numericValue = value => (typeof value === "number" || (typeof value === "string" && value.trim() !== "")) && Number.isFinite(Number(value));
    if (!invoice || !canonicalInvoiceId(invoice.id) || invoice.organization_id !== auth.orgId
      || invoice.project_id !== input.projectId || invoice.client_id !== input.clientId
      || invoice.status !== "draft" || data.lines !== input.selections.length
      || !numericValue(data.total) || total < 0
      || !numericValue(invoice.amount) || Math.abs(Number(invoice.amount) - total) > 0.00001) {
      return failure("Invoice creation was not confirmed. Reload the invoices before retrying.", 503);
    }
    return NextResponse.json({ success: true, invoice, lines: data.lines, total });
  } catch {
    return failure("Invoice creation was not confirmed. Reload the invoices before retrying.", 503);
  }
}

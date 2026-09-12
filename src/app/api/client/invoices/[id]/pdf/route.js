import { NextResponse } from "next/server";
import { getAuthedClient, serviceClient } from "@/utils/serverAuth";

export const dynamic = "force-dynamic";

const BUCKET = "invoices";
const ONE_HOUR = 60 * 60;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRIVATE_HEADERS = { "Cache-Control": "private, no-store, max-age=0", "Vary": "Authorization, Cookie", "Referrer-Policy": "no-referrer" };
const response = (body, status = 200) => NextResponse.json(body, { status, headers: PRIVATE_HEADERS });

// Uploads use organization/invoice/filename. Never sign an
// unrelated object merely because its path was written onto an invoice row.
function ownedPdfPath(path, organizationId, invoiceId) {
  if (typeof path !== "string") return false;
  const segments = path.split("/");
  return segments.length === 3 && segments[0] === organizationId && segments[1] === invoiceId
    && /^[A-Za-z0-9._-]+$/.test(segments[2]) && ![".", ".."].includes(segments[2]);
}

// A private, short-lived download is available only for an issued invoice
// addressed to the authenticated client in their current organization.
export async function GET(request, { params }) {
  try {
    const auth = await getAuthedClient(request);
    if (auth?.planRefusal) return response(auth.planRefusal, auth.planRefusal.status);
    if (!auth) return response({ error: "Unauthorized" }, 401);
    const invoiceId = (await params)?.id;
    if (typeof invoiceId !== "string" || !UUID_RE.test(invoiceId)) return response({ error: "Invalid invoice id" }, 400);

    const svc = serviceClient();
    const { data: invoice, error } = await svc.from("invoices")
      .select("id, organization_id, client_id, status, pdf_path")
      .eq("organization_id", auth.orgId).eq("client_id", auth.clientId)
      .eq("id", invoiceId).neq("status", "draft").maybeSingle();
    if (error) return response({ error: "Invoice download is temporarily unavailable. Please retry." }, 503);
    // Conceal both draft existence and invoices belonging to other clients.
    if (!invoice || invoice.organization_id !== auth.orgId || invoice.client_id !== auth.clientId
      || invoice.id.toLowerCase() !== invoiceId.toLowerCase() || !invoice.status || invoice.status === "draft") return response({ error: "Not found" }, 404);
    if (!invoice.pdf_path) return response({ url: null });
    if (!ownedPdfPath(invoice.pdf_path, auth.orgId, invoice.id)) {
      return response({ error: "This invoice attachment needs an administrator's review." }, 409);
    }
    const { data: signed, error: signError } = await svc.storage.from(BUCKET).createSignedUrl(invoice.pdf_path, ONE_HOUR);
    if (signError || typeof signed?.signedUrl !== "string" || !signed.signedUrl) {
      return response({ error: "Invoice download is temporarily unavailable. Please retry." }, 503);
    }
    return response({ url: signed.signedUrl });
  } catch {
    return response({ error: "Invoice download is temporarily unavailable. Please retry." }, 503);
  }
}

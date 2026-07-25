import { NextResponse } from "next/server";
import { getAuthedClient, serviceClient } from "@/utils/serverAuth";

export const dynamic = "force-dynamic";

const BUCKET = "invoices";
const ONE_HOUR = 60 * 60;

// GET /api/client/invoices/[id]/pdf
// Returns a 1-hour signed URL for the invoice PDF (or null if none), but only
// for an invoice addressed to this client.
export async function GET(request, { params }) {
  try {
    const auth = await getAuthedClient(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const invoiceId = params?.id;
    if (!invoiceId) {
      return NextResponse.json({ error: "Missing invoice id" }, { status: 400 });
    }

    const svc = serviceClient();
    const { data: invoice, error } = await svc
      .from("invoices")
      .select("id, client_id, pdf_path")
      .eq("organization_id", auth.orgId)
      .eq("id", invoiceId)
      .single();

    if (error || !invoice) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (invoice.client_id !== auth.clientId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (!invoice.pdf_path) {
      return NextResponse.json({ url: null });
    }

    const { data: signed, error: signError } = await svc.storage
      .from(BUCKET)
      .createSignedUrl(invoice.pdf_path, ONE_HOUR);

    if (signError || !signed?.signedUrl) {
      console.error("[client/invoices/:id/pdf] Sign error:", signError);
      return NextResponse.json({ error: "Failed to sign invoice" }, { status: 500 });
    }

    return NextResponse.json({ url: signed.signedUrl });
  } catch (err) {
    console.error("[client/invoices/:id/pdf] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

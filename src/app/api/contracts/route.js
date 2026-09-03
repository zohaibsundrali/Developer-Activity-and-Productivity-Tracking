import { NextResponse } from "next/server";
import { getAuthedOrg, serviceClient } from "@/utils/serverAuth";
import { requirePermission } from "@/utils/serverPermissions";
import { requireUnlocked } from "@/utils/entitlements";

export const dynamic = "force-dynamic";

/**
 * /api/contracts — what was agreed, and what has changed since.
 *
 *   GET    ?view=contracts | contract&contractId=…
 *   POST   ?action=contract | milestone
 *   PATCH  move a contract's status, sign it, amend it, or move a milestone
 *
 * A SIGNED CONTRACT'S TERMS ARE FROZEN. Value, type and dates cannot be edited
 * once the contract is past 'sent' — the trigger in 092 refuses it. The way to
 * change them is to AMEND: this route writes a `contract_amendments` row
 * recording what the value was, in the same breath as changing it, and the
 * trigger looks for exactly that row before allowing the update.
 *
 * That is not ceremony. "What did we agree, and when did it change" is the
 * question every commercial dispute turns on, and a record that can be edited
 * in place cannot answer it.
 *
 * AMENDING IS A DIFFERENT PERMISSION FROM DRAFTING. `contract.manage` writes a
 * new contract and signs it; `contract.amend` changes one that is already
 * signed, and is owner/admin only.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STATUS = ["draft", "sent", "signed", "active", "completed", "terminated"];
const TYPES = ["fixed_price", "time_and_materials", "retainer"];
const MILESTONE_STATUS = ["pending", "delivered", "approved", "invoiced"];
/** Only these may be amended; the trigger in 092 checks the same four. */
const AMENDABLE = ["value", "contract_type", "start_date", "end_date"];

const clip = (v, n) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
const isDate = (v) => typeof v === "string" && DATE_RE.test(v);
const money = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : undefined; // undefined = reject
};

export async function GET(request) {
  try {
    const auth = await getAuthedOrg(request);
    if (!auth) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const denied = requirePermission(auth, "contract.view");
    if (denied) return denied;

    const { searchParams } = new URL(request.url);
    const svc = serviceClient();

    if (searchParams.get("view") === "contract") {
      const contractId = searchParams.get("contractId");
      if (!UUID_RE.test(String(contractId || ""))) {
        return NextResponse.json({ success: false, error: "Invalid contractId" }, { status: 400 });
      }
      // Scoped to the org before anything hangs off it, so an id from another
      // tenant answers 404 rather than leaking its shape.
      const { data: contract } = await svc
        .from("contracts")
        .select("*")
        .eq("organization_id", auth.orgId)
        .eq("id", contractId)
        .maybeSingle();
      if (!contract) {
        return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
      }
      const [{ data: milestones }, { data: amendments }] = await Promise.all([
        svc
          .from("contract_milestones")
          .select("*")
          .eq("organization_id", auth.orgId)
          .eq("contract_id", contractId)
          .order("due_date", { ascending: true, nullsFirst: false })
          .limit(500),
        svc
          .from("contract_amendments")
          .select("*")
          .eq("organization_id", auth.orgId)
          .eq("contract_id", contractId)
          .order("created_at", { ascending: false })
          .limit(200),
      ]);
      return NextResponse.json({
        success: true,
        contract,
        milestones: milestones || [],
        amendments: amendments || [],
      });
    }

    const { data, error } = await svc
      .from("contract_summary_v")
      .select("*")
      .eq("organization_id", auth.orgId)
      .order("signed_at", { ascending: false, nullsFirst: false })
      .limit(500);
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true, contracts: data || [] });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e?.message || "Could not load contracts" },
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

    const denied = requirePermission(auth, "contract.manage");
    if (denied) return denied;

    const svc = serviceClient();
    const blocked = await requireUnlocked(svc, auth.orgId);
    if (blocked) return NextResponse.json({ success: false, ...blocked }, { status: blocked.status });

    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action") || "contract";
    const body = await request.json().catch(() => ({}));

    if (action === "contract") {
      const reference = clip(body?.reference, 60);
      const title = clip(body?.title, 300);
      if (!reference || !title) {
        return NextResponse.json(
          { success: false, error: "A contract needs a reference and a title" },
          { status: 400 }
        );
      }
      const value = money(body?.value);
      if (value === undefined) {
        return NextResponse.json({ success: false, error: "Invalid value" }, { status: 400 });
      }
      if (isDate(body?.startDate) && isDate(body?.endDate) && body.endDate < body.startDate) {
        return NextResponse.json(
          { success: false, error: "The contract ends before it starts" },
          { status: 400 }
        );
      }

      // A contract always starts as a draft. Creating one already signed would
      // put a commitment into the record with no moment attached to it, and the
      // CHECK in 092 refuses a signed row with no signed_at anyway.
      const { data, error } = await svc
        .from("contracts")
        .insert({
          organization_id: auth.orgId,
          client_id: UUID_RE.test(String(body?.clientId || "")) ? body.clientId : null,
          project_id: UUID_RE.test(String(body?.projectId || "")) ? body.projectId : null,
          reference,
          title,
          contract_type: TYPES.includes(body?.contractType) ? body.contractType : "fixed_price",
          value,
          currency: clip(body?.currency, 8) || "USD",
          start_date: isDate(body?.startDate) ? body.startDate : null,
          end_date: isDate(body?.endDate) ? body.endDate : null,
          document_url: clip(body?.documentUrl, 2000),
          notes: clip(body?.notes, 8000),
          status: "draft",
          created_by: auth.appUserId,
        })
        .select()
        .single();
      if (error) {
        const dup = /contracts_reference_unique/i.test(error.message || "");
        return NextResponse.json(
          { success: false, error: dup ? "That reference is already in use" : error.message },
          { status: dup ? 409 : 500 }
        );
      }
      return NextResponse.json({ success: true, contract: data });
    }

    // action === "milestone"
    const { contractId, title } = body || {};
    if (!UUID_RE.test(String(contractId || ""))) {
      return NextResponse.json({ success: false, error: "Invalid contractId" }, { status: 400 });
    }
    const mTitle = clip(title, 300);
    if (!mTitle) {
      return NextResponse.json({ success: false, error: "Give the milestone a title" }, { status: 400 });
    }
    const amount = money(body?.amount);
    if (amount === undefined) {
      return NextResponse.json({ success: false, error: "Invalid amount" }, { status: 400 });
    }

    const { data: contract } = await svc
      .from("contracts")
      .select("id, status")
      .eq("organization_id", auth.orgId)
      .eq("id", contractId)
      .maybeSingle();
    if (!contract) {
      return NextResponse.json({ success: false, error: "Contract not found" }, { status: 404 });
    }
    if (["completed", "terminated"].includes(contract.status)) {
      return NextResponse.json(
        { success: false, error: `That contract is ${contract.status}` },
        { status: 409 }
      );
    }

    const { data, error } = await svc
      .from("contract_milestones")
      .insert({
        organization_id: auth.orgId,
        contract_id: contractId,
        title: mTitle,
        description: clip(body?.description, 8000),
        due_date: isDate(body?.dueDate) ? body.dueDate : null,
        amount,
        created_by: auth.appUserId,
      })
      .select()
      .single();
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true, milestone: data });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e?.message || "Could not save that" },
      { status: 500 }
    );
  }
}

export async function PATCH(request) {
  try {
    const auth = await getAuthedOrg(request);
    if (!auth) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const svc = serviceClient();
    const now = new Date().toISOString();

    // ── Move a milestone ──────────────────────────────────────────────────
    if (body?.milestoneId) {
      const denied = requirePermission(auth, "contract.manage");
      if (denied) return denied;
      if (!UUID_RE.test(String(body.milestoneId)) || !MILESTONE_STATUS.includes(body?.status)) {
        return NextResponse.json({ success: false, error: "Invalid request" }, { status: 400 });
      }
      if (body.status === "invoiced" && !UUID_RE.test(String(body?.invoiceId || ""))) {
        // The CHECK in 092 refuses this too; answering here gives the reason.
        return NextResponse.json(
          { success: false, error: "Marking a milestone invoiced needs the invoice it went on" },
          { status: 400 }
        );
      }
      const blocked = await requireUnlocked(svc, auth.orgId);
      if (blocked) return NextResponse.json({ success: false, ...blocked }, { status: blocked.status });

      const patch = { status: body.status, updated_at: now };
      if (body.status === "delivered") patch.delivered_at = now;
      if (body.status === "approved") patch.approved_at = now;
      if (body.status === "invoiced") patch.invoice_id = body.invoiceId;

      const { data, error } = await svc
        .from("contract_milestones")
        .update(patch)
        .eq("organization_id", auth.orgId)
        .eq("id", body.milestoneId)
        .select()
        .single();
      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
      }
      return NextResponse.json({ success: true, milestone: data });
    }

    const { contractId } = body || {};
    if (!UUID_RE.test(String(contractId || ""))) {
      return NextResponse.json({ success: false, error: "Invalid contractId" }, { status: 400 });
    }

    const { data: existing } = await svc
      .from("contracts")
      .select("*")
      .eq("organization_id", auth.orgId)
      .eq("id", contractId)
      .maybeSingle();
    if (!existing) {
      return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
    }

    // ── Amend the terms of a signed contract ──────────────────────────────
    if (body?.amend) {
      const denied = requirePermission(auth, "contract.amend");
      if (denied) return denied;

      const { field, value } = body.amend;
      if (!AMENDABLE.includes(field)) {
        return NextResponse.json({ success: false, error: "That field cannot be amended" }, { status: 400 });
      }
      if (["draft", "sent"].includes(existing.status)) {
        // Nothing to amend: an unsigned contract is edited, not amended, and
        // writing an amendment row for it would put noise in the log that
        // matters.
        return NextResponse.json(
          { success: false, error: "That contract is not signed yet — edit it instead" },
          { status: 409 }
        );
      }

      let next = value;
      if (field === "value") {
        next = money(value);
        if (next === undefined) {
          return NextResponse.json({ success: false, error: "Invalid value" }, { status: 400 });
        }
      } else if (field === "contract_type") {
        if (!TYPES.includes(value)) {
          return NextResponse.json({ success: false, error: "Invalid type" }, { status: 400 });
        }
      } else if (value !== null && !isDate(value)) {
        return NextResponse.json({ success: false, error: "Invalid date" }, { status: 400 });
      }

      const blocked = await requireUnlocked(svc, auth.orgId);
      if (blocked) return NextResponse.json({ success: false, ...blocked }, { status: blocked.status });

      // THE AMENDMENT ROW FIRST, and that ordering is the mechanism rather than
      // a nicety: the trigger in 092 looks for it and refuses the update
      // without it. If the update then fails, an amendment recording a change
      // that did not happen is left behind — visible, and far better than a
      // change with no record.
      const { error: logErr } = await svc.from("contract_amendments").insert({
        organization_id: auth.orgId,
        contract_id: contractId,
        field,
        previous_value: existing[field] === null ? null : String(existing[field]),
        new_value: next === null ? null : String(next),
        reason: clip(body?.reason, 4000),
        amended_by: auth.appUserId,
      });
      if (logErr) {
        return NextResponse.json({ success: false, error: logErr.message }, { status: 500 });
      }

      const { data, error } = await svc
        .from("contracts")
        .update({ [field]: next, updated_at: now })
        .eq("id", contractId)
        .select()
        .single();
      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
      }
      return NextResponse.json({ success: true, contract: data });
    }

    // ── Move the status ───────────────────────────────────────────────────
    const denied = requirePermission(auth, "contract.manage");
    if (denied) return denied;
    if (!STATUS.includes(body?.status)) {
      return NextResponse.json({ success: false, error: "Invalid status" }, { status: 400 });
    }

    const blocked = await requireUnlocked(svc, auth.orgId);
    if (blocked) return NextResponse.json({ success: false, ...blocked }, { status: blocked.status });

    const patch = { status: body.status, updated_at: now };
    // Signing stamps the moment. The CHECK in 092 refuses a signed row without
    // one, so this is where it comes from rather than from the body.
    if (!["draft", "sent"].includes(body.status) && !existing.signed_at) {
      patch.signed_at = now;
      patch.signed_by_name = clip(body?.signedByName, 200);
    }

    const { data, error } = await svc
      .from("contracts")
      .update(patch)
      .eq("id", contractId)
      .select()
      .single();
    if (error) {
      const frozen = /needs an amendment/i.test(error.message || "");
      return NextResponse.json(
        { success: false, error: frozen ? error.message : error.message },
        { status: frozen ? 409 : 500 }
      );
    }
    return NextResponse.json({ success: true, contract: data });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e?.message || "Could not update that" },
      { status: 500 }
    );
  }
}

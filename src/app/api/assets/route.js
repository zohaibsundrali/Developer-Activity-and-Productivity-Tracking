import { NextResponse } from "next/server";
import { getAuthedOrg, serviceClient } from "@/utils/serverAuth";
import { requirePermission } from "@/utils/serverPermissions";
import { requireUnlocked } from "@/utils/entitlements";

export const dynamic = "force-dynamic";

/**
 * /api/assets — what the company owns and who is holding it.
 *
 *   GET    ?view=assets | licences | holdings&userId=…
 *   POST   ?action=asset | licence | seat
 *   PATCH  assign or return an asset, release a seat, edit a licence
 *
 * TWO SHAPES OF THING BEHIND ONE ROUTE. An asset is one object with one holder;
 * a licence is a pool of seats. They share a screen and not a table — see the
 * header of migration 090 for why folding them together loses either the serial
 * number or the seat count.
 *
 * OVER-ASSIGNMENT IS RECORDED, NOT REFUSED. Using thirteen of twelve seats is a
 * contract breach, and blocking it would simply mean the thirteenth seat stops
 * being written down — at which point nobody can see the breach at all. The
 * route allows it, the view reports `over_by`, and the screen shows it in red.
 *
 * EVERY MOVEMENT OF AN ASSET IS RECORDED. "Who had this in March" is the
 * question an asset register is actually asked, and a current-holder column
 * alone can never answer it.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ASSET_STATUS = ["in_stock", "assigned", "repair", "retired", "lost"];
const CATEGORIES = [
  "laptop", "desktop", "monitor", "phone", "tablet", "peripheral", "furniture", "other",
];

const clip = (v, n) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
const isDate = (v) => typeof v === "string" && DATE_RE.test(v);
const money = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : undefined; // undefined = reject
};

async function memberExists(svc, orgId, userId) {
  const { data } = await svc
    .from("memberships")
    .select("user_id")
    .eq("organization_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();
  return Boolean(data);
}

export async function GET(request) {
  try {
    const auth = await getAuthedOrg(request);
    if (!auth) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const view = searchParams.get("view") || "assets";
    const svc = serviceClient();

    if (view === "holdings") {
      // ASKING ABOUT YOURSELF NEEDS NO KEY. Asking about somebody else is the
      // offboarding question and needs the register.
      const requested = searchParams.get("userId");
      const wantsSomeoneElse = requested && String(requested) !== String(auth.appUserId);
      if (wantsSomeoneElse) {
        const denied = requirePermission(auth, "asset.view");
        if (denied) return denied;
        if (!UUID_RE.test(String(requested))) {
          return NextResponse.json({ success: false, error: "Invalid userId" }, { status: 400 });
        }
      }
      const { data, error } = await svc
        .from("person_holdings_v")
        .select("*")
        .eq("organization_id", auth.orgId)
        .eq("user_id", wantsSomeoneElse ? requested : auth.appUserId)
        .limit(500);
      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
      }
      return NextResponse.json({ success: true, holdings: data || [] });
    }

    if (view === "licences") {
      const denied = requirePermission(auth, "licence.view");
      if (denied) return denied;
      const { data, error } = await svc
        .from("licence_usage_v")
        .select("*")
        .eq("organization_id", auth.orgId)
        .order("name")
        .limit(500);
      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
      }
      return NextResponse.json({ success: true, licences: data || [] });
    }

    const denied = requirePermission(auth, "asset.view");
    if (denied) return denied;
    const { data, error } = await svc
      .from("assets")
      .select("*")
      .eq("organization_id", auth.orgId)
      .order("asset_tag")
      .limit(2000);
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true, assets: data || [] });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e?.message || "Could not load the register" },
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

    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action") || "asset";
    const keyFor = { asset: "asset.manage", licence: "licence.manage", seat: "licence.manage" };
    if (!keyFor[action]) {
      return NextResponse.json({ success: false, error: "Unknown action" }, { status: 400 });
    }
    const denied = requirePermission(auth, keyFor[action]);
    if (denied) return denied;

    const svc = serviceClient();
    const blocked = await requireUnlocked(svc, auth.orgId);
    if (blocked) return NextResponse.json({ success: false, ...blocked }, { status: blocked.status });

    const body = await request.json().catch(() => ({}));

    if (action === "asset") {
      const tag = clip(body?.assetTag, 60);
      const name = clip(body?.name, 200);
      if (!tag || !name) {
        return NextResponse.json(
          { success: false, error: "An asset needs a tag and a name" },
          { status: 400 }
        );
      }
      const cost = money(body?.purchaseCost);
      if (cost === undefined) {
        return NextResponse.json({ success: false, error: "Invalid cost" }, { status: 400 });
      }

      const { data, error } = await svc
        .from("assets")
        .insert({
          organization_id: auth.orgId,
          asset_tag: tag,
          name,
          category: CATEGORIES.includes(body?.category) ? body.category : "other",
          serial_number: clip(body?.serialNumber, 200),
          purchase_date: isDate(body?.purchaseDate) ? body.purchaseDate : null,
          purchase_cost: cost,
          notes: clip(body?.notes, 4000),
          created_by: auth.appUserId,
        })
        .select()
        .single();
      if (error) {
        const dup = /assets_tag_unique/i.test(error.message || "");
        return NextResponse.json(
          { success: false, error: dup ? "That asset tag is already in use" : error.message },
          { status: dup ? 409 : 500 }
        );
      }
      await svc.from("asset_events").insert({
        organization_id: auth.orgId,
        asset_id: data.id,
        to_status: data.status,
        note: "Added to the register",
        actor_user_id: auth.appUserId,
      });
      return NextResponse.json({ success: true, asset: data });
    }

    if (action === "licence") {
      const name = clip(body?.name, 200);
      if (!name) {
        return NextResponse.json({ success: false, error: "Name the licence" }, { status: 400 });
      }
      const seats = body?.seatsTotal === null || body?.seatsTotal === "" ? null : Number(body?.seatsTotal);
      if (seats !== null && (!Number.isInteger(seats) || seats < 0)) {
        return NextResponse.json({ success: false, error: "Seats must be a whole number" }, { status: 400 });
      }
      const cost = money(body?.annualCost);
      if (cost === undefined) {
        return NextResponse.json({ success: false, error: "Invalid cost" }, { status: 400 });
      }

      const { data, error } = await svc
        .from("software_licences")
        .insert({
          organization_id: auth.orgId,
          name,
          vendor: clip(body?.vendor, 200),
          seats_total: seats,
          annual_cost: cost,
          renewal_date: isDate(body?.renewalDate) ? body.renewalDate : null,
          notes: clip(body?.notes, 4000),
          created_by: auth.appUserId,
        })
        .select()
        .single();
      if (error) {
        const dup = /licences_name_unique/i.test(error.message || "");
        return NextResponse.json(
          { success: false, error: dup ? "A licence with that name already exists" : error.message },
          { status: dup ? 409 : 500 }
        );
      }
      return NextResponse.json({ success: true, licence: data });
    }

    // action === "seat" — give somebody a seat on a licence.
    const { licenceId, userId } = body || {};
    if (!UUID_RE.test(String(licenceId || "")) || !UUID_RE.test(String(userId || ""))) {
      return NextResponse.json({ success: false, error: "Invalid ids" }, { status: 400 });
    }
    const { data: licence } = await svc
      .from("software_licences")
      .select("id, active")
      .eq("organization_id", auth.orgId)
      .eq("id", licenceId)
      .maybeSingle();
    if (!licence) {
      return NextResponse.json({ success: false, error: "Licence not found" }, { status: 404 });
    }
    if (!licence.active) {
      return NextResponse.json({ success: false, error: "That licence is not active" }, { status: 409 });
    }
    if (!(await memberExists(svc, auth.orgId, userId))) {
      return NextResponse.json(
        { success: false, error: "That person is not in this organization" },
        { status: 404 }
      );
    }

    // NO SEAT-COUNT CHECK HERE, and it is deliberate. See the note at the top:
    // refusing the thirteenth seat does not stop it existing, it stops it being
    // recorded. `licence_usage_v.over_by` is how it becomes visible instead.
    const { data, error } = await svc
      .from("licence_seats")
      .insert({
        organization_id: auth.orgId,
        licence_id: licenceId,
        user_id: userId,
        assigned_by: auth.appUserId,
      })
      .select()
      .single();
    if (error) {
      const dup = /licence_seats_one_active_per_person/i.test(error.message || "");
      return NextResponse.json(
        { success: false, error: dup ? "They already hold a seat on that licence" : error.message },
        { status: dup ? 409 : 500 }
      );
    }
    return NextResponse.json({ success: true, seat: data });
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

    // ── Release a licence seat ────────────────────────────────────────────
    if (body?.seatId) {
      const denied = requirePermission(auth, "licence.manage");
      if (denied) return denied;
      if (!UUID_RE.test(String(body.seatId))) {
        return NextResponse.json({ success: false, error: "Invalid seatId" }, { status: 400 });
      }
      const blocked = await requireUnlocked(svc, auth.orgId);
      if (blocked) return NextResponse.json({ success: false, ...blocked }, { status: blocked.status });

      // Released rather than deleted, so "who had a seat when we were billed
      // for fourteen" stays answerable.
      const { data, error } = await svc
        .from("licence_seats")
        .update({ released_at: now })
        .eq("organization_id", auth.orgId)
        .eq("id", body.seatId)
        .is("released_at", null)
        .select()
        .maybeSingle();
      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
      }
      if (!data) {
        return NextResponse.json(
          { success: false, error: "That seat is not held" },
          { status: 409 }
        );
      }
      return NextResponse.json({ success: true, seat: data });
    }

    // ── Move an asset ─────────────────────────────────────────────────────
    const { assetId, status, userId, note } = body || {};
    if (!UUID_RE.test(String(assetId || ""))) {
      return NextResponse.json({ success: false, error: "Invalid assetId" }, { status: 400 });
    }
    const denied = requirePermission(auth, "asset.manage");
    if (denied) return denied;
    if (!ASSET_STATUS.includes(status)) {
      return NextResponse.json({ success: false, error: "Invalid status" }, { status: 400 });
    }
    if (status === "assigned" && !UUID_RE.test(String(userId || ""))) {
      // The CHECK in 090 refuses the contradictory row anyway; answering here
      // gives the reason rather than a constraint name.
      return NextResponse.json(
        { success: false, error: "Assigning needs somebody to assign it to" },
        { status: 400 }
      );
    }

    const { data: existing } = await svc
      .from("assets")
      .select("*")
      .eq("organization_id", auth.orgId)
      .eq("id", assetId)
      .maybeSingle();
    if (!existing) {
      return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
    }
    if (status === "assigned" && !(await memberExists(svc, auth.orgId, userId))) {
      return NextResponse.json(
        { success: false, error: "That person is not in this organization" },
        { status: 404 }
      );
    }

    const blocked = await requireUnlocked(svc, auth.orgId);
    if (blocked) return NextResponse.json({ success: false, ...blocked }, { status: blocked.status });

    const { data, error } = await svc
      .from("assets")
      .update({
        status,
        // Cleared for every status but 'assigned'. The trigger in 090 enforces
        // the same thing; sending it correctly means the row that comes back
        // matches what was asked for.
        assigned_user_id: status === "assigned" ? userId : null,
        assigned_at: status === "assigned" ? now : null,
        updated_at: now,
      })
      .eq("id", assetId)
      .select()
      .single();
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    // EVERY MOVEMENT IS RECORDED. See the note at the top.
    await svc.from("asset_events").insert({
      organization_id: auth.orgId,
      asset_id: assetId,
      from_status: existing.status,
      to_status: data.status,
      from_user_id: existing.assigned_user_id,
      to_user_id: data.assigned_user_id,
      note: clip(note, 2000),
      actor_user_id: auth.appUserId,
    });

    return NextResponse.json({ success: true, asset: data });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e?.message || "Could not update that" },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";
import { getAuthedOrg, serviceClient } from "@/utils/serverAuth";

export const dynamic = "force-dynamic";

/**
 * /api/proposals — the client's request for new work.
 *
 *   GET   list. A client sees its own; staff see the organization's.
 *   POST  file one. Clients only.
 *
 * The organization ALWAYS comes from the verified token and never from the
 * body. `client_id` likewise: a client files as itself or not at all.
 *
 * RLS (database/059) already enforces all of that — these routes exist so the
 * browser gets sensible errors and one predictable shape, not as the security
 * boundary. If this file disappeared the rules would still hold.
 */

const MAX_TITLE = 200;
const MAX_DESCRIPTION = 10000;

/** Staff roles that may see the queue. All of them: a designer asked "can we
 *  build this?" needs to read the thing being asked about. */
function isStaff(auth) {
  return auth && auth.userType !== "client";
}

export async function GET(request) {
  try {
    const auth = await getAuthedOrg(request);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const svc = serviceClient();
    const url = new URL(request.url);
    const status = url.searchParams.get("status");

    let q = svc
      .from("project_proposals")
      .select("*")
      .eq("organization_id", auth.orgId)
      .order("created_at", { ascending: false })
      .limit(500);

    // A client is scoped to itself HERE as well as in RLS. The service client
    // bypasses RLS, so this route has to re-apply the rule the policy would
    // have — forgetting it is how a service-role endpoint leaks everything.
    if (!isStaff(auth)) q = q.eq("client_id", auth.appUserId);

    if (status) q = q.eq("status", status);

    const { data, error } = await q;
    if (error) throw error;

    return NextResponse.json({ proposals: data || [] });
  } catch (e) {
    console.error("[proposals GET]", e?.message || e);
    return NextResponse.json({ error: "Could not load proposals." }, { status: 503 });
  }
}

export async function POST(request) {
  try {
    const auth = await getAuthedOrg(request);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Only a client files a proposal. Staff creating one "on the client's
    // behalf" sounds harmless and is not: the record would say a customer
    // asked for something they never asked for, and that record is what
    // settles a scope argument six months later.
    if (isStaff(auth)) {
      return NextResponse.json(
        { error: "Only a client can submit a project proposal." },
        { status: 403 }
      );
    }
    if (!auth.appUserId) {
      return NextResponse.json({ error: "Your client account is not linked." }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const title = String(body.title || "").trim();
    const description = String(body.description || "").trim();

    if (!title || !description) {
      return NextResponse.json(
        { error: "A title and a description are both required." },
        { status: 400 }
      );
    }
    if (title.length > MAX_TITLE || description.length > MAX_DESCRIPTION) {
      return NextResponse.json({ error: "That is longer than we can store." }, { status: 400 });
    }

    // Budget is stored as a number or not at all. "around 50k" is not a
    // number, and coercing it would produce 50 or NaN — both worse than null,
    // because a null reads as "they did not say" and a 50 reads as a fact.
    let budget = null;
    if (body.budget !== undefined && body.budget !== null && String(body.budget).trim() !== "") {
      const n = Number(body.budget);
      if (!Number.isFinite(n) || n < 0) {
        return NextResponse.json(
          { error: "Budget must be a number, or left blank." },
          { status: 400 }
        );
      }
      budget = n;
    }

    const svc = serviceClient();

    // One open proposal at a time per client. Without this, a double-clicked
    // submit button files the same request twice and an admin has to work out
    // which of two identical rows to reject.
    const { data: open } = await svc
      .from("project_proposals")
      .select("id")
      .eq("organization_id", auth.orgId)
      .eq("client_id", auth.appUserId)
      .in("status", ["submitted", "in_review"])
      .limit(1);

    if (open && open.length) {
      return NextResponse.json(
        {
          error:
            "You already have a proposal waiting for a decision. We will come back to you on that one first.",
          code: "proposal_pending",
        },
        { status: 409 }
      );
    }

    const { data, error } = await svc
      .from("project_proposals")
      .insert({
        organization_id: auth.orgId,
        client_id: auth.appUserId,
        title,
        description,
        budget,
        currency: String(body.currency || "USD").slice(0, 8),
        desired_deadline: body.desiredDeadline || null,
        status: "submitted",
      })
      .select()
      .single();

    if (error) throw error;

    // Tell the people who decide. Best-effort: a notification that fails must
    // not lose the proposal — the queue is the source of truth, this is only
    // the tap on the shoulder.
    try {
      const { data: deciders } = await svc
        .from("memberships")
        .select("user_id, email, user_type, role")
        .eq("organization_id", auth.orgId)
        .eq("status", "active")
        .in("role", ["owner", "admin", "manager"]);

      const rows = (deciders || []).map((m) => ({
        organization_id: auth.orgId,
        admin_id: m.user_type === "admin" ? m.user_id : null,
        developer_id: m.user_type === "developer" ? m.user_id : null,
        admin_email: m.email || null,
        type: "proposal_submitted",
        // `project` — a real category from src/utils/notifications.js. An
        // invented one still inserts (there is no CHECK) and then falls
        // through to "general" in the bell, losing its icon and its filter.
        category: "project",
        title: "New project proposal",
        message: `A client has proposed "${title}".`,
        entity_type: "project_proposal",
        entity_id: data.id,
        read: false,
      }));
      if (rows.length) await svc.from("notifications").insert(rows);
    } catch (notifyErr) {
      console.error("[proposals POST] notify failed:", notifyErr?.message || notifyErr);
    }

    return NextResponse.json({ proposal: data }, { status: 201 });
  } catch (e) {
    console.error("[proposals POST]", e?.message || e);
    return NextResponse.json({ error: "Could not submit your proposal." }, { status: 503 });
  }
}

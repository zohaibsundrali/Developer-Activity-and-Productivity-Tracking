import { NextResponse } from "next/server";
import { getAuthedOrg, serviceClient } from "@/utils/serverAuth";
import { recordEvent } from "@/utils/systemEvents";
import { authorizeTeamDelete } from "./authorize";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/admin/teams/[id] — the ONLY supported way to delete a team.
 *
 * THE DEFECT THIS CLOSES
 *  Deleting a team has two effects: detach every member (memberships.team_id ->
 *  null) and remove the teams row. The browser used to do both itself, as two
 *  PostgREST round-trips. Two round-trips are two transactions, and there is no
 *  client-side transaction in supabase-js to wrap them in, so when the second
 *  failed the first stayed committed: every member of that team ended up
 *  detached from a team that still existed, repairable only by re-assigning
 *  each person by hand. Ordering the pair detach-first and reporting which half
 *  landed made the damage visible; it did not make it stop happening.
 *
 * HOW ATOMICITY IS ACTUALLY OBTAINED
 *  Not by doing the same two statements with a service key — two statements
 *  from a server are still two transactions and still tear in exactly the same
 *  place. The two writes are moved INTO the database, as
 *  public.delete_team_with_members(p_org_id, p_team_id) (migration 043). A
 *  function body runs inside one transaction, so both writes commit together or
 *  neither does. If the delete fails, the detach is rolled back with it and the
 *  team keeps its members.
 *
 *  Same two effects, same order, no third one. The function is not a cascade:
 *  members keep their membership in the organisation, exactly as before.
 *
 * WHAT THIS ROUTE GUARANTEES
 *  - the caller is identified from a VERIFIED bearer token; the organisation
 *    comes from that token and is never read from the body, the query string or
 *    the path,
 *  - the role check is owner/admin/hr — what src/utils/permissions.js already
 *    says for `manage_teams`; see ./authorize.js,
 *  - the team id from the path is treated as untrusted: ownership is re-checked
 *    inside the function, under a row lock, against the org id from the token,
 *  - a team in another organisation and a team that does not exist produce the
 *    SAME 404, so the response cannot be used to probe which ids exist
 *    elsewhere,
 *  - on any failure the answer is "nothing was changed", and that is now a fact
 *    about the database rather than a hope.
 */
export async function DELETE(request, context) {
  let auth = null;
  try {
    // ── Fail closed: a valid token is required ──
    auth = await getAuthedOrg(request);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Next 14 hands params as an object; Next 15 as a promise. `await` is
    // correct for both and costs nothing.
    const params = (await context?.params) || {};
    const teamId = params.id ? String(params.id).trim() : null;

    const verdict = authorizeTeamDelete(auth, teamId);
    if (!verdict.ok) {
      // Monitoring (best effort, never throws — see src/utils/systemEvents.js).
      // A refused delete is worth a durable record: a run of them is someone
      // walking team ids they do not own. Only opaque ids and short codes are
      // stored; the id that was refused is not, because for a 404 it is
      // attacker-supplied noise.
      await recordEvent({
        orgId: auth.orgId,
        type: "org.team_delete_refused",
        severity: "warning",
        source: "api",
        message: "A team delete was refused.",
        context: {
          route: "/api/admin/teams/[id]",
          userId: auth.appUserId || null,
          userType: auth.userType || null,
          role: auth.role || null,
          statusCode: verdict.status,
        },
      });
      return NextResponse.json({ error: verdict.error }, { status: verdict.status });
    }

    // The service role is what may EXECUTE the function (043 revokes it from
    // anon and authenticated, so the rpc endpoint is closed to the browser).
    // The organisation it is handed is the verified one.
    const svc = serviceClient();
    const { data, error } = await svc.rpc("delete_team_with_members", {
      p_org_id: auth.orgId,
      p_team_id: teamId,
    });

    if (error) {
      // The function raised, so its transaction rolled back: neither write
      // survived. Nothing to repair, and nothing partial to describe.
      await recordEvent({
        orgId: auth.orgId,
        type: "org.team_delete_failed",
        severity: "error",
        source: "api",
        message: "A team delete failed and was rolled back; nothing was changed.",
        context: {
          route: "/api/admin/teams/[id]",
          userId: auth.appUserId || null,
          userType: auth.userType || null,
          role: auth.role || null,
          reason: error.code || error.message || "rpc_failed",
        },
      });
      return NextResponse.json(
        { error: "Could not delete the team. Nothing was changed." },
        { status: 502 }
      );
    }

    // jsonb comes back as an object; a null would mean the function returned
    // nothing, which it never does — treat it as "not found" rather than
    // guessing that the delete worked.
    const result = data && typeof data === "object" ? data : {};
    if (!result.found) {
      return NextResponse.json(
        { error: "Team not found in your organization" },
        { status: 404 }
      );
    }

    const detached = Number.isFinite(result.detached) ? result.detached : 0;

    await recordEvent({
      orgId: auth.orgId,
      type: "org.team_deleted",
      severity: "info",
      source: "api",
      message: "A team was deleted and its members detached, in one transaction.",
      // `count` is the detached-member count. recordEvent() stores only the
      // keys on its allow-list (src/utils/systemEvents.js) and silently drops
      // the rest, so a `teamId`/`detached` pair would have been recorded as
      // nothing at all — `count` is the allowed name for exactly this.
      context: {
        route: "/api/admin/teams/[id]",
        userId: auth.appUserId || null,
        userType: auth.userType || null,
        role: auth.role || null,
        count: detached,
      },
    });

    return NextResponse.json({ success: true, teamId, detached });
  } catch (err) {
    console.error("[admin/teams/[id]] Failed to delete team:", err);
    return NextResponse.json(
      { error: "Failed to delete the team. Nothing was changed." },
      { status: 500 }
    );
  }
}

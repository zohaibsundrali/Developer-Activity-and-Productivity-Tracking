import { NextResponse } from "next/server";
import { getAuthedOrg } from "@/utils/serverAuth";
import { permissionSetFor } from "@/utils/permissionEngine";

export const dynamic = "force-dynamic";

/**
 * /api/me/permissions — what THIS caller may do, overrides included.
 *
 * WHY THE BROWSER NEEDED THIS. `roleCan(getRole(), key)` is what the browser has
 * always asked, and it passes `{ role }` — a subject with no `overrides` field.
 * `resolvePermission` has honoured overrides since 069 and the browser has
 * never given it any, so an exception written against one person changed what
 * the SERVER allowed and nothing about what the screen offered.
 *
 * Migration 094 makes those exceptions bite at the database. Without this
 * route, the result would be the worse half of that fix: a denied person still
 * sees the button, presses it, and RLS refuses them — the same dead end
 * `canPay` had, arrived at from the other direction.
 *
 * ONE ROUND TRIP, NOT N. `permissionSetFor` has existed since the catalogue was
 * written, with a comment saying it is "for sending a permission set to the
 * browser once instead of asking N times". Nothing had ever called it.
 *
 * THIS IS NOT A GATE AND MUST NEVER BE READ AS ONE. It tells a screen what to
 * offer. Every write is still decided by the route that performs it and by RLS
 * underneath — a caller who edits this response in flight changes what their
 * own buttons look like and nothing else.
 */
export async function GET(request) {
  try {
    const auth = await getAuthedOrg(request);
    if (!auth) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    // `auth` carries the role AND the overrides `getAuthedOrg` loaded, which is
    // exactly the subject shape resolvePermission wants. Passing `auth` rather
    // than `{ role: auth.role }` is the whole fix.
    return NextResponse.json({
      success: true,
      role: auth.role || null,
      // A client holds no staff permission whatever their role column says, and
      // permissionSetFor is a pure resolver that does not know that — the
      // refuseClient rule lives in serverPermissions. Answering an empty set is
      // the same thing the routes would answer, one round trip earlier.
      permissions: auth.userType === "client" ? [] : permissionSetFor(auth),
      // So a screen can tell "no exceptions were readable" from "no exceptions
      // exist" — getAuthedOrg sets this when the overrides query failed, and a
      // route answers 503 rather than falling back to the role.
      overridesUnavailable: Boolean(auth.overridesUnavailable),
    });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e?.message || "Could not load permissions" },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { checkSeatLimitForRole, checkFeatureAccess } from "@/utils/entitlements";
import { isRole, userTypeForRole, PROFILE_TABLE } from "@/utils/roles";
import { meta as termsMeta } from "@/content/legal/terms";

// Server-side invite acceptance (service_role): validates the token, creates the
// user + membership + Supabase Auth account, and marks the invite accepted.
// Bypasses RLS so acceptance works once RLS is enabled (the invitee is not
// authenticated at this point).

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// Same source and the same reasoning as src/app/api/auth/signup/route.js: the
// Terms module has no `version` field, so its last-updated date is the version,
// it is resolved on the server, and it is never taken from the request.
const TERMS_DOCUMENT = "terms_of_service";
const TERMS_VERSION = termsMeta.version || termsMeta.lastUpdated;

// Reads the address off the request we already have; no new plumbing. Returns
// null for anything that is not a valid address, because the column is `inet`
// and a malformed value would abort the insert.
function acceptanceIp(request) {
  const raw =
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    request.headers.get("x-real-ip") ||
    "";
  const value = raw.trim();
  if (!value) return null;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value);
  if (v4) return v4.slice(1).every((octet) => Number(octet) <= 255) ? value : null;
  const compressions = (value.match(/::/g) || []).length;
  if (compressions <= 1 && /^[0-9a-fA-F]{0,4}(:[0-9a-fA-F]{0,4}){2,7}$/.test(value)) return value;
  return null;
}

export async function POST(request) {
  try {
    const { token, fullName, password, termsAccepted } = await request.json();
    if (!token || !password) {
      return NextResponse.json({ error: "token and password are required" }, { status: 400 });
    }

    // THE GATE, the invitation half. Someone invited into an existing
    // organization is bound by the same Terms as the person who created it —
    // including the notification obligation in Section 3 — and until now was
    // equally unrecorded. Refused before the token is even looked up, so a
    // consent-less request cannot consume an invitation, a seat, or a profile
    // row. `!== true` for the same reason as signup: only a real boolean counts.
    if (termsAccepted !== true) {
      return NextResponse.json(
        { error: "You must accept the Terms of Service to accept this invitation." },
        { status: 400 }
      );
    }

    // 1) validate the invitation
    const { data: invite } = await admin
      .from("invitations")
      .select("*")
      .eq("token", token)
      .maybeSingle();

    if (!invite) return NextResponse.json({ error: "Invitation not found." }, { status: 404 });
    if (invite.status === "accepted") return NextResponse.json({ error: "This invitation was already used." }, { status: 409 });
    if (invite.status === "revoked") return NextResponse.json({ error: "This invitation was revoked." }, { status: 410 });
    if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
      return NextResponse.json({ error: "This invitation has expired." }, { status: 410 });
    }

    // 1b) the seat is consumed HERE, so this is where the plan has to be
    // checked. The create-invitation check cannot hold a seat: a 3-seat
    // organization can issue ten invitations that each see the same one free
    // seat, and accepting them all lands twelve members on a plan sold for
    // three. Re-checking at the moment the row is written is what makes the
    // ceiling real.
    const seatLimit =
      invite.role === "client"
        ? await checkFeatureAccess(admin, invite.organization_id, "client_portal", "The client portal")
        : await checkSeatLimitForRole(admin, invite.organization_id, invite.role);
    if (seatLimit) {
      // The invitation stays pending: the seat may free up, or the plan may be
      // upgraded, and the invitee can then use the same link.
      return NextResponse.json(seatLimit, { status: seatLimit.status });
    }

    const email = invite.email;

    // user_type comes from ONE place, and this is not it.
    //
    // THIS BLOCK USED TO COMPUTE ITS OWN ANSWER:
    //
    //   const isAdminLike = invite.role === "owner" || invite.role === "admin"
    //                       || invite.role === "hr";
    //
    // — and it disagreed with `userTypeForRole()` in utils/roles.js, which maps
    // owner/admin to "admin", client to "client" and EVERYTHING ELSE, hr
    // included, to "developer". So the same hr role came out as "developer" when
    // provisioned through /api/auth/provision (which already calls that
    // function) and as "admin" when INVITED through here. The value is written
    // to three places in one request — memberships.user_type below, the profile
    // table the row is created in, and app_metadata.user_type on the Auth user —
    // so an invited hr carried a claim a provisioned hr did not.
    //
    // That was not cosmetic. Several routes branch on `userType` instead of on
    // `role`, and for user_type "admin" those branches are LOOSER than the
    // permission catalogue, which puts `monitoring.view` at owner+admin only:
    // /api/productivity returns 403 unless userType === 'admin';
    // /api/keyboard-stats self-scopes only when userType === "developer";
    // /api/task-submission lets a non-'developer' userType submit as any
    // developer. An invited hr escaped all three.
    //
    // `userTypeForRole` is now the single source. hr resolves to "developer",
    // which is the tighter answer, is what provisioning and the Employees screen
    // have always done (roles.js STAFF_ROLES is DERIVED from this function and
    // contains hr), and costs hr nothing it should have: middleware.ts admits
    // /admin on canEnterAdminArea(role) as well as on userType, and the
    // catalogue grants hr the people-ops sections.
    //
    // EXISTING invited hr accounts are NOT repaired by this — their rows and
    // claims still say "admin". See database/073, FINDING 3 and PART 1 query 1e,
    // for how to measure and remedy them.
    //
    // Unknown roles are refused rather than defaulted. userTypeForRole would
    // answer "developer" for a typo, which is a fine default for a display
    // decision and a bad one for "which table does this person's account go in";
    // the invitations CHECK constraint (058/067) should make this unreachable,
    // so reaching it means something upstream is wrong. Fail closed.
    if (!isRole(invite.role) || !PROFILE_TABLE[userTypeForRole(invite.role)]) {
      return NextResponse.json({ error: "This invitation carries a role this system does not recognise." }, { status: 400 });
    }
    const userType = userTypeForRole(invite.role);
    const profileTable = PROFILE_TABLE[userType];

    // 2) create the profile row
    //
    // NONE of these three inserts writes the legacy `password` column. It existed
    // to feed the fallback branch in src/app/login/page.js, which has been
    // deleted: it only ran for a caller with no JWT, and every policy on
    // developers / admin_users / clients is `TO authenticated`, so its profile
    // lookup returned nothing and the stored value was never compared. Nothing
    // reads the column as a credential now — GET /api/admin/legacy-auth-audit
    // only counts rows by its shape. The real credential is created in step 4,
    // by Supabase Auth, which stores it hashed.
    // Branching on `userType` rather than on the role keeps the three writes
    // below — profile row, membership row, Auth claim — provably in step with
    // the one function that decided it. There is no second copy of the mapping
    // left in this file.
    let newUser = null;
    if (userType === "admin") {
      // admin_users.company is NOT NULL. The table predates database/010 and
      // the signup route fills the column from the company name the founder
      // typed; this insert used to write `company: null`, so EVERY admin
      // invitation failed at the database with "null value in column
      // \"company\" ... violates not-null constraint" and no admin could ever
      // be added through Organization → Invitations. An invitee has nothing to
      // type: the organization they are joining is their company, which is the
      // same mapping 011_saas_backfill applied in the other direction (org name
      // from admin_users.company). It is READ, not guessed — an invitation
      // whose organization cannot be read is refused rather than filed under a
      // made-up name. Nothing has been written yet, so refusing is clean.
      const { data: org, error: orgError } = await admin
        .from("organizations")
        .select("name")
        .eq("id", invite.organization_id)
        .maybeSingle();
      if (orgError || !org?.name) {
        return NextResponse.json(
          { error: "The organization behind this invitation could not be read." },
          { status: 500 }
        );
      }
      const { data, error } = await admin.from("admin_users").insert([{
        full_name: fullName || null, email, company: org.name,
        role: "admin", is_verified: true, organization_id: invite.organization_id,
        created_at: new Date().toISOString(),
      }]).select().single();
      if (error) {
        if (error.code === "23505") return NextResponse.json({ error: "An account already exists for this email." }, { status: 409 });
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      newUser = data;
    } else if (userType === "client") {
      // Clients get their own user_type + `clients` profile row (NO developers
      // row, so they never appear in staff lists or inherit developer data
      // access).
      const { data, error } = await admin.from("clients").insert([{
        name: fullName || null, email, status: "active",
        organization_id: invite.organization_id, created_at: new Date().toISOString(),
      }]).select().single();
      if (error) {
        if (error.code === "23505") return NextResponse.json({ error: "An account already exists for this email." }, { status: 409 });
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      newUser = data;

      // Link the client to the invited project (if any).
      if (invite.project_id) {
        await admin.from("project_clients").insert([{
          organization_id: invite.organization_id,
          project_id: invite.project_id,
          client_id: newUser.id,
        }]);
      }
    } else {
      // Every remaining role — manager, hr, finance, team_lead, qa, developer,
      // designer, devops, employee. Their real role is preserved on the
      // membership row and on app_metadata.role, which is what the role-aware
      // dashboard, the section table and every RLS policy actually read; the
      // profile table is storage, not authorisation. hr lands HERE now, which
      // is where /api/auth/provision has always put it.
      const { data, error } = await admin.from("developers").insert([{
        name: fullName || null, email, status: "active",
        organization_id: invite.organization_id, created_at: new Date().toISOString(),
      }]).select().single();
      if (error) {
        if (error.code === "23505") return NextResponse.json({ error: "An account already exists for this email." }, { status: 409 });
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      newUser = data;
    }

    // 3) membership
    await admin.from("memberships").insert([{
      organization_id: invite.organization_id, user_id: newUser.id, user_type: userType,
      email, role: invite.role, team_id: invite.team_id || null,
      department_id: invite.department_id || null, status: "active",
    }]);

    // 3b) record the acceptance — see database/039_terms_acceptance.sql.
    // entry_point 'invitation' distinguishes this from the person who created
    // the organization: materially different acts of assent, worth being able
    // to tell apart afterwards. Non-fatal for the same reason as signup — the
    // account already exists by this point, and the refusal above is the half
    // of this feature that has to be absolute.
    const { error: termsErr } = await admin.from("terms_acceptances").insert([{
      organization_id: invite.organization_id,
      user_id: newUser.id,
      user_type: userType,
      email,
      document: TERMS_DOCUMENT,
      document_version: TERMS_VERSION,
      entry_point: "invitation",
      accepted_at: new Date().toISOString(),
      ip: acceptanceIp(request),
    }]);
    if (termsErr) {
      console.error("[invite-accept] terms acceptance not recorded", newUser.id, termsErr.message);
    }

    // 4) Supabase Auth account (with org claim). This is the step that can fail
    // on a DUPLICATE: the per-org profile insert above only guards this org's
    // table, but a Supabase Auth email is global — the invitee may already have
    // an Auth account from another org or an earlier provision. The error used
    // to be discarded (`const { data: au }`), so on failure auth_user_id stayed
    // null, the invite was still flipped to accepted, and success was returned:
    // a seat-consuming account nobody could ever sign in to, behind a dead link.
    const { data: au, error: authErr } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
      app_metadata: { organization_id: invite.organization_id, role: invite.role, user_type: userType, app_user_id: newUser.id },
    });
    if (authErr || !au?.user?.id) {
      // Roll back everything THIS request wrote so the invite stays usable: the
      // membership (which consumed a seat), the client→project link, the terms
      // acceptance, and the freshly-inserted profile row. The invitation is
      // deliberately NOT marked accepted, so a corrected retry still works.
      await admin.from("memberships").delete()
        .eq("organization_id", invite.organization_id).eq("user_id", newUser.id);
      if (userType === "client" && invite.project_id) {
        await admin.from("project_clients").delete()
          .eq("organization_id", invite.organization_id).eq("client_id", newUser.id);
      }
      await admin.from("terms_acceptances").delete()
        .eq("organization_id", invite.organization_id).eq("user_id", newUser.id);
      await admin.from(profileTable).delete().eq("id", newUser.id);

      const dup = authErr?.status === 422 || /already|exist|registered/i.test(authErr?.message || "");
      return NextResponse.json(
        {
          error: dup
            ? "An account already exists for this email address. Sign in instead, or ask an admin to remove the old account before re-inviting."
            : "We couldn't finish creating your account. Please try again.",
        },
        { status: dup ? 409 : 400 }
      );
    }
    await admin.from(profileTable).update({ auth_user_id: au.user.id }).eq("id", newUser.id);

    // 5) mark accepted — only now that the Auth account actually exists.
    await admin.from("invitations").update({ status: "accepted" }).eq("id", invite.id);

    return NextResponse.json({ success: true, role: invite.role, userType });
  } catch (e) {
    return NextResponse.json({ error: "Failed to accept invitation" }, { status: 500 });
  }
}

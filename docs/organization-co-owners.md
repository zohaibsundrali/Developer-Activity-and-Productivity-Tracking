# Organization Owners and Verisade platform Admin

Organization `admin` has been retired. The organization role list is now Owner, Manager, HR, Finance, Team Lead, QA, Developer, Designer, DevOps, Employee and Client.

Verisade platform Admin is separately authorized through the private platform registry. Organization ownership does not grant platform statistics or platform administration access.

Every organization can have multiple Owners. Owners have the same default organization administration permissions and can invite another Owner or promote an existing non-client member through Organization → Members. They cannot change their own role. Another Owner can change it; the database prevents removing, suspending or demoting the last active Owner, including concurrent requests. The authorized organization deletion worker retains its existing cleanup path.

## Add an Owner

1. Sign in using **Owner / Platform Admin**, then open the organization.
2. Open **Organization → Invitations**.
3. Enter the new person's email and select **Owner**.
4. Send the invitation, or copy its link if email delivery is unavailable.
5. The invitee opens the link, accepts the terms, creates a password and signs in.
6. Confirm both accounts appear as **Owner** under **Organization → Members**.

For an existing staff member, use their role selector under **Members** and select **Owner**. Their profile table and login type remain unchanged; a staff-profile Owner still signs in through **Team Member**. Refresh/sign in again after a role change.

The `admin_users` table and `user_type: admin` remain internal profile identifiers, not assignable organization roles. Platform grants remain separate.

Organization-only billing is available to all its Owners. When several organizations share somebody else's billing account, changes to that wider account remain controlled by its payer; being an Owner in one workspace does not give access to the other organizations' shared payment account. Existing permission overrides, plan limits, typed identities and workflow rules continue to apply.

## Implementation and verification — 2026-09-21

Applied migration `20260921175040_organization_co_owners` to Supabase project `isaccqqjobuwfeaxlrwc`. Converted one existing organization Admin membership and one legacy Admin invitation; no organization Admin memberships/invitations remain. Stored Auth role claims were updated only for matching verified organization identities. Eight existing Owner memberships remain after synthetic test cleanup. The private platform registry still has one entry; all 289 existing storage objects remain.

Updated shared role/permission definitions, invitation creation/listing/acceptance, member role selectors, login labeling, profile-role display, billing authorization and generated permission documentation. Owner invitations require an active Owner sender when created and when accepted. Retired Admin assignments are rejected by API and database constraints.

Validation:

- Full Vitest suite: 267 files, 5,124 tests passed; six additional invitation authorization tests then passed in the focused 31-test run.
- Production build passed, with the existing 29 lint warnings.
- Isolated PostgreSQL: legacy conversion, Auth/profile consistency, invitation acceptance, stale inviter refusal, private RPC grants and final-owner protection passed. Competing demotions passed under READ COMMITTED and REPEATABLE READ.
- Live Supabase/local app: 15 positive/negative co-owner checks passed, including real signup acceptance, login, permission equality, another co-owner invitation, direct REST restrictions, cross-organization isolation and platform access refusal. All newly created test accounts/invitations were removed.
- All 11 current organization roles: 319 API permission checks passed.
- Owner browser controls: Owner is available for invitations, Admin is absent, and the current Owner’s self-role selector is disabled (two tests passed).
- Supabase advisors completed. No finding names the new last-owner trigger; existing project-wide warnings remain (including exposed legacy functions, leaked-password protection, and index/RLS performance recommendations).
- Browser login/logout: all 13 seeded identities passed, including the converted co-owner and organization B Owner.

The database change is live. Application code was built and tested locally; this work does not deploy the hosted website. No real payment or outbound invitation email was sent by the live QA flow. Historical QA reports describe the role model at the time of their run; this document and the regenerated permission matrix describe the current model.

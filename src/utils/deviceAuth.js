import { getAuthedOrg, orgScopedClient } from "@/utils/serverAuth";

/** Supabase verifies the JWT; the database verifies live device revocation. */
export async function verifyDeviceRequest(request) {
  const header = request.headers.get("authorization") || "";
  if (!/^Bearer\s+[^.\s]+\.[^.\s]+\.[^.\s]+$/i.test(header)) return null;
  const auth = await getAuthedOrg(request);
  if (!auth || auth.userType !== "developer") return null;
  const client = orgScopedClient(auth.token);
  const { data, error } = await client.rpc("auth_tracker_session");
  if (error || data !== true) return null;
  return {
    allow: true, authenticated: true, stage: "device", reason: "authenticated_device",
    developerId: auth.appUserId, orgId: auth.orgId, client,
  };
}

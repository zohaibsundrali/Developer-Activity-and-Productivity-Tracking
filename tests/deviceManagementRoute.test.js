import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn() }));
vi.mock("@/utils/serverAuth", () => ({ getAuthedOrg: mocks.auth, orgScopedClient: () => ({ rpc: mocks.rpc }) }));
import { DELETE } from "@/app/api/devices/route";
const id = "12345678-1234-1234-1234-123456789abc";
const request = body => new Request("https://app.test/api/devices", { method: "DELETE", body, headers: { "content-type": "application/json" } });
beforeEach(() => {
  mocks.auth.mockReset().mockResolvedValue({ userType: "developer", token: "session-token" });
  mocks.rpc.mockReset().mockResolvedValue({ data: true });
});
it.each(["null", "[]", "12", '"invalid"', "{", "{}"])("returns validation failure for malformed body %s without revoking a device", async body => {
  expect((await DELETE(request(body))).status).toBe(400);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("uses the authenticated session's database authorization for revocation", async () => {
  const response = await DELETE(request(JSON.stringify({ id, organization_id: "attacker-org" })));
  expect(response.status).toBe(200);
  expect(mocks.rpc).toHaveBeenCalledWith("revoke_tracker_device", { p_id: id });
});
it("does not report a missing or inaccessible device as revoked", async () => {
  mocks.rpc.mockResolvedValue({ data: false });
  expect((await DELETE(request(JSON.stringify({ id })))).status).toBe(404);
});
it("keeps provider failures retryable and does not expose database errors", async () => {
  mocks.rpc.mockResolvedValue({ error: { message: "internal schema detail" } });
  const response = await DELETE(request(JSON.stringify({ id })));
  expect(response.status).toBe(503);
  expect(JSON.stringify(await response.json())).not.toContain("internal schema detail");
});
it.each([null, { userType: "client" }])("refuses unauthorized caller %s before touching devices", async auth => {
  mocks.auth.mockResolvedValue(auth);
  expect((await DELETE(request(JSON.stringify({ id })))).status).toBe(401);
  expect(mocks.rpc).not.toHaveBeenCalled();
});

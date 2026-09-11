import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn() }));
vi.mock("@/utils/serverAuth", () => ({ getAuthedOrg: mocks.auth, orgScopedClient: () => ({ rpc: mocks.rpc }) }));
import { verifyDeviceRequest } from "@/utils/deviceAuth";
beforeEach(() => {
  mocks.auth.mockReset().mockResolvedValue({ userType: "developer", appUserId: "dev-a", orgId: "org-a", token: "a.b.c" });
  mocks.rpc.mockReset().mockResolvedValue({ data: true });
});
const req = authorization => new Request("https://app.test/api/track-activity", { headers: { authorization } });
it("does not accept fleet credentials as device identities", async () => {
  expect(await verifyDeviceRequest(req("Bearer shared-secret"))).toBeNull();
  expect(mocks.auth).not.toHaveBeenCalled();
});
it("requires server-verified identity", async () => {
  mocks.auth.mockResolvedValue(null);
  expect(await verifyDeviceRequest(req("Bearer a.b.c"))).toBeNull();
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it.each([false, null])("rejects inactive or unregistered device result %s", async data => {
  mocks.rpc.mockResolvedValue({ data });
  expect(await verifyDeviceRequest(req("Bearer a.b.c"))).toBeNull();
});
it("fails closed when revocation verification is unavailable", async () => {
  mocks.rpc.mockResolvedValue({ data: true, error: { code: "unavailable" } });
  expect(await verifyDeviceRequest(req("Bearer a.b.c"))).toBeNull();
});
it("binds the request to its registered member and organization", async () => {
  expect(await verifyDeviceRequest(req("Bearer a.b.c"))).toMatchObject({ developerId: "dev-a", orgId: "org-a", authenticated: true });
});
it("refuses client accounts", async () => {
  mocks.auth.mockResolvedValue({ userType: "client" });
  expect(await verifyDeviceRequest(req("Bearer a.b.c"))).toBeNull();
});

import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/utils/serverAuth", () => ({ getAuthedOrg: mocks.auth, orgScopedClient: () => ({ rpc: mocks.rpc, from: mocks.from }) }));
import { DELETE, GET } from "@/app/api/devices/route";
const id = "12345678-1234-1234-1234-123456789abc";
const request = body => new Request("https://app.test/api/devices", { method: "DELETE", body, headers: { "content-type": "application/json" } });
beforeEach(() => {
  mocks.auth.mockReset().mockResolvedValue({ userType: "developer", token: "session-token" });
  mocks.rpc.mockReset().mockResolvedValue({ data: true });
  mocks.from.mockReset();
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

const row = { id, created_at: "2026-09-12T10:00:00.123456+00:00", name: "Laptop" };
function pages(results) {
  const calls = [];
  mocks.from.mockImplementation(table => {
    const result = results.shift();
    const query = {};
    for (const method of ["select", "eq", "order", "or"]) query[method] = (...args) => { calls.push([method, ...args]); return query; };
    query.limit = vi.fn(async n => { calls.push(["limit", n]); return result; });
    return query;
  });
  return calls;
}
it("probes beyond an unexpectedly short hosted page and returns a stable cursor", async () => {
  mocks.auth.mockResolvedValue({ userType: "developer", token: "token", orgId: "own-org" });
  const calls = pages([{ data: [row] }, { data: [{ ...row, id: "older" }] }]);
  const response = await GET(new Request("https://app.test/api/devices"));
  const body = await response.json();
  expect(body.hasMore).toBe(true);
  expect(JSON.parse(Buffer.from(body.nextCursor, "base64url"))).toEqual({ id, created_at: row.created_at });
  expect(calls).toContainEqual(["eq", "organization_id", "own-org"]);
  expect(calls).toContainEqual(["order", "id", { ascending: false }]);
  expect(calls).toContainEqual(["limit", 1]);
});
it("applies the cursor tie breaker rather than offset skipping", async () => {
  const cursor = Buffer.from(JSON.stringify(row)).toString("base64url");
  const calls = pages([{ data: [row] }, { data: [] }]);
  const body = await (await GET(new Request(`https://app.test/api/devices?cursor=${cursor}`))).json();
  expect(calls).toContainEqual(["or", `created_at.lt.${row.created_at},and(created_at.eq.${row.created_at},id.lt.${id})`]);
  expect(body).toEqual({ devices: [row], hasMore: false, nextCursor: null });
});
it.each(["not-json", Buffer.from(JSON.stringify({ id, created_at: "now),id.gt.0" })).toString("base64url")])("rejects invalid cursors before database access", async cursor => {
  expect((await GET(new Request(`https://app.test/api/devices?cursor=${cursor}`))).status).toBe(400);
  expect(mocks.from).not.toHaveBeenCalled();
});
it("does not silently announce completion when the continuation probe fails", async () => {
  pages([{ data: [row] }, { error: { message: "private database error" } }]);
  const response = await GET(new Request("https://app.test/api/devices"));
  expect(response.status).toBe(503);
  expect(JSON.stringify(await response.json())).not.toContain("private database");
});
it("empty page completes without probing", async () => {
  pages([{ data: [] }]);
  expect(await (await GET(new Request("https://app.test/api/devices"))).json()).toEqual({ devices: [], hasMore: false, nextCursor: null });
  expect(mocks.from).toHaveBeenCalledTimes(1);
});

import { expect, it, vi } from "vitest";
import { createDevicePager, deviceSessionFingerprint, deviceIdentityChanged } from "@/utils/devicePagination";
const result = (ids, nextCursor = null) => ({ devices: ids.map(id => ({ id })), hasMore: Boolean(nextCursor), nextCursor });
it("preserves visible devices and retries the same failed continuation", async () => {
  let state;
  const fetch = vi.fn().mockResolvedValueOnce(result(["active"], "next"))
    .mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(result(["older"]));
  const pager = createDevicePager(fetch, update => state = update);
  await pager.load();
  await pager.load(true);
  expect(state.devices.map(d => d.id)).toEqual(["active"]);
  expect(state.error).toBe("offline");
  expect(state.nextCursor).toBe("next");
  await pager.load(true);
  expect(fetch.mock.calls[2][0]).toBe("next");
  expect(state.devices.map(d => d.id)).toEqual(["active", "older"]);
  expect(state.nextCursor).toBeNull();
});
it("account change clears rows and ignores the previous identity's late page", async () => {
  let state, oldResolve;
  const fetch = vi.fn().mockResolvedValueOnce(result(["old"], "cursor"))
    .mockImplementationOnce(() => new Promise(resolve => oldResolve = resolve))
    .mockResolvedValueOnce(result(["new"]));
  const pager = createDevicePager(fetch, update => state = update);
  await pager.load();
  const stale = pager.load(true);
  pager.clear();
  expect(state.devices).toEqual([]);
  await pager.load();
  oldResolve(result(["private-old"]));
  await stale;
  expect(state.devices.map(d => d.id)).toEqual(["new"]);
});
it("refresh supersedes an in-flight page and duplicate clicks do not send duplicate requests", async () => {
  let state, resolve;
  const fetch = vi.fn().mockResolvedValueOnce(result(["one"], "cursor"))
    .mockImplementationOnce(() => new Promise(r => resolve = r))
    .mockResolvedValueOnce(result(["fresh"]));
  const pager = createDevicePager(fetch, update => state = update);
  await pager.load();
  const pending = pager.load(true);
  await pager.load(true);
  expect(fetch).toHaveBeenCalledTimes(2);
  await pager.load();
  resolve(result(["stale"])); await pending;
  expect(state.devices.map(d => d.id)).toEqual(["fresh"]);
});
it("unmount invalidates late responses and aborts transport", async () => {
  let resolve;
  const publish = vi.fn();
  const fetch = vi.fn(() => new Promise(r => resolve = r));
  const pager = createDevicePager(fetch, publish);
  const pending = pager.load();
  pager.dispose(); publish.mockClear();
  expect(fetch.mock.calls[0][1].aborted).toBe(true);
  resolve(result(["old"])); await pending;
  expect(publish).not.toHaveBeenCalled();
});

it("role changes and refreshed authority invalidate previously visible devices", () => {
  const session = { user: { id: "same", app_metadata: { organization_id: "org", app_user_id: "profile", user_type: "developer", role: "manager" } } };
  const prior = deviceSessionFingerprint(session);
  expect(deviceIdentityChanged("SIGNED_IN", prior, session)).toBe(false);
  expect(deviceIdentityChanged("TOKEN_REFRESHED", prior, session)).toBe(true);
  const downgraded = { user: { ...session.user, app_metadata: { ...session.user.app_metadata, role: "employee" } } };
  expect(deviceIdentityChanged("USER_UPDATED", prior, downgraded)).toBe(true);
});

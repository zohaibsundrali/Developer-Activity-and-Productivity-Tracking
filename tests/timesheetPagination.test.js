import { expect, it, vi } from "vitest";
import { createTimesheetPager } from "@/utils/timesheetPagination";
const result = (ids, nextCursor = null) => ({ timesheets: ids.map(id => ({ id })), hasMore: Boolean(nextCursor), nextCursor });
it("preserves visible timesheets and retries the same failed continuation", async () => {
  let state;
  const fetch = vi.fn().mockResolvedValueOnce(result(["active"], "next"))
    .mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(result(["older"]));
  const pager = createTimesheetPager(fetch, update => state = update);
  await pager.load();
  await pager.load(true);
  expect(state.timesheets.map(d => d.id)).toEqual(["active"]);
  expect(state.error).toBe("offline");
  expect(state.retryMore).toBe(true);
  expect(state.nextCursor).toBe("next");
  await pager.load(true);
  expect(fetch.mock.calls[2][0]).toBe("next");
  expect(state.timesheets.map(d => d.id)).toEqual(["active", "older"]);
  expect(state.nextCursor).toBeNull();
});
it("account change clears rows and ignores the previous identity's late page", async () => {
  let state, oldResolve;
  const fetch = vi.fn().mockResolvedValueOnce(result(["old"], "cursor"))
    .mockImplementationOnce(() => new Promise(resolve => oldResolve = resolve))
    .mockResolvedValueOnce(result(["new"]));
  const pager = createTimesheetPager(fetch, update => state = update);
  await pager.load();
  const stale = pager.load(true);
  pager.clear();
  expect(state.timesheets).toEqual([]);
  await pager.load();
  oldResolve(result(["private-old"]));
  await stale;
  expect(state.timesheets.map(d => d.id)).toEqual(["new"]);
});
it("refresh supersedes an in-flight page and duplicate clicks do not send duplicate requests", async () => {
  let state, resolve;
  const fetch = vi.fn().mockResolvedValueOnce(result(["one"], "cursor"))
    .mockImplementationOnce(() => new Promise(r => resolve = r))
    .mockResolvedValueOnce(result(["fresh"]));
  const pager = createTimesheetPager(fetch, update => state = update);
  await pager.load();
  const pending = pager.load(true);
  await pager.load(true);
  expect(fetch).toHaveBeenCalledTimes(2);
  await pager.load();
  resolve(result(["stale"])); await pending;
  expect(state.timesheets.map(d => d.id)).toEqual(["fresh"]);
});
it("unmount invalidates late responses and aborts transport", async () => {
  let resolve;
  const publish = vi.fn();
  const fetch = vi.fn(() => new Promise(r => resolve = r));
  const pager = createTimesheetPager(fetch, publish);
  const pending = pager.load();
  pager.dispose(); publish.mockClear();
  expect(fetch.mock.calls[0][1].aborted).toBe(true);
  resolve(result(["old"])); await pending;
  expect(publish).not.toHaveBeenCalled();
});

it("rejects a non-advancing cursor and preserves the retry position", async () => {
  let state;
  const fetch = vi.fn().mockResolvedValueOnce(result(["one"], "cursor"))
    .mockResolvedValueOnce(result(["one"], "cursor"));
  const pager = createTimesheetPager(fetch, update => state = update);
  await pager.load(); await pager.load(true);
  expect(state.timesheets.map(r => r.id)).toEqual(["one"]);
  expect(state.error).toBe("Invalid timesheet response");
  expect(state.nextCursor).toBe("cursor");
});
it("de-duplicates rows when a refreshed record also appears on a later page", async () => {
  let state;
  const fetch = vi.fn().mockResolvedValueOnce(result(["one"], "cursor"))
    .mockResolvedValueOnce(result(["one", "two"]));
  const pager = createTimesheetPager(fetch, update => state = update);
  await pager.load(); await pager.load(true);
  expect(state.timesheets.map(r => r.id)).toEqual(["one", "two"]);
});

it("failed refresh retries from the first page instead of the old continuation", async () => {
  let state;
  const fetch = vi.fn().mockResolvedValueOnce(result(["old"], "cursor"))
    .mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(result(["fresh"]));
  const pager = createTimesheetPager(fetch, update => state = update);
  await pager.load(); await pager.load();
  expect(state.retryMore).toBe(false);
  expect(state.timesheets.map(r => r.id)).toEqual(["old"]);
  await pager.load(state.retryMore);
  expect(fetch.mock.calls[2][0]).toBeNull();
  expect(state.timesheets.map(r => r.id)).toEqual(["fresh"]);
});

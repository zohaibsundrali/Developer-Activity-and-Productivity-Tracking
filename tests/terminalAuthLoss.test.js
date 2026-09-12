import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { observeTerminalAuthLoss, protectedGateStatus } from "@/utils/terminalAuthLoss";
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
function setup() {
  let event;
  const unsubscribe = vi.fn();
  const auth = { getSession: vi.fn(async () => ({ data: { session: null } })),
    onAuthStateChange: callback => { event = callback; return { data: { subscription: { unsubscribe } } }; } };
  const loss = vi.fn();
  const dispose = observeTerminalAuthLoss(auth, loss);
  return { auth, loss, dispose, unsubscribe, emit: (...args) => event(...args) };
}
it("only reconciles confirmed terminal loss after the auth callback returns", async () => {
  const s = setup(); s.emit("SIGNED_OUT", null);
  expect(s.auth.getSession).not.toHaveBeenCalled();
  await vi.runAllTimersAsync();
  expect(s.loss).toHaveBeenCalledTimes(1);
  s.emit("SIGNED_OUT", null); await vi.runAllTimersAsync();
  expect(s.loss).toHaveBeenCalledTimes(1);
});
it("does not log out this tab for another tab's broadcast when its own session exists", async () => {
  const s = setup(); s.auth.getSession.mockResolvedValue({ data: { session: { access_token: "local" } } });
  s.emit("SIGNED_OUT", null); await vi.runAllTimersAsync();
  expect(s.loss).not.toHaveBeenCalled();
});
it.each(["throw", "returned-error"])("verification failure %s is not treated as revocation", async mode => {
  const s = setup();
  if (mode === "throw") s.auth.getSession.mockRejectedValue(new Error("offline"));
  else s.auth.getSession.mockResolvedValue({ data: { session: null }, error: new Error("offline") });
  s.emit("SIGNED_OUT", null); await vi.runAllTimersAsync();
  expect(s.loss).not.toHaveBeenCalled();
});
it("a fresh login supersedes a delayed old-session denial", async () => {
  const s = setup(); let settle;
  s.auth.getSession.mockImplementation(() => new Promise(r => settle = r));
  s.emit("SIGNED_OUT", null); await vi.advanceTimersByTimeAsync(0);
  s.emit("SIGNED_IN", { user: { id: "new" } });
  settle({ data: { session: null } }); await Promise.resolve();
  expect(s.loss).not.toHaveBeenCalled();
});
it("initial missing SDK session reconciles stale app caches and disposal blocks late work", async () => {
  const s = setup(); s.emit("INITIAL_SESSION", null); await vi.runAllTimersAsync();
  expect(s.loss).toHaveBeenCalledTimes(1);
  const other = setup(); other.emit("SIGNED_OUT", null); other.dispose(); await vi.runAllTimersAsync();
  expect(other.loss).not.toHaveBeenCalled(); expect(other.unsubscribe).toHaveBeenCalledTimes(1);
});
it("keeps authenticated pending rechecks smooth but explicit denial always wins", () => {
  expect(protectedGateStatus("pending", true)).toBe("allowed");
  expect(protectedGateStatus("denied", true)).toBe("denied");
  expect(protectedGateStatus("pending", false)).toBe("pending");
  expect(protectedGateStatus("allowed", false)).toBe("allowed");
});

it("an anonymous initial session does not disable monitoring of a later login", async () => {
  const s = setup(); s.loss.mockResolvedValueOnce(false);
  s.emit("INITIAL_SESSION", null); await vi.runAllTimersAsync();
  s.emit("SIGNED_IN", { user: { id: "new" } });
  s.emit("SIGNED_OUT", null); await vi.runAllTimersAsync();
  expect(s.loss).toHaveBeenCalledTimes(2);
});

it("malformed session responses are not confirmed logout", async () => {
  const s = setup(); s.auth.getSession.mockResolvedValue({ data: {} });
  s.emit("SIGNED_OUT", null); await vi.runAllTimersAsync();
  expect(s.loss).not.toHaveBeenCalled();
});

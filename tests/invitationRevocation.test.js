import { expect, it, vi } from "vitest";
import { createInvitationRevoker, revokePendingInvitation } from "@/utils/invitationRevocation";
function client(result) {
  const q = { update: vi.fn(() => q), eq: vi.fn(() => q), select: vi.fn(() => q), maybeSingle: vi.fn(async () => result) };
  return { from: vi.fn(() => q), q };
}
it("requires the exact affected pending invitation in the current organization", async () => {
  const db = client({ data: { id: "invite", status: "revoked" } });
  await expect(revokePendingInvitation(db, "org", "invite")).resolves.toEqual({ id: "invite", status: "revoked" });
  expect(db.q.eq.mock.calls).toEqual([["organization_id", "org"], ["id", "invite"], ["status", "pending"]]);
  expect(db.q.select).toHaveBeenCalledWith("id,status");
});
it.each([null, { id: "other", status: "revoked" }, { id: "invite", status: "accepted" }])("does not announce success for absent or conflicting affected rows: %s", async data => {
  await expect(revokePendingInvitation(client({ data }), "org", "invite")).rejects.toThrow("no longer pending");
});
it("keeps database internals out of the failure message", async () => {
  await expect(revokePendingInvitation(client({ error: { message: "private SQL" } }), "org", "invite")).rejects.toThrow("could not be confirmed");
});
function flow() {
  const deps = { confirm: vi.fn(async () => true), mutate: vi.fn(async () => {}), identity: vi.fn(() => "identity"), busy: vi.fn(), success: vi.fn(), error: vi.fn(), reload: vi.fn(async () => {}), refreshError: vi.fn() };
  return { deps, controller: createInvitationRevoker(deps) };
}
const inv = { id: "invite", email: "person@example.test", status: "pending" };
it("blocks duplicate clicks while confirmation and mutation are pending", async () => {
  const { deps, controller } = flow();
  let accept;
  deps.confirm.mockImplementation(() => new Promise(r => accept = r));
  const pending = controller.run("org", inv);
  await controller.run("org", inv);
  expect(deps.confirm).toHaveBeenCalledTimes(1);
  accept(true); await pending;
  expect(deps.mutate).toHaveBeenCalledTimes(1);
  expect(deps.success).toHaveBeenCalledTimes(1);
  expect(deps.busy.mock.calls).toEqual([["invite"], [null]]);
});
it("cancelled confirmation does not mutate and releases the controls", async () => {
  const { deps, controller } = flow(); deps.confirm.mockResolvedValue(false);
  await controller.run("org", inv);
  expect(deps.mutate).not.toHaveBeenCalled();
  expect(deps.busy).toHaveBeenLastCalledWith(null);
});
it("a failed mutation has no success toast and can be retried", async () => {
  const { deps, controller } = flow(); deps.mutate.mockRejectedValueOnce(new Error("not pending"));
  await controller.run("org", inv);
  expect(deps.success).not.toHaveBeenCalled(); expect(deps.reload).not.toHaveBeenCalled();
  expect(deps.error).toHaveBeenCalledWith("not pending");
  await controller.run("org", inv); expect(deps.success).toHaveBeenCalledTimes(1);
});
it("an identity change during confirmation prevents the mutation", async () => {
  const { deps, controller } = flow();
  deps.confirm.mockImplementation(async () => { deps.identity.mockReturnValue("other"); return true; });
  await controller.run("org", inv);
  expect(deps.mutate).not.toHaveBeenCalled(); expect(deps.success).not.toHaveBeenCalled();
});
it("unmount suppresses late success, reload and control updates", async () => {
  const { deps, controller } = flow();
  deps.mutate.mockImplementation(async () => controller.dispose());
  await controller.run("org", inv);
  expect(deps.success).not.toHaveBeenCalled(); expect(deps.reload).not.toHaveBeenCalled();
  expect(deps.busy).toHaveBeenCalledTimes(1);
});

it("does not misreport confirmed revocation as a mutation failure when refresh fails", async () => {
  const { deps, controller } = flow();
  deps.reload.mockRejectedValue(new Error("offline"));
  await controller.run("org", inv);
  expect(deps.success).toHaveBeenCalledTimes(1);
  expect(deps.error).not.toHaveBeenCalled();
  expect(deps.refreshError).toHaveBeenCalledWith(expect.stringContaining("was revoked"));
});

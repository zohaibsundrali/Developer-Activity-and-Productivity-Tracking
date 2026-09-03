"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { KeyRound, Laptop, Plus, TriangleAlert, Undo2 } from "lucide-react";

import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Modal,
  PageHeader,
  Section,
  Skeleton,
  Tabs,
} from "@/components/ui";
import StatCard from "@/components/shell/StatCard";
import { authFetch } from "@/utils/authFetch";
import { showError, showSuccess } from "@/utils/alerts";

/**
 * Assets and licences — what the company owns and who is holding it.
 *
 * TWO TABS BECAUSE THEY ARE TWO SHAPES OF THING. An asset is one object with
 * one holder, and its history is a chain of custody. A licence is a pool of
 * seats — one contract with a number on it. They belong on one screen and not
 * in one table; migration 090's header sets out why folding them together loses
 * either the serial number or the seat count.
 *
 * OVER-ASSIGNMENT IS SHOWN, NOT PREVENTED. Thirteen of twelve seats is a
 * contract breach, and refusing to record it would not stop the thirteenth seat
 * existing — it would stop anybody being able to see it. Red, with the number,
 * on the row.
 *
 * NO COST IS INVENTED. Purchase and annual costs are nullable, and an unset one
 * renders as an em-dash. A register full of confident zeroes reads as "we own
 * nothing valuable", which is worse than an empty column that asks a question.
 */

const CONTROL =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

const TABS = [
  { id: "assets", label: "Equipment" },
  { id: "licences", label: "Licences" },
];

const STATUS_TONE = {
  in_stock: "secondary",
  assigned: "success",
  repair: "warning",
  retired: "outline",
  lost: "destructive",
};

const CATEGORIES = [
  "laptop", "desktop", "monitor", "phone", "tablet", "peripheral", "furniture", "other",
];

const money = (v) =>
  v === null || v === undefined
    ? "—"
    : new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(Number(v));

export default function Assets({ developers = [] }) {
  const [tab, setTab] = useState("assets");
  const [assets, setAssets] = useState([]);
  const [licences, setLicences] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [assetForm, setAssetForm] = useState(null);
  const [licenceForm, setLicenceForm] = useState(null);
  const [assigning, setAssigning] = useState(null);
  const [seating, setSeating] = useState(null);

  const nameOf = useCallback(
    (id) => {
      if (!id) return "—";
      const d = developers.find((x) => String(x.id) === String(id));
      return d?.name || d?.full_name || d?.email || "Someone";
    },
    [developers]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await authFetch(`/api/assets?view=${tab}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) throw new Error(json?.error || "Could not load this.");
      if (tab === "licences") setLicences(json.licences || []);
      else setAssets(json.assets || []);
    } catch (e) {
      setError(e?.message || "Could not load this.");
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    load();
  }, [load]);

  const stats = useMemo(() => {
    const assigned = assets.filter((a) => a.status === "assigned").length;
    const stock = assets.filter((a) => a.status === "in_stock").length;
    const over = licences.filter((l) => Number(l.over_by) > 0).length;
    return { assigned, stock, over };
  }, [assets, licences]);

  const move = async (asset, status, userId) => {
    setBusy(true);
    try {
      const res = await authFetch("/api/assets", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId: asset.id, status, userId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) throw new Error(json?.error || "That did not go through.");
      setAssets((prev) => prev.map((a) => (a.id === asset.id ? json.asset : a)));
      setAssigning(null);
    } catch (e) {
      showError(e?.message || "That did not go through.");
    } finally {
      setBusy(false);
    }
  };

  const submitAsset = async () => {
    if (!assetForm?.assetTag?.trim() || !assetForm?.name?.trim()) {
      showError("An asset needs a tag and a name.");
      return;
    }
    setBusy(true);
    try {
      const res = await authFetch("/api/assets?action=asset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(assetForm),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) throw new Error(json?.error || "Could not add it.");
      showSuccess("Added to the register.");
      setAssetForm(null);
      await load();
    } catch (e) {
      showError(e?.message || "Could not add it.");
    } finally {
      setBusy(false);
    }
  };

  const submitLicence = async () => {
    if (!licenceForm?.name?.trim()) {
      showError("Name the licence.");
      return;
    }
    setBusy(true);
    try {
      const res = await authFetch("/api/assets?action=licence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(licenceForm),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) throw new Error(json?.error || "Could not add it.");
      showSuccess("Licence added.");
      setLicenceForm(null);
      await load();
    } catch (e) {
      showError(e?.message || "Could not add it.");
    } finally {
      setBusy(false);
    }
  };

  const addSeat = async () => {
    if (!seating?.userId) return;
    setBusy(true);
    try {
      const res = await authFetch("/api/assets?action=seat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          licenceId: seating.licence.licence_id,
          userId: seating.userId,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) throw new Error(json?.error || "Could not assign it.");
      showSuccess("Seat assigned.");
      setSeating(null);
      await load();
    } catch (e) {
      showError(e?.message || "Could not assign it.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Assets"
        description="Equipment and software seats — what is owned, and who has it."
        actions={
          tab === "assets" ? (
            <Button onClick={() => setAssetForm({ assetTag: "", name: "", category: "laptop" })}>
              <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
              Add equipment
            </Button>
          ) : (
            <Button onClick={() => setLicenceForm({ name: "" })}>
              <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
              Add licence
            </Button>
          )
        }
      />

      <Tabs tabs={TABS} active={tab} onChange={setTab} aria-label="Asset views" />

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : error ? (
        <ErrorState title="Could not load" description={error} onRetry={load} />
      ) : tab === "assets" ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <StatCard title="Issued" value={stats.assigned} icon={Laptop} />
            <StatCard title="In stock" value={stats.stock} icon={Laptop} tone="muted" />
          </div>

          <Section>
            {assets.length === 0 ? (
              <EmptyState
                icon={Laptop}
                title="Nothing on the register"
                description="Add a laptop, a monitor, a phone — anything the company owns and lends out."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-muted-foreground">
                      <th className="py-2 pr-4 font-medium">Tag</th>
                      <th className="py-2 pr-4 font-medium">Item</th>
                      <th className="py-2 pr-4 font-medium">Status</th>
                      <th className="py-2 pr-4 font-medium">Held by</th>
                      <th className="py-2 pr-4 font-medium">Cost</th>
                      <th className="py-2 font-medium" />
                    </tr>
                  </thead>
                  <tbody>
                    {assets.map((a) => (
                      <tr key={a.id} className="border-b border-border/60">
                        <td className="py-2 pr-4 tabular-nums text-foreground">{a.asset_tag}</td>
                        <td className="py-2 pr-4">
                          {a.name}
                          <span className="ml-2 text-xs text-muted-foreground">{a.category}</span>
                        </td>
                        <td className="py-2 pr-4">
                          <Badge variant={STATUS_TONE[a.status] || "outline"}>{a.status}</Badge>
                        </td>
                        <td className="py-2 pr-4 text-muted-foreground">
                          {nameOf(a.assigned_user_id)}
                        </td>
                        {/* An unset cost is a dash, never 0 — see the note at
                            the top of this file. */}
                        <td className="py-2 pr-4 tabular-nums text-muted-foreground">
                          {money(a.purchase_cost)}
                        </td>
                        <td className="py-2 text-right">
                          {a.status === "assigned" ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              onClick={() => move(a, "in_stock", null)}
                            >
                              <Undo2 className="mr-1 h-4 w-4" aria-hidden="true" />
                              Return
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy || ["retired", "lost"].includes(a.status)}
                              onClick={() => setAssigning({ asset: a, userId: "" })}
                            >
                              Issue
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </>
      ) : (
        <>
          {stats.over > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
              <span>
                {stats.over} licence{stats.over === 1 ? " is" : "s are"} using more seats than the
                contract allows. Those seats were recorded rather than refused — the alternative is
                that they exist and nobody can see them.
              </span>
            </div>
          )}

          <Section>
            {licences.length === 0 ? (
              <EmptyState
                icon={KeyRound}
                title="No licences recorded"
                description="Add a subscription and track who holds a seat on it."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-muted-foreground">
                      <th className="py-2 pr-4 font-medium">Licence</th>
                      <th className="py-2 pr-4 font-medium">Vendor</th>
                      <th className="py-2 pr-4 font-medium">Seats</th>
                      <th className="py-2 pr-4 font-medium">Free</th>
                      <th className="py-2 pr-4 font-medium">Renews</th>
                      <th className="py-2 pr-4 font-medium">Cost</th>
                      <th className="py-2 font-medium" />
                    </tr>
                  </thead>
                  <tbody>
                    {licences.map((l) => {
                      const over = Number(l.over_by) > 0;
                      return (
                        <tr key={l.licence_id} className="border-b border-border/60">
                          <td className="py-2 pr-4 text-foreground">{l.name}</td>
                          <td className="py-2 pr-4 text-muted-foreground">{l.vendor || "—"}</td>
                          <td className="py-2 pr-4 tabular-nums">
                            <span className={over ? "text-destructive" : ""}>{l.seats_used}</span>
                            <span className="text-muted-foreground">
                              {" / "}
                              {l.seats_total ?? "not set"}
                            </span>
                            {over && (
                              <Badge variant="destructive" className="ml-2">
                                {l.over_by} over
                              </Badge>
                            )}
                          </td>
                          {/* NULL total means no free count — 0 would read as
                              "fully used", which is a different claim. */}
                          <td className="py-2 pr-4 tabular-nums text-muted-foreground">
                            {l.seats_free ?? "—"}
                          </td>
                          <td className="py-2 pr-4 text-muted-foreground">{l.renewal_date || "—"}</td>
                          <td className="py-2 pr-4 tabular-nums text-muted-foreground">
                            {money(l.annual_cost)}
                          </td>
                          <td className="py-2 text-right">
                            <Button size="sm" variant="outline" disabled={busy} onClick={() => setSeating({ licence: l, userId: "" })}>
                              Give a seat
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </>
      )}

      <Modal open={Boolean(assigning)} onClose={() => setAssigning(null)} title="Issue equipment">
        {assigning && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {assigning.asset.asset_tag} · {assigning.asset.name}
            </p>
            <Field label="Issue to">
              <select
                className={CONTROL}
                value={assigning.userId}
                onChange={(e) => setAssigning((a) => ({ ...a, userId: e.target.value }))}
              >
                <option value="">Choose…</option>
                {developers.map((d) => (
                  <option key={d.id} value={d.id}>{d.name || d.email}</option>
                ))}
              </select>
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setAssigning(null)} disabled={busy}>Cancel</Button>
              <Button
                onClick={() => move(assigning.asset, "assigned", assigning.userId)}
                disabled={busy || !assigning.userId}
              >
                Issue
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={Boolean(seating)} onClose={() => setSeating(null)} title="Give a seat">
        {seating && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {seating.licence.name}
              {Number(seating.licence.over_by) > 0 && (
                <span className="ml-2 text-destructive">
                  already {seating.licence.over_by} over the contract
                </span>
              )}
            </p>
            <Field label="Give the seat to">
              <select
                className={CONTROL}
                value={seating.userId}
                onChange={(e) => setSeating((x) => ({ ...x, userId: e.target.value }))}
              >
                <option value="">Choose…</option>
                {developers.map((d) => (
                  <option key={d.id} value={d.id}>{d.name || d.email}</option>
                ))}
              </select>
            </Field>
            {/* Said before the click, not after it fails. The seat is still
                allowed — see the note at the top — but nobody should be
                surprised by it. */}
            {seating.licence.seats_free === 0 && (
              <p className="text-sm text-muted-foreground">
                Every seat on this licence is taken. Assigning another will put it over the
                contract, which is recorded rather than refused.
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setSeating(null)} disabled={busy}>Cancel</Button>
              <Button onClick={addSeat} disabled={busy || !seating.userId}>Give seat</Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={Boolean(assetForm)} onClose={() => setAssetForm(null)} title="Add equipment">
        {assetForm && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Asset tag" hint="The label physically stuck on it.">
                <Input
                  value={assetForm.assetTag}
                  onChange={(e) => setAssetForm((f) => ({ ...f, assetTag: e.target.value }))}
                  placeholder="LT-014"
                />
              </Field>
              <Field label="Category">
                <select
                  className={CONTROL}
                  value={assetForm.category}
                  onChange={(e) => setAssetForm((f) => ({ ...f, category: e.target.value }))}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Name">
              <Input
                value={assetForm.name}
                onChange={(e) => setAssetForm((f) => ({ ...f, name: e.target.value }))}
                placeholder='MacBook Pro 14"'
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Serial number">
                <Input
                  value={assetForm.serialNumber || ""}
                  onChange={(e) => setAssetForm((f) => ({ ...f, serialNumber: e.target.value }))}
                />
              </Field>
              <Field label="Purchase cost" hint="Leave blank if unknown — blank is not zero.">
                <Input
                  type="number"
                  min={0}
                  value={assetForm.purchaseCost || ""}
                  onChange={(e) => setAssetForm((f) => ({ ...f, purchaseCost: e.target.value }))}
                />
              </Field>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setAssetForm(null)} disabled={busy}>Cancel</Button>
              <Button onClick={submitAsset} disabled={busy}>Add</Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={Boolean(licenceForm)} onClose={() => setLicenceForm(null)} title="Add a licence">
        {licenceForm && (
          <div className="space-y-4">
            <Field label="Name">
              <Input
                value={licenceForm.name}
                onChange={(e) => setLicenceForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Figma Organization"
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Vendor">
                <Input
                  value={licenceForm.vendor || ""}
                  onChange={(e) => setLicenceForm((f) => ({ ...f, vendor: e.target.value }))}
                />
              </Field>
              <Field label="Seats" hint="Blank means the contract size is not recorded.">
                <Input
                  type="number"
                  min={0}
                  value={licenceForm.seatsTotal || ""}
                  onChange={(e) => setLicenceForm((f) => ({ ...f, seatsTotal: e.target.value }))}
                />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Renewal date">
                <input
                  type="date"
                  className={CONTROL}
                  value={licenceForm.renewalDate || ""}
                  onChange={(e) => setLicenceForm((f) => ({ ...f, renewalDate: e.target.value }))}
                />
              </Field>
              <Field label="Annual cost" hint="Leave blank if unknown.">
                <Input
                  type="number"
                  min={0}
                  value={licenceForm.annualCost || ""}
                  onChange={(e) => setLicenceForm((f) => ({ ...f, annualCost: e.target.value }))}
                />
              </Field>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setLicenceForm(null)} disabled={busy}>Cancel</Button>
              <Button onClick={submitLicence} disabled={busy}>Add</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

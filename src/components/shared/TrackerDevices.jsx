"use client";
import { useCallback, useEffect, useState } from "react";
import { authFetch } from "@/utils/authFetch";
import { Button, Section } from "@/components/ui";

export default function TrackerDevices() {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(null);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await authFetch("/api/devices");
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Devices unavailable");
      setDevices(body.devices || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  async function revoke(id) {
    setBusy(id); setError("");
    try {
      const response = await authFetch("/api/devices", {
        method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not revoke device");
      await load();
    } catch (e) { setError(e.message); }
    finally { setBusy(null); }
  }
  return <Section title="Tracker devices" description="Revoke a device to stop further activity and screenshot uploads from that session.">
    {loading && <p role="status">Loading devices…</p>}
    {error && <p role="alert">{error}</p>}
    <Button variant="outline" onClick={load} disabled={loading}>Refresh devices</Button>
    {!loading && !error && devices.length === 0 && <p>No tracker devices registered.</p>}
    <ul className="mt-4 space-y-3">
      {devices.map(device => <li key={device.id} className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
        <div><p>{device.name}</p><p className="text-sm text-muted-foreground">{device.platform} · {device.revoked_at ? "Revoked" : Date.parse(device.expires_at) <= Date.now() ? "Expired" : "Active"}</p></div>
        {!device.revoked_at && <Button variant="outline" disabled={busy !== null} onClick={() => revoke(device.id)}>{busy === device.id ? "Revoking…" : "Revoke device"}</Button>}
      </li>)}
    </ul>
  </Section>;
}

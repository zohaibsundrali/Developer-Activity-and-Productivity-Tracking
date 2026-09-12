"use client";
import { useEffect, useRef, useState } from "react";
import { authFetch } from "@/utils/authFetch";
import { supabase } from "@/utils/supabaseClient";
import { createDevicePager, deviceIdentityChanged, deviceSessionFingerprint } from "@/utils/devicePagination";
import { Button, Section } from "@/components/ui";

export default function TrackerDevices() {
  const [page, setPage] = useState({ devices: [], loading: true, error: "", nextCursor: null });
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(null);
  const pager = useRef(null);
  const identityGeneration = useRef(0);
  useEffect(() => {
    const controller = createDevicePager(async (cursor, signal) => {
      const response = await authFetch(`/api/devices${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, { signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Devices unavailable");
      return body;
    }, setPage);
    pager.current = controller;
    let previousIdentity;
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      const identity = deviceSessionFingerprint(session);
      if (deviceIdentityChanged(event, previousIdentity, session)) {
        previousIdentity = identity;
        ++identityGeneration.current;
        controller.clear(); setBusy(null); setActionError("");
        if (session) void controller.load();
      }
    });
    void controller.load();
    return () => { ++identityGeneration.current; controller.dispose(); data?.subscription?.unsubscribe(); };
  }, []);
  async function revoke(id) {
    const own = identityGeneration.current;
    setBusy(id); setActionError("");
    try {
      const response = await authFetch("/api/devices", {
        method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }),
      });
      const body = await response.json();
      if (own !== identityGeneration.current) return;
      if (!response.ok) throw new Error(body.error || "Could not revoke device");
      await pager.current?.load();
    } catch (e) { if (own === identityGeneration.current) setActionError(e.message); }
    finally { if (own === identityGeneration.current) setBusy(null); }
  }
  const { devices, loading, error, nextCursor } = page;
  return <Section title="Tracker devices" description="Revoke a device to stop further activity and screenshot uploads from that session.">
    {loading && <p role="status">Loading devices…</p>}
    {(actionError || error) && <p role="alert">{actionError || error}</p>}
    <Button variant="outline" onClick={() => { setActionError(""); void pager.current?.load(); }} disabled={loading || busy !== null}>Refresh devices</Button>
    {!loading && !error && devices.length === 0 && <p>No tracker devices registered.</p>}
    <ul className="mt-4 space-y-3">
      {devices.map(device => <li key={device.id} className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
        <div><p>{device.name}</p><p className="text-sm text-muted-foreground">{device.platform} · {device.revoked_at ? "Revoked" : Date.parse(device.expires_at) <= Date.now() ? "Expired" : "Active"}</p></div>
        {!device.revoked_at && <Button variant="outline" disabled={busy !== null || loading} onClick={() => revoke(device.id)}>{busy === device.id ? "Revoking…" : "Revoke device"}</Button>}
      </li>)}
    </ul>
    {nextCursor && <Button variant="outline" disabled={loading || busy !== null} onClick={() => pager.current?.load(true)}>Load more devices</Button>}
  </Section>;
}

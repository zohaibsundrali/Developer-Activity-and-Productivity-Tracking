"use client";
const labels = { tracking: 'Tracking', paused: 'Paused', idle: 'Connected · timer stopped', disconnected: 'Disconnected', unavailable: 'No live heartbeat', unknown: 'Status unavailable', revoked: 'Device revoked', expired: 'Device expired' };

export default function MonitoringPresence({ presence }) {
  return <section className="mb-6 rounded-xl border border-border bg-card p-4" aria-label="Live device status">
    <div className="flex items-center justify-between gap-3">
      <div><h2 className="text-sm font-semibold">Live tracking status</h2><p className="text-xs text-muted-foreground">Current device connection, independent of the selected history dates. A heartbeat does not measure productivity.</p></div>
      <button type="button" onClick={presence.refresh} className="text-sm underline">Refresh status</button>
    </div>
    <p className={`mt-3 text-sm font-semibold ${presence.status === 'tracking' ? 'text-success' : 'text-foreground'}`} role="status">{presence.loading ? 'Checking live status…' : labels[presence.status]}</p>
    {presence.error && <p className="mt-1 text-sm text-destructive" role="alert">{presence.error}</p>}
    {!presence.loading && !presence.error && presence.status === 'unavailable' && <p className="mt-1 text-xs text-muted-foreground">No valid device has reported a live heartbeat. Use the updated desktop tracker and sign in.</p>}
    {presence.devices.length > 0 && <ul className="mt-3 space-y-1 text-sm">{presence.devices.map(device => <li key={device.id} className="flex flex-wrap justify-between gap-2"><span>{device.name} <span className="text-muted-foreground">({device.platform})</span></span><span>{labels[device.status]}</span></li>)}</ul>}
    {presence.truncated && <p className="mt-2 text-xs text-muted-foreground">Showing {presence.devices.length} of {presence.total} devices. Status reflects the devices shown.</p>}
    <p className="mt-2 text-xs text-muted-foreground">Desktop heartbeats arrive every 30 seconds. Devices become disconnected after 90 seconds without a heartbeat.</p>
  </section>;
}

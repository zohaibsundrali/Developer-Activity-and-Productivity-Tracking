'use client';
import { useEffect, useState } from 'react';
import { authFetch } from '@/utils/authFetch';
import { Card, CardHeader, CardTitle, CardContent, Button, Field, Input } from '@/components/ui';

export default function TrackingRetentionSettings({ orgId }) {
  const [loaded,setLoaded] = useState(null), [error,setError] = useState(''), [attempt,setAttempt] = useState(0);
  const [mode,setMode] = useState('disabled'), [days,setDays] = useState(''), [confirmed,setConfirmed] = useState(false), [busy,setBusy] = useState(false);
  const [saved,setSaved] = useState('');
  useEffect(() => {
    let active = true; setLoaded(null); setError(''); setConfirmed(false);
    (async () => {
      try {
        const response = await authFetch('/api/organizations/retention');
        const body = await response.json();
        if (!active) return;
        if (response.status === 403) { setLoaded({ hidden: true }); return; }
        if (!response.ok) throw new Error(body.error || 'Could not load tracking retention.');
        setLoaded(body);setMode(body.policy.mode);setDays(body.policy.days == null ? '' : String(body.policy.days));
      } catch (e) { if (active) setError(e.message || 'Could not load tracking retention.'); }
    })();
    return () => { active = false; };
  }, [orgId, attempt]);
  async function save() {
    if (!loaded || busy) return;
    setBusy(true);setError('');setSaved('');
    try {
      const response = await authFetch('/api/organizations/retention', { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, days: mode === 'custom' ? Number(days) : null, confirmPermanentDeletion: confirmed }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Could not save tracking retention.');
      setSaved(body.inFlight ? `Policy saved. ${body.inFlight} already-claimed file cleanup(s) may still finish.` : 'Policy saved. Scheduled cleanup will use this policy.');
      setAttempt(value => value + 1);
    } catch (e) { setError(e.message || 'Could not save tracking retention.'); }
    finally { setBusy(false); }
  }
  if (loaded?.hidden) return null;
  return <Card><CardHeader><CardTitle>Tracking data retention</CardTitle></CardHeader><CardContent className="space-y-4">
    <p className="text-sm text-muted-foreground">Permanently remove old raw activity records and verified private monitoring screenshots. Projects, submissions, financial records, HR records and audit logs are kept. Legacy or ambiguous screenshot files are retained for ownership review.</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {saved && <p role="status" className="text-sm">{saved}</p>}
    {!loaded ? <div>{!error && <p role="status">Loading retention policy…</p>}<Button type="button" variant="outline" onClick={() => setAttempt(value => value + 1)}>Retry loading</Button></div> : <>
      <Field label="Cleanup policy"><select aria-label="Cleanup policy" className="w-full rounded border border-input bg-background p-2" disabled={busy} value={mode} onChange={event => {setMode(event.target.value);setConfirmed(false);}}>
        <option value="disabled">Off — retain stored data</option><option value="custom">Keep a configured number of days</option><option value="plan">Use the plan tracking-history window</option>
      </select></Field>
      {mode === 'custom' && <Field label="Days to keep"><Input aria-label="Days to keep" type="number" min={1} max={36500} step={1} value={days} disabled={busy} onChange={event => {setDays(event.target.value);setConfirmed(false);}} /></Field>}
      {mode === 'plan' && <p className="text-sm">A downgrade can shorten the deletion window. An unlimited history plan does not delete data automatically.</p>}
      <p className="text-sm text-muted-foreground">Policy changes affect future cleanup claims. Already-claimed file removals and their recovery retries may finish. Upgrading later cannot restore permanently deleted history.</p>
      {mode !== 'disabled' && <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} />I understand that selected tracking data will be permanently deleted.</label>}
      <Button type="button" disabled={busy || (mode !== 'disabled' && !confirmed)} onClick={save}>{busy ? 'Saving…' : 'Save retention policy'}</Button>
      {loaded.policy.last_swept_at && <p className="text-sm">Last scan: {new Date(loaded.policy.last_swept_at).toLocaleString()}. Records deleted: {loaded.policy.last_summary?.deleted || 0}; records retained for review: {loaded.policy.last_summary?.skipped || 0}.</p>}
      <p className="text-sm">File cleanup: {loaded.files?.processing || 0} queued/in progress, {loaded.files?.failed || 0} awaiting retry, {loaded.files?.completed || 0} completed.</p>
    </>}
  </CardContent></Card>;
}

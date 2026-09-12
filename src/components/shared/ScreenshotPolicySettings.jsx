'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/utils/supabaseClient';
import { getOrgId } from '@/utils/orgContext';
import { Card, CardHeader, CardTitle, CardContent, Button, Field, Input } from '@/components/ui';

export function validScreenshotInterval(value) {
  return /^\d+$/.test(String(value)) && Number(value) >= 60 && Number(value) <= 3600;
}

function readPolicy(result, orgId) {
  if (result?.error) throw new Error('Screenshot policy could not be loaded or saved. Check your access and try again.');
  const data = result?.data;
  if (!data || data.organization_id !== orgId || typeof data.enabled !== 'boolean'
      || !Number.isInteger(data.interval_seconds) || !validScreenshotInterval(data.interval_seconds)
      || typeof data.can_manage !== 'boolean') throw new Error('Screenshot policy response is unavailable. Reload and try again.');
  return data;
}

export default function ScreenshotPolicySettings({ orgId, readOnly = true }) {
  const [loaded, setLoaded] = useState(null);
  const [enabled, setEnabled] = useState(false);
  const [interval, setInterval] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current;
    const organization = orgId || getOrgId();
    setLoaded(null); setError(''); setSaved(''); setBusy(false);
    async function load() {
      try {
        if (!organization) throw new Error('Select an organization to view screenshot policy.');
        const policy = readPolicy(await supabase.rpc('get_screenshot_policy'), organization);
        if (generation.current !== current) return;
        setLoaded(policy); setEnabled(policy.enabled); setInterval(String(policy.interval_seconds));
      } catch (e) { if (generation.current === current) setError(e.message); }
    }
    load();
    return () => { generation.current++; };
  }, [orgId, attempt]);
  const canEdit = !readOnly && loaded?.can_manage === true;
  const valid = validScreenshotInterval(interval);
  const dirty = loaded && (enabled !== loaded.enabled || Number(interval) !== loaded.interval_seconds);
  async function save() {
    if (!canEdit || busy || !dirty) return;
    if (!valid) { setError('Enter a whole number from 60 to 3600 seconds.'); return; }
    const current = generation.current;
    setBusy(true); setError(''); setSaved('');
    try {
      if (getOrgId() !== loaded.organization_id) throw new Error('Organization changed. Reload the policy before saving.');
      const policy = readPolicy(await supabase.rpc('set_screenshot_policy', {
        p_enabled: enabled, p_interval_seconds: Number(interval),
      }), loaded.organization_id);
      if (generation.current !== current) return;
      setLoaded(policy); setEnabled(policy.enabled); setInterval(String(policy.interval_seconds));
      setSaved('Screenshot policy saved. Connected trackers apply the policy when they next refresh it.');
    } catch (e) { if (generation.current === current) setError(e.message); }
    finally { if (generation.current === current) setBusy(false); }
  }
  return <Card><CardHeader><CardTitle>Screenshot policy</CardTitle></CardHeader><CardContent className="space-y-4">
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {saved && <p role="status" className="text-sm">{saved}</p>}
    {!loaded ? <>{!error && <p role="status">Loading screenshot policy…</p>}{error && <Button type="button" variant="outline" onClick={() => setAttempt(value => value + 1)}>Retry screenshot policy</Button>}</> : <>
      <p className="text-sm">Organization policy: screenshots {loaded.enabled ? 'enabled' : 'disabled'}. Capture interval: {loaded.interval_seconds} seconds.</p>
      <p className="text-sm text-muted-foreground">Your organization administrator sets this policy. In the desktop tracker you can see screenshot status and pause or resume tracking. Pausing stops new screenshots while tracking is paused.</p>
      {canEdit && <>
        <label className="flex items-center gap-2 text-sm"><input aria-label="Enable screenshots" type="checkbox" checked={enabled} disabled={busy} onChange={event => { setEnabled(event.target.checked); setSaved(''); }} />Enable screenshots</label>
        <Field label="Capture interval (seconds)"><Input aria-label="Screenshot interval in seconds" type="number" min={60} max={3600} step={1} value={interval} disabled={busy} onChange={event => { setInterval(event.target.value); setSaved(''); }} /></Field>
        {!valid && <p role="alert" className="text-sm text-destructive">Enter a whole number from 60 to 3600 seconds.</p>}
        <Button type="button" disabled={busy || !dirty || !valid} onClick={save}>{busy ? 'Saving screenshot policy…' : 'Save screenshot policy'}</Button>
      </>}
    </>}
  </CardContent></Card>;
}

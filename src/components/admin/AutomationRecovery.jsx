'use client';
import { useEffect, useRef, useState } from 'react';
import { automationIdentity, createAutomationRecovery } from '@/utils/automationRecoveryState';
import { supabase } from '@/utils/supabaseClient';
import { getOrgContext } from '@/utils/orgContext';
import { processPendingAutomations } from '@/utils/automationDispatch';
import { Button, Section } from '@/components/ui';

export default function AutomationRecovery() {
  const identity = automationIdentity(getOrgContext());
  const controller = useRef(null);
  const [state, setState] = useState({ jobs: [], loading: true, busy: false, error: '', loaded: false });
  const [stateIdentity, setStateIdentity] = useState(identity);
  useEffect(() => {
    setStateIdentity(identity);
    const recovery = createAutomationRecovery({
      getContext: getOrgContext,
      fetchJobs: ctx => supabase.from('automation_jobs')
        .select('id,event,status,next_action,last_error,created_at')
        .eq('organization_id', ctx.organizationId).eq('actor_id', ctx.userId).eq('actor_type', ctx.userType)
        .order('created_at', { ascending: false }).limit(20),
      process: processPendingAutomations,
      publish: setState,
    });
    controller.current = recovery;
    recovery.load();
    return () => { recovery.dispose(); controller.current = null; };
  }, [identity]);
  const { jobs, error, busy, loading, loaded } = stateIdentity === identity ? state
    : { jobs: [], error: '', busy: false, loading: true, loaded: false };
  return <Section title="Your automation deliveries" description="Queued actions resume while you are signed in. Each action uses your current permissions."
    actions={<div className="flex gap-2">
      <Button variant="outline" onClick={() => controller.current?.load()} disabled={busy || loading}>Refresh history</Button>
      <Button variant="outline" onClick={() => controller.current?.retry()} disabled={busy || loading || !identity}>{busy ? 'Processing…' : 'Retry failed actions'}</Button>
    </div>}>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {loading && <p role="status" className="text-sm text-muted-foreground">Loading automation deliveries…</p>}
    {loaded && jobs.length === 0 ? <p className="text-sm text-muted-foreground">No automation deliveries recorded for your actions yet.</p> :
      <ul className="space-y-2">{jobs.map(job => <li key={job.id} className="rounded border border-border p-3 text-sm">
        <span className="font-medium">{String(job.event || '').replaceAll('_', ' ')} · {String(job.status || '').replaceAll('_', ' ')}</span>
        {job.last_error && <p className="mt-1 text-muted-foreground">{job.last_error}</p>}
        {job.status === 'delivery_unknown' && <p className="mt-1 text-muted-foreground">Check the email provider or email log before sending this message again. Automatic retries are paused to prevent duplicate email.</p>}
      </li>)}</ul>}
  </Section>;
}

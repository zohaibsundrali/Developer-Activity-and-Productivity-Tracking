'use client';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getOrgContext } from '@/utils/orgContext';
import { reportIdentity } from '@/utils/reportViewState';
import { allowed } from '@/utils/permissions';
import { supabase } from '@/utils/supabaseClient';
import { authFetch } from '@/utils/authFetch';
import { downloadReportBlob } from '@/utils/reportExport';
import { validExportRange } from '@/utils/approvedTimeExport';
import { Button, PageHeader, ErrorState } from '@/components/ui';
const monday = () => { const date = new Date(); date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7); return date.toISOString().slice(0, 10); };
export default function PayrollPreparation() {
  const { authStatus } = useAuth();
  const identity = reportIdentity(getOrgContext());
  const [from, setFrom] = useState(monday), [to, setTo] = useState(monday);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
  const generation = useRef(0), pending = useRef(false), abort = useRef(null);
  const binding = `${authStatus}:${identity}:${from}:${to}`;
  const live = useRef(binding); live.current = binding;
  useEffect(() => {
    const versions = generation, requests = abort;
    const invalidate = () => { ++versions.current; requests.current?.abort(); pending.current = false; setBusy(false); setError(''); setMessage(''); };
    invalidate();
    const { data } = supabase.auth.onAuthStateChange(invalidate);
    return () => { ++versions.current; requests.current?.abort(); data?.subscription?.unsubscribe(); };
  }, [identity, from, to, authStatus]);
  async function download(event) {
    event.preventDefault();
    if (pending.current || authStatus !== 'authenticated' || !allowed('timesheet.view_all')) return;
    if (!validExportRange(from, to)) { setError('Choose Monday week-start dates covering up to 13 weeks.'); return; }
    const captured = binding, ticket = ++generation.current;
    const current = () => ticket === generation.current && captured === live.current && reportIdentity(getOrgContext()) === identity && allowed('timesheet.view_all');
    const controller = new AbortController(); abort.current = controller;
    const timer = setTimeout(() => controller.abort(), 30000);
    pending.current = true; setBusy(true); setError(''); setMessage('');
    try {
      const response = await authFetch(`/api/payroll/export?${new URLSearchParams({ from, to })}`, { signal: controller.signal });
      if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || 'Export could not be completed.'); }
      const fingerprint = response.headers.get('X-Export-Fingerprint'), count = response.headers.get('X-Export-Count');
      if (!response.headers.get('Content-Type')?.startsWith('text/csv') || !/^[a-f0-9]{64}$/.test(fingerprint || '') || !/^[1-9]\d{0,4}$/.test(count || '') || Number(count) > 10000) throw new Error('Export receipt could not be verified. Retry the export.');
      const blob = await response.blob();
      if (!current()) return;
      downloadReportBlob(blob, `approved-time_${from}_${to}_${fingerprint.slice(0, 12)}.csv`);
      setMessage(`Exported ${count} approved staff-week records. Fingerprint: ${fingerprint}`);
    } catch (e) { if (current()) setError(e.name === 'AbortError' ? 'Export timed out. Retry; unchanged source data keeps the same fingerprint.' : e.message); }
    finally { clearTimeout(timer); if (current()) { pending.current = false; setBusy(false); } }
  }
  if (authStatus !== 'authenticated' || !allowed('timesheet.view_all')) return <ErrorState title="Payroll preparation access is not available" description="This view requires permission to see organization timesheets." />;
  return <div className="space-y-6">
    <PageHeader title="Payroll preparation" description="Export approved work time for payroll review." />
    <p className="text-sm">Select the first and last Monday of the weeks to include. Each row contains the approved seconds, employee reference and source approval. Only approved weeks are included.</p>
    <form onSubmit={download} className="flex flex-wrap items-end gap-4 rounded-xl border border-border bg-card p-5">
      <label className="text-sm">First week (Monday, UTC)<input aria-label="Payroll first week" type="date" required value={from} disabled={busy} onChange={e => setFrom(e.target.value)} className="block rounded-lg border border-input bg-background px-3 py-2" /></label>
      <label className="text-sm">Last week (Monday, UTC)<input aria-label="Payroll last week" type="date" required value={to} disabled={busy} onChange={e => setTo(e.target.value)} className="block rounded-lg border border-input bg-background px-3 py-2" /></label>
      <Button type="submit" disabled={busy}>{busy ? 'Preparing export…' : 'Download approved-time CSV'}</Button>
    </form>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {message && <p role="status" className="break-all text-sm">{message}</p>}
    <div className="space-y-2 rounded-xl border border-border p-5 text-sm">
      <p>Apply your agreed pay rates, overtime rules and deductions in your payroll system. This export contains hours; it does not calculate wages, send payments or mark anyone as paid.</p>
      <p>Use the export fingerprint to recognize an unchanged download. When a week is reopened and approved again, reconcile its timesheet ID and updated timestamp against earlier imports before paying it.</p>
      <p>Approved seconds are exact. The hours column is rounded for convenience. Reopened, submitted, rejected and draft weeks are excluded.</p>
    </div>
  </div>;
}

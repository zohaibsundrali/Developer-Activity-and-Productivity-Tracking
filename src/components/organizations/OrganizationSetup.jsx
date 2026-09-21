'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2 } from 'lucide-react';
import OrganizationsShell from './OrganizationsShell';
import { Field, Input } from '@/components/ui';
import { AUTH_INPUT } from '@/components/auth/AuthParts';
import { authFetch } from '@/utils/authFetch';
import { openWorkspace } from '@/utils/openWorkspace';
import { showError } from '@/utils/alerts';

const button = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60';
const select = 'registration-select h-11 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
export default function OrganizationSetup() {
  const router = useRouter();
  const [identity, setIdentity] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(null);
  const [accepted, setAccepted] = useState(false);
  const [details, setDetails] = useState({ company: '', industry: '', companySize: '', country: '', timezone: 'UTC' });
  const requestId = useRef(null);
  useEffect(() => {
    let live = true;
    requestId.current = crypto.randomUUID();
    setDetails(value => ({ ...value, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' }));
    async function load() {
      try {
        const response = await authFetch('/api/organizations', { cache: 'no-store' });
        if (response.status === 401) { router.replace('/login'); return; }
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        if (live) setIdentity(result);
      } catch (err) { if (live) setError(err.message || 'Workspace setup could not be loaded.'); }
      finally { if (live) setLoading(false); }
    }
    load(); return () => { live = false; };
  }, [router]);
  const update = key => event => setDetails(value => ({ ...value, [key]: event.target.value }));
  const submit = async event => {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try {
      let workspace = created;
      if (!workspace) {
        const response = await authFetch('/api/organizations', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...details, requestId: requestId.current, termsAccepted: accepted }) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Organization could not be created.');
        workspace = result; setCreated(result);
      }
      await openWorkspace(workspace);
    } catch (err) { setError(err.message); showError(created ? 'Unable to open workspace' : 'Workspace setup', err.message); }
    finally { setBusy(false); }
  };
  return <OrganizationsShell email={identity?.email}>
    <Link href="/organizations" className="mb-8 inline-flex min-h-10 items-center gap-2 rounded-lg text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><ArrowLeft size={16} aria-hidden="true" />All organizations</Link>
    <div className="grid items-start gap-8 lg:grid-cols-[0.85fr_1.15fr] lg:gap-14">
      <aside className="rounded-2xl border border-border bg-muted/30 p-6 lg:sticky lg:top-8 lg:p-10">
      <h1 className="font-display text-3xl font-semibold tracking-tight outline-none">{created ? 'Your organization is ready' : 'Create your organization'}</h1>
      <p className="mt-3 mb-8 text-sm leading-relaxed text-muted-foreground">{created ? 'Open your workspace to get started. You can also find it in your organizations.' : 'Set up a new workspace using your existing Verisade account.'}</p>
      <p className="text-sm leading-relaxed text-muted-foreground">Your account plan applies here too. Usage is combined across your organizations.</p>
      </aside>
      <section aria-label="Organization details" className="min-w-0">
      {loading ? <p role="status" className="flex items-center gap-2 text-sm"><Loader2 size={17} className="animate-spin" />Loading setup…</p> : !identity ? <div role="alert" className="rounded-xl border border-border bg-card p-5">{error}<button className={`${button} ml-3`} onClick={() => window.location.reload()}>Try again</button></div>
        : !identity.emailVerified ? <p role="alert">Verify your account email before creating an organization.</p>
        : <form onSubmit={submit} className="space-y-6">
          {!created && <div className="rounded-2xl border border-border bg-card p-5 shadow-card sm:p-8">
            <p className="mb-6 break-words rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">Signed in as <span className="font-medium text-foreground">{identity.email}</span></p>
            <fieldset disabled={busy} className="space-y-5">
              <Field label="Company / organization" htmlFor="workspace-name" hint="This becomes the name of your workspace." required><Input id="workspace-name" value={details.company} onChange={update('company')} placeholder="Your organization name" required maxLength={200} className={AUTH_INPUT} autoComplete="organization" /></Field>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Industry" htmlFor="workspace-industry" hint="Optional"><select id="workspace-industry" value={details.industry} onChange={update('industry')} className={select}><option value="">Select industry</option>{['Technology','Finance','Healthcare','Education','Retail','Manufacturing','Consulting','Marketing','Other'].map(v => <option key={v}>{v}</option>)}</select></Field>
                <Field label="Company size" htmlFor="workspace-size" hint="Optional"><select id="workspace-size" value={details.companySize} onChange={update('companySize')} className={select}><option value="">Select size</option>{['1-10','11-50','51-200','201-500','500+'].map(v => <option key={v} value={v}>{v} employees</option>)}</select></Field>
              </div>
              <Field label="Country" htmlFor="workspace-country" hint="Optional"><Input id="workspace-country" value={details.country} onChange={update('country')} maxLength={100} className={AUTH_INPUT} autoComplete="country-name" /></Field>
              <label className="flex items-start gap-3 text-sm leading-relaxed"><input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} required className="mt-1 h-4 w-4 shrink-0 accent-primary" /><span>I agree to the <Link href="/terms" target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-4">Terms of Service</Link> for this organization.</span></label>
            </fieldset>
          </div>}
          {error && <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-foreground">{error}</p>}
          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border pt-5">
            <button disabled={busy} className={button}>{busy && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}{busy ? 'Setting up workspace…' : created ? 'Open workspace' : 'Create organization'}</button>
          </div>
        </form>}
      </section>
    </div>
  </OrganizationsShell>;
}

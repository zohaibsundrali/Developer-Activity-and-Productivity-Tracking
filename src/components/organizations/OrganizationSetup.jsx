'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Check, Loader2 } from 'lucide-react';
import OrganizationsShell from './OrganizationsShell';
import { PlanChoice } from '@/components/billing/PlanChoice';
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
  const [plans, setPlans] = useState([]);
  const [plan, setPlan] = useState('free');
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(null);
  const [accepted, setAccepted] = useState(false);
  const [details, setDetails] = useState({ company: '', industry: '', companySize: '', country: '', timezone: 'UTC' });
  const requestId = useRef(null);
  const heading = useRef(null);
  useEffect(() => {
    let live = true;
    requestId.current = crypto.randomUUID();
    setDetails(value => ({ ...value, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' }));
    async function load() {
      try {
        const [response, catalogue] = await Promise.all([authFetch('/api/organizations', { cache: 'no-store' }), fetch('/api/billing/plans')]);
        if (response.status === 401) { router.replace('/login'); return; }
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        const priceData = catalogue.ok ? await catalogue.json() : { plans: [] };
        if (live) { setIdentity(result); setPlans((priceData.plans || []).filter(p => p.code === 'free' || Number(p.trial_days) > 0)); }
      } catch (err) { if (live) setError(err.message || 'Workspace setup could not be loaded.'); }
      finally { if (live) setLoading(false); }
    }
    load(); return () => { live = false; };
  }, [router]);
  useEffect(() => { if (step === 2) heading.current?.focus(); }, [step]);
  const update = key => event => setDetails(value => ({ ...value, [key]: event.target.value }));
  const submit = async event => {
    event.preventDefault();
    if (busy) return;
    if (step === 1) { setStep(2); return; }
    setBusy(true); setError('');
    try {
      let workspace = created;
      if (!workspace) {
        const response = await authFetch('/api/organizations', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...details, requestId: requestId.current, planCode: plan, termsAccepted: accepted }) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Organization could not be created.');
        workspace = result; setCreated(result);
      }
      await openWorkspace(workspace);
    } catch (err) { setError(err.message); showError(created ? 'Unable to open workspace' : 'Workspace setup', err.message); }
    finally { setBusy(false); }
  };
  const paid = plan !== 'free';
  return <OrganizationsShell email={identity?.email}>
    <Link href="/organizations" className="mb-8 inline-flex min-h-10 items-center gap-2 rounded-lg text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><ArrowLeft size={16} aria-hidden="true" />All organizations</Link>
    <div className="mx-auto max-w-4xl">
      <ol aria-label="Organization setup progress" className="mb-7 flex gap-6 text-xs font-medium text-muted-foreground">{['Organization details', 'Choose a plan'].map((label, i) => <li key={label} aria-current={step === i + 1 ? 'step' : undefined} className={`flex items-center gap-2 ${step === i + 1 ? 'text-foreground' : ''}`}><span className={`flex h-6 w-6 items-center justify-center rounded-full ${step >= i + 1 ? 'bg-primary text-primary-foreground' : 'border border-border'}`}>{step > i + 1 ? <Check size={13} aria-hidden="true" /> : i + 1}</span>{label}</li>)}</ol>
      <h1 ref={heading} tabIndex={-1} className="font-display text-3xl font-semibold tracking-tight outline-none">{created ? 'Your organization is ready' : step === 1 ? 'Create your organization' : 'A plan for the way you work'}</h1>
      <p className="mt-3 mb-8 text-sm leading-relaxed text-muted-foreground">{created ? 'Open your workspace to get started. You can also find it in your organizations.' : step === 1 ? 'Set up a new workspace using your existing Verisade account.' : 'Start on Free or try a plan. Manage your subscription from Billing at any time.'}</p>
      {loading ? <p role="status" className="flex items-center gap-2 text-sm"><Loader2 size={17} className="animate-spin" />Loading setup…</p> : !identity ? <div role="alert" className="rounded-xl border border-border bg-card p-5">{error}<button className={`${button} ml-3`} onClick={() => window.location.reload()}>Try again</button></div>
        : !identity.emailVerified ? <p role="alert">Verify your account email before creating an organization.</p>
        : <form onSubmit={submit} className="space-y-6">
          {step === 1 ? <div className="rounded-2xl border border-border bg-card p-5 shadow-card sm:p-8">
            <p className="mb-6 break-words rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">Signed in as <span className="font-medium text-foreground">{identity.email}</span></p>
            <div className="space-y-5">
              <Field label="Company / organization" htmlFor="workspace-name" hint="This becomes the name of your workspace." required><Input id="workspace-name" value={details.company} onChange={update('company')} placeholder="Your organization name" required maxLength={200} className={AUTH_INPUT} autoComplete="organization" /></Field>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Industry" htmlFor="workspace-industry" hint="Optional"><select id="workspace-industry" value={details.industry} onChange={update('industry')} className={select}><option value="">Select industry</option>{['Technology','Finance','Healthcare','Education','Retail','Manufacturing','Consulting','Marketing','Other'].map(v => <option key={v}>{v}</option>)}</select></Field>
                <Field label="Company size" htmlFor="workspace-size" hint="Optional"><select id="workspace-size" value={details.companySize} onChange={update('companySize')} className={select}><option value="">Select size</option>{['1-10','11-50','51-200','201-500','500+'].map(v => <option key={v} value={v}>{v} employees</option>)}</select></Field>
              </div>
              <Field label="Country" htmlFor="workspace-country" hint="Optional"><Input id="workspace-country" value={details.country} onChange={update('country')} maxLength={100} className={AUTH_INPUT} autoComplete="country-name" /></Field>
              <label className="flex items-start gap-3 text-sm leading-relaxed"><input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} required className="mt-1 h-4 w-4 shrink-0 accent-primary" /><span>I agree to the <Link href="/terms" target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-4">Terms of Service</Link> for this organization.</span></label>
            </div>
          </div> : !created && <PlanChoice plans={plans} value={plan} onChange={setPlan} disabled={busy} />}
          {error && <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-foreground">{error}</p>}
          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border pt-5">
            {step === 2 && !created && <button type="button" disabled={busy} onClick={() => setStep(1)} className="min-h-11 rounded-xl px-5 text-sm text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Back to details</button>}
            <button disabled={busy} className={button}>{busy && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}{busy ? 'Setting up workspace…' : created ? 'Open workspace' : step === 1 ? 'Continue to plans' : paid ? 'Start free trial' : 'Create workspace on Free'}</button>
          </div>
        </form>}
    </div>
  </OrganizationsShell>;
}

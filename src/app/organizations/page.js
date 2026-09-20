'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowUpRight, Building2, FolderKanban, Loader2, Plus, Users } from 'lucide-react';
import { authFetch } from '@/utils/authFetch';
import { openWorkspace } from '@/utils/openWorkspace';
import { showError } from '@/utils/alerts';
import OrganizationsShell from '@/components/organizations/OrganizationsShell';

const action = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-card transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';
export default function OrganizationsPage() {
  const router = useRouter();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(null);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await authFetch('/api/organizations', { cache: 'no-store' });
      if (response.status === 401) { router.replace('/login'); return; }
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setData(result);
    } catch (err) { setError(err.message || 'Organizations could not be loaded.'); }
    finally { setLoading(false); }
  }, [router]);
  useEffect(() => { load(); }, [load]);
  const open = async org => {
    if (opening) return;
    setOpening(`${org.id}:${org.userType}:${org.profileId}`);
    try { await openWorkspace({ organizationId: org.id, profileId: org.profileId, userType: org.userType }); }
    catch (err) { showError('Unable to open workspace', err.message); setOpening(null); }
  };
  return <OrganizationsShell email={data?.email}>
    <div className="mb-9 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
      <div><p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-primary">Your workspaces</p>
        <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">Organizations</h1>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">Choose a workspace to manage your team, projects and daily work.</p>
      </div>
      <Link className={action} href="/admin/registration"><Plus size={18} aria-hidden="true" />New Organization</Link>
    </div>
    {loading ? <div role="status" className="flex items-center gap-3 rounded-2xl border border-border bg-card p-8 text-sm text-muted-foreground"><Loader2 size={18} className="animate-spin motion-reduce:animate-none" />Loading your organizations…</div>
      : error ? <div role="alert" className="rounded-2xl border border-border bg-card p-6"><p>{error}</p><button onClick={load} className={`${action} mt-4`}>Try again</button></div>
      : <>
        <p className="mb-4 text-xs text-muted-foreground">{data?.organizations.length || 0} accessible {(data?.organizations.length || 0) === 1 ? 'workspace' : 'workspaces'}</p>
        <div className="grid items-stretch gap-5 md:grid-cols-2 lg:grid-cols-3">
          {(data?.organizations || []).map(org => {
            const key = `${org.id}:${org.userType}:${org.profileId}`;
            return <article key={key} className="relative flex min-w-0 flex-col rounded-2xl border border-border bg-card p-6 shadow-card transition-colors hover:border-primary/40">
              <div className="mb-5 flex items-center justify-between gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary"><Building2 size={21} aria-hidden="true" /></span><span className="rounded-full border border-border bg-muted/50 px-3 py-1 text-xs font-medium capitalize">{org.role.replace(/_/g, ' ')}</span></div>
              <h2 className="break-words font-display text-xl font-semibold tracking-tight">{org.name}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{[org.industry, org.country].filter(Boolean).join(' · ') || 'Team workspace'}</p>
              <dl className="my-6 grid grid-cols-2 gap-4 border-y border-border py-4">
                {org.projects != null || org.members != null ? <>{org.projects != null && <div><dt className="flex items-center gap-1.5 text-xs text-muted-foreground"><FolderKanban size={14} aria-hidden="true" />Projects</dt><dd className="mt-2 font-display text-2xl font-semibold tabular-nums">{org.projects}</dd></div>}{org.members != null && <div><dt className="flex items-center gap-1.5 text-xs text-muted-foreground"><Users size={14} aria-hidden="true" />Members</dt><dd className="mt-2 font-display text-2xl font-semibold tabular-nums">{org.members}</dd></div>}</>
                : <div className="col-span-2"><dt className="text-xs text-muted-foreground">Timezone</dt><dd className="mt-2 text-sm font-medium">{org.timezone || 'UTC'}</dd></div>}
              </dl>
              <button data-organization-id={org.id} onClick={() => open(org)} disabled={!!opening} aria-label={`Open ${org.name} workspace`} className="after:absolute after:inset-0 after:content-[''] mt-auto inline-flex min-h-11 w-full items-center justify-between gap-2 rounded-xl bg-muted px-4 text-sm font-semibold transition-colors hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-60">
                {opening === key ? 'Opening workspace…' : 'Open workspace'}{opening === key ? <Loader2 size={17} className="animate-spin" aria-hidden="true" /> : <ArrowUpRight size={17} aria-hidden="true" />}
              </button>
            </article>;
          })}
          <Link href="/admin/registration" className="group flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/30 p-6 text-center transition-colors hover:border-primary/50 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span className="mb-4 rounded-full border border-border bg-card p-3 text-primary"><Plus size={24} aria-hidden="true" /></span><span className="font-display text-lg font-semibold">New Organization</span><span className="mt-2 max-w-52 text-sm leading-relaxed text-muted-foreground">Create a workspace connected to your existing account.</span>
          </Link>
        </div>
      </>}
  </OrganizationsShell>;
}

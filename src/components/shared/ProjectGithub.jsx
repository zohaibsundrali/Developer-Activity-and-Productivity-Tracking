'use client';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { authFetch } from '@/utils/authFetch';
import { getOrgContext } from '@/utils/orgContext';
import { reportIdentity } from '@/utils/reportViewState';
import { supabase } from '@/utils/supabaseClient';
import { validGithubLink, githubUrl } from '@/utils/githubRepository';
import { Button } from '@/components/ui';
import GithubIssueImport from '@/components/shared/GithubIssueImport';
export default function ProjectGithub({ projectId }) {
  const { authStatus } = useAuth();
  const identity = reportIdentity(getOrgContext()), org = getOrgContext()?.organizationId;
  const [context, setContext] = useState(null), [items, setItems] = useState([]), [nextPage, setNextPage] = useState(null);
  const [nextAfter, setNextAfter] = useState(null);
  const [repository, setRepository] = useState(''), [token, setToken] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [importNumber, setImportNumber] = useState(null);
  const binding = `${authStatus}:${identity}:${projectId}:${refresh}`;
  const live = useRef(binding); live.current = binding;
  const generation = useRef(0), abort = useRef(null), pending = useRef(false);
  const visible = context?.binding === binding ? context.data : null;
  const current = (captured, ticket) => live.current === captured && generation.current === ticket && reportIdentity(getOrgContext()) === identity;
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange(() => { ++generation.current; abort.current?.abort(); setToken(''); setImportNumber(null); setContext(null); setItems([]); setRefresh(value => value + 1); });
    return () => data?.subscription?.unsubscribe();
  }, []);
  useEffect(() => {
    const versions = generation, requests = abort;
    ++versions.current; requests.current?.abort(); pending.current = false;
    setImportNumber(null); setContext(null); setItems([]); setNextPage(null); setNextAfter(null); setToken(''); setRepository(''); setError(''); setMessage(''); setBusy(false);
    if (authStatus === 'authenticated' && projectId) void run();
    return () => { ++versions.current; requests.current?.abort(); };
    // Each request captures this render's identity; auth callbacks invalidate it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [binding, identity, projectId, authStatus]);
  async function run(action = null, page = 1, after = null) {
    if (pending.current || authStatus !== 'authenticated') return;
    const captured = binding, ticket = ++generation.current, controller = new AbortController();
    abort.current = controller; pending.current = true; setBusy(true); setError(''); setMessage('');
    const timer = setTimeout(() => controller.abort(), 35000);
    try {
      const response = await authFetch(`/api/projects/${projectId}/github`, action ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ action, version: visible?.link?.version ?? 0, repository, page, after, githubToken: token }) } : { signal: controller.signal });
      const json = await response.json().catch(() => ({}));
      if (!current(captured, ticket)) return;
      if (!response.ok || !json.success) throw new Error(json.error || 'The GitHub request could not be confirmed.');
      if (json.project_id !== projectId || json.organization_id !== org || typeof json.can_manage !== 'boolean' || (json.link !== null && !validGithubLink(json.link, org, projectId))) throw new Error('The repository link could not be verified.');
      if (action === 'activity') {
        if (!Array.isArray(json.items) || json.page !== page || (json.nextAfter !== null && (typeof json.nextAfter !== 'string' || !/^[A-Za-z0-9_+/=-]{1,1024}$/.test(json.nextAfter))) || (json.nextPage !== null && json.nextPage !== page + 1)) throw new Error('Activity pagination changed. Refresh the list.');
        const rows = page === 1 ? json.items : [...items, ...json.items];
        if (new Set(rows.map(row => row.number)).size !== rows.length) throw new Error('GitHub activity changed between pages. Refresh the activity list.');
        setItems(rows); setNextPage(json.nextPage); setNextAfter(json.nextAfter);
        if (!rows.length) setMessage('No issues or pull requests found.');
      } else { setImportNumber(null); setItems([]); setNextPage(null); setNextAfter(null); if (action) setMessage(action === 'unlink' ? 'Repository disconnected.' : 'Repository linked. Load its activity below.'); }
      setContext({ binding, data: json });
      if (json.link?.repository_id) setRepository(`${json.link.owner}/${json.link.repository}`);
    } catch (e) { if (current(captured, ticket)) { setError(e.name === 'AbortError' ? 'Request timed out. Refresh the integration before retrying a link change.' : e.message); if (action === 'activity') { setItems([]); setNextPage(null); setNextAfter(null); } } }
    finally { clearTimeout(timer); if (current(captured, ticket)) { pending.current = false; setBusy(false); } }
  }
  if (authStatus !== 'authenticated') return null;
  return <section className="space-y-4 rounded-xl border border-border bg-card p-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">GitHub repository</h2><Button type="button" variant="outline" disabled={busy} onClick={() => setRefresh(value => value + 1)}>Refresh integration</Button></div>
    <p className="text-sm">View the linked repository’s issues and pull requests alongside this project.</p>
    {visible?.link?.repository_id && <a className="text-sm underline" href={githubUrl(visible.link.owner, visible.link.repository)} target="_blank" rel="noopener noreferrer">{visible.link.owner}/{visible.link.repository}</a>}
    {visible && <label className="block text-sm">GitHub read token (optional for public repositories)<input aria-label="GitHub read token" type="password" autoComplete="off" value={token} maxLength={512} disabled={busy} onChange={event => setToken(event.target.value)} className="mt-1 block w-full rounded-lg border border-input bg-background px-3 py-2" /><span className="mt-1 block text-xs text-muted-foreground">For a private repository, use your own token with read access to Issues and Pull requests. It is kept only in this view’s memory and sent to GitHub through our server for these requests.</span></label>}
    {visible?.can_manage && <div className="flex flex-wrap items-end gap-3"><label className="flex-1 text-sm">Repository<input aria-label="GitHub repository" placeholder="owner/repository" value={repository} maxLength={140} disabled={busy} onChange={event => setRepository(event.target.value)} className="mt-1 block w-full rounded-lg border border-input bg-background px-3 py-2" /></label><Button type="button" disabled={busy} onClick={() => run('link')}>Link repository</Button>{visible.link?.repository_id && <Button type="button" variant="outline" disabled={busy} onClick={() => run('unlink')}>Disconnect</Button>}</div>}
    {visible?.link?.repository_id && <Button type="button" variant="outline" disabled={busy} onClick={() => run('activity')}>Refresh GitHub activity</Button>}
    {busy && <p role="status" className="text-sm">Loading GitHub integration…</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {message && <p role="status" className="text-sm">{message}</p>}
    {visible && <ul className="space-y-2">{items.map(row => <li key={row.number} className="rounded-lg border border-border p-3"><a href={githubUrl(visible.link.owner, visible.link.repository, row.number, row.kind)} target="_blank" rel="noopener noreferrer" className="text-sm underline">#{row.number} {row.title}</a><p className="mt-1 text-xs text-muted-foreground">{row.kind === 'pull' ? 'Pull request' : 'Issue'} · {row.state} · Updated {row.updated_at.replace('T', ' ').replace('.000Z', ' UTC')}</p>{visible.can_import&&row.kind==='issue'&&<Button type="button" variant="outline" disabled={busy} onClick={()=>setImportNumber(row.number)}>Import issue as task</Button>}</li>)}</ul>}
    {visible?.can_import&&visible.link?.repository_id&&importNumber&&<GithubIssueImport key={`${projectId}:${visible.link.version}:${importNumber}`} projectId={projectId} link={visible.link} number={importNumber} token={token} onClose={()=>setImportNumber(null)}/> }
    {visible && nextPage && <Button type="button" variant="outline" disabled={busy} onClick={() => run('activity', nextPage, nextAfter)}>More GitHub activity</Button>}
    <p className="text-xs text-muted-foreground">GitHub status is shown as reported by GitHub. Import an issue explicitly to create a pending local task. Existing task status is never synchronized automatically and nothing is posted to GitHub.</p>
  </section>;
}

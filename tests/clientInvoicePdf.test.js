import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ auth: null, rows: [], error: null, signError: null, signedUrl: 'https://storage.example/private?token=secret', filters: [], signed: [], dbCalls: 0 }));
vi.mock('@/utils/serverAuth', () => ({
  getAuthedClient: async () => state.auth,
  serviceClient: () => {
    state.dbCalls++;
    return {
      from: table => {
        expect(table).toBe('invoices');
        const q = {
          select: () => q,
          eq: (key, value) => { state.filters.push(['eq', key, value]); return q; },
          neq: (key, value) => { state.filters.push(['neq', key, value]); return q; },
          maybeSingle: async () => ({ data: state.rows.find(row => state.filters.every(([op, key, value]) => op === 'eq' ? row[key] === value : row[key] !== value)) || null, error: state.error }),
        };
        return q;
      },
      storage: { from: bucket => ({ createSignedUrl: async (path, ttl) => {
        state.signed.push({ bucket, path, ttl }); return { data: { signedUrl: state.signedUrl }, error: state.signError };
      } }) },
    };
  },
}));
import { GET } from '../src/app/api/client/invoices/[id]/pdf/route';
const ID = '10000000-0000-4000-8000-000000000001';
const ORG = '20000000-0000-4000-8000-000000000001';
const path = `${ORG}/${ID}/1760000000000_invoice.pdf`;
const run = (id = ID) => GET(new Request('http://localhost/api/client/invoices/id/pdf'), { params: Promise.resolve({ id }) });
beforeEach(() => {
  state.auth = { orgId: ORG, clientId: 'client-1' };
  state.rows = [{ id: ID, organization_id: ORG, client_id: 'client-1', status: 'sent', pdf_path: path }];
  state.error = null; state.signError = null; state.signedUrl = 'https://storage.example/private?token=secret'; state.filters = []; state.signed = []; state.dbCalls = 0;
});
describe('private client invoice downloads', () => {
  it('signs only a non-draft invoice scoped to the authenticated client and organization', async () => {
    const res = await run(); expect(res.status).toBe(200); expect(await res.json()).toEqual({ url: state.signedUrl });
    expect(state.filters).toEqual([['eq', 'organization_id', ORG], ['eq', 'client_id', 'client-1'], ['eq', 'id', ID], ['neq', 'status', 'draft']]);
    expect(state.signed).toEqual([{ bucket: 'invoices', path, ttl: 3600 }]);
    expect(res.headers.get('cache-control')).toContain('no-store'); expect(res.headers.get('cache-control')).toContain('private');
    expect(res.headers.get('vary')).toContain('Authorization'); expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  });
  it('preserves a historical safe attachment in the same organization and invoice folder', async () => {
    state.rows[0].pdf_path = `${ORG}/${ID}/invoice.pdf`;
    expect((await run()).status).toBe(200);
    expect(state.signed[0].path).toBe(`${ORG}/${ID}/invoice.pdf`);
  });
  it.each([{ status: 'draft' }, { client_id: 'other-client' }, { organization_id: 'other-org' }])('conceals unauthorized invoice existence %j', async patch => {
    Object.assign(state.rows[0], patch); const res = await run(); expect(res.status).toBe(404); expect(await res.json()).toEqual({ error: 'Not found' }); expect(state.signed).toEqual([]);
  });
  it('returns missing separately from database failure without exposing internal errors', async () => {
    state.rows = []; expect((await run()).status).toBe(404);
    state.error = { message: 'private schema detail' }; const res = await run(); expect(res.status).toBe(503); expect(JSON.stringify(await res.json())).not.toContain('private schema'); expect(state.signed).toEqual([]);
  });
  it.each(['', 'bad', [ID], `${ID},id.gt.0`])('rejects malformed identifier %j without database access', async id => {
    expect((await run(id)).status).toBe(400); expect(state.dbCalls).toBe(0);
  });
  it('honors authentication and plan refusal before database access', async () => {
    state.auth = null; expect((await run()).status).toBe(401);
    state.auth = { planRefusal: { status: 403, error: 'Plan feature unavailable' } }; expect((await run()).status).toBe(403);
    expect(state.dbCalls).toBe(0);
  });
  it('returns null when no attachment exists', async () => {
    state.rows[0].pdf_path = null; const res = await run(); expect(res.status).toBe(200); expect(await res.json()).toEqual({ url: null }); expect(state.signed).toEqual([]);
  });
  it.each([`other/${ID}/1760000000000_invoice.pdf`, `${ORG}/other/1760000000000_invoice.pdf`, `${ORG}/${ID}/../invoice.pdf`, `${ORG}/${ID}/1760000000000_%2Fsecret.pdf`, `${ORG}/${ID}/1760000000000_x\\secret.pdf`, 'legacy.pdf', `${ORG}/${ID}/.`, `${ORG}/${ID}/..`])('refuses an unrelated or unsafe legacy path %s', async pdf_path => {
    state.rows[0].pdf_path = pdf_path; const res = await run(); expect(res.status).toBe(409); expect(state.signed).toEqual([]); expect(JSON.stringify(await res.json())).not.toContain(pdf_path);
  });
  it('reports signing failures for retry without exposing the underlying storage error', async () => {
    state.signError = { message: 'private bucket internals' }; const res = await run(); expect(res.status).toBe(503); expect(JSON.stringify(await res.json())).not.toContain('private bucket'); expect(res.headers.get('cache-control')).toContain('no-store');
  });
});

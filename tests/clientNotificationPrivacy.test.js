import { beforeEach, describe, expect, it, vi } from 'vitest';
const ORG = 'org';
const CLIENT = '11111111-1111-4111-8111-111111111111';
const PROJECT = '22222222-2222-4222-8222-222222222222';
const { state } = vi.hoisted(() => ({ state: {} }));
vi.mock('@/utils/serverAuth', () => ({
  getAuthedOrg: async () => state.auth,
  serviceClient: () => ({ from(table) {
    const query = { table, filters: [] };
    state.queries.push(query);
    const chain = {
      select() { return chain; },
      eq(...args) { query.filters.push(['eq', ...args]); return chain; },
      in(...args) { query.filters.push(['in', ...args]); return chain; },
      maybeSingle() { return chain; },
      then(resolve, reject) { return Promise.resolve(state.results[table]).then(resolve, reject); },
    };
    return chain;
  } }),
}));
vi.mock('@/utils/entitlements', () => ({ checkFeatureAccess: async (_db, org, feature) => {
  state.gates.push([org, feature]); return state.gate;
} }));
vi.mock('@/utils/mailer', () => ({
  notifyEmailHtml: () => '<p>Notification</p>',
  sendMail: async (payload) => { state.sent.push(payload); return state.delivery; },
}));
import { POST } from '@/app/api/notify/client/route';
async function send(body = {}) {
  const response = await POST(new Request('http://localhost/api/notify/client', {
    method: 'POST', body: JSON.stringify(body),
  }));
  return { status: response.status, body: await response.json() };
}
beforeEach(() => {
  Object.assign(state, {
    auth: { orgId: ORG, userType: 'admin', role: 'owner', overrides: {} },
    gate: null, gates: [], queries: [], sent: [], delivery: { ok: true, delivered: true },
    results: {
      clients: { data: [{ id: CLIENT, email: 'Client@example.test' }] },
      memberships: { data: [{ user_id: CLIENT }] },
      project_clients: { data: [{ client_id: CLIENT }] },
      projects: { data: { id: PROJECT } }, organizations: { data: { name: 'Acme' } },
    },
  });
});
describe('client notification privacy', () => {
  it('sends a linked project announcement only through BCC and active client memberships', async () => {
    const result = await send({ kind: 'announcement', projectId: PROJECT, message: null });
    expect(result).toMatchObject({ status: 200, body: { sent: 1 } });
    expect(state.sent[0]).toMatchObject({ bcc: ['client@example.test'] });
    expect(state.sent[0].to).toBeUndefined();
    for (const table of ['clients', 'memberships', 'project_clients', 'projects']) {
      expect(state.queries.find(q => q.table === table).filters).toContainEqual(['eq', 'organization_id', ORG]);
    }
    for (const table of ['clients', 'memberships']) {
      expect(state.queries.find(q => q.table === table).filters).toContainEqual(['eq', 'status', 'active']);
    }
    expect(state.queries.find(q => q.table === 'memberships').filters).toContainEqual(['eq', 'user_type', 'client']);
    expect(state.gates).toEqual([[ORG, 'client_portal']]);
  });
  it('does not send to a suspended or missing membership', async () => {
    state.results.memberships.data = [];
    expect((await send({ clientId: CLIENT })).body.sent).toBe(0);
    expect(state.sent).toHaveLength(0);
  });
  it('does not send to an inactive client profile', async () => {
    state.results.clients.data = [];
    expect((await send({ clientId: CLIENT })).body.sent).toBe(0);
    expect(state.sent).toHaveLength(0);
  });
  it('rejects an explicitly named client outside the project', async () => {
    state.results.project_clients.data = [];
    expect((await send({ projectId: PROJECT, clientId: CLIENT })).status).toBe(403);
    expect(state.sent).toHaveLength(0);
  });
  it('allows a named invoice client independently of project membership', async () => {
    state.results.project_clients.data = [];
    expect((await send({ kind: 'invoice', clientId: CLIENT, projectId: PROJECT })).body.sent).toBe(1);
    expect(state.queries.some(q => q.table === 'project_clients')).toBe(false);
    expect(state.queries.find(q => q.table === 'clients').filters).toContainEqual(['eq', 'id', CLIENT]);
  });
  it.each([{}, { projectId: PROJECT }])('never broadcasts invoices %j', async (scope) => {
    expect((await send({ kind: 'invoice', ...scope })).status).toBe(400);
    expect(state.sent).toHaveLength(0);
  });
  it('rejects a missing or cross-organization project', async () => {
    state.results.projects.data = null;
    expect((await send({ projectId: PROJECT })).status).toBe(404);
    expect(state.sent).toHaveLength(0);
  });
  it.each(['clients', 'memberships', 'projects', 'project_clients'])('fails closed on %s lookup error', async (table) => {
    state.results[table] = { error: { message: 'private database details' } };
    const result = await send({ projectId: PROJECT });
    expect(result.status).toBe(503);
    expect(JSON.stringify(result.body)).not.toContain('private database details');
    expect(state.sent).toHaveLength(0);
  });
  it('rejects unavailable or disallowed plans before recipient lookup', async () => {
    state.gate = { status: 402, error: 'Upgrade required' };
    expect((await send()).status).toBe(402);
    expect(state.queries).toHaveLength(0);
  });
  it.each([null, [], { kind: '__proto__' }, { kind: ['invoice'] }, { title: {} }, { message: 3 }, { projectId: 'bad' }, { clientId: 5 }, { title: 'x'.repeat(501) }])('rejects malformed input %j', async (body) => {
    expect((await send(body)).status).toBe(400);
    expect(state.sent).toHaveLength(0);
  });
  it.each(['client', 'developer', 'hr', 'finance', 'team_lead'])('refuses unauthorized %s', async (role) => {
    state.auth.role = role;
    state.auth.userType = role === 'client' ? 'client' : 'developer';
    expect((await send()).status).toBe(403);
    expect(state.sent).toHaveLength(0);
  });
  it('honors an explicit permission denial', async () => {
    state.auth.overrides = { 'client.notify': false };
    expect((await send()).status).toBe(403);
  });
  it('does not claim delivery when the mail provider fails', async () => {
    state.delivery = { ok: false, delivered: false, error: 'Unavailable' };
    expect((await send()).body).toMatchObject({ ok: false, sent: 0, recipients: 1 });
  });
});

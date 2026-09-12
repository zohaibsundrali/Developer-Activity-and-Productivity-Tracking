import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ auth: null, rpc: null, calls: [], rows: [], clientRows: [], selections: [], responses: [], filters: [], ranges: [], orders: [], cap: 500, blocked: null, token: null }));
vi.mock('@/utils/serverAuth', () => ({
  getAuthedOrg: async () => state.auth,
  orgScopedClient: token => { state.token = token; return { rpc: async (name, args) => { state.calls.push({ name, args }); return state.rpc; } }; },
  serviceClient: () => ({ from: table => {
    const q = { select: (columns, options) => { state.selections.push([table, columns]); expect(options).toEqual({ count: 'exact' }); return q; },
      eq: (key, value) => { state.filters.push([table, key, value]); return q; },
      order: (key, options) => { state.orders.push(key); return q; },
      range: async (from, to) => { if (table === 'clients') return { data: state.clientRows.slice(from, Math.min(to + 1, from + state.cap)), count: state.clientRows.length, error: null }; state.ranges.push([from, to]); return state.responses.length ? state.responses.shift()
        : { data: state.rows.slice(from, Math.min(to + 1, from + state.cap)), count: state.rows.length, error: null }; },
    }; return q;
  } }),
}));
vi.mock('@/utils/entitlements', () => ({ requireUnlocked: async () => state.blocked }));
import { GET, POST } from '../src/app/api/invoicing/route';
import { invoiceSelectionKey, validateInvoiceRequest, invoicePnlTotals, invoiceCurrencyBreakdown } from '@/utils/invoicingSelections';
const PROJECT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const INVOICE = '33333333-3333-4333-8333-333333333333';
const CLIENT = '44444444-4444-4444-8444-444444444444';
const choice = { userId: USER, userType: 'developer', weekStart: '2026-09-07' };
const body = extra => ({ projectId: PROJECT, selections: [choice], ...extra });
const post = data => POST(new Request('http://localhost/api/invoicing', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }));
const get = query => GET(new Request(`http://localhost/api/invoicing?${query || ''}`));
const reportRow = (i, type = 'developer') => ({ organization_id: 'org', project_id: PROJECT, user_id: `person-${i}`, user_type: type, week_start: '2026-09-07', hours: 1, rate: 10 });
beforeEach(() => {
  state.auth = { orgId: 'org', appUserId: USER, userType: 'admin', role: 'owner', overrides: {}, token: 'caller' };
  state.rpc = { data: { invoice: { id: INVOICE, organization_id: 'org', project_id: PROJECT, client_id: null, status: 'draft', amount: 10 }, lines: 1, total: 10 }, error: null };
  state.calls = []; state.rows = []; state.clientRows = []; state.selections = []; state.responses = []; state.filters = []; state.orders = []; state.ranges = []; state.cap = 500; state.blocked = null; state.token = null;
});

describe('transactional invoice raising', () => {
  it('sends only validated typed selections to one caller-scoped transaction', async () => {
    expect((await post(body())).status).toBe(200);
    expect(state.calls).toEqual([{ name: 'raise_timesheet_invoice', args: { p_project_id: PROJECT, p_selections: [choice], p_client_id: null, p_title: null, p_due_at: null } }]);
    expect(state.token).toBe('caller');
    expect(state.filters).toEqual([]);
  });

  it('keeps colliding admin/developer profile IDs as distinct billable selections', async () => {
    const selections = [choice, { ...choice, userType: 'admin' }];
    state.rpc.data.lines = 2;
    expect((await post(body({ selections }))).status).toBe(200);
    expect(state.calls[0].args.p_selections).toEqual(selections);
    expect(invoiceSelectionKey({ project_id: PROJECT, user_id: USER, user_type: 'developer', week_start: choice.weekStart }))
      .not.toBe(invoiceSelectionKey({ project_id: PROJECT, user_id: USER, user_type: 'admin', week_start: choice.weekStart }));
  });

  it('rejects duplicate, untyped, malformed, non-Monday, oversized and caller-priced selections', async () => {
    for (const selections of [[choice, choice], [{ ...choice, userType: undefined }], [{ ...choice, userId: 'bad' }],
      [{ ...choice, weekStart: '2026-09-08' }], [{ ...choice, weekStart: '2026-02-30' }],
      Array.from({ length: 201 }, () => choice), [], [{ ...choice, rate: 1 }]]) {
      expect((await post(body({ selections }))).status).toBe(400);
    }
    expect((await post(body({ total: 999999 }))).status).toBe(400);
    expect(state.calls).toEqual([]);
  });

  it('validates optional client, title and real due date instead of silently dropping bad inputs', async () => {
    for (const extras of [{ clientId: 'bad' }, { dueAt: '2026-02-30' }, { title: {} }, { title: 'a'.repeat(201) }]) {
      expect((await post(body(extras))).status).toBe(400);
    }
    state.rpc.data.invoice.client_id = CLIENT;
    expect((await post(body({ clientId: CLIENT, title: ' Approved work ', dueAt: '2026-09-30' }))).status).toBe(200);
    expect(state.calls.at(-1).args).toMatchObject({ p_client_id: CLIENT, p_title: 'Approved work', p_due_at: '2026-09-30' });
  });

  it('denies absent sessions, clients, explicit permission denies and billing locks before RPC', async () => {
    state.auth = null; expect((await post(body())).status).toBe(401);
    state.auth = { userType: 'client', role: 'owner', overrides: {} }; expect((await post(body())).status).toBe(403);
    state.auth = { orgId: 'org', userType: 'admin', role: 'owner', overrides: { 'invoice.manage': false } };
    expect((await post(body())).status).toBe(403);
    state.auth.overrides = {}; state.blocked = { status: 402, error: 'Billing locked' };
    expect((await post(body())).status).toBe(402);
    expect(state.calls).toEqual([]);
  });

  it('maps transaction conflicts and never exposes internal database details', async () => {
    for (const [code, message, expected] of [['55000', 'INVOICE_RATE_REQUIRED', 409], ['55000', 'INVOICE_HOURS_UNAVAILABLE', 409],
      ['23505', 'INVOICE_ALREADY_BILLED', 409], ['42501', 'INVOICE_FORBIDDEN', 403],
      ['22023', 'INVOICE_CLIENT_INVALID', 400], ['P0001', 'BILLING_LOCKED', 402], ['XX000', 'private table secret', 503]]) {
      state.rpc = { data: null, error: { code, message } };
      const response = await post(body());
      expect(response.status).toBe(expected);
      expect((await response.json()).error).not.toContain('private table');
    }
  });

  it('does not claim success for empty, mismatched or partial transaction receipts', async () => {
    const valid = state.rpc.data;
    for (const data of [null, { ...valid, lines: 0 }, { ...valid, total: null }, { ...valid, total: 99 }, { ...valid, total: true }, { ...valid, total: '' },
      { ...valid, invoice: { ...valid.invoice, organization_id: 'other' } },
      { ...valid, invoice: { ...valid.invoice, client_id: CLIENT } },
      { ...valid, invoice: { ...valid.invoice, status: 'sent' } }]) {
      state.rpc = { data, error: null };
      expect((await post(body())).status).toBe(503);
    }
  });
});

describe('complete financial view loading', () => {
  it('loads beyond a smaller provider cap using actual received row offsets', async () => {
    state.rows = Array.from({ length: 5 }, (_, i) => reportRow(i)); state.cap = 2;
    const response = await get();
    expect(response.status).toBe(200);
    expect((await response.json()).rows).toHaveLength(5);
    expect(state.ranges).toEqual([[0, 499], [2, 501], [4, 503]]);
    expect(state.filters).toContainEqual(['billable_hours_v', 'organization_id', 'org']);
    expect(state.filters).toContainEqual(['billable_hours_v', 'invoiced', false]);
    expect(state.orders.slice(0, 4)).toEqual(['week_start', 'project_id', 'user_type', 'user_id']);
  });

  it('loads all P&L rows and requires its separate permission', async () => {
    state.rows = [{ organization_id: 'org', project_id: PROJECT }, { organization_id: 'org', project_id: CLIENT }]; state.cap = 1;
    const response = await get('view=pnl');
    expect((await response.json()).projects).toHaveLength(2);
    state.auth.overrides['pnl.view'] = false;
    expect((await get('view=pnl')).status).toBe(403);
  });

  it('fails rather than publish partial totals when a page fails or count is unavailable', async () => {
    for (const tail of [{ data: null, count: 2, error: { message: 'private internal' } }, { data: [], count: null, error: null }]) {
      state.responses = [{ data: [reportRow(1)], count: 2, error: null }, tail];
      const response = await get();
      expect(response.status).toBe(503);
      expect((await response.json()).rows).toBeUndefined();
    }
  });

  it('refuses oversized, changing, repeated or prematurely exhausted datasets', async () => {
    const cases = [
      [[{ data: [], count: 20001, error: null }], 413],
      [[{ data: [reportRow(1)], count: 2 }, { data: [reportRow(2)], count: 3 }], 409],
      [[{ data: [reportRow(1)], count: 2 }, { data: [reportRow(1)], count: 2 }], 409],
      [[{ data: [], count: 1 }], 409],
    ];
    for (const [responses, expected] of cases) {
      state.responses = responses;
      expect((await get()).status).toBe(expected);
    }
  });

  it('returns complete minimal client choices scoped to the caller organization', async () => {
    state.clientRows = [{ id: CLIENT, name: 'Client one', email: 'not-returned@example.test' },
      { id: USER, name: 'Client two' }, { id: PROJECT, name: 'Client three' }];
    state.cap = 1;
    const response = await get();
    const json = await response.json();
    expect(response.status).toBe(200);
    expect(json.clients).toEqual(state.clientRows.map(({ id, name }) => ({ id, name })));
    expect(state.selections).toContainEqual(['clients', 'id, name']);
    expect(state.filters).toContainEqual(['clients', 'organization_id', 'org']);
    state.auth.overrides['invoice.view'] = false;
    state.selections = [];
    expect((await get()).status).toBe(403);
    expect(state.selections).toEqual([]);
  });

  it('applies project filter and never widens on malformed IDs', async () => {
    expect((await get(`projectId=${PROJECT}&include=all`)).status).toBe(200);
    expect(state.filters).toContainEqual(['billable_hours_v', 'project_id', PROJECT]);
    expect(state.filters.some(([, key]) => key === 'invoiced')).toBe(false);
    state.filters = [];
    expect((await get('projectId=invalid')).status).toBe(400);
    expect(state.filters).toEqual([]);
  });
});

describe('financial totals without invented currency conversions', () => {
  it('preserves complete USD totals and margin', () => {
    expect(invoicePnlTotals([{ invoiced: 100, cost: 60, total_hours: 2, costed_hours: 2 }]))
      .toEqual({ invoiced: 100, cost: 60, margin: 40, costComplete: true });
  });
  it('does not treat mixed currency null revenue as zero', () => {
    const totals = invoicePnlTotals([{ invoiced: null, cost: 60, total_hours: 2, costed_hours: 2 },
      { invoiced: 100, cost: 10, total_hours: 1, costed_hours: 1 }]);
    expect(totals).toMatchObject({ invoiced: null, margin: null, cost: 70 });
    expect(invoiceCurrencyBreakdown({ USD: 100, EUR: 50 })).toBe('USD 100.00 · EUR 50.00');
  });
  it('keeps known partial cost visible without overstating margin', () => {
    expect(invoicePnlTotals([{ invoiced: 100, cost: 10, total_hours: 2, costed_hours: 1 }]))
      .toEqual({ invoiced: 100, cost: 10, margin: null, costComplete: false });
  });
  it('labels unknown currency amounts without an Intl currency exception', () => {
    expect(invoiceCurrencyBreakdown({ UNKNOWN: 42 })).toBe('UNKNOWN 42.00');
    expect(invoiceCurrencyBreakdown({ EUR: null })).toBe('EUR unavailable');
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ auth: null, result: null, filters: {}, calls: [], token: null, locked: null, reads: 0 }));
vi.mock('@/utils/serverAuth', () => ({
  getAuthedOrg: async () => state.auth,
  serviceClient: () => ({ billingOnly: true }),
  orgScopedClient: token => {
    state.token = token;
    return {
      rpc: async (name, args) => { state.calls.push({ name, args }); return state.result; },
      from: table => {
        expect(table).toBe('timesheets');
        const q = { select: () => q, eq: (key, value) => { state.filters[key] = value; return q; },
          order: () => q, limit: () => q,
          then: resolve => { state.reads++; return Promise.resolve(state.result).then(resolve); } };
        return q;
      },
    };
  },
}));
vi.mock('@/utils/entitlements', () => ({ requireUnlocked: async () => state.locked }));
import { GET, POST, PATCH } from '../src/app/api/timesheets/route';
const ID = '10000000-0000-4000-8000-000000000001';
const USER = '20000000-0000-4000-8000-000000000001';
const OTHER = '30000000-0000-4000-8000-000000000001';
const MONDAY = '2026-09-07';
const row = updates => ({ id: ID, organization_id: 'org', user_id: USER, user_type: 'developer',
  week_start: MONDAY, status: 'submitted', total_seconds: 7200, billable_seconds: 3600, ...updates });
const request = (method, body) => new Request('http://localhost/api/timesheets', {
  method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
beforeEach(() => {
  state.auth = { orgId: 'org', appUserId: USER, userType: 'developer', role: 'developer', token: 'caller-token', overrides: {} };
  state.result = { data: row(), error: null };
  state.filters = {}; state.calls = []; state.token = null; state.locked = null; state.reads = 0;
});

describe('transactional timesheet API', () => {
  it('submits only the chosen Monday through caller credentials; supplied totals and identities are ignored', async () => {
    const response = await POST(request('POST', { weekStart: MONDAY, totalSeconds: 999999, user_id: OTHER, organization_id: 'other' }));
    expect(response.status).toBe(200);
    expect((await response.json()).timesheet.total_seconds).toBe(7200);
    expect(state.calls).toEqual([{ name: 'submit_timesheet_week', args: { p_week_start: MONDAY } }]);
    expect(state.token).toBe('caller-token');
    expect(state.reads).toBe(0);
  });

  it('preserves permitted typed admin submissions', async () => {
    state.auth.userType = 'admin'; state.auth.role = 'admin';
    state.result.data = row({ user_type: 'admin' });
    expect((await POST(request('POST', { weekStart: MONDAY }))).status).toBe(200);
  });

  it('rejects invalid Mondays before any database mutation', async () => {
    for (const weekStart of ['2026-09-08', '2026-02-30', null, 'bad']) {
      expect((await POST(request('POST', { weekStart }))).status).toBe(400);
    }
    expect(state.calls).toEqual([]);
  });

  it('denies absent identity, client role claims, explicit overrides and billing locks', async () => {
    state.auth = null;
    expect((await POST(request('POST', { weekStart: MONDAY }))).status).toBe(401);
    state.auth = { orgId: 'org', appUserId: USER, userType: 'client', role: 'owner', overrides: {} };
    expect((await POST(request('POST', { weekStart: MONDAY }))).status).toBe(403);
    state.auth.userType = 'developer'; state.auth.overrides['timesheet.submit_own'] = false;
    expect((await POST(request('POST', { weekStart: MONDAY }))).status).toBe(403);
    state.auth.overrides = {}; state.locked = { status: 402, error: 'Billing locked' };
    expect((await POST(request('POST', { weekStart: MONDAY }))).status).toBe(402);
    expect(state.calls).toEqual([]);
  });

  it('does not claim submission success for empty, wrong-owner, wrong-type or wrong-week receipts', async () => {
    for (const data of [null, [], row({ user_id: OTHER }), row({ user_type: 'admin' }), row({ week_start: '2026-09-14' }), row({ status: 'approved' })]) {
      state.result = { data, error: null };
      expect((await POST(request('POST', { weekStart: MONDAY }))).status).toBe(503);
    }
  });

  it('forwards approve, reject and reopen to one transactional decision without pre-reading status', async () => {
    state.auth.role = 'manager';
    for (const decision of ['approved', 'rejected', 'reopen']) {
      state.result.data = row({ user_id: OTHER, status: decision === 'reopen' ? 'draft' : decision });
      expect((await PATCH(request('PATCH', { timesheetId: ID, decision, note: 'Reviewed' }))).status).toBe(200);
      expect(state.calls.at(-1)).toEqual({ name: 'decide_timesheet', args: { p_timesheet_id: ID, p_decision: decision, p_note: 'Reviewed' } });
    }
    expect(state.reads).toBe(0);
  });

  it('rejects unauthorized decisions and forged empty confirmations', async () => {
    expect((await PATCH(request('PATCH', { timesheetId: ID, decision: 'approved' }))).status).toBe(403);
    expect(state.calls).toEqual([]);
    state.auth.role = 'manager'; state.result.data = null;
    expect((await PATCH(request('PATCH', { timesheetId: ID, decision: 'approved' }))).status).toBe(503);
  });

  it('maps database self-decision, concurrent conflict, missing row, invalid logs and billing errors', async () => {
    state.auth.role = 'manager';
    for (const [code, message, expected] of [
      ['42501', 'TIMESHEET_SELF_DECISION', 403], ['55000', 'TIMESHEET_STATE_CONFLICT', 409],
      ['P0002', 'TIMESHEET_NOT_FOUND', 404], ['55000', 'TIMESHEET_IDENTITY_REVIEW_REQUIRED', 409],
      ['55000', 'TIMESHEET_WEEK_LOCKED', 409], ['22023', 'TIMESHEET_EMPTY', 400],
      ['22023', 'TIMESHEET_OPEN_LOGS', 400], ['P0001', 'BILLING_LOCKED', 402],
      ['XX000', 'private internal details', 503],
    ]) {
      state.result = { data: null, error: { code, message } };
      const response = await PATCH(request('PATCH', { timesheetId: ID, decision: 'approved' }));
      expect(response.status).toBe(expected);
      expect((await response.json()).error).not.toContain('private internal');
    }
  });

  it('normalizes valid uppercase UUIDs and refuses non-string identifiers', async () => {
    state.auth.role = 'manager';
    const canonical = 'abcdef00-0000-4000-8000-000000000001';
    state.result.data = row({ id: canonical, user_id: OTHER, status: 'approved' });
    expect((await PATCH(request('PATCH', { timesheetId: canonical.toUpperCase(), decision: 'approved' }))).status).toBe(200);
    expect(state.calls.at(-1).args.p_timesheet_id).toBe(canonical);
    expect((await PATCH(request('PATCH', { timesheetId: [canonical], decision: 'approved' }))).status).toBe(400);
  });

  it('bounds optional notes and preserves typed self-decision distinction', async () => {
    state.auth.role = 'manager';
    state.result.data = row({ status: 'approved' });
    expect((await PATCH(request('PATCH', { timesheetId: ID, decision: 'approved' }))).status).toBe(503);
    state.result.data = row({ user_type: 'admin', status: 'approved' });
    expect((await PATCH(request('PATCH', { timesheetId: ID, decision: 'approved', note: 'a'.repeat(2500) }))).status).toBe(200);
    expect(state.calls.at(-1).args.p_note).toHaveLength(2000);
  });

  it('scopes own reads by organization, profile ID and type using caller RLS', async () => {
    state.result.data = [];
    expect((await GET(new Request('http://localhost/api/timesheets?scope=me&status=submitted'))).status).toBe(200);
    expect(state.filters).toEqual({ organization_id: 'org', user_id: USER, user_type: 'developer', status: 'submitted' });
    expect(state.token).toBe('caller-token');
  });

  it('loads the exact selected week and rejects malformed or non-Monday week filters', async () => {
    state.result.data = [];
    const response = await GET(new Request(`http://localhost/api/timesheets?scope=me&weekStart=${MONDAY}`));
    expect(response.status).toBe(200);
    expect(state.filters).toEqual({ organization_id: 'org', user_id: USER, user_type: 'developer', week_start: MONDAY });
    for (const weekStart of ['', 'bad', '2026-09-08']) {
      const reads = state.reads;
      expect((await GET(new Request(`http://localhost/api/timesheets?weekStart=${weekStart}`))).status).toBe(400);
      expect(state.reads).toBe(reads);
    }
  });

  it('retains wide reads only for effective permission and still honors explicit own scope', async () => {
    state.auth.role = 'manager'; state.result.data = [];
    await GET(new Request('http://localhost/api/timesheets'));
    expect(state.filters).toEqual({ organization_id: 'org' });
    state.filters = {};
    await GET(new Request('http://localhost/api/timesheets?scope=me'));
    expect(state.filters).toEqual({ organization_id: 'org', user_id: USER, user_type: 'developer' });
    state.auth.overrides = { 'timesheet.view_all': false, 'timesheet.view_own': false };
    expect((await GET(new Request('http://localhost/api/timesheets'))).status).toBe(403);
  });
});

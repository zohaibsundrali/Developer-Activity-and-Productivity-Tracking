import { describe, it, expect } from 'vitest';
import { validateInvitationScope } from '@/utils/invitationScope';

function service(rows, failure = null) {
  return { from(table) {
    const filters = {};
    const q = { select: () => q, eq: (key, value) => { filters[key] = value; return q; },
      maybeSingle: async () => ({ data: (rows[table] || []).find(r => Object.entries(filters).every(([k,v]) => r[k] === v)) || null, error: failure }) };
    return q;
  } };
}

describe('invitation tenant scope', () => {
  it.each([['teams','teamId'], ['departments','departmentId'], ['projects','projectId']])('rejects foreign %s before any account is written', async (table, key) => {
    const svc = service({ [table]: [{ id: 'foreign', organization_id: 'org-b' }] });
    expect(await validateInvitationScope(svc, 'org-a', { [key]: 'foreign' })).toMatchObject({ status: 400 });
    expect(await validateInvitationScope(svc, 'org-b', { [key]: 'foreign' })).toBeNull();
  });
  it('refuses unreadable resources', async () => {
    expect(await validateInvitationScope(service({}, { code: '57014' }), 'org', { teamId: 'team' })).toMatchObject({ status: 503 });
  });
  it('permits invitations without optional links', async () => {
    expect(await validateInvitationScope(service({}), 'org', {})).toBeNull();
  });
});

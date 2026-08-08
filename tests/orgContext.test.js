import { describe, it, expect } from 'vitest';
import { isMembershipActive, scopeToOrg } from '@/utils/orgContext';

/**
 * Audit finding C10: `memberships.status` was written on deactivation but never
 * read, so a suspended employee kept full access. `isMembershipActive` is the
 * check that closes that hole — every blocked status must stay blocked.
 */

const BLOCKED = ['suspended', 'terminated', 'inactive', 'offboarded'];

describe('isMembershipActive — blocked statuses', () => {
  it.each(BLOCKED)('blocks %s', (status) => {
    expect(isMembershipActive(status)).toBe(false);
  });

  it.each(BLOCKED)('blocks %s case-insensitively', (status) => {
    expect(isMembershipActive(status.toUpperCase())).toBe(false);
    expect(isMembershipActive(status[0].toUpperCase() + status.slice(1))).toBe(false);
  });

  it('covers the full blocked list and nothing has been silently dropped', () => {
    const stillBlocked = BLOCKED.filter((s) => isMembershipActive(s) === false);
    expect(stillBlocked).toEqual(BLOCKED);
  });
});

describe('isMembershipActive — allowed statuses', () => {
  it('allows an explicit active status', () => {
    expect(isMembershipActive('active')).toBe(true);
    expect(isMembershipActive('ACTIVE')).toBe(true);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
  ])('treats %s as active for legacy rows predating the column', (_label, status) => {
    expect(isMembershipActive(status)).toBe(true);
  });

  it('allows an unrecognised status rather than locking people out', () => {
    // Documented behaviour: only an explicit non-active state blocks sign-in.
    expect(isMembershipActive('pending_review')).toBe(true);
  });

  it('does not partial-match a blocked status inside a longer string', () => {
    expect(isMembershipActive('unsuspended')).toBe(true);
  });
});

describe('scopeToOrg', () => {
  // Minimal query-builder stand-in — no Supabase involved.
  function fakeQuery() {
    const calls = [];
    const q = { calls, eq: (col, val) => { calls.push([col, val]); return q; } };
    return q;
  }

  it('applies an organization_id filter when an org id is present', () => {
    const q = fakeQuery();
    const result = scopeToOrg(q, 'org-123');
    expect(result).toBe(q);
    expect(q.calls).toEqual([['organization_id', 'org-123']]);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
  ])('is a no-op for %s org id', (_label, orgId) => {
    const q = fakeQuery();
    expect(scopeToOrg(q, orgId)).toBe(q);
    expect(q.calls).toEqual([]);
  });
});

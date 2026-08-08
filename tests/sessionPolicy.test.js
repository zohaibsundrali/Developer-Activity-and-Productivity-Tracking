import { describe, it, expect, afterEach } from 'vitest';
import {
  isSessionExpired,
  getSessionCookieExpiryDate,
  SESSION_MAX_AGE_DAYS,
  SESSION_MAX_AGE_MS,
} from '@/utils/sessionPolicy';

/**
 * Sliding inactivity expiry. If this returns false when it should return true,
 * stale sessions stay valid indefinitely — so the boundary behaviour is pinned
 * explicitly (exactly 7 days is allowed; strictly greater expires).
 */

const realNow = Date.now;
const FIXED_NOW = Date.parse('2026-08-08T12:00:00.000Z');

function freezeNow(ms = FIXED_NOW) {
  Date.now = () => ms;
}

function isoAgo(ms) {
  return new Date(FIXED_NOW - ms).toISOString();
}

afterEach(() => {
  Date.now = realNow;
});

describe('constants', () => {
  it('is a 7 day window', () => {
    expect(SESSION_MAX_AGE_DAYS).toBe(7);
    expect(SESSION_MAX_AGE_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

describe('isSessionExpired — ISO string input', () => {
  it('is not expired for a timestamp just now', () => {
    freezeNow();
    expect(isSessionExpired(isoAgo(0))).toBe(false);
  });

  it('is not expired one day in', () => {
    freezeNow();
    expect(isSessionExpired(isoAgo(24 * 60 * 60 * 1000))).toBe(false);
  });

  it('is NOT expired at exactly 7 days (boundary is inclusive)', () => {
    freezeNow();
    expect(isSessionExpired(isoAgo(SESSION_MAX_AGE_MS))).toBe(false);
  });

  it('IS expired one millisecond past 7 days', () => {
    freezeNow();
    expect(isSessionExpired(isoAgo(SESSION_MAX_AGE_MS + 1))).toBe(true);
  });

  it('is expired well past the window', () => {
    freezeNow();
    expect(isSessionExpired(isoAgo(30 * 24 * 60 * 60 * 1000))).toBe(true);
  });
});

describe('isSessionExpired — invalid input fails closed', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
    ['garbage', 'not-a-date'],
    ['an empty object', {}],
    ['an object with unparseable timestamps', { lastActivity: 'nope', loginTime: 'nope' }],
  ])('treats %s as expired', (_label, input) => {
    freezeNow();
    expect(isSessionExpired(input)).toBe(true);
  });
});

describe('isSessionExpired — session object input', () => {
  it('prefers lastActivity over loginTime (sliding window)', () => {
    freezeNow();
    const session = {
      loginTime: isoAgo(30 * 24 * 60 * 60 * 1000), // long expired on its own
      lastActivity: isoAgo(60 * 1000), // but active a minute ago
    };
    expect(isSessionExpired(session)).toBe(false);
  });

  it('falls back to loginTime when lastActivity is absent', () => {
    freezeNow();
    expect(isSessionExpired({ loginTime: isoAgo(60 * 1000) })).toBe(false);
    expect(isSessionExpired({ loginTime: isoAgo(SESSION_MAX_AGE_MS + 1000) })).toBe(true);
  });

  it('expires when lastActivity itself is stale, even with a recent loginTime', () => {
    freezeNow();
    const session = {
      loginTime: isoAgo(0),
      lastActivity: isoAgo(SESSION_MAX_AGE_MS + 1000),
    };
    expect(isSessionExpired(session)).toBe(true);
  });
});

describe('getSessionCookieExpiryDate', () => {
  it('returns a date beyond the hard session expiry (grace window)', () => {
    freezeNow();
    const iso = isoAgo(0);
    const expiry = getSessionCookieExpiryDate(iso);
    expect(expiry).toBeInstanceOf(Date);
    // Cookie outlives the session by the 2 minute grace period.
    expect(expiry.getTime()).toBe(FIXED_NOW + SESSION_MAX_AGE_MS + 2 * 60 * 1000);
  });

  it('accepts a session object', () => {
    freezeNow();
    const expiry = getSessionCookieExpiryDate({ lastActivity: isoAgo(0) });
    expect(expiry.getTime()).toBe(FIXED_NOW + SESSION_MAX_AGE_MS + 2 * 60 * 1000);
  });

  it('returns null for an unparseable reference', () => {
    expect(getSessionCookieExpiryDate('not-a-date')).toBeNull();
    expect(getSessionCookieExpiryDate(null)).toBeNull();
  });
});

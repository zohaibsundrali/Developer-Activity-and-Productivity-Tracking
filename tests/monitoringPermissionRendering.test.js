import { beforeEach, describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const state = vi.hoisted(() => ({ auth: null, context: null, monitoring: false }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => state.auth }));
vi.mock('@/utils/orgContext', () => ({ getOrgContext: () => state.context, getOrgId: () => state.context?.organizationId || null }));
vi.mock('@/utils/permissions', () => ({ allowed: key => key === 'monitoring.view' && state.monitoring }));
vi.mock('@/utils/supabaseClient', () => ({ supabase: {} }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/components/charts/EChart', () => ({ default: () => null }));

// The repository's existing SSR tests supply React for classic JSX modules.
globalThis.React = React;
const DeveloperActivity = (await import('@/components/admin/DeveloperActivity')).default;
const render = () => renderToStaticMarkup(React.createElement(DeveloperActivity));

beforeEach(() => {
  state.auth = { user: { id: 'person' }, authStatus: 'authenticated' };
  state.context = { organizationId: 'org', userId: 'person', userType: 'developer', role: 'employee' };
  state.monitoring = true;
});

describe('monitoring screen uses authenticated effective permission', () => {
  it('keeps controls hidden while auth is pending even when old display context remains', () => {
    state.auth = { user: null, authStatus: 'pending' };
    const html = render();
    expect(html).not.toContain('id="developer-filter"');
    expect(html).not.toContain('Monitoring access is not allowed');
    expect(html).toContain('animate-pulse');
  });
  it('refuses an admin whose effective monitoring permission is denied', () => {
    state.context = { ...state.context, userType: 'admin', role: 'admin' };
    state.monitoring = false;
    const html = render();
    expect(html).toContain('Monitoring access is not allowed');
    expect(html).not.toContain('id="developer-filter"');
  });
  it('allows a typed developer with an explicit monitoring grant without adminUser storage', () => {
    expect(globalThis.sessionStorage).toBeUndefined();
    const html = render();
    const selector = html.match(/<select[^>]*id="developer-filter"[^>]*>/)?.[0];
    expect(selector).toBeTruthy();
    expect(selector).not.toContain('disabled');
    expect(html).not.toContain('Please login');
    expect(html).not.toContain('Only admins');
    expect(html).toContain('Choose Developer');
  });
  it('does not retain access after logout even if old organization context remains', () => {
    state.auth = { user: null, authStatus: 'unauthenticated' };
    const html = render();
    expect(html).toContain('Monitoring access is not allowed');
    expect(html).not.toContain('id="developer-filter"');
  });
});

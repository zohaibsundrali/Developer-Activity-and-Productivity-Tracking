import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import MonitoringPresence from '../src/components/shared/MonitoringPresence';
globalThis.React = React;
const render = presence => renderToStaticMarkup(React.createElement(MonitoringPresence, { presence: { devices: [], refresh() {}, ...presence } }));
it('separates current presence from history and avoids claiming productivity from a heartbeat', () => {
  const html = render({ status: 'tracking' });
  expect(html).toContain('independent of the selected history dates');
  expect(html).toContain('does not measure productivity');
  expect(html).toContain('Tracking');
});
it('shows read failures and missing heartbeat without an online badge', () => {
  const html = render({ status: 'unknown', error: 'Live status unavailable.' });
  expect(html).toContain('role="alert"');
  expect(html).not.toContain('text-success');
  expect(render({ status: 'unavailable' })).toContain('updated desktop tracker');
});
it('escapes device names and discloses a bounded cohort', () => {
  const html = render({ status: 'paused', truncated: true, total: 101, devices: [{ id: 'a', name: '<script>bad</script>', platform: 'Windows', status: 'paused' }] });
  expect(html).toContain('&lt;script&gt;');
  expect(html).not.toContain('<script>');
  expect(html).toContain('Showing 1 of 101 devices');
});

import { afterEach, expect, it, vi } from 'vitest';
import { showConfirm, showError, showPre, dismissAlert, getAlerts, getServerAlerts, subscribeAlerts } from '@/utils/alerts';
afterEach(() => getAlerts().forEach((alert) => dismissAlert(alert.id)));
it('requires explicit approval and ignores repeated dismissal', async () => {
  const pending = showConfirm('Delete account?', 'This cannot be undone.');
  const id = getAlerts()[0].id;
  let settled = false;
  pending.then(() => { settled = true; });
  await Promise.resolve();
  expect(settled).toBe(false);
  dismissAlert(id, true);
  dismissAlert(id, false);
  expect(await pending).toBe(true);
});
it('cancel or closing a confirmation never authorizes an action', async () => {
  const pending = showConfirm('Delete?', 'Confirm');
  dismissAlert(getAlerts()[0].id);
  expect(await pending).toBe(false);
});
it('preserves queued confirmations and plain text reports', async () => {
  const first = showConfirm('First', 'One');
  const second = showConfirm('Second', 'Two');
  showPre('Report', '<script>literal</script>\nProjects: 3');
  dismissAlert(getAlerts()[0].id);
  expect(await first).toBe(false);
  expect(getAlerts()[0].title).toBe('Second');
  expect(getAlerts()[1].text).toBe('<script>literal</script>\nProjects: 3');
  dismissAlert(getAlerts()[0].id, true);
  expect(await second).toBe(true);
});
it('notifies subscribers and keeps the server snapshot empty', () => {
  const listener = vi.fn();
  const unsubscribe = subscribeAlerts(listener);
  showError('Could not save', 'Retry');
  expect(listener).toHaveBeenCalledTimes(1);
  expect(getServerAlerts()).toEqual([]);
  unsubscribe();
  dismissAlert(getAlerts()[0].id);
  expect(listener).toHaveBeenCalledTimes(1);
});

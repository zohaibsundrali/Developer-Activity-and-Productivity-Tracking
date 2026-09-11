import { afterEach, expect, it, vi } from 'vitest';
import { startAutomationSessionRecovery } from '@/utils/automationSessionRecovery';
afterEach(() => vi.useRealTimers());
function setup(recover = vi.fn().mockResolvedValue({})) {
 vi.useFakeTimers();
 const win = new EventTarget();
 win.setInterval = setInterval; win.clearInterval = clearInterval;
 const doc = new EventTarget(); doc.hidden = false;
 const onError = vi.fn();
 const stop = startAutomationSessionRecovery({ windowTarget: win, documentTarget: doc, recover, onError });
 return { win, doc, recover, onError, stop };
}
it('recovers on mount, reconnect and visible periodic retry', async () => {
 const s = setup(); expect(s.recover).toHaveBeenCalledTimes(1);
 await Promise.resolve(); s.win.dispatchEvent(new Event('online'));
 expect(s.recover).toHaveBeenCalledTimes(2);
 await vi.advanceTimersByTimeAsync(60_000); expect(s.recover).toHaveBeenCalledTimes(3); s.stop();
});
it('does not dispatch while hidden and resumes when visible', async () => {
 const s = setup(); await Promise.resolve(); s.doc.hidden = true;
 await vi.advanceTimersByTimeAsync(120_000); s.win.dispatchEvent(new Event('online'));
 expect(s.recover).toHaveBeenCalledTimes(1);
 s.doc.hidden = false; s.doc.dispatchEvent(new Event('visibilitychange'));
 expect(s.recover).toHaveBeenCalledTimes(2); s.stop();
});
it('does not overlap a slow request', async () => {
 let finish; const s = setup(vi.fn(() => new Promise(resolve => { finish = resolve; })));
 await vi.advanceTimersByTimeAsync(120_000); s.win.dispatchEvent(new Event('online'));
 expect(s.recover).toHaveBeenCalledTimes(1); finish(); await Promise.resolve();
 s.win.dispatchEvent(new Event('online')); expect(s.recover).toHaveBeenCalledTimes(2); s.stop(); finish();
});
it('removes timers and event listeners when identity changes/unmounts', async () => {
 const s = setup(); await Promise.resolve(); s.stop();
 await vi.advanceTimersByTimeAsync(120_000); s.win.dispatchEvent(new Event('online'));
 s.doc.dispatchEvent(new Event('visibilitychange')); expect(s.recover).toHaveBeenCalledTimes(1);
});
it('a failed recovery does not prevent later retries or escape as an unhandled rejection', async () => {
 const s = setup(vi.fn().mockRejectedValue(new Error('offline'))); await Promise.resolve();
 expect(s.onError).toHaveBeenCalledTimes(1);
 await vi.advanceTimersByTimeAsync(60_000); expect(s.recover).toHaveBeenCalledTimes(2); s.stop();
});

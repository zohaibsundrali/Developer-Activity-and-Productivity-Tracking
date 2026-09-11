import { describe, it, expect } from 'vitest';
import { createNotificationRequestGuard } from '../src/utils/notificationRequestGuard';
const identity = (org, type, id) => JSON.stringify([org,type,id]);
describe('notification request ownership', () => {
  it.each([
    [identity('org','admin','same'),identity('org','developer','same')],
    [identity('org','developer','same'),identity('other','developer','same')],
    [identity('org','developer','same'),identity(null,null,null)],
  ])('discards pending results when identity changes', async (first, second) => {
    const guard=createNotificationRequestGuard();
    const ticket=guard.enter(first);
    let resolve;
    const delayed=new Promise(done=>{resolve=done;});
    let rows=[];
    const load=delayed.then(value=>{if(guard.isCurrent(ticket)) rows=value;});
    const next=guard.enter(second);
    resolve(['private old inbox']);
    await load;
    expect(rows).toEqual([]);
    expect(guard.isCurrent(next)).toBe(true);
  });
  it('rejects an old request even after switching back to the original identity',()=>{
    const guard=createNotificationRequestGuard();
    const old=guard.enter('first');
    guard.enter('second');
    guard.enter('first');
    expect(guard.isCurrent(old)).toBe(false);
  });
  it('keeps same-identity rerenders valid and stops work after unmount',()=>{
    const guard=createNotificationRequestGuard();
    const ticket=guard.enter('same');
    expect(guard.enter('same')).toBe(ticket);
    guard.deactivate();
    expect(guard.isCurrent(ticket)).toBe(false);
    // React StrictMode can re-run the setup without a fresh render.
    guard.activate();
    expect(guard.isCurrent(ticket)).toBe(true);
  });
});

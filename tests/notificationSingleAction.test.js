import { expect, it } from 'vitest';
import { beginUnreadChange, rollbackUnreadChange, settleNotificationAction, claimNotificationAction, createNotificationActionScheduler } from '@/utils/notificationSingleAction';

it('restores a single failed read or dismiss even when the follow-up count also fails', async () => {
  for (const action of ['read', 'dismiss']) {
    const change = beginUnreadChange(1, 4, true);
    expect(change.count).toBe(0);
    const result = await settleNotificationAction(() => Promise.reject(new Error(`${action} offline`)));
    expect(result.error).toBeInstanceOf(Error);
    const count = rollbackUnreadChange(change.count, 4, change);
    expect(count).toBe(1);
    const recount = await settleNotificationAction(() => Promise.reject(new Error('count offline')));
    expect(recount.error).toBeInstanceOf(Error);
    expect(count).toBe(1);
  }
});

it('restores both concurrent failed actions independently in either completion order', () => {
  for (const reversed of [false, true]) {
    const first = beginUnreadChange(2, 1, true);
    const second = beginUnreadChange(first.count, 1, true);
    let count = second.count;
    for (const change of reversed ? [second, first] : [first, second]) {
      count = rollbackUnreadChange(count, 1, change);
    }
    expect(count).toBe(2);
  }
});

it('never overwrites a newer authoritative count or another identity', () => {
  const change = beginUnreadChange(5, 3, true);
  expect(rollbackUnreadChange(8, 4, change)).toBeNull();
  expect(rollbackUnreadChange(0, 5, change)).toBeNull();
});

it('does not invent an unread count for an already read, missing or zero-count row', () => {
  for (const [count, unread] of [[3, false], [3, undefined], [0, true]]) {
    const change = beginUnreadChange(count, 1, unread);
    expect(change.count).toBe(count);
    expect(rollbackUnreadChange(count, 1, change)).toBeNull();
  }
});

it('preserves returned errors and captures synchronous exceptions', async () => {
  const error = new Error('write failed');
  expect(await settleNotificationAction(() => ({ error }))).toEqual({ error });
  expect(await settleNotificationAction(() => { throw error; })).toEqual({ error });
  expect((await settleNotificationAction(() => null)).error).toBeInstanceOf(Error);
});

it('deduplicates simultaneous read/dismiss on the same row but permits independent actions', () => {
  const pending = new Set();
  const releaseRead = claimNotificationAction(pending, 'identity1:row1');
  expect(releaseRead).toBeTypeOf('function');
  expect(claimNotificationAction(pending, 'identity1:row1')).toBeNull();
  const releaseOther = claimNotificationAction(pending, 'identity1:row2');
  expect(releaseOther).toBeTypeOf('function');
  releaseRead();
  expect(claimNotificationAction(pending, 'identity1:row1')).toBeTypeOf('function');
  releaseOther();
});

it('finishing an old identity action cannot unlock the new identity same-row action', () => {
  const pending = new Set();
  const oldRelease = claimNotificationAction(pending, 'identity1:row1');
  const newRelease = claimNotificationAction(pending, 'identity2:row1');
  oldRelease();
  expect(claimNotificationAction(pending, 'identity2:row1')).toBeNull();
  newRelease();
});

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

it('serializes overlapping single and bulk offline failures without losing either rollback', async () => {
  for (const bulkFirst of [false, true]) {
    const scheduler = createNotificationActionScheduler();
    let count = 2, epoch = 0;
    const entered = [];
    const singleGate = deferred(), bulkGate = deferred();
    const single = () => scheduler.single(async () => {
      entered.push('single');
      const change = beginUnreadChange(count, epoch, true);
      count = change.count;
      await singleGate.promise;
      count = rollbackUnreadChange(count, epoch, change) ?? count;
    });
    const bulk = () => scheduler.bulk(async () => {
      entered.push('bulk');
      const before = count;
      epoch++; count = 0;
      await bulkGate.promise;
      epoch++; count = before;
    });
    const first = bulkFirst ? bulk() : single();
    const second = bulkFirst ? single() : bulk();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(entered).toEqual([bulkFirst ? 'bulk' : 'single']);
    (bulkFirst ? bulkGate : singleGate).resolve();
    await first;
    (bulkFirst ? singleGate : bulkGate).resolve();
    await second;
    expect(count).toBe(2);
    expect(entered).toEqual(bulkFirst ? ['bulk', 'single'] : ['single', 'bulk']);
  }
});

it('keeps unrelated single actions concurrent and continues after rejected actions', async () => {
  const scheduler = createNotificationActionScheduler();
  const gate = deferred(); const entered = [];
  const first = scheduler.single(async () => { entered.push('one'); await gate.promise; throw new Error('offline'); });
  const second = scheduler.single(async () => { entered.push('two'); await gate.promise; });
  await Promise.resolve();
  expect(entered).toEqual(['one', 'two']);
  const bulk = scheduler.bulk(() => entered.push('bulk'));
  gate.resolve(); await Promise.allSettled([first, second, bulk]);
  expect(entered).toEqual(['one', 'two', 'bulk']);
});

it('a fresh identity scheduler is not blocked by the old identity bulk request', async () => {
  const oldScheduler = createNotificationActionScheduler();
  const blocked = deferred();
  const oldBulk = oldScheduler.bulk(() => blocked.promise);
  const currentScheduler = createNotificationActionScheduler();
  let ran = false;
  await currentScheduler.single(() => { ran = true; });
  expect(ran).toBe(true);
  blocked.resolve(); await oldBulk;
});

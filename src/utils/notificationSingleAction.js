/** Each failed action restores only its own optimistic decrement. */
export function beginUnreadChange(count, epoch, unread) {
  const delta = unread && count > 0 ? 1 : 0;
  return { epoch, delta, count: Math.max(0, count - delta) };
}

export function rollbackUnreadChange(currentCount, currentEpoch, change) {
  // A successful server count (or a newer bulk action) already supersedes this estimate.
  return change && currentEpoch === change.epoch && change.delta
    ? currentCount + change.delta : null;
}

export async function settleNotificationAction(action) {
  try {
    const result = await action();
    return result || { error: new Error('Notification update was not confirmed') };
  } catch (error) {
    return { error };
  }
}

/** Read and dismiss share the same per-row lock; unrelated rows remain concurrent. */
export function claimNotificationAction(pending, key) {
  if (pending.has(key)) return null;
  pending.add(key);
  return () => pending.delete(key);
}

/** Independent rows may run together; bulk actions are exclusive barriers. */
export function createNotificationActionScheduler() {
  let barrier = Promise.resolve();
  const singles = new Set();
  return {
    single(action) {
      const result = barrier.then(action);
      singles.add(result);
      result.then(() => singles.delete(result), () => singles.delete(result));
      return result;
    },
    bulk(action) {
      const result = Promise.allSettled([barrier, ...singles]).then(action);
      barrier = result.then(() => undefined, () => undefined);
      return result;
    },
  };
}

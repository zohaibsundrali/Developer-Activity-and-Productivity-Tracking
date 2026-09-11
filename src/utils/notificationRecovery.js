/** Keep each query below the normal page cap, even after many Load more clicks. */
export async function fetchNotificationRecovery(fetcher, options, lastPage) {
  const rows = [];
  const seen = new Set();
  let hasMore = false;
  let page = 0;
  for (; page <= Math.max(0, lastPage); page += 1) {
    const result = await fetcher({ ...options, page });
    if (result.error) return { rows: [], hasMore: false, error: result.error };
    for (const row of result.rows || []) if (!seen.has(row.id)) { seen.add(row.id); rows.push(row); }
    hasMore = result.hasMore;
    if (!hasMore) break;
  }
  return { rows, hasMore, error: null, page: Math.min(page, Math.max(0, lastPage)) };
}

/** Undo only this optimistic bulk write, preserving newer realtime changes. */
export function rollbackNotificationRead(rows, snapshot, optimisticReadAt) {
  const previous = new Map(snapshot.map(row => [row.id, row]));
  return rows.map(row => {
    const original = previous.get(row.id);
    if (!original || original.read || row.read_at !== optimisticReadAt) return row;
    return { ...row, read: original.read, read_at: original.read_at };
  });
}

export function notificationReconnect(status, { isCurrent, reconcile }) {
  if (status === 'SUBSCRIBED' && isCurrent()) reconcile();
}

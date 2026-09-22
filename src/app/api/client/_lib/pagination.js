// PostgREST caps individual responses. A capped page must never become a
// project's total. Query factories must retain tenant/visibility filters and
// include a unique final order (normally id) on every page.
const PAGE_SIZE = 500;
const MAX_ROWS = 50000;
export async function readClientRows(query, { key = 'id' } = {}) {
  try {
    const rows = [], seen = new Set();
    let expected;
    do {
      const { data, count, error } = await query().range(rows.length, rows.length + PAGE_SIZE - 1);
      if (error) throw error;
      if (!Number.isSafeInteger(count) || count < 0 || count > MAX_ROWS || !Array.isArray(data)
        || (expected !== undefined && count !== expected)) throw new Error('Client records changed or could not be fully loaded. Retry.');
      expected = count;
      if (data.length > PAGE_SIZE || rows.length + data.length > expected || (!data.length && rows.length < expected)) throw new Error('Client records are incomplete. Retry.');
      for (const row of data) {
        if (!row?.[key] || seen.has(row[key])) throw new Error('Client records changed during loading. Retry.');
        seen.add(row[key]); rows.push(row);
      }
    } while (rows.length < expected);
    return { data: rows, error: null };
  } catch (error) { return { data: null, error }; }
}

// Keep .in() URL filters below proxy limits even for thousands of linked tasks.
export async function readClientRowsIn(ids, query, options) {
  const rows = [], unique = [...new Set(ids)];
  for (let offset = 0; offset < unique.length; offset += 100) {
    const result = await readClientRows(() => query(unique.slice(offset, offset + 100)), options);
    if (result.error) return result;
    rows.push(...result.data);
    if (rows.length > MAX_ROWS) return { data: null, error: new Error('Too many client records to load together.') };
  }
  return { data: rows, error: null };
}

/** Monitoring needs display identities, never credentials or rich HR profiles. */
export async function loadMonitoringRoster(client, organizationId, current = () => true) {
  if (!organizationId) throw new Error('Your organization could not be confirmed.');
  const rows = [], seen = new Set();
  let total = null;
  while (true) {
    if (!current()) return null;
    const { data, error, count } = await client.from('developers').select('id, name, email', { count: 'exact' })
      .eq('organization_id', organizationId).order('name').order('id').range(rows.length, rows.length + 499);
    if (!current()) return null;
    if (error || !Array.isArray(data) || !Number.isSafeInteger(count) || count < 0 || data.length > 500
      || (total !== null && total !== count)) throw new Error('Could not load the complete monitoring roster. Please retry.');
    total = count;
    for (const row of data) {
      if (typeof row?.id !== 'string' || !row.id || seen.has(row.id)) throw new Error('Monitoring roster changed while loading. Please retry.');
      seen.add(row.id);
      rows.push({ id: row.id, name: row.name, email: row.email });
    }
    if (rows.length > total || (!data.length && rows.length !== total)) throw new Error('Monitoring roster changed while loading. Please retry.');
    if (rows.length === total) return rows;
  }
}

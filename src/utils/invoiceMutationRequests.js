/** Confirm scoped invoice writes; a successful HTTP request can still affect no rows. */
export function confirmInvoiceMutation(data, organizationId, invoice, patch = {}) {
  if (!data || typeof data !== 'object' || Array.isArray(data)
    || data.id !== invoice.id || data.organization_id !== organizationId
    || data.client_id !== (Object.hasOwn(patch, 'client_id') ? patch.client_id : (invoice.client_id ?? null))
    || Object.entries(patch).some(([key, value]) => data[key] !== value)) {
    throw new Error('Invoice update was not confirmed. Reload the invoices and check your access before retrying.');
  }
  return data;
}

export async function updateInvoiceRecord(client, organizationId, invoice, patch) {
  if (!organizationId || !invoice?.id || invoice.organization_id !== organizationId
    || !Object.keys(patch).length || Object.keys(patch).some(key => !['status', 'pdf_path', 'client_id'].includes(key))) {
    throw new Error('The invoice does not match this organization. Reload before retrying.');
  }
  const changesClient = Object.hasOwn(patch, 'client_id');
  if (changesClient && (invoice.status !== 'draft' || Object.keys(patch).length !== 1
    || (patch.client_id !== null && (typeof patch.client_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(patch.client_id))))) {
    throw new Error('Choose a valid client for a draft invoice. Reload before retrying.');
  }
  let query = client.from('invoices').update(patch)
    .eq('organization_id', organizationId).eq('id', invoice.id);
  query = invoice.client_id == null ? query.is('client_id', null) : query.eq('client_id', invoice.client_id);
  if (changesClient) query = query.eq('status', 'draft');
  // Refuse a stale screen overwriting another user's status/PDF change.
  for (const key of Object.keys(patch)) {
    if (key === 'client_id') continue; // Already compared against the original recipient above.
    query = invoice[key] == null ? query.is(key, null) : query.eq(key, invoice[key]);
  }
  const { data, error } = await query.select('id, organization_id, client_id, status, pdf_path').maybeSingle();
  if (error) throw error;
  return confirmInvoiceMutation(data, organizationId, invoice, changesClient ? { ...patch, status: 'draft' } : patch);
}

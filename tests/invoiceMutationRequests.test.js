import { describe, expect, it, vi } from 'vitest';
import { confirmInvoiceMutation, updateInvoiceRecord } from '@/utils/invoiceMutationRequests';

const invoice = { id: 'invoice', organization_id: 'org', client_id: 'client', status: 'draft', pdf_path: null };
function clientFor(result) {
  const filters = [];
  const q = { update: vi.fn(() => q), eq: (key, value) => { filters.push(['eq', key, value]); return q; },
    is: (key, value) => { filters.push(['is', key, value]); return q; }, select: () => q,
    maybeSingle: vi.fn(async () => result) };
  return { client: { from: vi.fn(() => q) }, q, filters };
}

describe('invoice mutation acknowledgement', () => {
  it('rejects silent zero-row updates and never reports success', async () => {
    const { client } = clientFor({ data: null, error: null });
    await expect(updateInvoiceRecord(client, 'org', invoice, { status: 'sent' })).rejects.toThrow('not confirmed');
  });

  it('binds status updates to org, client, ID and observed status', async () => {
    const fixture = clientFor({ data: { ...invoice, status: 'sent' }, error: null });
    await expect(updateInvoiceRecord(fixture.client, 'org', invoice, { status: 'sent' })).resolves.toMatchObject({ status: 'sent' });
    expect(fixture.filters).toEqual([['eq', 'organization_id', 'org'], ['eq', 'id', 'invoice'], ['eq', 'client_id', 'client'], ['eq', 'status', 'draft']]);
  });

  it('compares nullable client and PDF before replacing a path', async () => {
    const original = { ...invoice, client_id: null };
    const fixture = clientFor({ data: { ...original, pdf_path: 'org/invoice/file.pdf' }, error: null });
    await updateInvoiceRecord(fixture.client, 'org', original, { pdf_path: 'org/invoice/file.pdf' });
    expect(fixture.filters).toContainEqual(['is', 'client_id', null]);
    expect(fixture.filters).toContainEqual(['is', 'pdf_path', null]);
  });

  it('refuses mismatched identity or patch receipts', () => {
    for (const data of [null, [], { ...invoice, id: 'other' }, { ...invoice, organization_id: 'other' },
      { ...invoice, client_id: 'other' }, invoice]) {
      expect(() => confirmInvoiceMutation(data, 'org', invoice, { status: 'sent' })).toThrow('not confirmed');
    }
  });

  it('refuses stale organization and unsupported mutation before writing', async () => {
    const fixture = clientFor({ data: invoice, error: null });
    await expect(updateInvoiceRecord(fixture.client, 'other', invoice, { status: 'sent' })).rejects.toThrow();
    await expect(updateInvoiceRecord(fixture.client, 'org', invoice, { amount: 100 })).rejects.toThrow();
    expect(fixture.client.from).not.toHaveBeenCalled();
  });

  it('preserves database errors for visible failure handling', async () => {
    const error = new Error('Permission revoked');
    const fixture = clientFor({ data: null, error });
    await expect(updateInvoiceRecord(fixture.client, 'org', invoice, { status: 'sent' })).rejects.toBe(error);
  });
});

describe('draft invoice recipient changes', () => {
  const nextClient = '10000000-0000-4000-8000-000000000001';
  it('assigns an unassigned draft using original recipient and draft status comparisons', async () => {
    const original = { ...invoice, client_id: null };
    const fixture = clientFor({ data: { ...original, client_id: nextClient }, error: null });
    await expect(updateInvoiceRecord(fixture.client, 'org', original, { client_id: nextClient })).resolves.toMatchObject({ client_id: nextClient, status: 'draft' });
    expect(fixture.filters).toEqual([['eq', 'organization_id', 'org'], ['eq', 'id', 'invoice'], ['is', 'client_id', null], ['eq', 'status', 'draft']]);
    expect(fixture.q.update).toHaveBeenCalledWith({ client_id: nextClient });
  });
  it('can explicitly remove the recipient from a draft', async () => {
    const fixture = clientFor({ data: { ...invoice, client_id: null }, error: null });
    await expect(updateInvoiceRecord(fixture.client, 'org', invoice, { client_id: null })).resolves.toMatchObject({ client_id: null });
    expect(fixture.filters).toContainEqual(['eq', 'client_id', 'client']);
    expect(fixture.filters).toContainEqual(['eq', 'status', 'draft']);
  });
  it('rejects concurrent publication, replacement, or zero-row acknowledgement', async () => {
    for (const data of [null, invoice, { ...invoice, client_id: nextClient, status: 'sent' }]) {
      const fixture = clientFor({ data, error: null });
      await expect(updateInvoiceRecord(fixture.client, 'org', invoice, { client_id: nextClient })).rejects.toThrow('not confirmed');
    }
  });
  it.each(['sent', 'paid', 'void'])('never changes a %s invoice recipient through this draft-only helper', async status => {
    const fixture = clientFor({ data: null, error: null });
    await expect(updateInvoiceRecord(fixture.client, 'org', { ...invoice, status }, { client_id: nextClient })).rejects.toThrow('draft invoice');
    expect(fixture.client.from).not.toHaveBeenCalled();
  });
  it.each(['', 'other', [nextClient], undefined])('rejects malformed recipient %j before writing', async client_id => {
    const fixture = clientFor({ data: null, error: null });
    await expect(updateInvoiceRecord(fixture.client, 'org', invoice, { client_id })).rejects.toThrow();
    expect(fixture.client.from).not.toHaveBeenCalled();
  });
  it('does not combine assignment with publishing a draft', async () => {
    const fixture = clientFor({ data: null, error: null });
    await expect(updateInvoiceRecord(fixture.client, 'org', invoice, { client_id: nextClient, status: 'sent' })).rejects.toThrow();
    expect(fixture.client.from).not.toHaveBeenCalled();
  });
});

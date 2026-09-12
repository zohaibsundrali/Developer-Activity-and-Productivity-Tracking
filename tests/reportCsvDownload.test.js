import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), download: vi.fn() }));
vi.mock('@/utils/authFetch', () => ({ authFetch: (...args) => mocks.fetch(...args) }));
vi.mock('@/utils/reportExport', () => ({ downloadReportBlob: (...args) => mocks.download(...args) }));
import { exportReportCsv } from '@/utils/reportCsvDownload';
const range = { from: '2026-09-01', to: '2026-09-12' };
const encoder = new TextEncoder();
function streamResponse(reads = [], { status = 200, contentType = 'text/csv;charset=utf-8' } = {}) {
  const reader = { read: vi.fn(), cancel: vi.fn(async () => {}), releaseLock: vi.fn() };
  for (const read of reads) typeof read === 'function' ? reader.read.mockImplementationOnce(read) : reader.read.mockResolvedValueOnce(read);
  reader.read.mockResolvedValue({ done: true });
  const body = { getReader: vi.fn(() => reader), cancel: vi.fn(async () => {}) };
  const response = { ok: status >= 200 && status < 300, status, headers: new Headers({ 'Content-Type': contentType }), body, json: vi.fn(async () => ({ error: 'Export unavailable' })) };
  return { response, reader, body };
}
beforeEach(() => { mocks.fetch.mockReset(); mocks.download.mockReset(); });
describe('complete streamed report CSV download', () => {
  it('waits for the final stream read before starting the browser download', async () => {
    let finish;
    const final = new Promise(resolve => { finish = resolve; });
    const streamed = streamResponse([{ value: encoder.encode('header\r\n'), done: false }, () => final]);
    mocks.fetch.mockResolvedValue(streamed.response);
    const pending = exportReportCsv(range, 'time');
    await vi.waitFor(() => expect(streamed.reader.read).toHaveBeenCalledTimes(2));
    expect(mocks.download).not.toHaveBeenCalled();
    finish({ done: true }); await pending;
    expect(mocks.download).toHaveBeenCalledTimes(1);
    expect(await mocks.download.mock.calls[0][0].text()).toBe('header\r\n');
    expect(streamed.reader.releaseLock).toHaveBeenCalledTimes(1);
  });
  it('never downloads a partial file if a later stream read fails', async () => {
    const streamed = streamResponse([{ value: encoder.encode('first page\r\n'), done: false }, () => Promise.reject(new Error('connection lost'))]);
    mocks.fetch.mockResolvedValue(streamed.response);
    await expect(exportReportCsv(range, 'projects')).rejects.toThrow('connection lost');
    expect(mocks.download).not.toHaveBeenCalled(); expect(streamed.reader.releaseLock).toHaveBeenCalledOnce();
  });
  it('cancels before fetching when the scope is already stale', async () => {
    await exportReportCsv(range, 'team', { shouldContinue: () => false });
    expect(mocks.fetch).not.toHaveBeenCalled(); expect(mocks.download).not.toHaveBeenCalled();
  });
  it('cancels the response body if the scope changes while awaiting headers', async () => {
    let active = true; const streamed = streamResponse();
    mocks.fetch.mockImplementation(async () => { active = false; return streamed.response; });
    await exportReportCsv(range, 'time', { shouldContinue: () => active });
    expect(streamed.body.cancel).toHaveBeenCalledOnce(); expect(streamed.body.getReader).not.toHaveBeenCalled(); expect(mocks.download).not.toHaveBeenCalled();
  });
  it('cancels the reader and drops accumulated chunks when the scope changes during a read', async () => {
    let active = true;
    const streamed = streamResponse([() => { active = false; return Promise.resolve({ value: encoder.encode('private data'), done: false }); }]);
    mocks.fetch.mockResolvedValue(streamed.response);
    await exportReportCsv(range, 'team', { shouldContinue: () => active });
    expect(streamed.reader.cancel).toHaveBeenCalledOnce(); expect(streamed.reader.releaseLock).toHaveBeenCalledOnce();
    expect(streamed.reader.read).toHaveBeenCalledOnce(); expect(mocks.download).not.toHaveBeenCalled();
  });
  it('does not download if scope changes at end-of-stream', async () => {
    let active = true;
    const streamed = streamResponse([{ value: encoder.encode('private data'), done: false }, () => { active = false; return Promise.resolve({ done: true }); }]);
    mocks.fetch.mockResolvedValue(streamed.response);
    await exportReportCsv(range, 'team', { shouldContinue: () => active });
    expect(streamed.reader.releaseLock).toHaveBeenCalledOnce(); expect(mocks.download).not.toHaveBeenCalled();
  });
  it.each([401,403,402,503])('rejects HTTP %s without creating a file', async status => {
    const streamed = streamResponse([], { status }); mocks.fetch.mockResolvedValue(streamed.response);
    await expect(exportReportCsv(range, 'projects')).rejects.toThrow('Export unavailable');
    expect(streamed.body.getReader).not.toHaveBeenCalled(); expect(mocks.download).not.toHaveBeenCalled();
  });
  it.each(['application/json', 'text/html', 'application/octet-stream', 'text/csv-evil', 'text/csvjunk'])('rejects unexpected content type %s', async contentType => {
    const streamed = streamResponse([], { contentType }); mocks.fetch.mockResolvedValue(streamed.response);
    await expect(exportReportCsv(range, 'time')).rejects.toThrow('confirm');
    expect(streamed.body.getReader).not.toHaveBeenCalled(); expect(mocks.download).not.toHaveBeenCalled();
    expect(streamed.body.cancel).toHaveBeenCalledOnce();
  });
  it('accepts an exact CSV MIME type with case-insensitive spelling and charset parameters', async () => {
    const streamed = streamResponse([], { contentType: 'TEXT/CSV; charset=UTF-8' });
    mocks.fetch.mockResolvedValue(streamed.response);
    await exportReportCsv(range, 'time');
    expect(mocks.download).toHaveBeenCalledOnce(); expect(streamed.body.cancel).not.toHaveBeenCalled();
  });
  it('rejects a missing stream body instead of downloading an empty file', async () => {
    const streamed = streamResponse(); streamed.response.body = null; mocks.fetch.mockResolvedValue(streamed.response);
    await expect(exportReportCsv(range, 'time')).rejects.toThrow('could not start'); expect(mocks.download).not.toHaveBeenCalled();
  });
  it('preserves BOM and Unicode bytes split across arbitrary stream chunks', async () => {
    const text = '\uFEFFName,Hours\r\nعلی,2\r\nZohaib 😀,3'; const bytes = encoder.encode(text);
    const streamed = streamResponse(Array.from(bytes, byte => ({ value: Uint8Array.of(byte), done: false })));
    mocks.fetch.mockResolvedValue(streamed.response);
    await exportReportCsv(range, 'team');
    const blob = mocks.download.mock.calls[0][0];
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes); expect(blob.type).toBe('text/csv;charset=utf-8;');
  });
  it('uses a sanitized bounded filename and sends the exact view and date range', async () => {
    mocks.fetch.mockResolvedValue(streamResponse().response);
    await exportReportCsv(range, 'projects', { filename: '../../Payroll / α?*.csv' });
    expect(mocks.download.mock.calls[0][1]).toBe('.._.._Payroll_.csv_2026-09-01_2026-09-12.csv');
    const url = new URL(mocks.fetch.mock.calls[0][0], 'http://localhost');
    expect(url.pathname).toBe('/api/reports/export'); expect(Object.fromEntries(url.searchParams)).toEqual({ ...range, view: 'projects' });
    mocks.fetch.mockResolvedValue(streamResponse().response); await exportReportCsv(range, 'team', { filename: 'x'.repeat(200) });
    expect(mocks.download.mock.calls[1][1]).toBe(`${'x'.repeat(80)}_${range.from}_${range.to}.csv`);
  });
});

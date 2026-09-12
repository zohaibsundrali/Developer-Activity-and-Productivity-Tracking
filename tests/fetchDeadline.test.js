import { describe, expect, it, vi } from 'vitest';
import { fetchWithDeadline } from '@/utils/fetchDeadline';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
describe('background provider request deadlines', () => {
  it('keeps the deadline active after response headers arrive', async () => {
    let signal;
    const fetcher = vi.fn(async (_input, options) => { signal = options.signal; return { headersReceived: true }; });
    const response = await fetchWithDeadline(20, fetcher)('https://example.test', { headers: { 'x-test': 'safe' } });
    expect(response.headersReceived).toBe(true);
    expect(signal.aborted).toBe(false);
    await delay(40);
    expect(signal.aborted).toBe(true);
    expect(signal.reason.name).toBe('TimeoutError');
    expect(fetcher.mock.calls[0][1].headers).toEqual({ 'x-test': 'safe' });
  });
  it('retains caller cancellation and uses a fresh deadline for each request', async () => {
    const signals = [];
    const fetcher = async (_url, options) => { signals.push(options.signal); return {}; };
    const controller = new AbortController();
    const bounded = fetchWithDeadline(500, fetcher);
    await bounded('https://example.test/a', { signal: controller.signal });
    await bounded('https://example.test/b');
    controller.abort();
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
  });
  it('preserves a Request object cancellation signal', async () => {
    const controller = new AbortController();
    const request = new Request('https://example.test', { signal: controller.signal });
    const fetcher = vi.fn(async () => ({}));
    await fetchWithDeadline(500, fetcher)(request);
    controller.abort();
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
  });
  it.each([0, -1, Infinity, 60001, 1.5])('refuses invalid deadlines: %s', ms => {
    expect(() => fetchWithDeadline(ms)).toThrow(RangeError);
  });
});

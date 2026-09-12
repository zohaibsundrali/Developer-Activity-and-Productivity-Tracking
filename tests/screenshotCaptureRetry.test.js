import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ auth: null }));
vi.mock('@/utils/deviceAuth', () => ({ verifyDeviceRequest: vi.fn(async () => state.auth) }));
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => ({})) }));
vi.mock('@/utils/systemEvents', () => ({ recordEvent: vi.fn() }));
vi.mock('@/utils/rateLimit', () => ({ rateLimited: vi.fn(() => false) }));
import { POST } from '@/app/api/upload-screenshot/route';
const dev = '11111111-1111-1111-1111-111111111111';
const org = '22222222-2222-2222-2222-222222222222';
const capture = '33333333-3333-3333-3333-333333333333';
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const path = `${org}/${dev}/capture_${capture}.png`;
let client, bucket, receipt;
function request(extra = {}) {
  return new Request('http://localhost/api/upload-screenshot', { method: 'POST', body: JSON.stringify({ developer_id: dev, image_data: png, capture_id: capture, timestamp: '2026-09-12T08:00:00.000Z', ...extra }) });
}
beforeEach(() => {
  receipt = null;
  bucket = { upload: vi.fn(async () => ({ error: null })), download: vi.fn(async () => ({ data: new Blob([Buffer.from(png, 'base64')]), error: null })) };
  client = {
    from: vi.fn(table => {
      const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: table === 'developers' ? { id: dev, organization_id: org, email: 'verified@example.test' } : receipt, error: null }) };
      return query;
    }),
    storage: { from: vi.fn(() => bucket) },
    rpc: vi.fn(async (_name, args) => _name === 'get_screenshot_policy' ? { data: { organization_id: org, enabled: true, interval_seconds: 60 }, error: null } : ({ data: { success: true, capture_id: args.p_capture_id, storage_path: args.p_metadata.storage_path }, error: null })),
  };
  state.auth = { allow: true, authenticated: true, developerId: dev, orgId: org, client };
});
describe('device screenshot durable receipt', () => {
  it('derives required metadata from verified identity and PNG bytes, uploads immutably', async () => {
    expect((await POST(request({ developer_email: 'spoof@example.test', width: 999 }))).status).toBe(200);
    const metadata = client.rpc.mock.calls.find(([name]) => name === 'finalize_screenshot_capture')[1].p_metadata;
    expect(metadata).toMatchObject({ developer_email: 'verified@example.test', width: 1, height: 1, size_kb: Number((Buffer.from(png, 'base64').length / 1024).toFixed(2)), mime_type: 'image/png', public_url: null, storage_path: path });
    expect(client.rpc.mock.calls[0][0]).toBe('get_screenshot_policy');
    expect(bucket.upload.mock.calls[0][2]).toEqual({ contentType: 'image/png', upsert: false });
  });
  it('retries a lost upload response by verifying committed bytes', async () => {
    bucket.upload.mockRejectedValueOnce(new Error('network outcome unknown'));
    expect((await POST(request())).status).toBe(200);
    expect(bucket.download).toHaveBeenCalledWith(path);
    expect(client.rpc).toHaveBeenCalledTimes(2);
  });
  it('never acknowledges or overwrites conflicting stored bytes', async () => {
    bucket.upload.mockResolvedValue({ error: { message: 'duplicate' } });
    const changed = Buffer.from(png, 'base64'); changed[30] ^= 1;
    bucket.download.mockResolvedValue({ data: new Blob([changed]), error: null });
    expect((await POST(request())).status).toBe(409);
    expect(client.rpc.mock.calls.some(([name]) => name === 'finalize_screenshot_capture')).toBe(false);
    expect(bucket.upload).toHaveBeenCalledTimes(1);
  });
  it('rejects conflicting metadata before touching storage', async () => {
    await POST(request());
    receipt = { storage_path: path, capture_metadata: client.rpc.mock.calls.find(([name]) => name === 'finalize_screenshot_capture')[1].p_metadata };
    bucket.upload.mockClear(); client.rpc.mockClear();
    expect((await POST(request({ context: 'different' }))).status).toBe(409);
    expect(bucket.upload).not.toHaveBeenCalled();
    expect(client.rpc.mock.calls.some(([name]) => name === 'finalize_screenshot_capture')).toBe(false);
  });
  it('reuses the committed timestamp when an older client omitted it', async () => {
    await POST(request());
    receipt = { storage_path: path, capture_metadata: client.rpc.mock.calls.find(([name]) => name === 'finalize_screenshot_capture')[1].p_metadata };
    bucket.upload.mockResolvedValue({ error: { message: 'duplicate' } });
    expect((await POST(request({ timestamp: undefined }))).status).toBe(200);
    expect(client.rpc.mock.calls.filter(([name]) => name === 'finalize_screenshot_capture')[1][1].p_metadata).toEqual(receipt.capture_metadata);
  });
  it.each([[{ message: 'PLAN_LIMIT_REACHED: screenshots' }, 402], [{ code: '42501' }, 403], [{ message: 'timeout' }, 503], [{ message: 'SCREENSHOT_CAPTURE_CONFLICT' }, 409]])('does not return success on failed finalization %j', async (error, status) => {
    client.rpc.mockImplementation(async name => name === 'get_screenshot_policy' ? { data: { organization_id: org, enabled: true } } : { error });
    expect((await POST(request())).status).toBe(status);
    expect(bucket.upload).toHaveBeenCalledTimes(1);
  });
  it('never resurrects a deleted object after metadata was already committed', async () => {
    await POST(request());
    receipt = { storage_path: path, capture_metadata: client.rpc.mock.calls.find(([name]) => name === 'finalize_screenshot_capture')[1].p_metadata };
    bucket.upload.mockClear(); client.rpc.mockClear();
    bucket.download.mockResolvedValue({ error: { message: 'not found' }, data: null });
    expect((await POST(request())).status).toBe(503);
    expect(bucket.upload).not.toHaveBeenCalled();
    expect(client.rpc.mock.calls.some(([name]) => name === 'finalize_screenshot_capture')).toBe(false);
  });
  it('leaves unknown storage outcomes unacknowledged', async () => {
    bucket.upload.mockResolvedValue({ error: { message: 'timeout' } });
    bucket.download.mockRejectedValue(new Error('timeout'));
    expect((await POST(request())).status).toBe(503);
    expect(client.rpc.mock.calls.some(([name]) => name === 'finalize_screenshot_capture')).toBe(false);
  });
  it.each([
    [{ data: { organization_id: org, enabled: false } }, 403],
    [{ error: { message: 'unavailable' } }, 503],
    [{ data: { organization_id: dev, enabled: true } }, 503],
    [{ data: { organization_id: org, enabled: 'true' } }, 503],
  ])('blocks new bytes when policy is disabled or cannot be verified', async (result, status) => {
    client.rpc.mockResolvedValue(result);
    expect((await POST(request())).status).toBe(status);
    expect(bucket.upload).not.toHaveBeenCalled();
    expect(bucket.download).not.toHaveBeenCalled();
  });
  it('allows exact receipt acknowledgment after the policy is disabled', async () => {
    await POST(request());
    receipt = { storage_path: path, capture_metadata: client.rpc.mock.calls.find(([name]) => name === 'finalize_screenshot_capture')[1].p_metadata };
    client.rpc.mockClear(); bucket.upload.mockClear();
    expect((await POST(request())).status).toBe(200);
    expect(client.rpc.mock.calls.map(([name]) => name)).toEqual(['finalize_screenshot_capture']);
    expect(bucket.upload).not.toHaveBeenCalled();
  });
  it('validates identity, UUID, PNG dimensions and JSON before storage', async () => {
    expect((await POST(request({ developer_id: org }))).status).toBe(403);
    expect((await POST(request({ capture_id: '../evil' }))).status).toBe(400);
    const invalid = Buffer.from(png, 'base64'); invalid.writeUInt32BE(0, 16);
    expect((await POST(request({ image_data: invalid.toString('base64') }))).status).toBe(415);
    expect((await POST(new Request('http://localhost', { method: 'POST', body: '{' }))).status).toBe(400);
    expect(bucket.upload).not.toHaveBeenCalled();
  });
});

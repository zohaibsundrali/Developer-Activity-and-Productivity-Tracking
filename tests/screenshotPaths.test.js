import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Screenshot storage path shape + read-path resolution.
 *
 * These tests exist because the previous legacy detector keyed off a
 * `screenshots/` path PREFIX that has never existed in this project's data. The
 * captures live in a separate PUBLIC bucket named `screenshots`, keyed
 * `{email_local_part}/{file}.jpg`, so every legacy row was misclassified as
 * private, failed to sign, and fell through to its world-readable public_url.
 *
 * The two invariants worth pinning forever:
 *   1. the upload route, the reader and the migration script agree on the key
 *      shape that migration 040's storage policy can actually read;
 *   2. the reader prefers a signed URL and treats public_url as a fallback.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// resolveScreenshotUrls talks to the Supabase storage client at module scope, so
// the client is mocked before the module under test is imported.
const createSignedUrls = vi.fn();
const createSignedUrl = vi.fn();

vi.mock('@/utils/supabaseClient', () => ({
  supabase: {
    storage: { from: () => ({ createSignedUrls, createSignedUrl }) },
    from: () => ({ select: () => ({ or: () => ({ count: 0, error: null }) }) }),
  },
}));

const {
  isMonitoringPath,
  buildMonitoringPath,
  isPrivateScreenshot,
  resolveScreenshotUrl,
  resolveScreenshotUrls,
  SCREENSHOT_BUCKET,
  LEGACY_PUBLIC_BUCKET,
  UNASSIGNED_ORG_SEGMENT,
} = await import('@/utils/screenshotFiles');

const ORG = '15e9b618-77d9-48a3-a32f-f1c4ba7b830b';
const DEV = 'ffb61eac-166e-4aff-a2f8-b779b86908fe';

beforeEach(() => {
  createSignedUrls.mockReset();
  createSignedUrl.mockReset();
});

describe('buckets', () => {
  it('reads from the private monitoring bucket, never the public one', () => {
    expect(SCREENSHOT_BUCKET).toBe('monitoring');
    expect(LEGACY_PUBLIC_BUCKET).toBe('screenshots');
    expect(SCREENSHOT_BUCKET).not.toBe(LEGACY_PUBLIC_BUCKET);
  });
});

describe('isMonitoringPath — the shape migration 040 can read', () => {
  it('accepts {organization_id}/{developer_id}/{file}', () => {
    expect(isMonitoringPath(`${ORG}/${DEV}/1770000000000-abc.png`)).toBe(true);
  });

  it('accepts the unassigned-organization sentinel in segment 1', () => {
    // 040 PART 15 calls this case out: it can never equal auth_org(), so the
    // object is service-role-only. Fail closed, deliberately.
    expect(isMonitoringPath(`${UNASSIGNED_ORG_SEGMENT}/${DEV}/shot.jpg`)).toBe(true);
  });

  it('rejects a non-uuid in segment 2, because that is the developer id', () => {
    // try_uuid() returns null for these and auth_can_read_member(null) is false,
    // so such an object is unreadable — it must not be treated as migrated.
    expect(isMonitoringPath(`${ORG}/zohaib6511/shot.jpg`)).toBe(false);
    expect(isMonitoringPath(`${ORG}//shot.jpg`)).toBe(false);
  });

  it('rejects a non-uuid in segment 1, because that is the organization id', () => {
    expect(isMonitoringPath(`acme/${DEV}/shot.jpg`)).toBe(false);
  });

  it('rejects the real legacy shape found in the public bucket', () => {
    // This is verbatim from public.screenshots on the live project.
    expect(isMonitoringPath('zohaib6511/screenshot_20260705_105605_570_aaf3ae68.jpg')).toBe(false);
    expect(isMonitoringPath('bsf2204971/screenshot_20260423_182238.jpg')).toBe(false);
  });

  it('rejects the shape migration 019 wrongly assumed the legacy data had', () => {
    expect(isMonitoringPath('screenshots/some-dev/shot.png')).toBe(false);
  });

  it('rejects too-shallow keys and junk', () => {
    expect(isMonitoringPath(`${ORG}/${DEV}`)).toBe(false);
    expect(isMonitoringPath('shot.png')).toBe(false);
    expect(isMonitoringPath('')).toBe(false);
    expect(isMonitoringPath(null)).toBe(false);
    expect(isMonitoringPath(undefined)).toBe(false);
    expect(isMonitoringPath(12345)).toBe(false);
  });

  it('allows nested segments below the developer folder', () => {
    expect(isMonitoringPath(`${ORG}/${DEV}/2026/08/shot.png`)).toBe(true);
  });
});

describe('buildMonitoringPath', () => {
  it('produces a key isMonitoringPath accepts', () => {
    const key = buildMonitoringPath({ organizationId: ORG, developerId: DEV, filename: 'shot.png' });
    expect(key).toBe(`${ORG}/${DEV}/shot.png`);
    expect(isMonitoringPath(key)).toBe(true);
  });

  it('substitutes the unassigned sentinel when the org is missing', () => {
    const key = buildMonitoringPath({ organizationId: null, developerId: DEV, filename: 'shot.png' });
    expect(key).toBe(`${UNASSIGNED_ORG_SEGMENT}/${DEV}/shot.png`);
    expect(isMonitoringPath(key)).toBe(true);
  });

  it('refuses to build a key with no developer id', () => {
    expect(() => buildMonitoringPath({ organizationId: ORG, filename: 'a.png' })).toThrow();
  });
});

describe('the upload route writes the shape the reader expects', () => {
  const routeSource = fs.readFileSync(
    path.join(ROOT, 'src/app/api/upload-screenshot/route.js'),
    'utf8'
  );

  it('keys new objects {org}/{developer}/{ts}-{uuid}.png', () => {
    expect(routeSource).toContain(
      '`${orgPrefix}/${developer.id}/${Date.now()}-${crypto.randomUUID()}.png`'
    );
  });

  it('uploads to the private bucket', () => {
    expect(routeSource).toContain("const SCREENSHOT_BUCKET = 'monitoring'");
  });

  it('the shape it writes is one the reader classifies as private', () => {
    const asWritten = `${ORG}/${DEV}/${Date.now()}-11111111-2222-3333-4444-555555555555.png`;
    expect(isMonitoringPath(asWritten)).toBe(true);
    expect(isPrivateScreenshot({ storage_path: asWritten })).toBe(true);
  });
});

describe('the migration script agrees with the reader', () => {
  const scriptSource = fs.readFileSync(path.join(ROOT, 'scripts/migrate-screenshots.mjs'), 'utf8');

  it('copies into monitoring, out of screenshots', () => {
    expect(scriptSource).toContain('const SOURCE_BUCKET = "screenshots"');
    expect(scriptSource).toContain('const TARGET_BUCKET = "monitoring"');
  });

  it('re-declares the same unassigned sentinel', () => {
    expect(scriptSource).toContain(`const UNASSIGNED_ORG_SEGMENT = "${UNASSIGNED_ORG_SEGMENT}"`);
  });

  it('never deletes and never changes a public flag', () => {
    expect(scriptSource).not.toMatch(/\.remove\(/);
    expect(scriptSource).not.toMatch(/updateBucket|\.public\s*=/);
  });

  it('defaults to a dry run', () => {
    expect(scriptSource).toContain('const DRY = !args.confirm');
    expect(scriptSource).toContain('--confirm-migrate');
  });

  it('requires a project ref that matches .env.local', () => {
    expect(scriptSource).toContain('PROJECT MISMATCH');
    expect(scriptSource).toContain('--project=<ref> is required');
  });
});

describe('read path prefers a signed URL over public_url', () => {
  const PUBLIC_URL = 'https://example.supabase.co/storage/v1/object/public/screenshots/x/y.jpg';

  it('signs a monitoring row and does not return its public_url', async () => {
    const row = { storage_path: `${ORG}/${DEV}/shot.png`, public_url: PUBLIC_URL };
    createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://signed/one' }, error: null });

    const url = await resolveScreenshotUrl(row);

    expect(url).toBe('https://signed/one');
    expect(url).not.toBe(PUBLIC_URL);
    expect(createSignedUrl).toHaveBeenCalledWith(`${ORG}/${DEV}/shot.png`, 600);
  });

  it('signs in batch and overwrites public_url with the signed URL', async () => {
    const rows = [{ storage_path: `${ORG}/${DEV}/a.png`, public_url: PUBLIC_URL }];
    createSignedUrls.mockResolvedValue({
      data: [{ path: `${ORG}/${DEV}/a.png`, signedUrl: 'https://signed/a' }],
      error: null,
    });

    const [out] = await resolveScreenshotUrls(rows);

    expect(out.public_url).toBe('https://signed/a');
  });

  it('a migrated row whose public_url was nulled never regains a public URL', async () => {
    // After the migration public_url is null. If signing fails there is nothing
    // to fall back to, and that is the point — it must not invent one.
    const rows = [{ storage_path: `${ORG}/${DEV}/a.png`, public_url: null }];
    createSignedUrls.mockResolvedValue({ data: null, error: { message: 'denied' } });

    const [out] = await resolveScreenshotUrls(rows);

    expect(out.public_url).toBeNull();
  });

  it('does NOT attempt to sign a legacy row, and renders it from public_url', async () => {
    // The regression that mattered: this row used to be classified private,
    // signed against a bucket that does not hold it, and served publicly via the
    // error fallback. Now it is classified correctly up front.
    const legacy = {
      storage_path: 'zohaib6511/screenshot_20260705_105605_570_aaf3ae68.jpg',
      public_url: PUBLIC_URL,
    };

    expect(isPrivateScreenshot(legacy)).toBe(false);
    const url = await resolveScreenshotUrl(legacy);

    expect(url).toBe(PUBLIC_URL);
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it('only sends monitoring-shaped paths to the signing API', async () => {
    const rows = [
      { storage_path: `${ORG}/${DEV}/a.png`, public_url: null },
      { storage_path: 'zohaib6511/screenshot_20260705_105605_570_aaf3ae68.jpg', public_url: PUBLIC_URL },
      { storage_path: null, public_url: PUBLIC_URL },
    ];
    createSignedUrls.mockResolvedValue({
      data: [{ path: `${ORG}/${DEV}/a.png`, signedUrl: 'https://signed/a' }],
      error: null,
    });

    const out = await resolveScreenshotUrls(rows);

    expect(createSignedUrls).toHaveBeenCalledWith([`${ORG}/${DEV}/a.png`], 600);
    expect(out[0].public_url).toBe('https://signed/a');
    expect(out[1].public_url).toBe(PUBLIC_URL);
    expect(out[2].public_url).toBe(PUBLIC_URL);
  });

  it('falls back to the legacy URL when signing a monitoring row genuinely fails', async () => {
    const row = { storage_path: `${ORG}/${DEV}/shot.png`, public_url: PUBLIC_URL };
    createSignedUrl.mockResolvedValue({ data: null, error: { message: 'boom' } });

    expect(await resolveScreenshotUrl(row)).toBe(PUBLIC_URL);
  });

  it('tolerates a throwing storage client', async () => {
    const row = { storage_path: `${ORG}/${DEV}/shot.png`, public_url: PUBLIC_URL };
    createSignedUrl.mockRejectedValue(new Error('network'));

    expect(await resolveScreenshotUrl(row)).toBe(PUBLIC_URL);
  });

  it('handles empty and non-array input', async () => {
    expect(await resolveScreenshotUrls([])).toEqual([]);
    expect(await resolveScreenshotUrls(null)).toEqual([]);
    expect(await resolveScreenshotUrl(null)).toBeNull();
  });
});

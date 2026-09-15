/** Operator-owned release evidence. Never accepts a browser-supplied download URL. */
const VERSION = /^(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})$/;
export function parseDesktopRelease(raw, now = Date.now()) {
  if (typeof raw !== 'string' || raw.length > 12000) return null;
  try {
    const r = JSON.parse(raw);
    if (!r || r.schema_version !== 1 || r.platform !== 'windows-x64' || typeof r.version !== 'string' || !VERSION.test(r.version)
      || r.configured !== true || r.signed !== true || r.acceptance !== 'windows_installed_passed'
      || typeof r.sha256 !== 'string' || typeof r.commit !== 'string' || !/^[a-f0-9]{64}$/.test(r.sha256) || !/^[a-f0-9]{40}$/.test(r.commit)
      || !Number.isSafeInteger(r.bytes) || r.bytes < 1 || r.bytes > 300 * 1024 * 1024
      || typeof r.publisher !== 'string' || !r.publisher.trim() || r.publisher.length > 120
      || /[\x00-\x1f\x7f]/.test(r.publisher) || typeof r.published_at !== 'string'
      || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(r.published_at)) return null;
    const published = Date.parse(r.published_at);
    if (!Number.isFinite(published) || published > now) return null;
    if (typeof r.url !== 'string' || r.url.length > 2048 || /\s/.test(r.url)) return null;
    const url = new URL(r.url);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
      || url.port || !url.pathname.endsWith('.exe') || url.hostname === 'localhost'
      || !url.hostname.includes('.') || url.hostname.endsWith('.invalid')) return null;
    return {version: r.version, url: url.href, sha256: r.sha256, bytes: r.bytes,
      publisher: r.publisher.trim(), published_at: new Date(published).toISOString(), commit: r.commit};
  } catch { return null; }
}
export function getDesktopRelease() {
  return parseDesktopRelease(process.env.DESKTOP_PUBLIC_RELEASE);
}

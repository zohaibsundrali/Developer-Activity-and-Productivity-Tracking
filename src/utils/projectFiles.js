import { safeHref } from '@/utils/safeUrl';
import { resolveOrgFileUrl } from '@/utils/orgFiles';

// Project documents are either legacy navigation URLs or private org-files
// keys. A key is never handed directly to fetch, an anchor, or window.open.
export function safeProjectFileValue(value) {
  if (typeof value !== 'string') return '';
  const url = safeHref(value);
  if (url) return url;
  const path = value.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[^/]+\/.+$/i.test(path)) return '';
  if (/[\u0000-\u001f\u007f\\?#]/.test(path) || path.split('/').some(part => !part || part === '.' || part === '..')) return '';
  return path;
}

export async function resolveProjectFileUrl(value) {
  const stored = safeProjectFileValue(value);
  if (!stored) return null;
  const url = safeHref(stored);
  if (url) return url;
  return safeHref(await resolveOrgFileUrl(stored)) || null;
}

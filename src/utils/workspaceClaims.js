// Decode only for UI/context comparison. Server callers must first verify the
// SAME token with Supabase Auth; decoding alone never authenticates a request.
export function workspaceTokenClaims(token) {
  try {
    const encoded = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(typeof window === 'undefined'
      ? Buffer.from(encoded, 'base64').toString('utf8')
      : new TextDecoder().decode(Uint8Array.from(atob(encoded), c => c.charCodeAt(0))));
  } catch { return null; }
}

export function sameWorkspace(a, b) {
  return !!a && !!b && ['organization_id', 'app_user_id', 'user_type', 'role']
    .every(key => typeof a[key] === 'string' && a[key] === b[key]);
}

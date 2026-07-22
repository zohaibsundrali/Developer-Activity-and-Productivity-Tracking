import { supabase } from "./supabaseClient";

// fetch() wrapper that attaches the current Supabase Auth access token as a
// Bearer header, so API routes can verify the caller and scope data to their
// organization. Use this for any client call to an authenticated API route.
export async function authFetch(url, options = {}) {
  let token = null;
  try {
    const { data } = await supabase.auth.getSession();
    token = data?.session?.access_token || null;
  } catch {
    token = null;
  }

  const headers = new Headers(options.headers || {});
  if (token) headers.set("Authorization", `Bearer ${token}`);

  return fetch(url, { ...options, headers });
}

import { mobileReply, mobileFail } from '@/utils/mobileServer';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL), key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (url.protocol !== 'https:' || url.username || url.password || !['', '/'].includes(url.pathname) || url.search || url.hash || typeof key !== 'string') throw new Error();
    let publicKey = /^sb_publishable_[A-Za-z0-9_-]+$/.test(key);
    if (!publicKey && key.split('.').length === 3) publicKey = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString('utf8')).role === 'anon';
    if (!publicKey) throw new Error();
    return mobileReply({ success: true, supabase_url: url.origin, public_key: key });
  } catch { return mobileFail('Mobile sign-in is not configured.', 503); }
}

import { mobileAuth, readMobileContext, mobileReply, mobileDatabaseError } from '@/utils/mobileServer';
export const dynamic = 'force-dynamic';
export async function GET(request) {
  try { const { auth, client, denied } = await mobileAuth(request); if (denied) return denied;
    const context = await readMobileContext(client, auth); return context.denied || mobileReply({ success: true, ...context.data });
  } catch { return mobileDatabaseError(); }
}

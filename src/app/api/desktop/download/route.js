import { getDesktopRelease } from '@/utils/desktopRelease';
export const dynamic = 'force-dynamic';
export function GET() {
  const release = getDesktopRelease();
  const headers = {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'};
  if (!release) return Response.json({error: 'The Windows download is not available yet.'}, {status: 503, headers});
  return new Response(null, {status: 302, headers: {...headers, Location: release.url}});
}

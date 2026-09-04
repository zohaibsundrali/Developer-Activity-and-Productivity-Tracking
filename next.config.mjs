/** @type {import('next').NextConfig} */

/**
 * Security headers (audit Phase 5).
 *
 * The app talks to Supabase over https (REST/Storage) and wss (Realtime), and
 * renders images served from Supabase Storage, so every policy below has to
 * allow `*.supabase.co` on both schemes.
 *
 * CSP is deliberately shipped as **Report-Only**. An enforced policy that blocks
 * Supabase Storage images or the Realtime websocket would be worse than no CSP
 * at all, and this app has not yet been observed under the policy. Report-Only
 * gives violation telemetry with zero risk of breaking the UI. The policy's
 * `report-uri`/`report-to` now point at /api/csp-report, which records each
 * violation to system_events (Admin -> System Health). Promote it to the
 * enforcing `Content-Security-Policy` header only after those reports are clean.
 */
const cspDirectives = [
  "default-src 'self'",
  // Next.js injects inline bootstrap/flight scripts; ECharts + Next dev tooling
  // need 'unsafe-eval'. Removing these requires nonce-based CSP support.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  // Tailwind/styled inline styles and sweetalert2 inject <style> at runtime.
  "style-src 'self' 'unsafe-inline'",
  // Supabase Storage images, plus data:/blob: for canvas + ECharts/jsPDF exports.
  "img-src 'self' data: blob: https://*.supabase.co https://*.supabase.in",
  "font-src 'self' data:",
  // Supabase REST/Storage over https AND Realtime over wss — both required.
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.supabase.in wss://*.supabase.in https://api.emailjs.com",
  // ECharts and jsPDF render into blob/data workers.
  "worker-src 'self' blob:",
  "media-src 'self' blob: data: https://*.supabase.co",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
  // Where violations are sent. `report-uri` is the widely-supported legacy
  // directive; `report-to` is its modern replacement and needs the
  // `Reporting-Endpoints` header below. Both name the same sink,
  // /api/csp-report, which records to system_events (Admin -> System Health).
  // Without these the Report-Only policy reported to nobody.
  "report-uri /api/csp-report",
  "report-to csp-endpoint",
].join('; ');

const securityHeaders = [
  // Force HTTPS for 2 years, including subdomains. Vercel terminates TLS.
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  // Block MIME sniffing (stops a text upload being executed as script).
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Clickjacking protection. frame-ancestors above is the modern equivalent;
  // this covers browsers that only honour the legacy header.
  { key: 'X-Frame-Options', value: 'DENY' },
  // Don't leak full URLs (which contain org/task ids) to third parties.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Drop powerful APIs the app does not use.
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  },
  // Legacy XSS filter — off is the current guidance, CSP supersedes it.
  { key: 'X-XSS-Protection', value: '0' },
  // Names the `csp-endpoint` group that the policy's `report-to` points at.
  { key: 'Reporting-Endpoints', value: 'csp-endpoint="/api/csp-report"' },
  // Report-Only: observe before enforcing. See note above. Violations now reach
  // /api/csp-report (system_events) instead of being discarded.
  { key: 'Content-Security-Policy-Report-Only', value: cspDirectives },
];

const nextConfig = {
  async headers() {
    return [
      {
        // Apply to every route, including API routes and static assets.
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;

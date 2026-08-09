import { Inter, Space_Grotesk } from 'next/font/google';
import { AuthProvider } from '@/contexts/AuthContext';
// Plain module, not the "use client" Logo — a Server Component importing from a
// client module receives opaque client references, not strings.
import { BRAND_NAME, SITE_URL } from '@/components/brand/brand';
import './globals.css';
import 'sweetalert2/dist/sweetalert2.min.css';

/**
 * Typography is self-hosted through next/font: the files are downloaded at
 * build time, served from our own origin and preloaded, so there is no
 * render-blocking round trip to a third-party font CDN and nothing for the
 * report-only CSP (font-src 'self' data:) to flag.
 *
 * NOTE: src/app/globals.css still carries an `@import url(...)` for Inter on
 * its first line. That file is owned elsewhere and was out of scope here, so
 * the legacy request survives until that single line is deleted.
 *
 * Inter carries the UI — it is drawn for dense product screens and its
 * tabular figures keep durations and counts aligned in a column
 * (use Tailwind's `tabular-nums`). Space Grotesk carries headings and the
 * wordmark: a geometric grotesk with enough engineering-drawing character to
 * make the brand recognisable without ever being asked to set a data table.
 */
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-space-grotesk',
});

// SITE_URL is still the old `devtrack-blush.vercel.app` hostname on purpose —
// see the note on it in src/components/brand/brand.js. metadataBase must point
// at an origin that actually resolves.
const title = `${BRAND_NAME} — Developer activity & productivity tracking`;

const description =
  `${BRAND_NAME} gives engineering leaders an honest view of where the hours go: live sessions, focus and activity insight, and project delivery — one workspace per organization, isolated by role.`;

export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: title,
    template: `%s · ${BRAND_NAME}`,
  },
  description,
  applicationName: BRAND_NAME,
  keywords: [
    'developer productivity',
    'activity tracking',
    'time tracking',
    'engineering analytics',
    'sprint and project tracking',
    'team management software',
  ],
  authors: [{ name: BRAND_NAME }],
  creator: BRAND_NAME,
  publisher: BRAND_NAME,
  category: 'technology',
  formatDetection: { telephone: false, address: false, email: false },
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    url: '/',
    siteName: BRAND_NAME,
    title,
    description,
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large' },
  },
  // Browser chrome picks up the surface colour of whichever theme is showing.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F8FAFB' },
    { media: '(prefers-color-scheme: dark)', color: '#0D1A21' },
  ],
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${inter.variable} ${spaceGrotesk.variable}`}>
      <body className="min-h-screen overflow-x-hidden font-sans">
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}

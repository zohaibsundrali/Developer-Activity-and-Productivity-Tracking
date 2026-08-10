import localFont from 'next/font/local';
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
// `next/font/local`, NOT `next/font/google`.
//
// The Google loader downloads the woff2 files from fonts.gstatic.com *during
// the build*. That makes every deploy depend on an outbound connection from
// the build machine, and it is not hypothetical: the Vercel build failed with
// three ETIMEDOUTs against fonts.gstatic.com and `Failed to fetch Space Grotesk
// from Google Fonts`, which is a hard webpack error — the build stops, it does
// not degrade to a fallback.
//
// The files now live in src/app/fonts and are committed, so the build has no
// network dependency at all. It also removes a build-time third party from the
// deploy path, which for a product that sells on data handling is worth having
// regardless of the outage.
//
// Latin subset only, matching what the Google loader was already fetching.
// Adding a weight means adding a file here.
const inter = localFont({
  src: [
    { path: './fonts/Inter-400.woff2', weight: '400', style: 'normal' },
    { path: './fonts/Inter-500.woff2', weight: '500', style: 'normal' },
    { path: './fonts/Inter-600.woff2', weight: '600', style: 'normal' },
    { path: './fonts/Inter-700.woff2', weight: '700', style: 'normal' },
    { path: './fonts/Inter-800.woff2', weight: '800', style: 'normal' },
  ],
  display: 'swap',
  variable: '--font-inter',
  fallback: ['ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
});

const spaceGrotesk = localFont({
  src: [
    { path: './fonts/SpaceGrotesk-500.woff2', weight: '500', style: 'normal' },
    { path: './fonts/SpaceGrotesk-600.woff2', weight: '600', style: 'normal' },
    { path: './fonts/SpaceGrotesk-700.woff2', weight: '700', style: 'normal' },
  ],
  display: 'swap',
  variable: '--font-space-grotesk',
  fallback: ['ui-sans-serif', 'system-ui', 'sans-serif'],
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

/**
 * Applies the `.dark` class BEFORE first paint.
 *
 * `tailwind.config.js` is `darkMode: ["class"]` and globals.css defines a full
 * `.dark` palette, but nothing ever set the class, so the whole dark theme was
 * dead code. This has to run as a blocking inline script in <head>: doing it in
 * a `useEffect` would paint the light palette first and then repaint dark, and
 * a full-viewport white flash on every navigation is worse than no dark mode.
 *
 * Order of precedence: an explicit stored choice, then the OS via
 * `prefers-color-scheme`. `colorScheme` is set alongside so native widgets
 * (scrollbars, date pickers, the caret) match the palette.
 *
 * `data-swal2-theme` is stamped alongside. SweetAlert2's bundled CSS gates its
 * dark palette on `@media (prefers-color-scheme: dark) [data-swal2-theme=auto]`
 * — the OS, not our class — so an OS-light machine with the app in dark mode
 * got a white dialog on a dark page. Setting the attribute explicitly uses
 * SweetAlert's own theming rather than overriding its stylesheet.
 *
 * Keep `devtrack.theme` in step with THEME_KEY in components/shell/Topbar.jsx.
 * Kept to one statement with no optional chaining so it parses and runs on old
 * engines too — a syntax error here would take the theme down silently.
 */
const THEME_INIT_SCRIPT = `(function(){try{var e=document.documentElement,s=null;try{s=localStorage.getItem("devtrack.theme")}catch(_){}var d=s==="dark"||(s!=="light"&&window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches);e.classList.toggle("dark",d);e.style.colorScheme=d?"dark":"light";e.setAttribute("data-swal2-theme",d?"dark":"light")}catch(_){}})();`;

export default function RootLayout({ children }) {
  return (
    // `suppressHydrationWarning` because the script above mutates <html>'s
    // class list before React hydrates, so the client tree legitimately
    // disagrees with the server-rendered markup on exactly this attribute.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${spaceGrotesk.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      {/*
        No `overflow-x-hidden` here, deliberately.

        `overflow-x: hidden` on body makes body a scroll container, and a
        `position: sticky` child sticks to its nearest scroll container rather
        than the viewport — so it scrolls away instead of holding. Measured
        before this was removed: the app-shell topbar read top=-394 after a
        394px scroll, and the legal pages' tables of contents left a 480px
        empty column behind them on a 32,000px page.

        globals.css handles the clipping with `overflow-x: clip`, which clips
        without creating a scroll container. That rule was already there and
        was losing to THIS utility class on specificity, which is why an
        earlier attempt at the fix appeared to do nothing outside the landing
        page (which had patched itself locally).

        Do not add it back. If horizontal overflow appears, the fix is the
        element that overflows, not a clip on the whole document.
      */}
      <body className="min-h-screen font-sans">
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}

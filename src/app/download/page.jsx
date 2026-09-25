import Link from 'next/link';
import { Download, Monitor, ArrowRight, Clock3, MousePointer2, ShieldCheck } from 'lucide-react';
import SiteNav from '@/components/landing/SiteNav';
import SiteFooter from '@/components/landing/SiteFooter';
import { BRAND_NAME } from '@/components/brand/brand';
import { getDesktopRelease } from '@/utils/desktopRelease';
import styles from '../landing.module.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: `Download | ${BRAND_NAME}`, description: 'Bring your Verisade workspace to Windows. Download the desktop tracker, sign in and start your workday.', alternates: { canonical: '/download' } };

export default function DownloadPage() {
  const release = getDesktopRelease();
  return <div className={`${styles.page} min-h-screen bg-background text-foreground`}>
    <SiteNav homeLinks />
    <main id="main">
      <section className="mx-auto grid max-w-7xl items-center gap-12 px-6 py-16 lg:grid-cols-2 lg:py-24">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">Verisade for Windows</p>
          <h1 className="mt-5 font-display text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">Your workspace.<br />Now on your desktop.</h1>
          <p className="mt-6 max-w-lg text-lg leading-relaxed text-muted-foreground">Start your workday with a clear view of your time. Connect your projects and tasks, track activity, and pause when it’s time for a break.</p>
          <div className="mt-8 flex flex-wrap gap-3 text-xs font-medium"><span className="rounded-full border border-border bg-card px-3 py-2">Windows 10 or 11</span><span className="rounded-full border border-border bg-card px-3 py-2">64-bit desktop app</span></div>
          <Link href="#windows-download" className="mt-8 inline-flex items-center gap-2 text-sm font-semibold underline underline-offset-4">Get the desktop app <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
        </div>
        <section id="windows-download" aria-labelledby="download-heading" className="scroll-mt-24 rounded-2xl border border-border bg-card p-6 shadow-elevated sm:p-8">
          <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-accent"><Monitor aria-hidden="true" className="h-8 w-8 text-primary" /></div>
          <h2 id="download-heading" className="font-display text-2xl font-semibold">Verisade Desktop</h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">Everything you need to connect your workday to your workspace.</p>
          {release ? <>
            <a href="/api/desktop/download" download className="mt-7 flex min-h-12 items-center justify-center gap-3 rounded-lg bg-primary px-5 py-3 text-center font-semibold text-primary-foreground"><Download className="h-5 w-5" aria-hidden="true" />Download for Windows</a>
            <p className="mt-4 text-xs text-muted-foreground">Version {release.version} · {(release.bytes / 1024 / 1024).toFixed(1)} MB · Windows setup (.exe)</p>
            <p className="mt-2 text-xs text-muted-foreground">Verified publisher: {release.publisher}</p>
            <details className="mt-5 border-t border-border pt-4 text-xs"><summary className="cursor-pointer font-medium">Release details</summary><p className="mt-3">Released {release.published_at.slice(0, 10)}</p><p className="mt-2">Installer checksum (SHA-256)</p><code className="mt-2 block break-all">{release.sha256}</code></details>
          </> : <div role="status" className="mt-7 rounded-xl border border-border bg-muted p-5"><Download className="mb-3 h-5 w-5" aria-hidden="true" /><p className="font-semibold">Download not available yet</p><p className="mt-2 text-sm leading-relaxed">The Windows release is being prepared. Your workspace administrator will let you know when it is ready to install.</p></div>}
          <p className="mt-5 text-xs leading-relaxed text-muted-foreground">Administrator permission required to install. An active employee account and internet access are required for first sign-in.</p>
        </section>
      </section>
      <section aria-labelledby="setup-heading" className="border-y border-border bg-muted px-6 py-16">
        <div className="mx-auto max-w-7xl"><h2 id="setup-heading" className="font-display text-3xl font-semibold">Three steps to your first session</h2><ol className="mt-8 grid gap-6 md:grid-cols-3">{[
          ['Download & install', 'Download the Windows setup file, run the installer, and open Verisade from the Start menu.'],
          ['Connect your workspace', 'Accept your workspace invitation first, then sign in with your workspace email and password.'],
          ['Choose a task & start', 'Select a project or task and press Start. Pause for a break and resume when you’re ready.'],
        ].map(([title, description], index) => <li key={title} className="rounded-2xl border border-border bg-card p-6"><span className="text-sm font-semibold text-primary">0{index + 1}</span><h3 className="mt-4 text-lg font-semibold">{title}</h3><p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p></li>)}</ol></div>
      </section>
      <section aria-labelledby="controls-heading" className="mx-auto max-w-7xl px-6 py-16">
        <h2 id="controls-heading" className="font-display text-3xl font-semibold">Stay in control of your workday</h2>
        <div className="mt-8 grid gap-8 md:grid-cols-3">{[
          [Clock3, 'A timer you control', 'Start, pause, resume and stop your session. Locking or putting Windows to sleep pauses tracking; Resume is your choice.'],
          [MousePointer2, 'Activity you can see', 'View time, keyboard and mouse activity, app/site usage and screenshots allowed by your organization. Pause stops new capture.'],
          [ShieldCheck, 'Keep work connected', 'Saved records wait locally when the connection is unavailable and sync under the original account when you reconnect.'],
        ].map(([Icon, title, description]) => <div key={title}><Icon className="h-6 w-6 text-primary" aria-hidden="true" /><h3 className="mt-4 font-semibold">{title}</h3><p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p></div>)}</div>
        <p className="mt-10 border-t border-border pt-6 text-sm text-muted-foreground">Need help signing in? Use your workspace password, not your Google password. Google sign-in is not available in the desktop app. Client-portal access alone does not enable employee tracking. Contact your workspace administrator for setup support.</p>
        <p className="mt-3 text-sm text-muted-foreground">Windows only. This installer does not support macOS, Linux, Android or iPhone. <Link href="/privacy" className="underline underline-offset-4">Read the privacy policy</Link></p>
      </section>
    </main>
    <SiteFooter homeLinks />
  </div>;
}

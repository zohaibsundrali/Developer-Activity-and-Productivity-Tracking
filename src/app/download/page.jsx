import Link from 'next/link';
import Logo from '@/components/brand/Logo';
import { BRAND_NAME } from '@/components/brand/brand';
import { getDesktopRelease } from '@/utils/desktopRelease';
export const dynamic = 'force-dynamic';
export const metadata = {title: `Download the Windows tracker | ${BRAND_NAME}`,
  description: 'Install the Windows desktop tracker and sign in with your workspace account.',
  alternates: {canonical: '/download'}};
export default function DownloadPage() {
  const release = getDesktopRelease();
  return <main className="min-h-screen bg-background text-foreground">
    <header className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-7">
      <Link href="/" aria-label={`${BRAND_NAME} home`}><Logo /></Link>
      <Link href="/login" className="font-medium underline underline-offset-4">Sign in</Link>
    </header>
    <div className="mx-auto max-w-3xl px-6 pb-20 pt-10">
      <p className="font-semibold text-primary">DESKTOP TRACKER</p>
      <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">Your workday, on Windows.</h1>
      <p className="mt-5 text-lg">Track time against your projects and tasks, pause for breaks, and see your capture and sync status.</p>
      <section aria-labelledby="windows-download" className="mt-9 space-y-5 rounded-2xl border border-border bg-card p-6 sm:p-8">
        <h2 id="windows-download" className="text-2xl font-semibold">Windows desktop app</h2>
        <p>Windows 10 or 11 · 64-bit · Administrator permission required to install</p>
        {release ? <>
          <a href="/api/desktop/download" className="inline-flex rounded-lg bg-primary px-6 py-3 font-semibold text-primary-foreground">Download Windows setup (.exe)</a>
          <p>Version {release.version} · {(release.bytes / 1024 / 1024).toFixed(1)} MB · Released {release.published_at.slice(0, 10)}</p>
          <p>Verified publisher: {release.publisher}</p>
          <details><summary className="cursor-pointer font-medium">Installer checksum (SHA-256)</summary><code className="mt-3 block break-all text-sm">{release.sha256}</code></details>
        </> : <div role="status" className="rounded-lg bg-muted p-4">
          <p className="font-semibold">Download not available yet</p>
          <p className="mt-1">The Windows release is being prepared. Your workspace administrator will let you know when it is ready to install.</p>
        </div>}
      </section>
      <section aria-labelledby="getting-started" className="mt-10 space-y-4">
        <h2 id="getting-started" className="text-2xl font-semibold">Before you start</h2>
        <ol className="list-decimal space-y-3 pl-6">
          <li>Accept your workspace invitation and set your account password. An active employee account is required.</li>
          <li>Download and run the installer, then open DevTrack from the Start menu.</li>
          <li>Sign in with your workspace email and password. Choose a project or task, then press Start.</li>
        </ol>
        <p>A Gmail address is fine. Use the password you set for this workspace, not your Google password. Google sign-in is not available in the desktop app.</p>
        <p>Client-portal access alone does not enable employee tracking. Ask your workspace administrator if your staff account is not linked or active.</p>
      </section>
      <section aria-labelledby="tracking-controls" className="mt-10 space-y-4">
        <h2 id="tracking-controls" className="text-2xl font-semibold">You can see when tracking is active</h2>
        <p>The tracker records time, input activity counts, app/site usage and screenshots allowed by your organization. Pause stops new capture. Locking or putting Windows to sleep pauses tracking; Resume is your choice.</p>
        <p>Saved records wait locally when the connection is unavailable and sync under the original account. Internet access is required for first sign-in and device registration.</p>
        <p>If setup or login fails, contact your workspace administrator. After signing in, Save diagnostics creates a setup report without passwords, screenshots or account details.</p>
        <Link href="/privacy" className="inline-block font-medium underline underline-offset-4">Read the privacy policy</Link>
      </section>
      <p className="mt-10 border-t border-border pt-6">This installer is for Windows. It does not install on macOS, Linux, Android or iPhone.</p>
    </div>
  </main>;
}

'use client';
import Link from 'next/link';
import { LogOut } from 'lucide-react';
import { BrandLockup } from '@/components/auth/AuthShell';
import { logoutAndRedirect } from '@/utils/browserLogout';

export default function OrganizationsShell({ children, email }) {
  return <div className="min-h-screen bg-background text-foreground">
    <header className="border-b border-border bg-card/70">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
        <Link href="/organizations" aria-label="Verisade organizations" className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><BrandLockup /></Link>
        <div className="flex min-w-0 items-center gap-4"><span className="hidden max-w-64 truncate text-sm text-black dark:text-white sm:block">{email}</span>
          <button type="button" onClick={() => logoutAndRedirect()} className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg px-3 text-sm text-black dark:text-white hover:bg-muted  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><LogOut size={16} aria-hidden="true" />Sign out</button>
        </div>
      </div>
    </header>
    <main className="mx-auto max-w-6xl px-5 py-10 sm:px-8 sm:py-14">{children}</main>
  </div>;
}

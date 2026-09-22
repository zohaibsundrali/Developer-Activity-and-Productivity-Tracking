'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/utils/supabaseClient';
import { authFetch } from '@/utils/authFetch';
import { platformOwnerHome } from '@/utils/platformOwnerHome';
import { Loader2 } from 'lucide-react';

export default function HomeAuthRedirect({ children }) {
  const router = useRouter();
  const [pending, setPending] = useState(true);
  useEffect(() => {
    let active = true;
    async function check() {
      let redirecting = false;
      try {
        const { data } = await supabase.auth.getSession();
        if (!active || !data?.session) return;
        if (await platformOwnerHome()) {
          if (active) { redirecting = true; router.replace('/admin'); }
          return;
        }
        const response = await authFetch('/api/organizations', { cache: 'no-store' });
        const result = await response.json();
        // Server-authorized memberships, never a cached browser role/cookie.
        if (active && response.ok && (result.ownerAccount || result.organizations?.some(org => org.role === 'owner'))) {
          redirecting = true;
          router.replace('/organizations');
        }
      } catch { /* Preserve the public page when authentication is unavailable. */ }
      finally { if (active && !redirecting) setPending(false); }
    }
    check();
    return () => { active = false; };
  }, [router]);
  return <>
    {pending && <div role="status" aria-live="polite" aria-busy="true" className="flex min-h-[100dvh] flex-col items-center justify-center gap-5 bg-background text-foreground">
      <Loader2 className="h-9 w-9 animate-spin text-primary motion-reduce:animate-none" aria-hidden="true" />
      <span className="font-display text-3xl font-bold tracking-tight">Verisade</span>
      <span className="sr-only">Checking your session…</span>
    </div>}
    <div hidden={pending}>{children}</div>
  </>;
}

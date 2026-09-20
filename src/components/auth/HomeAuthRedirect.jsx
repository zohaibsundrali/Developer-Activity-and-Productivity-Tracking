'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/utils/supabaseClient';
import { authFetch } from '@/utils/authFetch';

export default function HomeAuthRedirect() {
  const router = useRouter();
  useEffect(() => {
    let active = true;
    async function check() {
      try {
        const { data } = await supabase.auth.getSession();
        if (!active || !data?.session) return;
        const response = await authFetch('/api/organizations', { cache: 'no-store' });
        const result = await response.json();
        // Server-authorized memberships, never a cached browser role/cookie.
        if (active && response.ok && (result.ownerAccount || result.organizations?.some(org => ['owner', 'admin'].includes(org.role)))) router.replace('/organizations');
      } catch { /* Preserve the public page when authentication is unavailable. */ }
    }
    check();
    return () => { active = false; };
  }, [router]);
  return null;
}

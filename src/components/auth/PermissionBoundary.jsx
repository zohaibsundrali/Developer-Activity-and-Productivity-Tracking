"use client";

import { useEffect, useState } from 'react';
import { loadPermissionSet } from '@/utils/permissions';
import { authFetch } from '@/utils/authFetch';
import AuthLoadingScreen from './AuthLoadingScreen';

/** Reload the effective permission set before mounting a staff dashboard. */
export default function PermissionBoundary({ children }) {
  const [status, setStatus] = useState('loading');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setStatus('loading');
    loadPermissionSet(authFetch).then(ok => {
      if (active) setStatus(ok ? 'ready' : 'error');
    });
    return () => { active = false; };
  }, [attempt]);
  if (status === 'loading') return <AuthLoadingScreen message="Loading your permissions…" />;
  if (status === 'error') return (
    <div role="alert" className="flex min-h-screen flex-col items-center justify-center gap-4">
      <p>We could not load your permissions. Please try again.</p>
      <button type="button" onClick={() => setAttempt(n => n + 1)}>Try again</button>
    </div>
  );
  return children;
}

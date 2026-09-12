"use client";
import { useEffect, useMemo, useRef, useState } from 'react';
import { setVisibleInterval } from '@/hooks/useVisibleInterval';
import { createMonitoringPresenceController } from '@/utils/monitoringPresence';

export function useMonitoringPresence({ client, organizationId, profileId, scope, enabled, makeGuard }) {
  const binding = useMemo(() => ({ client, organizationId, profileId, scope, enabled, makeGuard }), [client, organizationId, profileId, scope, enabled, makeGuard]);
  const live = useRef(binding); live.current = binding;
  const controller = useRef(null);
  const [result, setResult] = useState(null);
  useEffect(() => {
    if (!enabled) return;
    const instance = createMonitoringPresenceController({ client, organizationId, profileId, guard: makeGuard(),
      onChange: state => { if (live.current === binding) setResult({ binding, state }); },
    });
    controller.current = { binding, instance };
    instance.refresh();
    const stopPoll = setVisibleInterval(() => instance.refresh(), 10000);
    const stopAge = setVisibleInterval(() => instance.tick(), 1000);
    // Some operating systems suspend performance.now() during sleep. Never
    // revive a pre-sleep receipt merely because its monotonic age looks fresh.
    const focus = () => { instance.invalidate(); instance.refresh(); };
    const visibility = () => { if (document.visibilityState === 'hidden') instance.invalidate(); };
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', visibility);
    return () => { instance.dispose(); stopPoll(); stopAge(); window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', visibility); controller.current = null; };
  }, [binding, client, organizationId, profileId, enabled, makeGuard]);
  const state = result?.binding === binding ? result.state : { status: 'unknown', devices: [], loading: !!enabled, error: '' };
  return { ...state, refresh: () => { if (controller.current?.binding === live.current) controller.current.instance.refresh(); } };
}

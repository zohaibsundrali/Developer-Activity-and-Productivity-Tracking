"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { resolveScreenshotUrls } from '@/utils/screenshotFiles';
import { createMonitoringScreenshotController, attachScreenshotRenewal } from '@/utils/monitoringScreenshotController';

export function useMonitoringScreenshots({ client, organizationId, profileId, start, end, scope, enabled, makeGuard }) {
  const binding = useMemo(() => ({ client, organizationId, profileId, start, end, scope, enabled, makeGuard }), [client, organizationId, profileId, start, end, scope, enabled, makeGuard]);
  const liveBinding = useRef(binding); liveBinding.current = binding;
  const controllerRef = useRef(null);
  const [result, setResult] = useState(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = createMonitoringScreenshotController({ client, organizationId, profileId, start, end, makeGuard,
      sign: rows => resolveScreenshotUrls(rows, 600),
      onChange: state => { if (liveBinding.current === binding) setResult({ binding, state }); },
    });
    controllerRef.current = { binding, controller };
    controller.refresh();
    const stopRenewal = attachScreenshotRenewal({ renew: () => controller.retryImages(), windowTarget: window, documentTarget: document });
    return () => {
      controller.dispose(); stopRenewal();
      if (controllerRef.current?.controller === controller) controllerRef.current = null;
    };
  }, [binding, client, organizationId, profileId, start, end, enabled, makeGuard]);
  const call = useCallback(method => {
    const entry = controllerRef.current;
    if (entry?.binding === liveBinding.current) return entry.controller[method]();
  }, []);
  const next = useCallback(() => call('next'), [call]);
  const previous = useCallback(() => call('previous'), [call]);
  const refresh = useCallback(() => call('refresh'), [call]);
  const retryImages = useCallback(() => call('retryImages'), [call]);
  const state = result?.binding === binding ? result.state
    : { rows: [], total: null, page: 1, loading: !!enabled, error: '', hasNext: false, hasPrevious: false };
  return { ...state, next, previous, refresh, retryImages };
}

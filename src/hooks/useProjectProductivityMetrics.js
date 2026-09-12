"use client";
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getOrgContext } from '@/utils/orgContext';
import { reportIdentity } from '@/utils/reportViewState';
import { authFetch } from '@/utils/authFetch';
import { createProductivityRequestGate, loadProductivityView, projectProductivityUrl } from '@/utils/productivityViewData';

export function useProjectProductivityMetrics() {
  const { user, authStatus } = useAuth();
  const identity = authStatus === 'authenticated' && user ? reportIdentity(getOrgContext()) : null;
  const liveIdentity = useRef(identity);
  liveIdentity.current = identity;
  const gate = useRef(null);
  if (!gate.current) gate.current = createProductivityRequestGate();
  const mounted = useRef(false);
  const [state, setState] = useState(null);
  useEffect(() => {
    mounted.current = true;
    const requests = gate.current;
    return () => { mounted.current = false; requests.invalidate(); };
  }, []);
  useEffect(() => { gate.current.invalidate(); setState(null); }, [identity]);
  const closeMetrics = () => { gate.current.invalidate(); setState(null); };
  const openMetrics = async (project, developerId = null) => {
    const context = getOrgContext();
    if (!identity || reportIdentity(context) !== identity || !project?.id) return;
    const current = gate.current.begin(() => mounted.current && liveIdentity.current === identity && reportIdentity(getOrgContext()) === identity);
    setState({ identity, project, loading: true, data: null, error: '' });
    try {
      const data = await loadProductivityView(authFetch, projectProductivityUrl(project.id, developerId), current, context.organizationId);
      if (data && current()) setState({ identity, project, loading: false, data: { ...data, project }, error: '' });
    } catch (error) {
      if (current()) setState({ identity, project, loading: false, data: null, error: error?.message || 'Could not load productivity metrics. Please retry.' });
    }
  };
  const visible = identity && state?.identity === identity ? state : null;
  return { showMetricsModal: !!visible, metricsLoading: visible?.loading || false,
    metricsError: visible?.error || '', metricsData: visible?.data || null,
    metricsProject: visible?.project || null, openMetrics, closeMetrics };
}

// Storage bytes are removed through the supported API. The database owns scope,
// leases, immutable references and finalization after object absence is verified.
export async function runTrackingRetention(svc, { maxOrganizations = 5, maxFiles = 10, batchSize = 100 } = {}) {
  const summary = { organizations: 0, deletedRecords: 0, removedFiles: 0, skipped: 0, errors: [] };
  const candidates = await svc.rpc('retention_organizations', { p_limit: maxOrganizations });
  if (candidates.error) throw new Error('Retention scheduling unavailable');
  for (const { organization_id: orgId } of candidates.data || []) {
    try {
      const scan = await svc.rpc('sweep_tracking_retention', { p_org: orgId, p_limit: batchSize });
      if (scan.error) throw new Error('Retention scan failed');
      summary.organizations += 1;
      summary.deletedRecords += Number(scan.data?.deleted || 0);
      summary.skipped += Number(scan.data?.skipped || 0);
      for (let count = 0; count < maxFiles; count += 1) {
        const claim = await svc.rpc('claim_retention_file', { p_org: orgId });
        if (claim.error) throw new Error('Retention claim failed');
        const job = claim.data;
        if (!job) break;
        if (job.cancelled) continue;
        // Defense in depth for the only automated object class. Legacy paths
        // stay available for a separately verified migration/ownership repair.
        if (!job.id || !job.lease || job.bucket !== 'monitoring' || typeof job.path !== 'string'
          || !job.path.startsWith(`${orgId}/`) || job.path.split('/').length < 3) throw new Error('Unsafe retention object claim');
        let providerError = null;
        if (job.remove) {
          try {
            const removed = await svc.storage.from(job.bucket).remove([job.path]);
            if (removed.error) providerError = 'Storage provider did not confirm removal';
          } catch { providerError = 'Storage provider did not confirm removal'; }
        }
        // Even a timeout may have removed bytes: only the database object
        // existence check can decide whether the screenshot record is removed.
        const finished = await svc.rpc('finish_retention_file', { p_job: job.id, p_lease: job.lease, p_error: providerError });
        if (finished.error || finished.data !== true) {
          summary.errors.push({ organizationId: orgId, message: 'Screenshot cleanup remains queued for reconciliation' });
        } else summary.removedFiles += 1;
      }
    } catch (error) {
      summary.errors.push({ organizationId: orgId, message: error?.message || 'Retention unavailable' });
    }
  }
  return summary;
}

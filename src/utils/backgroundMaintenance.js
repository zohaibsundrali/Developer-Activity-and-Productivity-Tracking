import { processUnattendedAutomations } from '@/utils/unattendedAutomations';
import { runTrackingRetention } from '@/utils/trackingRetention';
import { processOrganizationDeletion } from '@/utils/organizationDeletion';

// Independent durable queues: one unavailable provider must not prevent another
// queue from progressing. Each worker bounds work and checkpoints its own lease.
export async function runBackgroundMaintenance(svc, {
  automation = processUnattendedAutomations,
  retention = runTrackingRetention,
  deletion = processOrganizationDeletion,
} = {}) {
  const summary = { errors: [] };
  const jobs = [
    ['organization_cleanup', deletion, { maxSteps: 4, timeBudgetMs: 15000 }],
    ['actor_automation', automation, { maxActors: 5, maxJobsPerActor: 2 }],
    ['tracking_retention', retention, { maxOrganizations: 2, maxFiles: 5, batchSize: 100 }],
  ];
  for (const [name, worker, limits] of jobs) {
    try {
      const result = await worker(svc, limits);
      summary[name] = result;
      summary.errors.push(...(result.errors || []).map(error => ({ ...error, job: name })));
      if (result.retry) summary.errors.push({ job: name, message: 'Cleanup remains queued for retry.' });
    } catch {
      summary.errors.push({ job: name, message: 'Background worker unavailable; durable work remains queued.' });
    }
  }
  return summary;
}

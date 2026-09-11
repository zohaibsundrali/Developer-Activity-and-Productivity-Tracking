import { processActorAutomations } from '@/utils/automationProcessor';
import { loadOverrides } from '@/utils/permissionOverrides';

// Cron uses only the service client. Database operations execute through the
// restricted actor role; no actor tokens or unrestricted task writes exist.
export async function processUnattendedAutomations(svc, { maxActors = 25, maxJobsPerActor = 2,
  processActor = processActorAutomations, readOverrides = loadOverrides } = {}) {
  const result = { actors: 0, ran: 0, errors: [] };
  const candidates = await svc.rpc('pending_automation_actors', { p_limit: maxActors });
  if (candidates.error) throw candidates.error;
  for (const actor of candidates.data || []) {
    const auth = { orgId: actor.organization_id, appUserId: actor.actor_id, userType: actor.actor_type, role: actor.role };
    try {
      auth.overrides = await readOverrides(svc, auth);
      const batch = await processActor({ svc, auth, maxJobs: maxJobsPerActor,
        executeStep: (job, operation) => svc.rpc('run_unattended_automation_step', {
          p_job: job.id, p_lease: job.lease, p_operation: operation,
        }),
      });
      result.actors += 1;
      result.ran += batch.ran;
      result.errors.push(...batch.errors);
    } catch (error) {
      // One revoked/unavailable actor must not prevent unrelated tenants from
      // progressing; leases/checkpoints retain the failure for recovery.
      result.errors.push({ actorId: actor.actor_id, userType: actor.actor_type, message: error?.message || 'Automation worker failed.' });
    }
  }
  return result;
}

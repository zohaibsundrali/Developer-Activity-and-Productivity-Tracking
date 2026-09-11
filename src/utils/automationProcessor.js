import { authCan } from '@/utils/serverPermissions';
import { loadOverrides } from '@/utils/permissionOverrides';
import { canReceiveTaskNotification } from '@/utils/taskNotificationAccess';
import { sendTemplatedEmail, emailMode } from '@/utils/emailService';

const TASK_ACTIONS = new Set(['assign', 'set_status', 'set_priority', 'add_label']);
const permanentCodes = new Set(['42501', '22023', '23514', '40001']);
const failure = (message, code = '22023') => Object.assign(new Error(message), { code });

// Dependency injection keeps regression tests focused on RLS client selection,
// durable checkpoints, lease ownership and external-delivery uncertainty.
export async function processActorAutomations({ auth, svc, caller, retryFailed = false, maxJobs = 8,
  sendEmail = sendTemplatedEmail, getEmailMode = emailMode }) {
  const result = { ran: 0, errors: [], pending: 0 };
  async function checkpoint(job, patch) {
    const { data, error } = await svc.from('automation_jobs').update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', job.id).eq('organization_id', auth.orgId).eq('actor_id', auth.appUserId).eq('actor_type', auth.userType)
      .eq('lease', job.lease).eq('status', 'processing').select('id');
    if (error || data?.length !== 1) throw failure('Automation lease expired; progress was not saved.', 'LEASE_LOST');
  }
  for (let jobs = 0; jobs < maxJobs; jobs += 1) {
    const claimed = await svc.rpc('claim_actor_automation_job', {
      p_org: auth.orgId, p_actor: auth.appUserId, p_type: auth.userType, p_retry: retryFailed,
    });
    if (claimed.error) throw claimed.error;
    const job = claimed.data;
    if (!job) break;
    // Explicit retry applies once per batch, never spins on the same failed job.
    retryFailed = false;
    let externalStarted = Boolean(job.external_started);
    try {
      if (!job.rule_id) {
        await checkpoint(job, { status: 'cancelled', last_error: 'Rule was removed.', lease: null, lease_until: null });
        continue;
      }
      const rule = await svc.from('automation_rules').select('id,enabled,organization_id,project_id')
        .eq('id', job.rule_id).eq('organization_id', auth.orgId).maybeSingle();
      if (rule.error) throw rule.error;
      if (!rule.data?.enabled) {
        await checkpoint(job, { status: 'cancelled', last_error: 'Rule was removed or disabled.', lease: null, lease_until: null });
        continue;
      }
      for (let index = job.next_action; index < job.actions.length; index += 1) {
        const action = job.actions[index];
        if (!action || typeof action !== 'object') throw failure('Invalid automation action.');
        let task;
        if (TASK_ACTIONS.has(action.type)) {
          const applied = await caller.rpc('apply_actor_automation_action', { p_job: job.id, p_lease: job.lease });
          if (applied.error) throw applied.error;
          if (!applied.data?.id) throw failure('Task was not changed; check current access.', '42501');
          task = applied.data;
        } else if (action.type === 'notify' || action.type === 'email') {
          const read = await caller.from('developer_tasks').select('*').eq('id', job.task_id).eq('organization_id', auth.orgId).maybeSingle();
          if (read.error) throw read.error;
          if (!read.data) throw failure('Automation task is no longer accessible.', '42501');
          task = read.data;
          if (rule.data.project_id && rule.data.project_id !== task.project_id) throw failure('Automation project scope changed since dispatch.', '40001');
          const recipientId = action.target === 'user' ? action.userId : task.developer_id || action.userId;
          if (!recipientId) throw failure('Automation recipient is missing.');
          // Existing notify actions address developer profiles. Email actions
          // without a stored type may resolve only an unambiguous membership.
          let recipients = svc.from('memberships').select('user_id,user_type,email,role,status')
            .eq('organization_id', auth.orgId).eq('user_id', recipientId).in('user_type', ['admin', 'developer']);
          if (action.type === 'notify' || action.userType) recipients = recipients.eq('user_type', action.userType || 'developer');
          const recipient = await recipients.maybeSingle();
          if (recipient.error || !recipient.data || recipient.data.status !== 'active') throw failure('Recipient identity is inactive, unavailable, or ambiguous.', '42501');
          const member = recipient.data;
          const subject = { orgId: auth.orgId, appUserId: member.user_id, userType: member.user_type, role: member.role };
          subject.overrides = await loadOverrides(svc, subject);
          if (!canReceiveTaskNotification(subject, task)) throw failure('Recipient cannot access this task.', '42501');
          const title = action.subject || action.title || 'Task update';
          const message = action.message || `Task "${task.task_title || 'Untitled'}" was updated.`;
          if (typeof title !== 'string' || title.length > 500 || typeof message !== 'string' || message.length > 20000) throw failure('Invalid automation message.');
          if (action.type === 'email' && !authCan(auth, 'automation.manage')) throw failure('Email actions require automation.manage.', '42501');
          {
            const notice = await caller.from('notifications').insert({ organization_id: auth.orgId,
              ...(member.user_type === 'admin' ? { admin_id: member.user_id, admin_recipient_type: 'admin' } : { developer_id: member.user_id }),
              type: 'automation', title, message, project_id: task.project_id, task_id: task.id,
              dedupe_key: `automation:${job.id}:${index}`, read: false });
            // Unique dedupe key means a previous delivery committed before the
            // worker lost its response; never send a second copy on recovery.
            if (notice.error && notice.error.code !== '23505') throw notice.error;
          }
          if (action.type === 'email') {
            if (!member.email) {
              const address = await svc.from(member.user_type === 'admin' ? 'admin_users' : 'developers').select('email')
                .eq('id', member.user_id).eq('organization_id', auth.orgId).maybeSingle();
              if (address.error) throw address.error;
              member.email = address.data?.email;
            }
            if (!member.email) throw failure('Recipient has no verified email address.');
            if (getEmailMode() === 'mock') throw failure('Configure a real email provider before retrying this action.');
            await checkpoint(job, { external_started: true });
            externalStarted = true;
            const delivery = await sendEmail({ template: 'automation', to: member.email, organizationId: auth.orgId,
              subject: title, data: { subject: title, heading: title, message, taskTitle: task.task_title || '', orgName: 'Your workspace' } });
            if (!delivery?.delivered) throw failure('Email delivery could not be confirmed. Verify the provider/email log before resending.', 'DELIVERY_UNKNOWN');
          }
        } else throw failure(`Unsupported automation action: ${String(action.type)}`);
        await checkpoint(job, { next_action: index + 1, task_snapshot: task, external_started: false, last_error: null,
          lease_until: new Date(Date.now() + 120000).toISOString() });
        externalStarted = false;
        job.next_action = index + 1;
        job.task_snapshot = task;
      }
      await checkpoint(job, { status: 'completed', lease: null, lease_until: null, last_error: null });
      result.ran += 1;
    } catch (error) {
      const message = error?.message || 'Automation action failed.';
      result.errors.push({ jobId: job.id, action: job.actions?.[job.next_action]?.type || 'engine', message });
      if (error?.code !== 'LEASE_LOST') {
        await checkpoint(job, { status: externalStarted ? 'delivery_unknown' : 'failed', last_error: message.slice(0, 2000),
          lease: null, lease_until: null, external_started: externalStarted,
          next_attempt_at: permanentCodes.has(error?.code) || externalStarted ? null : new Date(Date.now() + 60000 * Math.min(job.attempts, 10)).toISOString() });
      }
    }
  }
  const pending = await svc.from('automation_jobs').select('id', { count: 'exact', head: true })
    .eq('organization_id', auth.orgId).eq('actor_id', auth.appUserId).eq('actor_type', auth.userType).in('status', ['pending', 'processing']);
  if (pending.error) throw pending.error;
  result.pending = pending.count || 0;
  return result;
}

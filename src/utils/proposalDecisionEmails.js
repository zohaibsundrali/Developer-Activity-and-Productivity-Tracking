import { sendMail, notifyEmailHtml } from '@/utils/mailer';

const COPY = {
  accepted: title => `Your proposal "${title}" has been accepted and a project has been created.`,
  rejected: title => `Your proposal "${title}" was not taken forward.`,
  needs_info: title => `We need a little more detail on "${title}".`,
};

/** Durable, leased delivery. Provider success followed by a lost database ACK can
 * be retried: delivery is at least once, never falsely acknowledged in mock mode. */
export async function flushProposalDecisionEmails(svc, proposalId = null) {
  const { data: jobs, error } = await svc.rpc('claim_proposal_decision_emails', { p_proposal: proposalId, p_limit: 25 });
  if (error) throw new Error('Proposal delivery queue unavailable');
  const result = { delivered: 0, pending: 0 };
  for (const job of jobs || []) {
    let delivered = false;
    try {
      // Resolve the current verified recipient; never trust a stale stored address.
      const { data: client, error: clientError } = await svc.from('clients').select('id,email,organization_id,status')
        .eq('id', job.client_id).eq('organization_id', job.organization_id).eq('status', 'active').maybeSingle();
      if (clientError) throw clientError;
      const { data: member, error: memberError } = await svc.from('memberships').select('user_id,user_type,organization_id,status')
        .eq('organization_id', job.organization_id).eq('user_id', job.client_id).eq('user_type', 'client').eq('status', 'active').maybeSingle();
      if (memberError) throw memberError;
      if (client?.id === job.client_id && client.organization_id === job.organization_id && client.status === 'active'
        && member?.user_id === job.client_id && member.user_type === 'client' && member.organization_id === job.organization_id
        && member.status === 'active' && client.email && COPY[job.decision]) {
        const body = `${COPY[job.decision](job.title)}${job.reason ? ` — ${job.reason}` : ''}`;
        const sent = await sendMail({ to: client.email, subject: 'Project proposal update',
          html: notifyEmailHtml({ heading: 'Project proposal update', body }), text: body,
          organizationId: job.organization_id, template: 'proposal_decision' });
        delivered = sent?.delivered === true;
      }
    } catch { /* A retained queue entry is retried by cron. */ }
    const ack = await svc.rpc('finish_proposal_decision_email', { p_id: job.id, p_lease: job.lease_id, p_delivered: delivered });
    if (ack.error || ack.data !== true) throw new Error('Proposal delivery acknowledgement unavailable');
    if (delivered) result.delivered += 1;
    else result.pending += 1;
  }
  return result;
}

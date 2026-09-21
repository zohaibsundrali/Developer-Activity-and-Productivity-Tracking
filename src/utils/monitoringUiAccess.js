export const MY_ACTIVITY_KEYS = ['productivity.view_own', 'monitoring.view_own', 'team.view_own'];
export function myActivityPanels(can, context) {
  // Keyboard recordings belong to typed developer profiles. An admin UUID
  // cannot be used as a developer selector, even when both roles can monitor.
  return { productivity: can(MY_ACTIVITY_KEYS[0]), activity: context?.userType === 'developer' && can(MY_ACTIVITY_KEYS[1]), team: can(MY_ACTIVITY_KEYS[2]) };
}
export async function loadMyTypedTeam(client, context) {
  if (!context?.organizationId || !context?.userId || !['admin','developer'].includes(context.userType)) throw new Error('No staff identity');
  const mine = await client.from('project_members').select('project_id').eq('organization_id',context.organizationId)
    .eq('user_id',context.userId).eq('user_type',context.userType);
  if (mine.error) throw mine.error;
  const ids = [...new Set((mine.data || []).map(row=>row.project_id))];
  if (!ids.length) return [];
  const mates = await client.from('project_members').select('project_id,user_id,user_type,project_role,projects(name)')
    .eq('organization_id',context.organizationId).in('project_id',ids);
  if (mates.error) throw mates.error;
  const userIds = [...new Set((mates.data || []).map(row=>row.user_id))];
  if (!userIds.length) return [];
  const people = await client.from('memberships').select('user_id,user_type,email').eq('organization_id',context.organizationId).in('user_id',userIds);
  if (people.error) throw people.error;
  const emails = new Map((people.data || []).map(row=>[`${row.user_type}:${row.user_id}`,row.email]));
  return (mates.data || []).map(row=>({...row,email:emails.get(`${row.user_type}:${row.user_id}`)||null,
    isMe:row.user_id===context.userId && row.user_type===context.userType}));
}

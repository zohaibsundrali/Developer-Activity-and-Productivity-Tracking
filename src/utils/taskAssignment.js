/** Assignment identity is a profile type + profile ID, never an untyped UUID. */
export function taskAssignee(task) {
  if (task?.developer_id && task?.assignee_admin_id) return null;
  if (task?.assignee_admin_id) return { userId: task.assignee_admin_id, userType: 'admin' };
  if (task?.developer_id) return { userId: task.developer_id, userType: 'developer' };
  return null;
}

export function taskAssignmentKey(task) {
  const assignee = taskAssignee(task);
  return assignee ? `${assignee.userType}:${assignee.userId}` : '';
}

export function isTaskAssignee(task, context) {
  const assignee = taskAssignee(task);
  const id = context?.appUserId !== undefined ? context.appUserId : context?.userId;
  return Boolean(id && assignee && context?.userType === assignee.userType && String(id) === String(assignee.userId));
}

/** Legacy callers may still pass a developer ID. Both columns change together. */
export function taskAssignmentPatch(assignment) {
  if (!assignment) return { developer_id: null, assignee_admin_id: null };
  const member = typeof assignment === 'string'
    ? { userId: assignment, userType: 'developer' } : assignment;
  if (!member.userId || !['admin', 'developer'].includes(member.userType)) {
    throw new Error('Choose an active staff member.');
  }
  return {
    developer_id: member.userType === 'developer' ? member.userId : null,
    assignee_admin_id: member.userType === 'admin' ? member.userId : null,
  };
}

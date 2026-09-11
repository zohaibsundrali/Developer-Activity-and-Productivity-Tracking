export function canRemoveTaskReviewer({ task, watcher, context, allowed }) {
  if (!task?.id || !context?.organizationId || !context?.userId ||
      !['admin', 'developer'].includes(context.userType) ||
      task.organization_id !== context.organizationId ||
      watcher?.organization_id !== context.organizationId || watcher?.task_id !== task.id ||
      watcher?.role !== 'reviewer') return false;
  return (watcher.user_type === context.userType && watcher.user_id === context.userId) ||
    allowed('task.manage') === true || allowed('task.review') === true;
}

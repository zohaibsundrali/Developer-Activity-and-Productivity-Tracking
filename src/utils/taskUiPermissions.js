import { isTaskAssignee } from '@/utils/taskAssignment';
/** Existing task capabilities, separate from permission to open a dashboard. */
export function taskUiPermissions({ task, context, allowed, ownPlanEditable = false }) {
  const staff = ['admin', 'developer'].includes(context?.userType);
  const scoped = staff && Boolean(context?.organizationId) && (!task || task.organization_id === context.organizationId);
  const can = key => scoped && allowed(key) === true;
  const manage = can('task.manage');
  const own = isTaskAssignee(task, context);
  const ownUpdate = own && can('task.update_own');
  return {
    manage,
    createBug: manage || can('bug.raise'),
    move: Boolean(task && (manage || ownUpdate || (task.task_type === 'bug' && can('bug.triage')))),
    editField(field) {
      if (field === 'client_visible') return can('task.set_client_visibility');
      if (['task_title', 'task_description', 'start_date', 'end_date'].includes(field)) {
        return manage || (ownUpdate && ownPlanEditable === true);
      }
      return manage && ['priority','developer_id','story_points','due_date','estimated_hours','actual_hours','sprint_id','epic_id'].includes(field);
    },
  };
}

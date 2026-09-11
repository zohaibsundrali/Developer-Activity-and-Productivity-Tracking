import { authCan } from '@/utils/serverPermissions';

// Match the existing submission-reader permissions: supervisors and reviewers
// can read other people's work; contributors need their own assignment and
// task.view_own. Profile type prevents cross-table UUID collisions counting as
// assignment. Callers must load this subject's overrides before asking.
export function canReceiveTaskNotification(subject, task) {
  if (!subject || !task || subject.orgId !== task.organization_id) return false;
  if (subject.userType !== 'admin' && subject.userType !== 'developer') return false;
  return authCan(subject, 'task.view_all') || authCan(subject, 'task.review') ||
    (subject.userType === 'developer' && Boolean(task.developer_id) &&
      subject.appUserId === task.developer_id && authCan(subject, 'task.view_own'));
}

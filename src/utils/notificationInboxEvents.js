import { isTypedNotificationRecipient } from './notificationIdentity';

/** Resolve content/state events through the caller's committed inbox view. */
export function createNotificationInboxEvents({ organizationId, userId, userType, isCurrent, fetchRow, onRow, onError, onCount }) {
  let active = true;
  const pending = new Map();
  return {
    async handle(payload) {
      const row = payload?.new;
      if (!active || !row || !isCurrent() || row.organization_id !== organizationId) return;
      const recipientEvent = payload?.table === 'notification_recipients' || Boolean(row.notification_id);
      if (recipientEvent) {
        if (row.user_id !== userId || row.user_type !== userType) return;
      } else if (!isTypedNotificationRecipient(row, { userId, userType })) return;
      const id = recipientEvent ? row.notification_id : row.id;
      if (!id) return;
      const ticket = { isInsert: pending.get(id)?.isInsert || payload?.eventType === 'INSERT' };
      pending.set(id, ticket);
      let result;
      try { result = await fetchRow(id); } catch (error) { result = { error }; }
      if (!active || !isCurrent() || pending.get(id) !== ticket) return;
      pending.delete(id);
      if (result.error) onError(result.error);
      else if (result.data) onRow(result.data, { isInsert: ticket.isInsert });
      onCount();
    },
    close() { active = false; pending.clear(); },
  };
}

/** Navigation audience is not identity: managers use the admin shell with a developer profile. */
export function notificationRecipientKey({ userId, userType } = {}) {
  return typeof userId === 'string' && userId && ['admin', 'developer'].includes(userType)
    ? `${userType}:${userId}` : null;
}
export function isTypedNotificationRecipient(row, identity) {
  const key = notificationRecipientKey(identity);
  return Boolean(key && Array.isArray(row?.recipient_keys) && row.recipient_keys.includes(key));
}

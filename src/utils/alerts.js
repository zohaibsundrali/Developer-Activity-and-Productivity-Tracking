// One shared store keeps notifications visible across client-side navigation.
const empty = [];
let alerts = empty;
let nextId = 0;
const listeners = new Set();
const pending = new Map();
const emit = () => listeners.forEach((listener) => listener());
export const subscribeAlerts = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export const getAlerts = () => alerts;
export const getServerAlerts = () => empty;

export function dismissAlert(id, confirmed = false) {
  const resolve = pending.get(id);
  pending.delete(id);
  alerts = alerts.filter((alert) => alert.id !== id);
  emit();
  resolve?.(confirmed);
}

function enqueue(alert) {
  const id = ++nextId;
  const completion = new Promise((resolve) => pending.set(id, resolve));
  alerts = [...alerts, { ...alert, id }];
  emit();
  return completion;
}
const showAlert = (icon, title, text, options = {}) =>
  enqueue({ ...options, icon, title, text, confirmation: false });
export const showSuccess = (title, text, options) => showAlert('success', title, text, options);
export const showError = (title, text, options) => showAlert('error', title, text, options);
export const showWarning = (title, text, options) => showAlert('warning', title, text, options);
export const showInfo = (title, text, options) => showAlert('info', title, text, options);
export const showPre = (title, text, icon = 'info') => showAlert(icon, title, text, { pre: true });
// Never time out or auto-approve confirmations. Only explicit approval is true.
export const showConfirm = (title, text, options = {}) =>
  enqueue({ ...options, icon: options.icon || 'warning', title, text, confirmation: true });

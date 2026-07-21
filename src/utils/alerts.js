import Swal from "sweetalert2";

const escapeHtml = (value = "") =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");

const toPreHtml = (text) => `<pre class="swal2-pre">${escapeHtml(text)}</pre>`;

const showAlert = ({ icon, title, text, html, confirmButtonText }) =>
  Swal.fire({
    icon,
    title,
    text,
    html,
    confirmButtonText: confirmButtonText || "OK",
  });

export const showSuccess = (title, text, options = {}) =>
  showAlert({ icon: "success", title, text, ...options });

export const showError = (title, text, options = {}) =>
  showAlert({ icon: "error", title, text, ...options });

export const showWarning = (title, text, options = {}) =>
  showAlert({ icon: "warning", title, text, ...options });

export const showInfo = (title, text, options = {}) =>
  showAlert({ icon: "info", title, text, ...options });

export const showPre = (title, text, icon = "info") =>
  showAlert({ icon, title, html: toPreHtml(text) });

// Confirmation dialog — resolves to true when the user confirms.
export const showConfirm = async (title, text, options = {}) => {
  const result = await Swal.fire({
    icon: options.icon || "warning",
    title,
    text,
    showCancelButton: true,
    confirmButtonText: options.confirmButtonText || "Confirm",
    cancelButtonText: options.cancelButtonText || "Cancel",
    confirmButtonColor: options.confirmButtonColor || "#0c8f6e",
    cancelButtonColor: options.cancelButtonColor || "#64748b",
  });
  return result.isConfirmed;
};

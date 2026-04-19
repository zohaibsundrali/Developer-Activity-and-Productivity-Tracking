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

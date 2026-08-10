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
    // The logo's tile colour — the same #4840DD that src/app/icon.svg paints
    // the favicon with, and the resolved value of `--primary`. It was #0c8f6e,
    // the green from before the rename, so every confirm button in the product
    // was a colour that appears nowhere else on the site any more.
    //
    // Literal hex rather than the token: SweetAlert2 writes this straight into
    // an inline style, and `hsl(var(--primary))` does not resolve there.
    confirmButtonColor: options.confirmButtonColor || "#4840DD",
    cancelButtonColor: options.cancelButtonColor || "#64748b",
  });
  return result.isConfirmed;
};

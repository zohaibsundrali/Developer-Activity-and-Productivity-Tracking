/**
 * Minimal, dependency-free error reporting seam.
 *
 * AUDIT (Phase 5): unhandled errors were silently swallowed — no monitoring of
 * any kind existed. This module gives the app one place to report errors from,
 * without adding a paid SDK or a runtime dependency.
 *
 * Behaviour:
 *  - Always logs to the console (so nothing gets quieter than it is today).
 *  - Additionally POSTs a small JSON payload to NEXT_PUBLIC_ERROR_REPORT_URL
 *    when that env var is set. If it is NOT set, the network side is a complete
 *    no-op — safe to deploy immediately with zero configuration.
 *  - Never throws. A failure inside the reporter must never mask the original
 *    error or break a render.
 *
 * To turn monitoring on later, point NEXT_PUBLIC_ERROR_REPORT_URL at any
 * collector that accepts a JSON POST (Sentry tunnel, Logflare, a Vercel route,
 * an internal endpoint, ...). No code change required.
 */

// Read at module scope: Next.js inlines NEXT_PUBLIC_* at build time, so this
// must be a static property access, not a dynamic env lookup.
const REPORT_URL =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_ERROR_REPORT_URL) ||
  "";

const APP_ENV =
  (typeof process !== "undefined" && process.env.NODE_ENV) || "unknown";

/** True when a remote collector is configured. */
export function isReportingEnabled() {
  return Boolean(REPORT_URL);
}

/** Strip anything unserializable / oversized before it leaves the process. */
function serializeError(error) {
  if (!error) return { name: "UnknownError", message: "(no error object)" };
  if (typeof error === "string") return { name: "Error", message: error };
  return {
    name: error.name || "Error",
    message: String(error.message || error),
    // Cap the stack: collectors reject huge payloads and long stacks add nothing.
    stack: typeof error.stack === "string" ? error.stack.slice(0, 4000) : undefined,
    // Next.js attaches this to errors surfaced in error boundaries.
    digest: error.digest || undefined,
  };
}

function buildPayload(error, context) {
  const payload = {
    level: "error",
    env: APP_ENV,
    timestamp: new Date().toISOString(),
    runtime: typeof window === "undefined" ? "server" : "client",
    error: serializeError(error),
    context: context && typeof context === "object" ? context : {},
  };

  if (typeof window !== "undefined") {
    payload.url = window.location?.href;
    payload.userAgent = window.navigator?.userAgent;
  }

  return payload;
}

function send(payload) {
  if (!REPORT_URL) return;
  try {
    const body = JSON.stringify(payload);

    // `keepalive` lets the report survive a navigation/unload.
    if (typeof fetch === "function") {
      fetch(REPORT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => {
        /* reporting must never surface an error of its own */
      });
    }
  } catch {
    /* ignore — reporting is strictly best-effort */
  }
}

/**
 * Report an error. Safe to call from client components, server components,
 * route handlers and error boundaries.
 */
export function reportError(error, context) {
  const payload = buildPayload(error, context);

  try {
    // eslint-disable-next-line no-console
    console.error("[error]", payload.error.message, {
      ...payload.context,
      digest: payload.error.digest,
      stack: payload.error.stack,
    });
  } catch {
    /* ignore */
  }

  send(payload);
  return payload;
}

/** Non-fatal breadcrumb / warning. Console only unless a collector is set. */
export function reportWarning(message, context) {
  const payload = buildPayload(new Error(String(message)), context);
  payload.level = "warn";
  try {
    // eslint-disable-next-line no-console
    console.warn("[warn]", String(message), payload.context);
  } catch {
    /* ignore */
  }
  send(payload);
  return payload;
}

/**
 * Install global handlers for errors that never reach a React error boundary:
 * `window.onerror` and unhandled promise rejections. Idempotent.
 */
export function installGlobalErrorHandlers() {
  if (typeof window === "undefined") return false;
  if (window.__errorHandlersInstalled) return false;
  window.__errorHandlersInstalled = true;

  window.addEventListener("error", (event) => {
    reportError(event?.error || event?.message, { source: "window.onerror" });
  });

  window.addEventListener("unhandledrejection", (event) => {
    reportError(event?.reason, { source: "unhandledrejection" });
  });

  return true;
}

const logger = { reportError, reportWarning, isReportingEnabled, installGlobalErrorHandlers };

export default logger;

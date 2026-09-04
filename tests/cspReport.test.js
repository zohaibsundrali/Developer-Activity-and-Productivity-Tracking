import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The CSP Report-Only policy used to report to nowhere: next.config.mjs shipped
 * Content-Security-Policy-Report-Only with no report-uri/report-to, so the
 * "promote once the reports are clean" plan could never be evaluated. These
 * tests pin the sink (/api/csp-report), that both wire formats are recorded,
 * that the policy points at it, and that it is still Report-Only — not enforcing.
 */

const recorded = [];
vi.mock("@/utils/systemEvents", () => ({
  recordEvent: vi.fn(async (e) => {
    recorded.push(e);
    return true;
  }),
}));

const { POST } = await import("@/app/api/csp-report/route.js");

function post(body, json = true) {
  return POST({ json: async () => (json ? body : JSON.parse(body)) });
}

const source = (rel) => readFileSync(path.join(process.cwd(), rel), "utf8");

describe("/api/csp-report", () => {
  beforeEach(() => {
    recorded.length = 0;
  });

  it("records a legacy report-uri violation and answers 204", async () => {
    const res = await post({
      "csp-report": {
        "violated-directive": "img-src",
        "blocked-uri": "https://evil.example.com/x.png",
        "document-uri": "https://app/login?token=secret",
      },
    });
    expect(res.status).toBe(204);
    expect(recorded).toHaveLength(1);
    const e = recorded[0];
    expect(e.type).toBe("security.csp_violation");
    expect(e.severity).toBe("warning");
    expect(e.context.reason).toBe("img-src");
    expect(e.context.status).toBe("https://evil.example.com");
    // The document path is kept but its query string (with the token) is not.
    expect(e.message).toContain("/login");
    expect(e.message).not.toContain("secret");
  });

  it("records a modern report-to (reports+json) violation", async () => {
    const res = await post([
      {
        type: "csp-violation",
        body: {
          effectiveDirective: "script-src",
          blockedURL: "https://cdn.example.com/a.js",
          documentURL: "https://app/admin/dashboard",
        },
      },
      { type: "deprecation", body: {} }, // ignored — not a CSP report
    ]);
    expect(res.status).toBe(204);
    expect(recorded).toHaveLength(1);
    expect(recorded[0].context.reason).toBe("script-src");
    expect(recorded[0].context.status).toBe("https://cdn.example.com");
  });

  it("throttles repeats of the same directive+origin within the window", async () => {
    const one = {
      "csp-report": { "violated-directive": "img-src", "blocked-uri": "https://x.example.com/a.png" },
    };
    await post(one);
    await post(one);
    await post(one);
    expect(recorded).toHaveLength(1); // first recorded, next two folded in
  });

  it("never throws on a malformed body, and still answers 204", async () => {
    expect((await POST({ json: async () => { throw new Error("bad json"); } })).status).toBe(204);
    expect((await post(null)).status).toBe(204);
    expect((await post("not-a-report")).status).toBe(204);
    expect(recorded).toHaveLength(0);
  });
});

describe("next.config.mjs wires the policy to the sink and stays Report-Only", () => {
  const cfg = source("next.config.mjs");

  it("points report-uri and report-to at /api/csp-report", () => {
    expect(cfg).toContain('"report-uri /api/csp-report"');
    expect(cfg).toContain('"report-to csp-endpoint"');
    expect(cfg).toContain('csp-endpoint="/api/csp-report"');
  });

  it("is Content-Security-Policy-Report-Only, not the enforcing header", () => {
    expect(cfg).toContain("Content-Security-Policy-Report-Only");
    // The enforcing header is a bare `Content-Security-Policy` key — must be absent.
    expect(cfg).not.toMatch(/key:\s*'Content-Security-Policy'\s*,/);
  });
});

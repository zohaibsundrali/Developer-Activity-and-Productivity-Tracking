import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import fs from "node:fs";
import path from "node:path";

import { escapeHtml, safeHref, safeUrl } from "@/utils/safeUrl";
import { safeUrl as safeUrlFromEmailTemplates } from "@/utils/emailTemplates";
import {
  navCommandsFor,
  isNavCommandAllowed,
  roleFor,
  shellFor,
} from "@/components/shell/searchCommands";
import { adminNavFor, staffNav, CLIENT_NAV } from "@/components/shell/navConfig";
import { canEnterAdminArea } from "@/components/shell/sectionAccess";
import { dashboardHomeFor } from "@/utils/dashboardHome";
import { ROLES } from "@/utils/roles";

/**
 * UI correctness — six confirmed defects, and the assertions that keep them
 * fixed.
 *
 * WHAT THESE TESTS ARE GUARDING, in one line each:
 *   1. `?file_url=javascript:…` reached `link.href = …; link.click()` on
 *      /developer/project-details and executed in the page's own origin.
 *   2. `useDialog` had no idea a second dialog could be open, which cost a
 *      focus-recursion crash, a permanent scroll lock and an Escape key that
 *      closed the whole stack at once.
 *   3. `ErrorState`/`EmptyState` take `description`; thirty-six call sites
 *      passed `message`, which the `...props` spread turned into a junk DOM
 *      attribute — so every error surface in the client portal showed
 *      "Something went wrong" and nothing else.
 *   4. The command palette branched on `userType`, which cannot tell a manager
 *      from a developer, so five roles were offered the wrong shell's nav.
 *   5. /admin/upgrade never checked `planRes.ok`, so a 500 produced an empty
 *      plan list, no error, and a submit button that could never enable.
 *   6. MyWork handed a project id to a handler that wanted a project object.
 *
 * TWO TRAPS THIS SUITE DELIBERATELY AVOIDS, both of which this repo has walked
 * into before:
 *
 *  - ASSERTING AGAINST A COMMENT. Every source assertion below runs on
 *    `stripComments(source)`. The fixes above are heavily commented and name
 *    the very identifiers being asserted on, so an assertion against the raw
 *    file would pass on a file whose CODE had been reverted entirely.
 *
 *  - AN ASSERTION THE BROKEN VERSION ALSO SATISFIES. `toContain("someName")`
 *    once passed on a file that CALLED that function without importing it. So
 *    the checks here are either behavioural (call the real function and compare
 *    the answer) or negative-and-positive in pairs: the fixed form must be
 *    present AND the broken form must be absent.
 */

const root = path.resolve(__dirname, "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

/** Source with block and line comments removed — comments are not code. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** Count of non-overlapping occurrences of a literal substring. */
function countOf(haystack, needle) {
  let n = 0;
  let i = haystack.indexOf(needle);
  while (i !== -1) {
    n += 1;
    i = haystack.indexOf(needle, i + needle.length);
  }
  return n;
}

/* ================================================================== *
 * 1. Reflected DOM XSS through ?file_url=
 * ================================================================== */

describe("safeHref — the scheme check the project-details screens were missing", () => {
  it("drops every scheme that is not http(s)", () => {
    // Not a style preference. `javascript:` on an anchor that is clicked
    // programmatically runs in the current document's origin, with the session.
    expect(safeHref("javascript:alert(1)")).toBe("");
    expect(safeHref("JaVaScRiPt:alert(1)")).toBe("");
    expect(safeHref("  javascript:alert(1)")).toBe("");
    expect(safeHref("vbscript:msgbox(1)")).toBe("");
    expect(safeHref("data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==")).toBe("");
    expect(safeHref("file:///etc/passwd")).toBe("");
  });

  it("drops the control-character spellings a prefix check would miss", () => {
    // Browsers ignore embedded control characters when resolving a scheme, so
    // these navigate exactly like `javascript:` while `startsWith` says no.
    //
    // WRITTEN AS \u ESCAPES, NOT AS THE BYTES THEMSELVES. The NUL and the DEL
    // below used to be literal control characters in this file, which made git
    // call the whole thing binary — every diff of it showed as "Bin 36501 ->
    // 37285 bytes" and nothing in it could be reviewed — and made grep skip it
    // silently, so a search for any assertion in this file returned nothing at
    // all. The strings are byte-for-byte what they were; only the spelling
    // changed. Do not paste the raw characters back.
    expect(safeHref("java\nscript:alert(1)")).toBe("");
    expect(safeHref("java\tscript:alert(1)")).toBe("");
    expect(safeHref("java\rscript:alert(1)")).toBe("");
    expect(safeHref("java\u0000script:alert(1)")).toBe("");
    expect(safeHref("jav\u007fascript:alert(1)")).toBe("");
  });

  it("keeps real links intact", () => {
    expect(safeHref("https://cdn.test/files/spec.pdf")).toBe("https://cdn.test/files/spec.pdf");
    expect(safeHref("http://cdn.test/x")).toBe("http://cdn.test/x");
    expect(safeHref("/uploads/spec.pdf")).toBe("/uploads/spec.pdf");
  });

  it("returns a falsy empty string, never the input, for anything rejected", () => {
    // A caller that forgets the check gets "" rather than the attacker's
    // string handed back to it.
    for (const bad of ["javascript:alert(1)", "", null, undefined, "not a url", "null"]) {
      expect(safeHref(bad)).toBe("");
    }
  });

  it("does NOT html-escape, which is exactly why it is not `safeUrl`", () => {
    /**
     * THE REASON THE HELPER HAD TO BE SPLIT IN TWO.
     *
     * `safeUrl` escapes its survivor, because it was written for an href inside
     * hand-built email markup. Handing that output to `fetch()` or
     * `window.open()` would request `?a=1&amp;b=2` literally — a signed storage
     * link would 400 or come back as the wrong object. So the scheme check and
     * the escaping are separate, and the DOM sinks take the unescaped half.
     *
     * If someone "simplifies" the client screens back onto `safeUrl`, this is
     * the test that notices.
     */
    const withQuery = "https://cdn.test/f.pdf?token=a&download=spec.pdf";
    expect(safeHref(withQuery)).toBe(withQuery);
    expect(safeUrl(withQuery)).toBe("https://cdn.test/f.pdf?token=a&amp;download=spec.pdf");
    expect(safeHref(withQuery)).not.toContain("&amp;");
  });

  it("is ONE copy — emailTemplates re-exports it rather than keeping its own", () => {
    // Function identity, not behaviour: two independent implementations that
    // happen to agree today would pass a behavioural comparison and then drift.
    expect(safeUrlFromEmailTemplates).toBe(safeUrl);
    // The escaping contract emailTemplates depends on is unchanged.
    expect(safeUrl("javascript:alert(1)")).toBe("");
    expect(safeUrl("/invite/abc-def")).toBe("/invite/abc-def");
    expect(escapeHtml("Tom & Jerry's")).toBe("Tom &amp; Jerry&#39;s");
  });
});

describe("the three sinks that followed ?file_url= unchecked", () => {
  const PAGE = "src/app/developer/project-details/page.jsx";
  const COMPONENT = "src/components/developer/ProjectDetails.jsx";

  for (const rel of [PAGE, COMPONENT]) {
    describe(rel, () => {
      const code = stripComments(read(rel));

      it("imports the shared helper instead of rolling its own check", () => {
        expect(code).toMatch(/import \{ safeHref \} from ['"]@\/utils\/safeUrl['"]/);
        // A local re-implementation is the failure mode this is watching for.
        expect(code).not.toMatch(/function safeHref/);
      });

      it("sanitises the query-string value where it is read", () => {
        expect(code).toMatch(/file_url:\s*safeHref\(searchParams\.get\('file_url'\)\)/);
      });

      it("never reads project.file_url except to sanitise it", () => {
        /**
         * The general form of the fix, rather than a list of the three sinks
         * that happened to exist. A fourth sink added later — another
         * window.open, an <a href>, a router.push — fails this the moment it
         * reads the raw field.
         *
         * The one permitted occurrence is `safeHref(project.file_url)`.
         */
        const total = countOf(code, "project.file_url");
        const sanitised = countOf(code, "safeHref(project.file_url)");
        expect(total).toBeGreaterThan(0); // the field is still in play at all
        expect(total).toBe(sanitised);
      });

      it("hands the sanitised value to every navigation", () => {
        // Present AND absent, in pairs: `toContain("fileHref")` alone would
        // pass on a file that also still used the raw value somewhere.
        expect(code).toMatch(/\bfileHref\b/);
        expect(code).not.toMatch(/window\.open\(\s*project\.file_url/);
        expect(code).not.toMatch(/link\.href\s*=\s*project\.file_url/);
        expect(code).not.toMatch(/fetch\(\s*project\.file_url/);
      });
    });
  }

  it("the page's catch-block fallback — the actual XSS — uses the safe value", () => {
    const code = stripComments(read(PAGE));
    expect(code).toMatch(/link\.href\s*=\s*fileHref/);
    expect(code).toMatch(/window\.open\(fileHref/);
    expect(code).toMatch(/fetch\(fileHref/);
  });
});

/* ================================================================== *
 * 2. useDialog and the dialog stack
 * ================================================================== */

describe("useDialog knows which dialog is on top", () => {
  // Fresh module per test: the stack and the lock counter are module state, by
  // design (there is one document), so they must not leak between cases.
  let dialog;

  beforeEach(async () => {
    vi.resetModules();
    dialog = await import("@/components/ui/use-dialog");
  });

  it("stacks dialogs and names only the last one as topmost", () => {
    const a = dialog.pushDialog();
    expect(dialog.isTopDialog(a)).toBe(true);

    const b = dialog.pushDialog();
    // This is the whole fix. Both dialogs are open; exactly one is in charge.
    expect(dialog.isTopDialog(b)).toBe(true);
    expect(dialog.isTopDialog(a)).toBe(false);
    expect(dialog.openDialogCount()).toBe(2);

    dialog.popDialog(b);
    expect(dialog.isTopDialog(a)).toBe(true);
    expect(dialog.openDialogCount()).toBe(1);
  });

  it("removes by identity, so an out-of-order unmount cannot corrupt the stack", () => {
    // React does not promise cleanup runs in reverse mount order, and an outer
    // dialog can close while an inner one is still open. A blind pop() would
    // take the wrong token off and leave the stack pointing at a closed dialog.
    const a = dialog.pushDialog();
    const b = dialog.pushDialog();
    dialog.popDialog(a);
    expect(dialog.openDialogCount()).toBe(1);
    expect(dialog.isTopDialog(b)).toBe(true);
    expect(dialog.isTopDialog(a)).toBe(false);
  });

  it("nothing is topmost when nothing is open", () => {
    const a = dialog.pushDialog();
    dialog.popDialog(a);
    expect(dialog.isTopDialog(a)).toBe(false);
    expect(dialog.openDialogCount()).toBe(0);
  });

  describe("the focus guard that used to blow the call stack", () => {
    // A container is anything with `contains`. Real elements are not needed to
    // exercise the rule, and the rule is the part that was wrong.
    const container = (holds) => ({ contains: () => holds });

    it("only the topmost dialog recaptures focus", () => {
      /**
       * THE CRASH. Both guards were unconditional, so dialog A pulled focus out
       * of B, which fired focusin, which made B pull it back out of A, forever:
       * `RangeError: Maximum call stack size exceeded`. Nothing recovers from
       * that. With the stack, exactly one guard is live, so there is no second
       * guard for it to fight.
       */
      const a = dialog.pushDialog();
      const b = dialog.pushDialog();
      const outside = { nodeName: "INPUT" };

      expect(dialog.shouldRecaptureFocus(b, container(false), outside)).toBe(true);
      expect(dialog.shouldRecaptureFocus(a, container(false), outside)).toBe(false);
    });

    it("the topmost dialog leaves focus alone when it is already inside", () => {
      const b = dialog.pushDialog();
      expect(dialog.shouldRecaptureFocus(b, container(true), {})).toBe(false);
    });

    it("does nothing without a container", () => {
      const b = dialog.pushDialog();
      expect(dialog.shouldRecaptureFocus(b, null, {})).toBe(false);
    });
  });

  describe("the body scroll lock is a counter, not a per-dialog snapshot", () => {
    let originalDocument;
    let originalWindow;
    let body;

    beforeEach(() => {
      originalDocument = globalThis.document;
      originalWindow = globalThis.window;
      body = { style: { overflow: "auto", paddingRight: "12px" } };
      globalThis.document = { body, documentElement: { clientWidth: 1000 } };
      globalThis.window = {
        innerWidth: 1000,
        getComputedStyle: () => ({ paddingRight: "12px" }),
      };
    });

    afterEach(() => {
      globalThis.document = originalDocument;
      globalThis.window = originalWindow;
    });

    it("restores the page's own styles only when the LAST dialog closes", () => {
      /**
       * THE BUG. Each dialog snapshotted `body.style.overflow` as "the previous
       * value" on open. The second one opened after the first had already set
       * "hidden", so it snapshotted "hidden" — and whichever cleanup ran last
       * wrote that back. The page was left unscrollable with no dialog open and
       * no way out but a reload.
       *
       * The sequence below is exactly that scenario.
       */
      dialog.lockBodyScroll(); // modal opens
      expect(body.style.overflow).toBe("hidden");
      expect(dialog.scrollLockDepth()).toBe(1);

      dialog.lockBodyScroll(); // Ctrl+K over the top of it
      expect(body.style.overflow).toBe("hidden");
      expect(dialog.scrollLockDepth()).toBe(2);

      dialog.unlockBodyScroll(); // palette closes — the modal is still open
      expect(body.style.overflow).toBe("hidden");

      dialog.unlockBodyScroll(); // modal closes — now the page is the page again
      expect(body.style.overflow).toBe("auto");
      expect(body.style.paddingRight).toBe("12px");
      expect(dialog.scrollLockDepth()).toBe(0);
    });

    it("compensates for the scrollbar once, not once per dialog", () => {
      globalThis.document.documentElement.clientWidth = 985; // 15px scrollbar
      dialog.lockBodyScroll();
      dialog.lockBodyScroll();
      // 12 + 15, not 12 + 15 + 15. Double-padding shifts the whole page
      // sideways the moment a second dialog opens.
      expect(body.style.paddingRight).toBe("27px");
      dialog.unlockBodyScroll();
      dialog.unlockBodyScroll();
      expect(body.style.paddingRight).toBe("12px");
    });

    it("an unmatched unlock cannot drive the count negative", () => {
      // A negative count would mean the NEXT real lock never fires, and every
      // dialog after it leaves the page scrolling behind itself.
      dialog.unlockBodyScroll();
      dialog.unlockBodyScroll();
      expect(dialog.scrollLockDepth()).toBe(0);
      dialog.lockBodyScroll();
      expect(body.style.overflow).toBe("hidden");
    });
  });

  describe("the key handler", () => {
    const code = stripComments(read("src/components/ui/use-dialog.js"));

    it("ignores keys unless this dialog is on top", () => {
      // Asserted on the stripped source because the guard lives inside an
      // effect-scoped listener that cannot be reached without a DOM. The rule
      // it delegates to, `isTopDialog`, is behaviourally tested above.
      const handlerStart = code.indexOf("const handleKeyDown");
      expect(handlerStart).toBeGreaterThan(-1);
      // Scoped to the handler's own body. `if (!isTopDialog(token)) return`
      // also appears inside shouldRecaptureFocus, and a whole-file indexOf
      // would find that one and call the handler guarded when it is not.
      const body = code.slice(handlerStart, code.indexOf("const handleFocusIn"));
      const guard = body.indexOf("if (!isTopDialog(token)) return\n");
      const escape = body.indexOf('event.key === "Escape"');
      // indexOf returns -1 for a missing needle, and -1 sorts before every real
      // index — so "the guard comes first" passes on a DELETED guard unless
      // presence is asserted separately. It is, here.
      expect(guard).toBeGreaterThan(-1);
      expect(escape).toBeGreaterThan(-1);
      expect(guard).toBeLessThan(escape);
    });

    it("stops Escape reaching the other dialogs' listeners on the same node", () => {
      /**
       * stopPropagation stops an event travelling to other NODES. Every dialog
       * in this app listens on `document` — the same node — so it stopped
       * nothing that mattered, and one Escape ran every handler and closed the
       * entire stack. Only stopImmediatePropagation stops the remaining
       * listeners on the node the event is currently at.
       */
      expect(code).toContain("event.stopImmediatePropagation()");
    });

    it("the focusin listener defers to the shared, tested rule", () => {
      expect(code).toMatch(/shouldRecaptureFocus\(token, container, event\.target\)/);
    });

    it("the effect joins and leaves the stack, and locks through the counter", () => {
      // Pairs. A push with no pop leaks a token that is topmost forever, which
      // would silently disable every dialog opened after it.
      expect(code).toMatch(/const token = pushDialog\(\)/);
      expect(code).toMatch(/popDialog\(token\)/);
      expect(code).toMatch(/lockBodyScroll\(\)/);
      expect(code).toMatch(/unlockBodyScroll\(\)/);
      // The per-dialog snapshot that caused the stuck scroll lock is gone.
      expect(code).not.toMatch(/const prevOverflow = body\.style\.overflow/);
      expect(code).not.toMatch(/body\.style\.overflow = prevOverflow/);
    });
  });
});

/* ================================================================== *
 * 3. ErrorState / EmptyState take `description`, not `message`
 * ================================================================== */

/**
 * Every prop each primitive actually destructures. Anything else lands in
 * `...props` and is spread onto the root div, where React renders a lowercase
 * unknown name as a DOM attribute without complaint — which is precisely why
 * thirty-six broken call sites survived review.
 */
const PRIMITIVE_PROPS = {
  EmptyState: new Set(["icon", "title", "description", "action", "className", "key"]),
  ErrorState: new Set([
    "icon",
    "title",
    "description",
    "onRetry",
    "retryLabel",
    "className",
    "key",
  ]),
};

/** Every .js/.jsx file under src/. */
function sourceFiles(dir = path.join(root, "src")) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.jsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * Find `<EmptyState …>` / `<ErrorState …>` and return the props written at the
 * TOP level of the opening tag.
 *
 * The brace tracking is the whole point: `action={<Button variant="ghost"
 * onClick={…} />}` is a nested element, and counting its props as the outer
 * tag's would report false failures until someone deleted the check.
 */
function primitiveUsages(source) {
  const found = [];
  for (const match of source.matchAll(/<(EmptyState|ErrorState)\b/g)) {
    let i = match.index + match[0].length;
    let depth = 0;
    let top = "";
    while (i < source.length) {
      const c = source[i];
      if (c === "{") depth += 1;
      else if (c === "}") depth -= 1;
      else if (c === ">" && depth === 0) break;
      if (depth === 0) top += c;
      i += 1;
    }
    found.push({
      component: match[1],
      line: source.slice(0, match.index).split("\n").length,
      props: [...top.matchAll(/(?:^|\s)([A-Za-z_][A-Za-z0-9_]*)=/g)].map((m) => m[1]),
    });
  }
  return found;
}

describe("no call site passes a prop these primitives do not take", () => {
  const files = sourceFiles();
  const usages = files.flatMap((file) =>
    primitiveUsages(fs.readFileSync(file, "utf8")).map((u) => ({
      ...u,
      file: path.relative(root, file),
    }))
  );

  it("finds the call sites at all", () => {
    /**
     * The scanner is the assertion, so a scanner that silently matches nothing
     * would report a clean sweep over an empty set. This is the guard against
     * that — the same failure as `expect(file).toContain("projectStatusMeta")`
     * passing on a file that never imported it.
     */
    expect(usages.length).toBeGreaterThan(40);
    expect(usages.some((u) => u.component === "ErrorState")).toBe(true);
    expect(usages.some((u) => u.component === "EmptyState")).toBe(true);
  });

  it("every prop is one the component destructures", () => {
    /**
     * THE BUG, ACROSS THIRTY-SIX CALL SITES. Both components take
     * `description`; twenty ErrorState sites and sixteen EmptyState sites
     * passed `message`. It reached the root div as an attribute, so the reason
     * a load failed was dropped on the floor and every error surface in the
     * client portal — plus My Work, My Timesheet and Permissions — rendered a
     * bare "Something went wrong".
     *
     * Whole-tree, not a list of the files that were wrong on the day: a new
     * screen written with `message=` fails here on its first commit.
     */
    const bad = usages
      .map((u) => ({ ...u, unknown: u.props.filter((p) => !PRIMITIVE_PROPS[u.component].has(p)) }))
      .filter((u) => u.unknown.length > 0)
      .map((u) => `${u.file}:${u.line} <${u.component}> got ${u.unknown.join(", ")}`);

    expect(bad).toEqual([]);
  });

  it("the screens that were broken now pass a description", () => {
    // Positive half of the pair. The check above proves nothing WRONG is
    // passed; a call site that simply deleted its message would satisfy it
    // while still showing no reason.
    const mustExplain = [
      "src/components/client/ClientOverview.jsx",
      "src/components/client/ClientInvoices.jsx",
      "src/components/client/ClientTimeline.jsx",
      "src/components/client/ClientTaskDetail.jsx",
      "src/components/client/ClientProjects.jsx",
      "src/components/client/ClientSupport.jsx",
      "src/components/client/ClientProjectDetail.jsx",
      "src/components/client/ClientProjectComments.jsx",
      "src/components/client/ClientAnnouncements.jsx",
      "src/components/client/ClientApprovals.jsx",
      "src/components/developer/MyWork.jsx",
      "src/components/developer/MyTimesheet.jsx",
      "src/components/admin/PermissionsPanel.jsx",
    ];
    for (const rel of mustExplain) {
      const errorStates = primitiveUsages(read(rel)).filter((u) => u.component === "ErrorState");
      expect(errorStates.length).toBeGreaterThan(0);
      for (const usage of errorStates) {
        expect({ rel, line: usage.line, props: usage.props }).toEqual({
          rel,
          line: usage.line,
          props: expect.arrayContaining(["description"]),
        });
      }
    }
  });
});

describe("the primitives complain instead of swallowing", () => {
  it("both still destructure description and neither takes message", () => {
    for (const rel of ["src/components/ui/error-state.jsx", "src/components/ui/empty-state.jsx"]) {
      const code = stripComments(read(rel));
      expect(code).toMatch(/^\s*description,\s*$/m);
      expect(code).not.toMatch(/^\s*message,\s*$/m);
    }
  });

  it("warns in development when a known-wrong prop name is used", () => {
    const guard = stripComments(read("src/components/ui/prop-aliases.js"));
    // Silent is the failure mode being fixed, so the guard has to actually
    // report — and it must not report in production, where console noise on a
    // customer's screen helps nobody.
    expect(guard).toMatch(/console\.error/);
    expect(guard).toMatch(/process\.env\.NODE_ENV === "production"/);

    for (const rel of ["src/components/ui/error-state.jsx", "src/components/ui/empty-state.jsx"]) {
      const code = stripComments(read(rel));
      // Imported AND called. A call without the import is the exact shape of
      // the bug this repo has already shipped once.
      expect(code).toMatch(
        /import \{ warnAliasedProps \} from ['"]@\/components\/ui\/prop-aliases['"]/
      );
      expect(code).toMatch(/warnAliasedProps\(/);
      expect(code).toMatch(/message: "description"/);
    }
  });
});

/* ================================================================== *
 * 4. The command palette follows the role, not the profile table
 * ================================================================== */

describe("the command palette offers the shell the user is actually in", () => {
  const ctx = (userType, role) => ({ userType, role });
  const base = (command) => command.href.split("?")[0];

  it("sends every admin-area role to the admin nav", () => {
    /**
     * THE BUG. `userTypeForRole` files manager, team_lead, hr, qa and finance
     * in the `developers` table, so all five sign in with
     * `userType: "developer"` — while `dashboardHomeFor` puts them in the ADMIN
     * shell, because that is decided by role. Branching on userType therefore
     * handed a manager sitting on /admin/dashboard six staff entries pointing
     * at /developer/dashboard: none of the sections they work in, and every one
     * of them a one-way trip out of their own shell.
     */
    for (const role of ["manager", "team_lead", "hr", "qa", "finance"]) {
      const commands = navCommandsFor(ctx("developer", role));
      expect(commands.length).toBeGreaterThan(0);

      // Exactly the sidebar they see, in the same order — the palette is
      // derived from navConfig, never a second list.
      expect(commands.map((c) => c.sectionId)).toEqual(adminNavFor(role).map((i) => i.id));
      expect([...new Set(commands.map(base))]).toEqual([dashboardHomeFor("developer", role)]);

      // The staff nav is what they used to get; make sure it is not what they
      // get now.
      //
      // `my-work` USED TO BE the tell — it was in every staff nav and in no
      // admin nav. It is in both now, because moving these five roles into
      // /admin took their own-work screens away and the fix was to render them
      // here rather than send anybody back across. So the tell is no longer
      // WHICH sections appear but WHERE they point: every command above,
      // my-work included, resolves to the admin dashboard, which the `base`
      // assertion already pins. What is left to prove is that the palette is
      // the admin nav and not the staff one — so: at least one section that no
      // staff nav has ever contained.
      const staffIds = new Set(staffNav(role).map((i) => i.id));
      const orgWide = commands.map((c) => c.sectionId).filter((id) => !staffIds.has(id));
      expect(orgWide.length, `${role} got only staff sections`).toBeGreaterThan(0);
    }
  });

  it("gives a manager sections a plain developer never sees", () => {
    // A weaker version of this test — "the base path is /admin/dashboard" —
    // would pass on a list that was still empty or still generic.
    const manager = navCommandsFor(ctx("developer", "manager")).map((c) => c.sectionId);
    expect(manager).toContain("all-projects");
    expect(manager).toContain("overview");
    expect(manager.length).toBeGreaterThan(1);
  });

  it("leaves a plain developer on the staff shell", () => {
    for (const role of ["developer", "designer", "devops", "employee"]) {
      const commands = navCommandsFor(ctx("developer", role));
      expect(commands.map((c) => c.sectionId)).toEqual(staffNav(role).map((i) => i.id));
      expect([...new Set(commands.map(base))]).toEqual([dashboardHomeFor("developer", role)]);
    }
  });

  it("still handles owner/admin and a legacy admin row with no membership role", () => {
    for (const role of ["owner", "admin"]) {
      const commands = navCommandsFor(ctx("admin", role));
      expect(commands.map((c) => c.sectionId)).toEqual(adminNavFor(role).map((i) => i.id));
    }
    // The dashboard falls back to "admin" for a row with no membership_role;
    // the palette has to fall back identically or the two lists disagree.
    expect(roleFor({ userType: "admin", role: null })).toBe("admin");
    expect(navCommandsFor({ userType: "admin" }).map((c) => c.sectionId)).toEqual(
      adminNavFor("admin").map((i) => i.id)
    );
  });

  it("keeps clients in the portal, whatever else is on the session", () => {
    const commands = navCommandsFor(ctx("client", "client"));
    expect(commands.map((c) => c.sectionId)).toEqual(CLIENT_NAV.map((i) => i.id));
    expect([...new Set(commands.map(base))]).toEqual(["/client"]);
    expect(navCommandsFor({ userType: "client", role: "owner" }).map((c) => c.userType)).toEqual(
      CLIENT_NAV.map(() => "client")
    );
  });

  it("returns nothing when nobody is signed in", () => {
    expect(navCommandsFor(null)).toEqual([]);
    expect(navCommandsFor({})).toEqual([]);
    expect(shellFor(null)).toBeNull();
  });

  it("agrees with dashboardHomeFor for every role in the vocabulary", () => {
    /**
     * The cross-file invariant, over ROLES rather than a hand-picked five. The
     * palette and the "where do I belong" map are two readers of one rule; a
     * new role added to the catalogue is covered here the day it appears.
     */
    for (const role of ROLES) {
      const userType = role === "client" ? "client" : role === "admin" || role === "owner" ? "admin" : "developer";
      const commands = navCommandsFor(ctx(userType, role));
      expect(commands.length).toBeGreaterThan(0);
      const bases = [...new Set(commands.map(base))];
      expect({ role, bases }).toEqual({ role, bases: [dashboardHomeFor(userType, role)] });
    }
  });

  it("shellFor answers with the role, and canEnterAdminArea is the judge", () => {
    for (const role of ROLES) {
      if (role === "client") continue;
      const expected = canEnterAdminArea(role) ? "admin" : "developer";
      expect({ role, shell: shellFor(ctx("developer", role)) }).toEqual({ role, shell: expected });
    }
  });

  it("does not block the very commands it just built", () => {
    /**
     * The near-miss this fix could have introduced. `isNavCommandAllowed`
     * compared `command.userType` against `ctx.userType`; a manager's commands
     * are tagged "admin" while their userType is "developer", so a careless fix
     * to navCommandsFor alone would have made every row in the palette inert on
     * Enter — a worse bug than the one being fixed.
     */
    for (const role of ["manager", "team_lead", "hr", "qa", "finance", "developer", "employee"]) {
      const context = ctx("developer", role);
      for (const command of navCommandsFor(context)) {
        expect({ role, id: command.sectionId, ok: isNavCommandAllowed(command, context) }).toEqual({
          role,
          id: command.sectionId,
          ok: true,
        });
      }
    }
    for (const command of navCommandsFor(ctx("client", "client"))) {
      expect(isNavCommandAllowed(command, ctx("client", "client"))).toBe(true);
    }
  });

  it("still refuses a stale command from a session that has changed underneath it", () => {
    const managerCommands = navCommandsFor(ctx("developer", "manager"));
    const developerCtx = ctx("developer", "developer");
    // Signed out of the manager account and back in as a developer while the
    // palette was open: the rows in state are now forbidden.
    for (const command of managerCommands) {
      expect(isNavCommandAllowed(command, developerCtx)).toBe(false);
    }
  });

  it("still reads the shared route map rather than its own literals", () => {
    const code = stripComments(read("src/components/shell/searchCommands.js"));
    expect(code).toMatch(/import \{ DASHBOARD_HOME \} from ['"]@\/utils\/dashboardHome['"]/);
    expect(code).not.toMatch(/["']\/admin\/dashboard["']/);
    expect(code).not.toMatch(/["']\/developer\/dashboard["']/);
    // And the branch is on the role rule, not on the profile table.
    expect(code).toMatch(/canEnterAdminArea\(/);
    expect(code).not.toMatch(/if \(userType === "admin"\)/);
  });
});

/* ================================================================== *
 * 5. /admin/upgrade must not dead-end
 * ================================================================== */

describe("/admin/upgrade reports a failed plan load instead of going quiet", () => {
  const code = stripComments(read("src/app/admin/upgrade/page.jsx"));

  it("checks the response status, because a 500 does not reject", () => {
    /**
     * `fetch` only rejects on a network error, so the old `try/catch` could not
     * see an HTTP 500 at all: `planRes.json().catch(() => ({}))` swallowed the
     * body, `plans` became [], no error was set, `chosen` stayed null and the
     * one submit — `disabled={saving || loading || !chosen}` — could never
     * enable. A billing-locked admin is REDIRECTED here by BillingGate and has
     * no other admin screen to go to, so that was the end of the product for
     * them.
     */
    expect(code).toMatch(/if \(!planRes\.ok\)/);
    // The swallow that made the catch unreachable.
    expect(code).not.toMatch(/planRes\.json\(\)\.catch\(\(\) => \(\{\}\)\)/);
    expect(code).not.toMatch(/Array\.isArray\(planData\.plans\) \? planData\.plans : \[\]/);
  });

  it("treats an unreadable or empty list as a failure, not as an empty state", () => {
    expect(code).toMatch(/!planData \|\| !Array\.isArray\(planData\.plans\)/);
    expect(code).toMatch(/planData\.plans\.length === 0/);
  });

  it("every failure path sets a message and raises the retry", () => {
    expect(code).toMatch(/catch \(err\) \{/);
    expect(code).toMatch(/setLoadFailed\(true\)/);
    expect(code).toMatch(/setError\(/);
    // Cleared when a retry starts, or the old message outlives the failure.
    expect(code).toMatch(/setLoadFailed\(false\)/);
  });

  it("offers a control that actually calls load again", () => {
    // Present AND wired. A "Try again" label with no handler is the same dead
    // end with better manners.
    expect(code).toMatch(/loadFailed &&/);
    expect(code).toMatch(/onClick=\{load\}/);
    expect(code).toMatch(/Try again/);
  });

  it("the submit is still gated on a real choice", () => {
    // The disabled expression is correct; it was the missing error handling
    // that made it permanent. Loosening it would be the wrong fix.
    expect(code).toMatch(/disabled=\{saving \|\| loading \|\| !chosen\}/);
  });
});

/* ================================================================== *
 * 6. MyWork opens the right project
 * ================================================================== */

describe("MyWork hands the details handler a project, not an id", () => {
  const MYWORK = "src/components/developer/MyWork.jsx";
  const DASHBOARD = "src/app/developer/dashboard/page.jsx";

  it("no longer passes the bare id", () => {
    const code = stripComments(read(MYWORK));
    // The exact broken call. Every task row on the screen pushed
    // `/developer/project-details?id=undefined&name=undefined…`.
    expect(code).not.toMatch(/onViewProjectDetails\?\.\(task\.project_id\)/);
    expect(code).toMatch(/onViewProjectDetails\?\.\(\{/);
    expect(code).toMatch(/id: task\.project_id/);
  });

  it("supplies every field the dashboard handler interpolates", () => {
    /**
     * The real contract, read off the handler rather than guessed.
     * handleViewProjectDetails builds a query string out of `project.<field>`
     * for eleven fields, most of them unguarded, so any field MyWork omits
     * lands in the URL as the literal text "undefined".
     *
     * MyProjects passes a whole projects row and is fine. MyWork only has
     * `id, name, status` from loadMyWork's join, so it fills the rest with
     * blanks — the project-details page reads the row from the database off
     * `id` and only falls back to these when that lookup fails.
     */
    // The handler now delegates to projectDetailsHref (utils/queryDates.js),
    // which is where `project.<field>` is read — so that is the contract.
    const handler = stripComments(read(DASHBOARD));
    expect(handler).toMatch(/const handleViewProjectDetails[\s\S]*projectDetailsHref\(project\)/);
    const util = stripComments(read("src/utils/queryDates.js"));
    const start = util.indexOf("export function projectDetailsHref");
    expect(start).toBeGreaterThan(-1);
    const body = util.slice(start, util.indexOf("return `/developer/project-details", start));

    const required = [...new Set([...body.matchAll(/project\.([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]))];
    // Guard against the slice silently coming back empty and this asserting
    // nothing at all.
    expect(required).toContain("id");
    expect(required.length).toBeGreaterThan(5);

    const start2 = stripComments(read(MYWORK)).indexOf("onViewProjectDetails?.({");
    expect(start2).toBeGreaterThan(-1);
    const passed = stripComments(read(MYWORK)).slice(start2, start2 + 900);
    const missing = required.filter((field) => !new RegExp(`\\b${field}:`).test(passed));
    expect(missing).toEqual([]);
  });

  it("still refuses to navigate for a task with no project", () => {
    const code = stripComments(read(MYWORK));
    expect(code).toMatch(/if \(!task\?\.project_id\) return/);
  });

  it("MyProjects, which was always correct, still passes the whole row", () => {
    const code = stripComments(read("src/components/developer/MyProjects.jsx"));
    expect(code).toMatch(/onViewProjectDetails\(project\)/);
  });
});

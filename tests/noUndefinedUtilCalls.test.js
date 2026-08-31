import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * A function that is CALLED but never IMPORTED.
 *
 * WHY THIS FILE EXISTS. `components/developer/MyProjects.jsx` called
 * `projectStatusMeta(status)` and never imported it. Every developer with at
 * least one assigned project hit a ReferenceError and got the error page; an
 * account with zero projects rendered fine, so it survived manual checks.
 *
 * It also survived 1824 passing tests, because the test guarding exactly this
 * asserted `expect(file).toContain("projectStatusMeta")` — a condition the
 * BROKEN call satisfies as well as a working one. That assertion has been
 * changed to require the import; this file generalises it to the whole tree,
 * because the next instance will not be in a file anybody thought to guard.
 *
 * This is plain JavaScript with no type checker, and `next build` does not
 * resolve identifiers inside a component body, so nothing else in the
 * toolchain catches it.
 *
 * DELIBERATELY CONSERVATIVE: a name is only reported when some module under
 * src/utils exports it. A mistyped local helper is not this test's job, and
 * flagging one would make the test noisy enough to be ignored.
 */

const SRC = path.resolve(__dirname, "..", "src");

function jsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...jsFiles(p));
    else if (/\.(jsx?|mjs)$/.test(p)) out.push(p);
  }
  return out;
}

/** Comments and string literals are not code; identifiers inside them are prose. */
function stripNonCode(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ")
    .replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""');
}

function importedNames(source) {
  const names = new Set();
  for (const m of source.matchAll(/import\s+([\s\S]*?)\s+from\s+["'][^"']+["']/g)) {
    for (const raw of m[1].replace(/[{}]/g, " ").split(/[,\s]+/)) {
      const name = raw.replace(/^.*\bas\b\s*/, "").trim();
      if (name) names.add(name);
    }
  }
  return names;
}

function localNames(code) {
  const names = new Set();
  for (const m of code.matchAll(/(?:function|const|let|var|class)\s+(\w+)/g)) names.add(m[1]);
  for (const m of code.matchAll(/(?:const|let|var)\s*\{([^}]*)\}/g)) {
    for (const raw of m[1].split(/[,\s]+/)) {
      const name = raw.split(":").pop().trim();
      if (name) names.add(name);
    }
  }
  for (const m of code.matchAll(/function\s*\w*\s*\(([^)]*)\)/g)) {
    for (const raw of m[1].split(/[,\s]+/)) {
      const name = raw.replace(/[{}]/g, "").split(/[:=]/)[0].trim();
      if (name) names.add(name);
    }
  }
  return names;
}

const files = jsFiles(SRC);

const utilExports = new Set();
for (const file of files.filter((f) => f.includes(`${path.sep}utils${path.sep}`))) {
  const code = stripNonCode(readFileSync(file, "utf8"));
  for (const m of code.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)) utilExports.add(m[1]);
  for (const m of code.matchAll(/export\s+const\s+(\w+)/g)) utilExports.add(m[1]);
}

describe("every util function that is called is also imported", () => {
  it("has something to check", () => {
    // Guards the scanner itself: a regex that silently matched nothing would
    // make this whole file a green light that tests no code at all.
    expect(files.length).toBeGreaterThan(100);
    expect(utilExports.size).toBeGreaterThan(50);
    expect(utilExports.has("projectStatusMeta")).toBe(true);
  });

  it("finds no call to an unimported util export", () => {
    const offenders = [];

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const code = stripNonCode(source);
      const known = new Set([...importedNames(source), ...localNames(code)]);

      for (const m of code.matchAll(/(^|[^.\w$])(\w+)\s*\(/g)) {
        const name = m[2];
        // `[^.\w$]` in the pattern already excludes `obj.name(` — a method
        // call is not a reference to the module-level binding.
        if (!utilExports.has(name) || known.has(name)) continue;
        offenders.push(`${path.relative(SRC, file)} calls ${name}() without importing it`);
      }
    }

    expect([...new Set(offenders)]).toEqual([]);
  });
});

/**
 * One copy of "is this URL safe to follow", for HTML and for the DOM.
 *
 * WHY THIS FILE EXISTS
 *  `safeUrl` and `escapeHtml` used to live in utils/emailTemplates.js, where
 *  they were written for exactly one job: interpolating a URL into an `href`
 *  attribute inside a hand-built email. That is a fine place for them until a
 *  CLIENT screen needs the same scheme check — and one did.
 *
 *  /developer/project-details reads `?file_url=` straight out of the query
 *  string and, on a DB miss or a failed fetch, treats that value as the
 *  project's real file. Three sinks then consumed it unchecked:
 *  `fetch(file_url)`, `link.href = file_url; link.click()` in the catch block,
 *  and `window.open(file_url, "_blank")`. A `javascript:` URL makes the fetch
 *  throw, which is what REACHES the catch — and a programmatic click on a
 *  `javascript:` anchor runs the script in the page's own origin, with the
 *  signed-in session. Reflected DOM XSS from a link anyone can send.
 *
 *  Importing emailTemplates.js into those screens would have been the wrong
 *  fix twice over: it drags the whole template library into the client bundle,
 *  and — the real problem — `safeUrl` HTML-ESCAPES its survivor. That is
 *  correct for an attribute and WRONG for a live URL: a legitimate storage link
 *  carrying `?a=1&b=2` comes back as `?a=1&amp;b=2`, which fetch and
 *  window.open would request literally. So the scheme check is separated from
 *  the escaping here, and each caller takes the half it needs:
 *
 *    safeHref(value)  →  the URL, unescaped, for fetch/href/window.open
 *    safeUrl(value)   →  the same URL, HTML-escaped, for an href in markup
 *
 *  emailTemplates.js imports both from here rather than keeping its own copy,
 *  so there is still exactly one answer to "which schemes are allowed" — and
 *  its exported names are unchanged, so every existing caller and
 *  tests/emailSystem.test.js still see the same functions.
 */

/**
 * HTML-escape a value for interpolation into element content or a quoted
 * attribute. Same implementation this project has always used — it is also the
 * one in src/app/api/send-verification/route.js's history.
 *
 * The slice happens BEFORE escaping so `maxLen` bounds the source text rather
 * than the entity-expanded output; the escape then runs over the slice, so it
 * is impossible to cut an entity in half.
 */
export function escapeHtml(value, maxLen = 500) {
  return String(value ?? "")
    .slice(0, maxLen)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * The URL if it is safe to navigate to or fetch, otherwise "".
 *
 * Only absolute http/https URLs and site-relative paths survive.
 * `javascript:`, `data:` and `vbscript:` are dropped entirely — there is no
 * amount of escaping that makes a scheme safe, and every one of those three is
 * still honoured somewhere.
 *
 * The control-character strip is not cosmetic and it is not a trim: browsers
 * ignore embedded control characters when resolving a scheme, so
 * `java\nscript:alert(1)` navigates exactly like `javascript:alert(1)` while
 * sailing past any naive `startsWith("javascript:")` check. Flattening first
 * means the test below sees what the browser will see.
 *
 * Returns "" — never null and never the input — so a caller that forgets to
 * check gets a falsy value rather than the attacker's string back.
 */
export function safeHref(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const flat = raw.replace(/[\u0000-\u0020\u007f]/g, "");
  if (/^https?:\/\//i.test(flat) || /^\//.test(flat)) return flat.slice(0, 2000);
  return "";
}

/**
 * Return an href that is safe to place in MARKUP, or "" when it is not.
 *
 * `safeHref` decides what survives; this only attribute-escapes the survivor,
 * because a URL going into a hand-built `href="..."` still has to not break out
 * of the quotes. Use `safeHref` instead anywhere the value is handed to the
 * DOM or to fetch as a real URL — see the note at the top of this file.
 */
export function safeUrl(value) {
  return escapeHtml(safeHref(value), 2000);
}

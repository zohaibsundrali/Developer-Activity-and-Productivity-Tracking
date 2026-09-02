/**
 * Loud failure for props a primitive does NOT take.
 *
 * THE BUG THIS EXISTS TO PREVENT
 *  `ErrorState` and `EmptyState` both take `description`. Thirty-six call
 *  sites across the client portal, My Work, My Timesheet and Permissions passed
 *  `message=` instead. Because both components end in `...props` spread onto
 *  their root `<div>`, and because `message` is all-lowercase, React passed it
 *  straight through as a DOM attribute without a word of complaint. The result
 *  was that EVERY error surface in the portal rendered the generic heading
 *  "Something went wrong" with the actual reason dropped on the floor — the one
 *  thing an error surface exists to show — and every empty state lost its
 *  explanatory line. Nothing threw, nothing logged, and the JSX read correctly.
 *
 *  A prop spread is a silent typo detector that never fires. This is the
 *  detector.
 *
 * WHY A NAMED LIST AND NOT "ANYTHING UNRECOGNISED"
 *  The `...props` spread is load-bearing: `id`, `style`, `aria-*` and `data-*`
 *  are meant to reach the div. Warning on every leftover would cry wolf until
 *  people stopped reading it, which is how a warning becomes worse than no
 *  warning. So this only fires on names that are known to be WRONG — near
 *  misses for a real prop — and each one names its replacement.
 *
 * DEV ONLY, and deliberately not a throw. A rendered error surface that is
 * missing one line is still more use to the person looking at it than an error
 * boundary. tests/uiCorrectness.test.js is the gate that actually stops these
 * reaching a build; this is what shortens the loop while someone is writing the
 * call site.
 */

// Names already seen, so a component rendered in a list logs once rather than
// once per row.
const reported = new Set()

/**
 * @param {string} component  e.g. "ErrorState" — named in the message
 * @param {object} rest       the `...props` the component did not destructure
 * @param {object} aliases    wrong name -> the prop that was meant
 */
export function warnAliasedProps(component, rest, aliases) {
  if (process.env.NODE_ENV === "production") return
  if (!rest) return

  for (const wrong of Object.keys(aliases)) {
    if (!(wrong in rest)) continue
    const key = `${component}.${wrong}`
    if (reported.has(key)) continue
    reported.add(key)
    // console.error rather than warn: this is a defect with a visible symptom,
    // not a style note, and warn is filtered out by default in some setups.
    console.error(
      `<${component}> was given a \`${wrong}\` prop, which it does not take. ` +
        `It was spread onto the root element as a DOM attribute and its value ` +
        `is not rendered. Use \`${aliases[wrong]}\` instead.`
    )
  }
}

"use client"

import * as React from "react"

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  "audio[controls]",
  "video[controls]",
  "[contenteditable]:not([contenteditable='false'])",
  "[tabindex]:not([tabindex='-1'])",
].join(",")

/** Visible, tabbable descendants of `node`, in DOM order. */
function getFocusable(node) {
  if (!node) return []
  return Array.from(node.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
    (el) =>
      !el.hasAttribute("disabled") &&
      el.getAttribute("aria-hidden") !== "true" &&
      (el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0)
  )
}

/* ------------------------------------------------------------------ *
 * The dialog stack.
 *
 * WHAT WAS MISSING AND WHY IT MATTERED
 *
 * Every dialog listened on `document`, in the capture phase, and none of them
 * had any idea another one existed. That is fine while only one can be open —
 * and two always could be. CommandPalette is mounted for the whole session with
 * an ungated Cmd/Ctrl+K listener, so "open a modal, press Ctrl+K" stacks two
 * dialogs on any screen in the product. Three separate failures followed:
 *
 *  1. FOCUS RECURSION. `handleFocusIn` fired on every focus change anywhere and
 *     unconditionally yanked focus back into ITS panel. With two of them
 *     mounted, A pulled focus out of B, which fired focusin, which made B pull
 *     it back out of A, and so on until `RangeError: Maximum call stack size
 *     exceeded`. Nothing recovers from that; the tab is finished.
 *
 *  2. A PERMANENT SCROLL LOCK. Each dialog snapshotted `body.style.overflow` as
 *     "the previous value" and wrote it back on close. The second dialog opened
 *     after the first had already set "hidden", so it snapshotted "hidden" —
 *     and whichever cleanup ran last restored that. The page was left
 *     unscrollable with no dialog open and no way back except a reload.
 *
 *  3. ESCAPE CLOSED EVERYTHING. The handler called `stopPropagation()`, which
 *     stops the event travelling to other NODES and does nothing about other
 *     listeners on the same node — and every dialog listens on the same node,
 *     `document`. So one Escape ran every dialog's handler and closed all of
 *     them, when it should close the top one and leave the rest.
 *
 * The fix for all three is the same missing concept: an ordered stack of what
 * is open, so a dialog can ask whether it is the one on top. It lives at module
 * scope because there is one of it per document, not one per component — the
 * same reason the listeners are on `document` in the first place. The push/pop
 * pair is exported so this is testable without a DOM.
 * ------------------------------------------------------------------ */

/** Open dialogs, outermost first. The last entry is the topmost. */
const openDialogs = []

/** Register a newly opened dialog and return its token. */
export function pushDialog() {
  const token = { id: Symbol("dialog") }
  openDialogs.push(token)
  return token
}

/**
 * Remove a dialog from the stack.
 *
 * Splices by identity rather than popping, because cleanup order is React's to
 * decide and is NOT guaranteed to be the reverse of mount order — an outer
 * dialog can unmount while an inner one is still open, and a blind pop would
 * take the wrong token off and leave the stack pointing at something closed.
 */
export function popDialog(token) {
  const index = openDialogs.indexOf(token)
  if (index !== -1) openDialogs.splice(index, 1)
}

/** Is this dialog the one on top — the only one that should react to input? */
export function isTopDialog(token) {
  return openDialogs.length > 0 && openDialogs[openDialogs.length - 1] === token
}

/** Depth of the stack. Exported for tests; nothing in the UI reads it. */
export function openDialogCount() {
  return openDialogs.length
}

/**
 * Should this dialog pull focus back, given where focus just landed?
 *
 * Pulled out of the focusin listener so the rule can be tested directly, and
 * because the `isTopDialog` clause is the entire fix for the recursion above —
 * a check buried in an event handler is a check nobody can exercise.
 *
 * A dialog that is not on top yields: whatever stole focus is either the dialog
 * above it (which is allowed to have focus) or something outside both (which is
 * the top dialog's problem, not this one's). Either way, exactly one guard is
 * ever active, so there is no second guard to fight with.
 */
export function shouldRecaptureFocus(token, container, target) {
  if (!container) return false
  if (!isTopDialog(token)) return false
  return !container.contains(target)
}

/* ------------------------------------------------------------------ *
 * Body scroll lock — a COUNTER, not a per-dialog snapshot.
 *
 * The page's own styles are read once, when the first dialog opens, and written
 * back once, when the last one closes. Nested dialogs in between change only
 * the count. This is why `prevOverflow`/`prevPaddingRight` are module state and
 * not locals in the effect: a local is a per-dialog snapshot, and a per-dialog
 * snapshot of a value another dialog already changed is the bug.
 * ------------------------------------------------------------------ */

let scrollLockCount = 0
let scrollLockPrev = null

export function lockBodyScroll() {
  scrollLockCount += 1
  if (scrollLockCount > 1) return
  if (typeof document === "undefined") return

  const body = document.body
  scrollLockPrev = {
    overflow: body.style.overflow,
    paddingRight: body.style.paddingRight,
  }
  const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth
  body.style.overflow = "hidden"
  if (scrollbarWidth > 0) {
    const current = parseFloat(window.getComputedStyle(body).paddingRight) || 0
    body.style.paddingRight = `${current + scrollbarWidth}px`
  }
}

export function unlockBodyScroll() {
  // Clamped at zero. An unmatched unlock (a double cleanup, a hot reload)
  // must not drive the count negative, because a negative count means the next
  // real lock never fires and every dialog after it leaves the page scrolling
  // behind itself.
  scrollLockCount = Math.max(0, scrollLockCount - 1)
  if (scrollLockCount > 0) return
  if (typeof document === "undefined") return

  const body = document.body
  if (scrollLockPrev) {
    body.style.overflow = scrollLockPrev.overflow
    body.style.paddingRight = scrollLockPrev.paddingRight
    scrollLockPrev = null
  }
}

/** Current lock depth. Exported for tests; nothing in the UI reads it. */
export function scrollLockDepth() {
  return scrollLockCount
}

/**
 * Shared dialog behaviour for Modal and Drawer:
 *
 *  - remembers the element that had focus before opening and restores it on close
 *  - moves focus into the panel when it opens
 *  - traps Tab / Shift+Tab inside the panel (wrapping at both ends)
 *  - re-captures focus if anything outside the panel steals it (focusin guard)
 *  - closes on Escape
 *  - locks body scroll while open, compensating for the scrollbar width
 *
 * ALL OF THAT APPLIES TO THE TOPMOST DIALOG ONLY. See the stack above for what
 * happened when it applied to all of them at once.
 *
 * Everything is torn down when `open` goes false or the component unmounts.
 */
export function useDialog({ open, onClose, containerRef }) {
  const onCloseRef = React.useRef(onClose)

  React.useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  React.useEffect(() => {
    if (!open) return undefined
    if (typeof document === "undefined") return undefined

    const container = containerRef.current
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null

    // This dialog's place in the stack. Taken before anything else, so the
    // guards below can ask "am I on top" from their first invocation.
    const token = pushDialog()

    // --- body scroll lock ---------------------------------------------------
    lockBodyScroll()

    // --- initial focus ------------------------------------------------------
    const frame = window.requestAnimationFrame(() => {
      const target = getFocusable(container)[0] || container
      if (target && typeof target.focus === "function") {
        target.focus({ preventScroll: true })
      }
    })

    // --- Escape + Tab trap --------------------------------------------------
    const handleKeyDown = (event) => {
      // Not the top dialog: this key belongs to the one above. Returning
      // WITHOUT preventDefault matters — a dialog underneath must neither close
      // nor swallow the keystroke on the way past.
      if (!isTopDialog(token)) return

      if (event.key === "Escape") {
        // stopImmediatePropagation, NOT stopPropagation.
        //
        // stopPropagation stops the event reaching other NODES. Every dialog
        // in the app listens on `document` — the same node — so it stopped
        // nothing that mattered and one Escape closed the whole stack. Only
        // stopImmediatePropagation prevents the remaining listeners on this
        // same node from running.
        event.stopImmediatePropagation()
        event.stopPropagation()
        event.preventDefault()
        if (typeof onCloseRef.current === "function") onCloseRef.current()
        return
      }
      if (event.key !== "Tab" || !container) return

      const focusable = getFocusable(container)
      if (focusable.length === 0) {
        event.preventDefault()
        container.focus({ preventScroll: true })
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement
      const inside = container.contains(active)

      if (event.shiftKey) {
        if (!inside || active === first || active === container) {
          event.preventDefault()
          last.focus()
        }
      } else if (!inside || active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    // --- guard against focus escaping by any other means ---------------------
    const handleFocusIn = (event) => {
      if (!shouldRecaptureFocus(token, container, event.target)) return
      const target = getFocusable(container)[0] || container
      if (target && typeof target.focus === "function") {
        target.focus({ preventScroll: true })
      }
    }

    document.addEventListener("keydown", handleKeyDown, true)
    document.addEventListener("focusin", handleFocusIn, true)

    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener("keydown", handleKeyDown, true)
      document.removeEventListener("focusin", handleFocusIn, true)
      popDialog(token)
      unlockBodyScroll()
      if (
        previouslyFocused &&
        typeof previouslyFocused.focus === "function" &&
        document.contains(previouslyFocused)
      ) {
        previouslyFocused.focus({ preventScroll: true })
      }
    }
  }, [open, containerRef])
}

/** True once mounted in the browser — gates createPortal for SSR safety. */
export function useMounted() {
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => setMounted(true), [])
  return mounted
}

export { getFocusable }

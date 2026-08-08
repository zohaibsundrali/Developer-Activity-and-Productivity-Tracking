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

    // --- body scroll lock ---------------------------------------------------
    const body = document.body
    const prevOverflow = body.style.overflow
    const prevPaddingRight = body.style.paddingRight
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth
    body.style.overflow = "hidden"
    if (scrollbarWidth > 0) {
      const current = parseFloat(window.getComputedStyle(body).paddingRight) || 0
      body.style.paddingRight = `${current + scrollbarWidth}px`
    }

    // --- initial focus ------------------------------------------------------
    const frame = window.requestAnimationFrame(() => {
      const target = getFocusable(container)[0] || container
      if (target && typeof target.focus === "function") {
        target.focus({ preventScroll: true })
      }
    })

    // --- Escape + Tab trap --------------------------------------------------
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
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
      if (!container || container.contains(event.target)) return
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
      body.style.overflow = prevOverflow
      body.style.paddingRight = prevPaddingRight
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

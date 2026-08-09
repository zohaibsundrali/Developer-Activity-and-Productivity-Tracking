"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * ScrollStrip — a horizontally scrollable row that LOOKS scrollable.
 *
 * `overflow-x-auto` on its own is invisible: on a phone there is no scrollbar
 * until you drag, so a tab strip or chip row whose last item is cut mid-word
 * reads as a rendering bug ("Delays" printing as "Dela") rather than as
 * something you can push sideways. This wraps the viewport and paints a soft
 * edge fade on whichever side still has content behind it, so the clip is
 * always attributable and the affordance appears exactly when it is true.
 *
 * Presentation only — it owns no state beyond the two booleans that say which
 * edges are currently overflowing, and it never touches the children.
 *
 *   <ScrollStrip fadeFrom="from-card"><div className="flex w-max">…</div></ScrollStrip>
 *
 * `fadeFrom` is the Tailwind gradient stop matching the surface BEHIND the
 * strip, so the fade dissolves into the page rather than smearing a colour
 * across it.
 */
function ScrollStrip({
  className,
  viewportClassName,
  fadeFrom = "from-background",
  fadeWidth = "w-8",
  children,
  ...props
}) {
  const viewportRef = React.useRef(null)
  // Default to "no overflow" so the server render and the first client render
  // agree — the fades are painted only after a real measurement.
  const [atStart, setAtStart] = React.useState(true)
  const [atEnd, setAtEnd] = React.useState(true)

  const measure = React.useCallback(() => {
    const el = viewportRef.current
    if (!el) return
    const max = el.scrollWidth - el.clientWidth
    // 1px of slack: sub-pixel layout leaves a permanent fractional remainder
    // that would otherwise pin the end fade on forever.
    setAtStart(el.scrollLeft <= 1)
    setAtEnd(max <= 1 || el.scrollLeft >= max - 1)
  }, [])

  // Deliberately dependency-free: it re-measures after every render, so a strip
  // whose contents change (tab counts arriving, a filter shortening the row)
  // re-evaluates its own edges without the caller having to say so.
  React.useEffect(measure)

  React.useEffect(() => {
    const el = viewportRef.current
    if (!el) return undefined

    el.addEventListener("scroll", measure, { passive: true })

    let observer
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(measure)
      observer.observe(el)
      // The content box too: the viewport can keep its width while the row
      // inside it grows past the edge.
      if (el.firstElementChild) observer.observe(el.firstElementChild)
    }
    window.addEventListener("resize", measure)

    return () => {
      el.removeEventListener("scroll", measure)
      observer?.disconnect()
      window.removeEventListener("resize", measure)
    }
  }, [measure])

  const fade =
    "pointer-events-none absolute inset-y-0 z-10 bg-gradient-to-r transition-opacity duration-150 motion-reduce:transition-none"

  return (
    <div
      data-slot="scroll-strip"
      className={cn("relative", className)}
      {...props}
    >
      <div
        ref={viewportRef}
        data-slot="scroll-strip-viewport"
        className={cn("w-full overflow-x-auto overscroll-x-contain", viewportClassName)}
      >
        {children}
      </div>

      <span
        aria-hidden="true"
        data-slot="scroll-strip-fade-start"
        className={cn(
          fade,
          "left-0 bg-gradient-to-r to-transparent",
          fadeFrom,
          fadeWidth,
          atStart ? "opacity-0" : "opacity-100"
        )}
      />
      <span
        aria-hidden="true"
        data-slot="scroll-strip-fade-end"
        className={cn(
          fade,
          "right-0 bg-gradient-to-l to-transparent",
          fadeFrom,
          fadeWidth,
          atEnd ? "opacity-0" : "opacity-100"
        )}
      />
    </div>
  )
}

export { ScrollStrip }

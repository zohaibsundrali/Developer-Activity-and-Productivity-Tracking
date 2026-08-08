"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"
import { useDialog, useMounted } from "@/components/ui/use-dialog"

const SIZES = {
  sm: "max-w-sm",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
}

/**
 * Modal — focus trap, Escape, restore focus, aria-modal, labelled title.
 *
 * <Modal open onClose title description size="sm|md|lg|xl">{…}</Modal>
 */
function Modal({
  open = false,
  onClose,
  title,
  description,
  size = "md",
  footer,
  children,
  className,
  overlayClassName,
  closeOnBackdrop = true,
  showClose = true,
  ...props
}) {
  const panelRef = React.useRef(null)
  const mounted = useMounted()
  const ids = React.useId()
  const titleId = `${ids}-title`
  const descriptionId = `${ids}-description`

  useDialog({ open, onClose, containerRef: panelRef })

  if (!mounted || !open) return null

  const handleBackdrop = (event) => {
    if (!closeOnBackdrop) return
    if (event.target !== event.currentTarget) return
    if (typeof onClose === "function") onClose()
  }

  return createPortal(
    <div
      data-slot="modal-overlay"
      onMouseDown={handleBackdrop}
      className={cn(
        "fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-foreground/40 p-4 backdrop-blur-[2px] animate-fade-in motion-reduce:animate-none sm:items-center",
        overlayClassName
      )}
    >
      <div
        data-slot="modal"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cn(
          "relative flex w-full flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-popover outline-none animate-fade-in motion-reduce:animate-none",
          SIZES[size] || SIZES.md,
          className
        )}
        {...props}
      >
        {(title || description || showClose) && (
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div className="min-w-0 space-y-1">
              {title && (
                <h2
                  id={titleId}
                  className="text-base font-semibold tracking-tight text-foreground"
                >
                  {title}
                </h2>
              )}
              {description && (
                <p id={descriptionId} className="text-sm text-muted-foreground">
                  {description}
                </p>
              )}
            </div>
            {showClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close dialog"
                className="-mr-1 -mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 motion-reduce:transition-none hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <X aria-hidden="true" className="h-4 w-4" />
              </button>
            )}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-muted/30 px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}

export { Modal }

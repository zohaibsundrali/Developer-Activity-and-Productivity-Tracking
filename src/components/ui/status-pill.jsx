import * as React from "react"
import {
  Circle,
  CircleCheck,
  CircleDot,
  CircleHelp,
  CircleMinus,
  CircleX,
  Clock,
  TriangleAlert,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"

/**
 * Status is never colour alone. Each status carries a distinct glyph *shape*
 * (filled dot, hollow ring, clock, triangle, cross, dash, question mark) and a
 * text label, so the state survives greyscale, colour-blindness and a screen
 * reader.
 */
const STATUS_MAP = {
  active: { icon: CircleDot, variant: "success", label: "Active" },
  success: { icon: CircleCheck, variant: "success", label: "Success" },
  inactive: { icon: Circle, variant: "secondary", label: "Inactive" },
  pending: { icon: Clock, variant: "warning", label: "Pending" },
  warning: { icon: TriangleAlert, variant: "warning", label: "Warning" },
  error: { icon: CircleX, variant: "destructive", label: "Error" },
  unknown: { icon: CircleHelp, variant: "outline", label: "Unknown" },
}

const FALLBACK = { icon: CircleMinus, variant: "outline", label: "Unknown" }

/**
 * StatusPill — a Badge that also carries a shape, never colour alone (a11y).
 *
 * <StatusPill status="active" label="Active" />
 */
function StatusPill({ status = "unknown", label, size = "md", className, ...props }) {
  const key = typeof status === "string" ? status.toLowerCase() : "unknown"
  const config = STATUS_MAP[key] || FALLBACK
  const Icon = config.icon
  const text = label ?? config.label

  return (
    <Badge
      data-slot="status-pill"
      data-status={key}
      variant={config.variant}
      size={size}
      className={cn("gap-1.5", className)}
      {...props}
    >
      <Icon aria-hidden="true" />
      <span>{text}</span>
    </Badge>
  )
}

export { StatusPill }

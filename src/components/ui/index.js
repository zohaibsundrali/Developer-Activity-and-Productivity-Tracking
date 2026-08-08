/**
 * Shared UI kit barrel.
 *
 *   import { PageHeader, Badge, DataTable } from "@/components/ui"
 *
 * Everything the polish-pass contract (docs/ui-kit-contract.md) defines is
 * exported here. Do not redefine these primitives in feature code.
 */

// Existing primitives
export { Alert, AlertTitle, AlertDescription, AlertAction } from "./alert"
export { Button, buttonVariants } from "./button"
export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
  CardContent,
  CardFooter,
} from "./card"
export { Input } from "./input"
export { Label } from "./label"

// Layout
export { PageHeader } from "./page-header"
export { Section } from "./section"
export { Toolbar } from "./toolbar"

// Status & data display
export { Badge, badgeVariants } from "./badge"
export { StatusPill } from "./status-pill"
export { DataTable } from "./data-table"
export { Tabs } from "./tabs"

// Async surface states
export { EmptyState } from "./empty-state"
export { ErrorState } from "./error-state"
export {
  Skeleton,
  SkeletonTable,
  SkeletonCard,
  SkeletonList,
} from "./skeleton"

// Overlays
export { Modal } from "./modal"
export { Drawer } from "./drawer"

// Forms
export { Field } from "./field"

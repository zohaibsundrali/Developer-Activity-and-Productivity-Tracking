"use client";

/**
 * Shared building blocks for the landing page: the reveal wrapper, the section
 * shell (ground colour + parallax field + rhythm), headings, buttons, the
 * animated counter and the icon resolver.
 *
 * Everything here is token-only — no hex, no `bg-white`, no `text-gray-*` — and
 * every opacity modifier is a multiple of five so Tailwind actually emits it.
 */

import { forwardRef, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlarmClock,
  ArrowRight,
  BarChart3,
  Bell,
  Bot,
  Briefcase,
  Building2,
  Calendar,
  CalendarClock,
  Camera,
  Check,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  Clock,
  Columns3,
  Contact,
  Cpu,
  CreditCard,
  Database,
  Eye,
  FileBarChart,
  FileText,
  Filter,
  Gauge,
  GitBranch,
  Globe,
  Handshake,
  Kanban,
  Laptop,
  LayoutDashboard,
  LayoutGrid,
  LineChart,
  ListChecks,
  Lock,
  Mail,
  MessageSquare,
  Monitor,
  MonitorSmartphone,
  PieChart,
  Play,
  Receipt,
  Rocket,
  Server,
  Settings,
  Shield,
  ShieldCheck,
  Sparkles,
  Star,
  Target,
  Timer,
  TrendingUp,
  Users,
  UserCheck,
  UserPlus,
  Workflow,
  Zap,
} from "lucide-react";

import { useReveal, useOnEnter } from "@/hooks/useReveal";
import { useCountUp } from "@/hooks/useCountUp";

/* ------------------------------------------------------------------ *
 * Measure — the page's one horizontal rhythm
 * ------------------------------------------------------------------ */

/**
 * The shared measure every landing band is laid out on.
 *
 * 1400px rather than `max-w-6xl` (1152px): on a 1920px display the old measure
 * left 384px of dead margin on each side, which read as the page hiding in a
 * column down the middle. 1400px is where modern B2B SaaS marketing sites sit,
 * and it buys back ~264px of usable layout without the page touching the edges.
 *
 * The horizontal padding deliberately stops escalating at `lg`. It existed to
 * create breathing room the container itself now provides, so it holds at 24px
 * from `sm` up instead of stepping to 32px — a little less padding at large
 * widths, exactly where the measure is already doing the work.
 *
 * **This is a layout measure, not a text measure.** Prose must never be laid out
 * across 1400px: headings, descriptions, footnotes and the FAQ keep their own
 * `max-w-2xl` / `max-w-3xl` caps inside this box. Only grids, cards, tables and
 * the pricing row are allowed to use the full width.
 *
 * Every band on the page reads this one constant, so the next width change is a
 * single line here rather than fourteen edits that drift apart.
 */
export const CONTAINER = "mx-auto w-full max-w-[1400px] px-5 sm:px-6";

/**
 * The measure as an element. `as` lets a band keep its correct tag (`nav`,
 * `ul`) instead of wrapping one in a div, and `className` carries the band's
 * own vertical rhythm — the horizontal geometry is never overridden.
 */
export function Container({ as: Tag = "div", className = "", children, ...rest }) {
  return (
    <Tag className={[CONTAINER, className].filter(Boolean).join(" ")} {...rest}>
      {children}
    </Tag>
  );
}

/* ------------------------------------------------------------------ *
 * Motion tuning — one place, so every section moves the same way
 * ------------------------------------------------------------------ */

/** Long tail, no overshoot. Reads as "settling" rather than "sliding". */
export const REVEAL_EASING = "cubic-bezier(0.16, 1, 0.3, 1)";
export const REVEAL_DURATION_MS = 500;
export const REVEAL_STAGGER_MS = 80;
/** Past the sixth item a stagger stops reading as rhythm and starts reading as lag. */
export const REVEAL_MAX_STEPS = 6;

/** Stagger delay for the nth item in a group. */
export function stagger(index, step = REVEAL_STAGGER_MS) {
  return Math.min(index, REVEAL_MAX_STEPS) * step;
}

/* ------------------------------------------------------------------ *
 * Reveal
 * ------------------------------------------------------------------ */

/**
 * Fade-and-rise wrapper.
 *
 * When the hook reports `static` — server render, no IntersectionObserver, or
 * `prefers-reduced-motion: reduce` — **no inline style is applied at all**. The
 * element is simply itself: fully opaque, untransformed, in flow. That is the
 * guarantee that reduced motion can never produce a blank page.
 *
 * @param {Object} props
 * @param {React.ElementType} [props.as="div"]
 * @param {number} [props.delay=0]     stagger offset in ms
 * @param {number} [props.distance=24] rise distance in px
 */
export function Reveal({
  as: Tag = "div",
  delay = 0,
  distance = 24,
  className = "",
  children,
  ...rest
}) {
  const { ref, state, animating } = useReveal();
  const hidden = state === "hidden";

  /*
    The transition is attached only on the way *in*.

    Arming happens after hydration, and an element that already painted at full
    opacity would otherwise animate its own disappearance — a 500ms fade-out of
    everything below the fold, visible on any slow hydration. With
    `transition: none` in the hidden state the arming is instantaneous and
    invisible; the transition properties arrive in the same style change that
    sets `opacity: 1`, which is enough for CSS to run the transition, because a
    transition is started from the after-change style.
  */
  const style = animating
    ? hidden
      ? {
          opacity: 0,
          transform: `translate3d(0, ${distance}px, 0)`,
          transition: "none",
          // Only while there is still something left to composite.
          willChange: "opacity, transform",
        }
      : {
          opacity: 1,
          transform: "translate3d(0, 0, 0)",
          transitionProperty: "opacity, transform",
          transitionDuration: `${REVEAL_DURATION_MS}ms`,
          transitionTimingFunction: REVEAL_EASING,
          transitionDelay: `${delay}ms`,
          willChange: "auto",
        }
    : undefined;

  return (
    <Tag ref={ref} className={className} style={style} {...rest}>
      {children}
    </Tag>
  );
}

/* ------------------------------------------------------------------ *
 * Section shell
 * ------------------------------------------------------------------ */

/**
 * Decorative parallax field.
 *
 * Rendered as its own absolutely positioned, `overflow-hidden` clipper rather
 * than by clipping the section itself. That distinction matters: an ancestor
 * with `overflow: hidden` becomes the scrollport for any `position: sticky`
 * descendant, which would silently kill the pinned column in the role section.
 * Clipping here keeps the blobs off the document width without touching the
 * sticky ancestry.
 *
 * @param {Object} props
 * @param {Object} props.layerRef  ref from `useParallax`
 * @param {boolean} [props.dark=false]
 */
export function ParallaxField({ layerRef, dark = false }) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <div ref={layerRef} className="absolute inset-x-0 -top-40 -bottom-40">
        <div
          className={[
            "absolute left-1/2 top-0 h-[36rem] w-[36rem] max-w-[140%] -translate-x-1/2 rounded-full blur-3xl",
            dark ? "bg-primary/20" : "bg-primary/5",
          ].join(" ")}
        />
        <div
          className={[
            "absolute bottom-0 right-0 h-[28rem] w-[28rem] max-w-[120%] translate-x-1/3 rounded-full blur-3xl",
            dark ? "bg-sidebar-primary/10" : "bg-accent/50",
          ].join(" ")}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Headings
 * ------------------------------------------------------------------ */

/** Small uppercase label above a section title. */
export function Eyebrow({ children, dark = false, className = "" }) {
  if (!children) return null;
  return (
    <p
      className={[
        "text-xs font-semibold uppercase tracking-[0.18em]",
        dark ? "text-sidebar-primary" : "text-primary",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </p>
  );
}

/**
 * Section header block. Renders only the parts the content actually supplies.
 *
 * @param {Object} props
 * @param {"left"|"center"} [props.align="center"]
 */
export function SectionHeading({
  eyebrow,
  title,
  description,
  align = "center",
  dark = false,
  headingId,
  className = "",
}) {
  if (!eyebrow && !title && !description) return null;

  const centered = align === "center";

  return (
    <div
      className={[
        centered ? "mx-auto max-w-3xl text-center" : "max-w-2xl text-left",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {eyebrow ? (
        <Reveal>
          <Eyebrow dark={dark}>{eyebrow}</Eyebrow>
        </Reveal>
      ) : null}

      {title ? (
        <Reveal delay={eyebrow ? REVEAL_STAGGER_MS : 0}>
          <h2
            id={headingId}
            className={[
              "font-display text-3xl font-semibold leading-[1.1] tracking-[-0.03em] sm:text-4xl lg:text-5xl",
              eyebrow ? "mt-4" : "",
              dark ? "text-background" : "text-foreground",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {title}
          </h2>
        </Reveal>
      ) : null}

      {description ? (
        <Reveal delay={stagger(title ? 2 : 1)}>
          <p
            className={[
              "mt-5 text-base leading-relaxed sm:text-lg",
              centered ? "mx-auto max-w-2xl" : "",
              dark ? "text-sidebar-foreground" : "text-muted-foreground",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {description}
          </p>
        </Reveal>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Buttons
 * ------------------------------------------------------------------ */

const BUTTON_BASE =
  "group inline-flex items-center justify-center gap-2 rounded-lg font-semibold " +
  "transition-colors duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 " +
  "focus-visible:ring-offset-2";

const BUTTON_VARIANTS = {
  primary:
    "bg-primary text-primary-foreground shadow-elevated hover:bg-primary/90 " +
    "focus-visible:ring-ring focus-visible:ring-offset-background",
  secondary:
    "border border-border bg-card text-foreground shadow-card hover:bg-muted " +
    "focus-visible:ring-ring focus-visible:ring-offset-background",
  // Outline with no fill and no shadow. The header sits transparent over the
  // hero until the page scrolls, and a filled secondary there would punch a
  // card-coloured hole in the scene; this one only draws its own edge.
  ghost:
    "border border-border bg-transparent text-foreground hover:border-primary/30 hover:bg-muted " +
    "focus-visible:ring-ring focus-visible:ring-offset-background",
  onDark:
    "border border-sidebar-border bg-sidebar-accent text-background hover:bg-sidebar-border " +
    "focus-visible:ring-sidebar-primary focus-visible:ring-offset-sidebar",
  onDarkPrimary:
    "bg-primary text-primary-foreground hover:bg-sidebar-primary " +
    "focus-visible:ring-sidebar-primary focus-visible:ring-offset-sidebar",
  onBrand:
    "bg-background text-primary shadow-elevated hover:bg-muted " +
    "focus-visible:ring-background focus-visible:ring-offset-primary",
  onBrandGhost:
    "border border-primary-foreground/20 text-primary-foreground hover:bg-primary-foreground/10 " +
    "focus-visible:ring-background focus-visible:ring-offset-primary",
};

const BUTTON_SIZES = {
  // Header scale. Two of these plus a text link have to sit inside an 80px bar
  // without crowding it, which `md` at 44px cannot do.
  sm: "h-10 px-4 text-sm",
  md: "h-11 px-6 text-sm",
  lg: "h-12 px-7 text-base",
};

/**
 * The page's only link-button. `showArrow` adds the nudge-on-hover arrow, which
 * is `motion-safe:` gated so reduced motion gets a static arrow rather than an
 * instant jump.
 *
 * Every CTA on this page points at an in-app route — `/admin/registration`,
 * `/login`, `/pricing` — and a hardcoded `<a>` made each of them a full
 * document load: the whole framework torn down and rebooted to move one route,
 * which is the single most expensive thing the landing page did. In-app hrefs
 * therefore render as `next/link`; in-page anchors (`#monitoring`) and absolute
 * URLs stay plain anchors, because `Link` has nothing to offer either.
 */
export const CtaButton = forwardRef(function CtaButton(
  { href, children, variant = "primary", size = "md", showArrow = false, className = "", ...rest },
  ref,
) {
  if (!href || !children) return null;

  const internal = typeof href === "string" && href.startsWith("/") && !href.startsWith("//");
  const Tag = internal ? Link : "a";

  return (
    <Tag
      ref={ref}
      href={href}
      className={[
        BUTTON_BASE,
        BUTTON_SIZES[size] ?? BUTTON_SIZES.md,
        BUTTON_VARIANTS[variant] ?? BUTTON_VARIANTS.primary,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      {children}
      {showArrow ? (
        <ArrowRight
          className="h-4 w-4 shrink-0 transition-transform duration-200 ease-out motion-safe:group-hover:translate-x-1"
          aria-hidden="true"
        />
      ) : null}
    </Tag>
  );
});

/**
 * Renders a section's actions with the first one styled as the single primary
 * CTA and the rest as quiet secondaries.
 *
 * @param {Object} props
 * @param {Array<{label:string, href:string}>} props.actions
 * @param {"light"|"dark"|"brand"} [props.ground="light"]
 */
export function CtaRow({ actions, ground = "light", size = "md", align = "center", className = "" }) {
  if (!actions || actions.length === 0) return null;

  const variants =
    ground === "dark"
      ? ["onDarkPrimary", "onDark"]
      : ground === "brand"
        ? ["onBrand", "onBrandGhost"]
        : ["primary", "secondary"];

  return (
    <div
      className={[
        "flex flex-col gap-3 sm:flex-row",
        align === "center" ? "items-stretch justify-center sm:items-center" : "items-stretch sm:items-center",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {actions.slice(0, 2).map((action, index) => (
        <CtaButton
          key={`${action.href}-${action.label}`}
          href={action.href}
          variant={index === 0 ? variants[0] : variants[1]}
          size={size}
          showArrow={index === 0}
        >
          {action.label}
        </CtaButton>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Counter
 * ------------------------------------------------------------------ */

/**
 * A stat that counts up on reveal.
 *
 * Zero layout shift by construction: an invisible copy of the *final* string
 * sits in flow and reserves the exact box, and the animating value is painted
 * over it absolutely. The number can therefore go from "0" to "10,000+" without
 * the surrounding grid moving by a pixel.
 *
 * Screen readers get the final value only — announcing sixty intermediate
 * numbers would be hostile — via the in-flow copy carrying the accessible text
 * while the animated layer is `aria-hidden`.
 */
export function Counter({ value, className = "" }) {
  const [started, setStarted] = useState(false);
  const enterRef = useOnEnter(() => setStarted(true));
  const display = useCountUp(value, { start: started });

  if (!value) return null;

  return (
    <span ref={enterRef} className={["relative inline-block tabular-nums", className].join(" ")}>
      <span className="invisible" aria-hidden="true">
        {value}
      </span>
      <span className="sr-only">{value}</span>
      <span className="absolute inset-0" aria-hidden="true">
        {display}
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Icons
 * ------------------------------------------------------------------ */

const ICONS = {
  activity: Activity,
  alarmclock: AlarmClock,
  alarm: AlarmClock,
  analytics: LineChart,
  approvals: UserCheck,
  automation: Workflow,
  barchart: BarChart3,
  barchart3: BarChart3,
  bell: Bell,
  billing: CreditCard,
  board: Kanban,
  bot: Bot,
  briefcase: Briefcase,
  building: Building2,
  building2: Building2,
  calendar: Calendar,
  calendarclock: CalendarClock,
  camera: Camera,
  chart: BarChart3,
  check: Check,
  checkcircle: CheckCircle2,
  checkcircle2: CheckCircle2,
  clipboardcheck: ClipboardCheck,
  client: Briefcase,
  clipboard: ClipboardList,
  clipboardlist: ClipboardList,
  clock: Clock,
  columns: Columns3,
  columns3: Columns3,
  contact: Contact,
  cpu: Cpu,
  creditcard: CreditCard,
  dashboard: LayoutDashboard,
  database: Database,
  eye: Eye,
  file: FileText,
  filebarchart: FileBarChart,
  filetext: FileText,
  filter: Filter,
  gauge: Gauge,
  gitbranch: GitBranch,
  globe: Globe,
  handshake: Handshake,
  invoice: Receipt,
  kanban: Kanban,
  laptop: Laptop,
  layoutdashboard: LayoutDashboard,
  layoutgrid: LayoutGrid,
  linechart: LineChart,
  listchecks: ListChecks,
  lock: Lock,
  mail: Mail,
  message: MessageSquare,
  messagesquare: MessageSquare,
  monitor: Monitor,
  monitoring: Eye,
  monitorsmartphone: MonitorSmartphone,
  piechart: PieChart,
  play: Play,
  receipt: Receipt,
  report: FileText,
  reports: FileText,
  rocket: Rocket,
  screenshot: Camera,
  server: Server,
  settings: Settings,
  shield: Shield,
  shieldcheck: ShieldCheck,
  security: ShieldCheck,
  sparkles: Sparkles,
  star: Star,
  target: Target,
  team: Users,
  timer: Timer,
  timetracking: Timer,
  trendingup: TrendingUp,
  usercheck: UserCheck,
  userplus: UserPlus,
  users: Users,
  workflow: Workflow,
  zap: Zap,
};

/**
 * Resolves whatever the content module put in an `icon` field.
 * Accepts a component, a lucide-ish name in any casing, or nothing.
 *
 * @returns {React.ComponentType|null}
 */
export function resolveIcon(icon, fallback = null) {
  if (typeof icon === "function") return icon;
  if (typeof icon === "object" && icon !== null && icon.$$typeof) return icon;
  if (typeof icon === "string") {
    const key = icon.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (ICONS[key]) return ICONS[key];
  }
  return fallback;
}

/** Square token-tinted icon chip used by feature cards and step markers. */
export function IconChip({ icon, dark = false, className = "", size = "md" }) {
  const Icon = resolveIcon(icon);
  if (!Icon) return null;

  const box = size === "lg" ? "h-12 w-12" : "h-11 w-11";
  const glyph = size === "lg" ? "h-6 w-6" : "h-5 w-5";

  return (
    <span
      aria-hidden="true"
      className={[
        "inline-flex shrink-0 items-center justify-center rounded-xl",
        box,
        dark ? "bg-primary/20 text-sidebar-primary" : "bg-primary/10 text-primary",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <Icon className={glyph} strokeWidth={1.75} />
    </span>
  );
}

/** The hover-lift treatment shared by every card on the page. */
export const CARD_LIFT =
  "transition-[transform,box-shadow,border-color] duration-300 ease-out " +
  "motion-safe:hover:-translate-y-1 hover:shadow-elevated hover:border-primary/20";

export { Check, ArrowRight };

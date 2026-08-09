import { BRAND_NAME } from "@/components/brand/brand";

/**
 * Landing page content.
 *
 * Plain data only — no JSX, no styling, no components. The landing page
 * components import from here and render it.
 *
 * EVERY claim in this file maps to shipped code. Where a capability is
 * configured-but-not-enforced, or exists in the schema but has no UI, it is
 * either omitted or stated with its real limit. Icon names are lucide-react
 * exports already in use in src/components/shell/navConfig.js.
 *
 * Sources of truth:
 *   plan tiers + prices ....... database/027_billing_subscriptions.sql (PART 4)
 *   which limits bite ......... database/028_plan_limit_triggers.sql,
 *                               src/utils/entitlements.js
 *   feature list .............. src/components/shell/navConfig.js
 *   roles + isolation ......... database/012, 013, 014, 018, 037
 *   tracked signals ........... src/app/api/upload-screenshot, keyboard-stats,
 *                               src/components/admin/DeveloperActivity.jsx
 */

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------

export const hero = {
  eyebrow: "Project management and employee monitoring, one system",
  headline: "Track the work and the workday, in one place",
  // Kept to ~25 words: the first CTA should be reachable without a paragraph.
  // Every claim here is the compressed form of one already made below.
  subhead:
    "Epics, sprints, a six-view board and task review — plus desktop activity tracking on the machines you choose. One permission model over both halves.",
  // Price above the fold. Both figures are the seeded billing_plans rows:
  // Free is $0 with no card, Business is $149/month for up to 100 people.
  priceLine: "Priced per organization, not per seat. Free to start; $149 a month covers up to 100 people.",
  primaryCta: {
    label: "Create your organization",
    href: "/admin/registration",
    // Signup writes admin_users + organizations + owner membership + a Supabase
    // Auth account (src/app/api/auth/signup/route.js). No subscription row is
    // created, and src/utils/entitlements.js treats "no row" as the Free plan.
    sublabel: "Free plan, no card required",
  },
  secondaryCta: {
    label: "See exactly what the tracker records",
    href: "#monitoring",
  },
};

// ---------------------------------------------------------------------------
// Trust strip — the numbers are counts of things listed elsewhere in this file
// ---------------------------------------------------------------------------
//
//   8 roles ......... the eight in the FAQ answer on roles, and in database/018
//   6 board views ... Kanban, List, Table, Calendar, Timeline, Workload
//   5 signals ....... the five entries in `monitoring.records` below
//   $0 .............. billing_plans "free" row; signup creates no subscription

export const socialProof = {
  stats: [
    { value: "8", label: "roles, from owner to client" },
    { value: "6", label: "views over the same board" },
    { value: "5", label: "signals the desktop agent records" },
    { value: "$0", label: "to start, no card required" },
  ],
  line: "Every table is scoped to your organization by Postgres row-level security, and clients are locked out of all eight tracking tables. Screenshots live in a private bucket, served only through URLs that expire in ten minutes.",
};

// ---------------------------------------------------------------------------
// The one structural claim: both halves, one permission model
// ---------------------------------------------------------------------------

export const twoHalves = {
  id: "one-system",
  eyebrow: "One system, not two",
  title: "Two halves, one permission model",
  description:
    "Most teams run a project tool and a tracker side by side, then reconcile them by hand. Here the board and the agent read the same tasks, the same organization and the same eight roles.",
  columns: [
    {
      title: "Project management",
      icon: "Kanban",
      description:
        "Epics, sprints, story points and burndown. Six views over one board. Task review with file submissions, and a client portal with approvals and invoices.",
    },
    {
      title: "Activity tracking",
      icon: "Activity",
      description:
        "Screenshots with the active application, applications and window titles, keystroke and unique-key counts with words per minute, and active-versus-idle minutes.",
    },
  ],
  // Deliberately claims only the boundary the database actually draws.
  spine:
    "One organization id on every table, and one row-level security policy enforcing that boundary on every query — in both halves, from the same signed session.",
  footnote:
    "Skip the desktop agent entirely and the project management half is untouched. Neither half depends on the other.",
};

// ---------------------------------------------------------------------------
// Features — 8 items, each backed by a shipped screen
// ---------------------------------------------------------------------------

export const features = [
  {
    title: "Desktop activity tracking",
    description:
      "A desktop agent records screenshots, the applications and window titles people used, keystroke and unique-key counts with words per minute, and active-versus-idle minutes. The admin dashboard has six views over it — Overview, Mouse, Keyboard, Apps, Screenshots and Logins — and refreshes live while a session is running.",
    icon: "Activity",
    role: "Owner and admin",
  },
  {
    title: "Six views of the same board",
    description:
      "Kanban, List, Table, Calendar, Timeline and Workload, all reading the same tasks with one shared toolbar of filters. Group a list by sprint, epic or assignee; see who is carrying what in Workload. Save a view and come back to it.",
    icon: "Columns3",
    role: "Admin, manager, team lead",
  },
  {
    title: "Epics, sprints and burndown",
    description:
      "Group work into epics with their own colour and status, plan sprints with a goal and dates, point the backlog, and watch a burndown chart draw ideal against actual remaining points. Advancing a sprint notifies every assignee on it.",
    icon: "Rocket",
    role: "Manager and team lead",
  },
  {
    title: "Task review with proof of work",
    description:
      "A developer submits a file and notes; the task moves to In Review and waits. Owners, admins and managers approve or reject it — rejection requires a written reason — and the verdict stamps whether it landed on time and adjusts the developer's productivity points. Nothing else can push a task to Done.",
    icon: "ClipboardCheck",
    role: "Owner, admin, manager",
  },
  {
    title: "A client portal that does not leak your board",
    description:
      "Clients see only the projects they are linked to, and only the tasks you have marked client-visible — new tasks are private by default. They approve, request changes, reject or comment, and every decision writes to an audit trail they cannot edit, plus a notification to your team.",
    icon: "Handshake",
    role: "Your clients, invited by you",
  },
  {
    title: "Reports you can hand to someone",
    description:
      "Five tabs — Overview, Projects, Team, Time and Delays — over any date range, with charts and a KPI strip covering completion rate, logged hours and tracked hours. Every tab exports to CSV and to PDF.",
    icon: "FileBarChart",
    role: "Owner, admin, manager, team lead",
  },
];

// ---------------------------------------------------------------------------
// Monitoring disclosure — deliberately its own block, not buried in a footnote
// ---------------------------------------------------------------------------

export const monitoring = {
  id: "monitoring",
  eyebrow: "Say it plainly",
  title: "This product monitors people. Here is the full list.",
  // The product name is never spelled out in this file — it is interpolated
  // from BRAND_NAME, so a rename is one constant.
  intro: `The name is the argument. Monitoring software that is vague about what it captures is asking you to find out later; ${BRAND_NAME} publishes the whole list and captures nothing beyond it. Decide with it in front of you, and tell your team what is on it.`,
  records: [
    {
      label: "Screenshots",
      detail:
        "Full captures uploaded by the desktop agent, with the application that was active at the time. Stored in a private per-organization bucket; the dashboard only ever renders them through signed URLs that expire after ten minutes.",
    },
    {
      label: "Applications and window titles",
      detail:
        "Which application was in the foreground, its window title, and for how long — down to individual application switches.",
    },
    {
      label: "Keyboard volume",
      detail:
        "Total keystrokes, unique keys, words per minute and an activity percentage per session. Counts and rates only — no keylogging, and no record of what was typed.",
    },
    {
      label: "Active and idle time",
      detail:
        "Minute-by-minute active-versus-idle percentages from mouse and keyboard sampling, plus total, active and idle duration per session.",
    },
    { label: "Login times", detail: "When each person's first and subsequent logins of the day happened." },
  ],
  notRecorded: [
    "Websites or URLs visited. Browsers show up only as applications by name, like any other program.",
    "The content of what is typed. Only counts and rates leave the machine.",
    "Anything on a machine where the desktop agent is not installed. Nothing is captured from the browser.",
  ],
  // ACCURACY NOTE — checked against the migrations, not against the UI:
  //   database/014_client_portal.sql `track_read`  -> using (organization_id =
  //     auth_org() and not auth_is_client())
  //   database/019_storage_hardening.sql `monitoring_read` -> same shape on the
  //     screenshot bucket
  // Both are ORGANIZATION-WIDE for every non-client role. There is no per-user
  // narrowing in the database. "A developer sees only their own record" was
  // true of the interface and false of the data, so it is not claimed here.
  // What IS enforced in the database: the organization boundary, the client
  // block on all eight tracking tables and on the bucket, and owner/admin-only
  // update and delete of screenshots.
  whoSeesIt: [
    "Owners and admins get the full activity dashboard for anyone in the organization.",
    "Everyone else sees their own sessions and screenshots in the interface — but that limit is the interface's, not the database's. The row-level policy admits any non-client member of your organization, so treat monitoring data as visible to your staff rather than private between one person and their manager. Tightening that is a change to the policy, not to a setting.",
    "Clients are the hard boundary, and it is a database one: blocked from all eight tracking tables and unable to read a screenshot from the bucket at all — not a hidden menu item. Only owners and admins can modify or delete a screenshot.",
  ],
  // Retoned: the same three facts, stated as the shape of the control rather
  // than as an apology, and closed with the mitigation that actually exists.
  honesty:
    "The control is the install. Tracking exists only on machines running the desktop agent — there is no in-app pause button, no per-person opt-out and no screenshot blurring, so which machines carry the agent is the decision that matters. Skip it entirely and the project management half is untouched: the board, sprints, reviews, reports and the client portal never depended on it. Tell your team what is on this list before you deploy it.",
};

// ---------------------------------------------------------------------------
// Role sections — three distinct value stories
// ---------------------------------------------------------------------------

export const roleSections = [
  {
    id: "for-admins",
    role: "Owners and admins",
    icon: "ShieldCheck",
    headline: "One console for the work, the people and the plan",
    body: "The admin dashboard is eighteen sections, filtered by your role. The organization boundary and the client block are enforced by the database on every query; the narrowing by role inside your own organization is the application's.",
    highlights: [
      "Every project, every board, every sprint, and a Gantt view per project with on-time and late markers.",
      "The task review queue: download what was submitted, approve or reject with a reason, and see whether the client has already pushed back on it.",
      "Developer Activity per person and per day — screenshots, apps, keystrokes, active time — updating live while someone is working.",
      "People management: invite by email with a role, edit employee profiles, set who reports to whom, move people between teams and departments, suspend an account and have it blocked on the very next API call.",
      "Employee records with job title, skills, employment type, joining date, work schedule and photo — and a reporting line the database itself guards: a change that would create a reporting loop is refused, not merely hidden in the UI.",
      "Automation rules that fire when a task is created, changes status or is assigned — reassign, set a status, change priority, add a label, notify someone — plus a nightly job that sends due and overdue reminders and spawns recurring tasks. A rule cannot force an illegal status transition.",
      "Reports over any date range with CSV and PDF export, billing and usage against your plan limits, and a System Health page that reports 'unknown' when it has no evidence rather than a green tick it cannot justify.",
    ],
  },
  {
    id: "for-developers",
    role: "Developers and employees",
    icon: "Laptop",
    headline: "Your queue, your timer, your record",
    body: "Staff get a deliberately small surface: the work assigned to you and the proof that you did it.",
    highlights: [
      "My Projects and a task list with deadlines, plus a Gantt view of where your work sits in the project.",
      "A start/stop timer on each task, or log minutes by hand. Only one timer can run at a time — the database enforces it.",
      "Submit a finished task with a file and notes; it goes to review and you are notified of the verdict, including the reason if it comes back.",
      "A timesheet showing every task with its deadline, whether it landed on time, and the points it earned.",
      "Your own session history — the screenshots, apps and keyboard stats recorded on your machine — on a page scoped to you. Stated precisely, because it matters to the person being recorded: that scoping is the interface's. The row-level policy behind it is organization-wide for staff, so this is not private from your colleagues.",
      "Managers and team leads get one extra section: a read-only roster of their team and its projects.",
    ],
  },
  {
    id: "for-clients",
    role: "Clients",
    icon: "Handshake",
    headline: "Enough to sign off, nothing more",
    body: "Clients are invited by email to specific projects. They cannot self-register, and they never see your internal board unless you mark an item client-visible.",
    highlights: [
      "Per-project view with milestones, the tasks you chose to share, the team by name and job title, a timeline and deliverables.",
      "Four decisions on anything sent for approval — approve, request changes, reject, or just comment — with a note required on anything negative. The verdict lands on your task as a separate field, so a client can never move a task through your own review pipeline.",
      "A conversation thread per project with file attachments, where your team can also post internal-only replies on the same thread.",
      "Invoices with a downloadable PDF, org-wide and per-project announcements, and support threads that your team answers in-app.",
      "Team members appear as a name and a designation. Emails, salaries, productivity data and activity tracking are never sent to the portal.",
    ],
  },
];

// ---------------------------------------------------------------------------
// How it works
// ---------------------------------------------------------------------------

export const howItWorks = {
  id: "how-it-works",
  title: "From signup to a working board",
  steps: [
    {
      number: 1,
      title: "Create your organization",
      description:
        "Sign up with your company name, industry, size, country and timezone. You become the owner — the only role that can change organization settings, buy a plan, or grant ownership to someone else.",
      icon: "Building2",
    },
    {
      number: 2,
      title: "Invite your team with the role you want them to have",
      description:
        "Admin, manager, team lead, HR, developer, employee or client. The invite is a one-time link that expires in seven days, and nobody can invite someone at or above their own level.",
      icon: "UserPlus",
    },
    {
      number: 3,
      title: "Install the desktop agent where you want tracking",
      description:
        "Activity tracking is opt-in per machine — it exists only where the agent is installed. Skip this step entirely and you still get the full project management side. Tell your team before you do it.",
      icon: "MonitorSmartphone",
    },
    {
      number: 4,
      title: "Run the work",
      description:
        "Create projects and sprints, work the board, review submissions, and share what the client should see. Reports and the activity dashboard fill in from there.",
      icon: "LayoutGrid",
    },
  ],
};

// ---------------------------------------------------------------------------
// Pricing — read verbatim from database/027_billing_subscriptions.sql PART 4
// ---------------------------------------------------------------------------
//
// amount_cents / currency / billing_interval come straight from the seeded
// billing_plans rows. `limits` and `features` are the seeded jsonb.
//
// Honest caveat encoded below: of the seeded limits, only `projects` and
// `active_tasks` have database triggers (028_plan_limit_triggers.sql), and
// `employees` / `developers` are checked when a seat is granted
// (checkSeatLimitForRole in src/utils/entitlements.js). storage_mb,
// screenshots and tracking_history_days are catalogue values that nothing
// currently enforces, so they are NOT listed as plan limits on the page.
//
// Of the seeded feature flags, `reports` and `api_access` are not enforced
// anywhere — there is no public API at all — so neither is sold here.
//
// `automation` and `client_portal` are the only flags checkFeatureAccess ever
// consults, and NEITHER is a whole-feature gate:
//   automation ...... only the `email` action reaches a gated route
//                     (src/app/api/automation/notify/route.js). Rule CRUD and
//                     the assign / set_status / set_priority / add_label /
//                     notify actions all run client-side under RLS
//                     (src/utils/automation.js), and the daily worker in
//                     src/app/api/cron/route.js sends due-date reminders and
//                     spawns recurring tasks for EVERY organization with no
//                     plan check. So a Free org has working automation rules;
//                     what it does not have is automation email.
//   client_portal ... gated where a client seat is handed out
//                     (src/app/api/invitations/route.js and .../accept), not
//                     on the portal itself.
// The copy below therefore sells the boundary that actually exists — automation
// EMAIL and client invitations — rather than "automation" and "the portal".

export const pricing = {
  id: "pricing",
  title: "Priced per organization, not per seat",
  subtitle:
    "Every plan runs the same board, tracking and reports. What changes is how many people, projects and open tasks you can have — plus automation email and client logins, which need a paid plan.",
  currency: "USD",
  interval: "month",
  note: "Prices are monthly per organization. Plan limits count everything in your organization, not per user — your own owner account is one of the people on the plan.",
  // `trialDays` below is the seeded catalogue value (billing_plans.trial_days).
  // A trial clock only starts once a paid subscription is created through
  // Stripe Checkout. A fresh signup has no subscription row at all and is
  // simply on Free, so DO NOT render trialDays as "14-day free trial" on the
  // Free card — it would promise a countdown that never starts.
  renderTrialDays: false,
  plans: [
    {
      code: "free",
      name: "Free",
      price: 0,
      priceLabel: "$0",
      interval: "month",
      description: "For trying it out on one real project.",
      trialDays: 14,
      highlight: false,
      cta: { label: "Create your organization", href: "/admin/registration" },
      limits: [
        { label: "People", value: "3" },
        { label: "Developers", value: "3" },
        { label: "Projects", value: "2" },
        { label: "Open tasks", value: "50" },
      ],
      includes: [
        "The full board — kanban, list, table, calendar, timeline, workload",
        "Epics, sprints, story points and burndown",
        "Task review with file submissions",
        "Desktop activity tracking and the six-view activity dashboard",
        "Reports with CSV and PDF export",
        "Workflow automation rules — assign, set status, set priority, label, notify",
        "Daily due-date reminders and recurring tasks",
      ],
      excludes: ["Email actions inside automation rules", "Client logins to the portal"],
    },
    {
      code: "professional",
      name: "Professional",
      price: 49,
      priceLabel: "$49",
      interval: "month",
      description: "For a growing team.",
      trialDays: 14,
      highlight: true,
      cta: { label: "Start on Professional", href: "/admin/registration" },
      limits: [
        { label: "People", value: "25" },
        { label: "Developers", value: "25" },
        { label: "Projects", value: "25" },
        { label: "Open tasks", value: "2,000" },
      ],
      includes: [
        "Everything in Free",
        "Email actions in your automation rules, so a rule can mail the assignee",
        "Client logins — invite clients into the portal for approvals, invoices and support threads",
      ],
      excludes: [],
    },
    {
      code: "business",
      name: "Business",
      price: 149,
      priceLabel: "$149",
      interval: "month",
      description: "For multiple teams.",
      trialDays: 14,
      highlight: false,
      cta: { label: "Start on Business", href: "/admin/registration" },
      limits: [
        { label: "People", value: "100" },
        { label: "Developers", value: "100" },
        { label: "Projects", value: "150" },
        { label: "Open tasks", value: "20,000" },
      ],
      includes: [
        "Everything in Professional",
        "Room for several teams and departments under one organization",
      ],
      excludes: [],
    },
    {
      code: "enterprise",
      name: "Enterprise",
      price: 499,
      priceLabel: "$499",
      interval: "month",
      description: "Unlimited, with support.",
      trialDays: 0,
      highlight: false,
      cta: { label: "Talk to us", href: "/admin/registration" },
      limits: [
        { label: "People", value: "Unlimited" },
        { label: "Developers", value: "Unlimited" },
        { label: "Projects", value: "Unlimited" },
        { label: "Open tasks", value: "Unlimited" },
      ],
      includes: ["Everything in Business", "No plan limits on people, projects or open tasks"],
      excludes: [],
    },
  ],
  // Stated as arithmetic rather than as a comparison to any named product.
  // $149 / 100 people is the seeded Business row; the $10 seat rate is
  // labelled as an example, not as anyone's published price.
  comparison:
    "Per-seat trackers bill for every person you add. Take a common example rate of $10 a seat: 40 people is $400 a month, and it grows every time you hire. Business is $149 a month, flat, with room for 100 people.",
  footnote:
    "Start on Free — no card, no trial clock. Upgrade from the Billing page in your dashboard when you outgrow it.",
};

// ---------------------------------------------------------------------------
// FAQ
// ---------------------------------------------------------------------------

export const faq = {
  id: "faq",
  title: "Questions worth asking before you install this",
  items: [
    {
      question: "What does the desktop agent actually capture?",
      answer:
        "Screenshots with the application that was active, the applications and window titles used and for how long, keystroke and unique-key counts with words per minute, and active-versus-idle minutes. It does not capture the websites or URLs anyone visits, and it does not record what is typed — only how much. It captures nothing on a machine where it is not installed.",
    },
    {
      question: "Can someone pause tracking, or opt out?",
      answer:
        "Not from inside the app. There is no pause button and no per-person opt-out today. Tracking runs while the desktop agent is running on that machine and stops when it is not, so the practical control is which machines you install it on. If you need per-person consent, get it before you deploy the agent.",
    },
    {
      question: "Who can see my team's screenshots?",
      answer:
        "Owners and admins, for anyone in the organization. Other staff see their own sessions in the interface — but that limit lives in the interface, not the database: the row-level policy admits any non-client member of your organization, so monitoring data is not private between colleagues. Clients are the boundary the database does enforce: blocked from all eight tracking tables and from reading the screenshot bucket at all. Screenshots sit in a private bucket, are served only through URLs that expire ten minutes after they are minted, and only owners and admins can modify or delete them.",
    },
    {
      question: "How is my organization's data kept separate from other customers'?",
      answer:
        "Every table carries an organization id, and Postgres row-level security compares it against a claim baked into your signed session token — so isolation is enforced by the database on every query, not by the application remembering to filter. Cross-organization and client-versus-staff isolation are covered by end-to-end tests that run against real logins for each of the eight roles.",
    },
    {
      question: "Do I have to use the tracking to use the project management?",
      answer:
        "No. The board, sprints, reviews, reports and the client portal all work with no desktop agent installed anywhere. The two halves share the same tasks and the same permissions but neither depends on the other.",
    },
    {
      question: "What can a client see, and what can't they?",
      answer:
        "Only the projects they have been linked to, and within those, only tasks you have explicitly marked client-visible — new tasks are private by default. They see team members as a name and job title, never an email. Internal comments, employee records, salaries, productivity data and activity tracking never reach the portal. Clients cannot register themselves; they are invited to specific projects by your team.",
    },
    {
      question: "How do the eight roles differ?",
      answer:
        "Owner alone manages organization settings and billing. Admin runs projects, boards and automation. Manager and team lead review tasks, plan sprints and see tracking and reports for their people. HR manages employees, teams, departments and invitations without touching projects. Developer and employee see their own work. Client sees the portal. Nobody can change their own role, nobody can invite or promote above their own level, and only an owner can grant ownership.",
    },
    {
      question: "What happens when I hit a plan limit?",
      answer:
        "The create is refused with a message naming the resource, your current count and the limit, and the database refuses it too — so a browser cannot talk its way past a limit the server would have blocked. Existing work is never deleted or locked. An organization with no subscription record is treated as Free, which is the most restrictive plan, so a billing outage can never accidentally hand out unlimited use.",
    },
  ],
};

// ---------------------------------------------------------------------------
// Final CTA
// ---------------------------------------------------------------------------

export const finalCta = {
  eyebrow: "Free plan, no card",
  headline: "Set up your organization in a few minutes",
  subhead:
    "Create the org, invite your first three people, and run a real project on the board. Install the desktop agent later, or never — that part is your call, and it should be a deliberate one.",
  primaryCta: { label: "Create your organization", href: "/admin/registration" },
  secondaryCta: { label: "Sign in", href: "/login" },
  reassurance:
    "Two projects and three people on the Free plan, with no trial countdown. Upgrade from the Billing page inside your dashboard when the limits start to bite.",
};

// ---------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------
//
// Only routes that exist are linked. `href: null` marks a page that has not
// been built yet — the renderer should either omit those entries or render
// them as plain text, never as a dead link.

export const footer = {
  brand: {
    name: BRAND_NAME,
    tagline: "Project management and developer activity tracking, under one permission model.",
    icon: "Activity",
  },
  linkGroups: [
    {
      title: "Product",
      links: [
        { label: "Features", href: "#features" },
        { label: "What gets tracked", href: "#monitoring" },
        { label: "How it works", href: "#how-it-works" },
        { label: "Pricing", href: "#pricing" },
        { label: "FAQ", href: "#faq" },
      ],
    },
    {
      title: "Who it's for",
      links: [
        { label: "Owners and admins", href: "#for-admins" },
        { label: "Developers and employees", href: "#for-developers" },
        { label: "Clients", href: "#for-clients" },
      ],
    },
    {
      title: "Account",
      links: [
        { label: "Create an organization", href: "/admin/registration" },
        { label: "Join with an invite", href: "/admin/registration" },
        { label: "Sign in", href: "/login" },
      ],
    },
    {
      // All three are now built and routed. The Data processing page carries the
      // DPA and, as an annex, the monitoring notice a customer hands to their own
      // staff — see src/content/legal/ and src/app/{privacy,terms,dpa}/page.js.
      title: "Legal",
      links: [
        { label: "Privacy policy", href: "/privacy" },
        { label: "Terms of service", href: "/terms" },
        { label: "Data processing", href: "/dpa" },
      ],
    },
  ],
  copyright: `© 2026 ${BRAND_NAME}. All rights reserved.`,
};

const landing = {
  hero,
  socialProof,
  twoHalves,
  features,
  monitoring,
  roleSections,
  howItWorks,
  pricing,
  faq,
  finalCta,
  footer,
};

export default landing;

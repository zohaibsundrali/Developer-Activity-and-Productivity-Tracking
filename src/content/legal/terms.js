/**
 * Terms of Service — structured content.
 *
 * Plain data only: no JSX, no styling, no components. `src/app/terms/page.js`
 * renders it.
 *
 * EVERY product fact asserted here is traceable to shipped code. Where a fact
 * does not exist yet (jurisdiction, legal entity, notice address, refund
 * window, SLA) the text carries a `[PLACEHOLDER — owner to complete]` marker
 * and the same marker is listed in `placeholders` below, so the page can show
 * the owner exactly what is outstanding instead of the gap being invisible.
 *
 * Sources of truth:
 *   prices, plan catalogue ..... database/027_billing_subscriptions.sql PART 4
 *   stripe_price_id is NULL .... database/027_billing_subscriptions.sql PART 4/6
 *   checkout refuses ........... src/app/api/billing/checkout/route.js:29-64
 *   cancel at period end ....... src/app/api/billing/cancel/route.js
 *   proration on plan change ... src/app/api/billing/checkout/route.js:141-198
 *   grace period ............... src/utils/stripeServer.js gracePeriodDays()
 *   which limits bite .......... src/utils/entitlements.js,
 *                                database/028_plan_limit_triggers.sql
 *   seat enforcement ........... src/app/api/invitations/route.js,
 *                                src/app/api/invitations/accept/route.js,
 *                                src/app/api/auth/provision/route.js
 *   feature gates .............. checkFeatureAccess call sites (automation,
 *                                client_portal only)
 *   the eight roles ............ src/utils/permissions.js
 *   what the agent captures .... src/content/landing.js `monitoring`
 *   signed URL lifetime ........ src/app/api/admin-review/route.js:542 (600s)
 *   invite expiry .............. src/app/api/invitations/route.js:115 (7 days)
 *   third-party processors ..... src/utils/stripeServer.js, emailProvider.js,
 *                                supabaseClient.js, api/ai-generate-tasks
 *
 * Deliberately NOT stated anywhere in this document:
 *   - a free trial. `trial_days: 14` is seeded in the catalogue but signup
 *     creates no subscription row at all, so no trial clock ever starts.
 *   - storage, screenshot-count or tracking-history retention limits. Those
 *     three keys are seeded in `limits` but nothing reads them, so they are
 *     described as NOT currently applied rather than sold as plan ceilings.
 */

// ---------------------------------------------------------------------------
// Document metadata
// ---------------------------------------------------------------------------

export const meta = {
  title: "Terms of Service",
  productName: "Verisade",
  lastUpdated: "2026-08-09",
  lastUpdatedLabel: "9 August 2026",
  // No effective date is asserted: the owner sets it when the document is
  // adopted. Rendering "effective today" would be a fact nobody has decided.
  effectiveDate: "[EFFECTIVE DATE — owner to complete]",
  intro:
    "These Terms govern your organization's use of Verisade. Verisade is a project management system that also, on the machines where you choose to install our desktop agent, records screenshots and application usage of the people who work for you. Section 3 sets out what you must do before you switch that on. It is the most important section in this document.",
  readingTime: "About 25 minutes to read in full.",
};

/**
 * Rendered above the document, not buried at the end. A generated contract that
 * presents itself as finished legal advice is worse than one that says plainly
 * what it is.
 */
export const lawyerNotice = {
  title: "This is a starting point, not finished legal advice",
  body: [
    "This document was drafted against what the Verisade code actually does, so that no clause promises behaviour the software does not have. That makes it accurate. It does not make it lawyer-reviewed.",
    "It must be reviewed by a qualified lawyer in the jurisdiction where the business operates before it is relied on — and specifically by someone who practises employment and data protection law in every country where customers will monitor staff. Workplace monitoring rules differ sharply between jurisdictions, and some of them cannot be contracted around.",
    "Nothing here is legal advice to you or to your customers.",
  ],
};

/**
 * The one thing a reader must not miss, surfaced before the table of contents.
 */
export const keyPoint = {
  eyebrow: "Read this first",
  title: "If you monitor people with Verisade, the legal responsibility for that monitoring is yours",
  body: "We supply the software. You decide who is monitored, on which machines, and why. You must have a lawful basis for it and you must tell the people being monitored, before you install the desktop agent. Section 3 sets out exactly what that means and what happens if you do not do it.",
  linkToSection: "monitoring",
  linkLabel: "Go to Section 3 — Lawful monitoring",
};

/**
 * Every unfinished fact in the document, in one list. The page renders this so
 * the owner can see the outstanding work without reading all twenty sections.
 */
export const placeholders = [
  { token: "[PLACEHOLDER — owner to confirm registered company name and jurisdiction of incorporation]", where: "§1, §20", note: "The legal entity the Customer contracts with. This is NOT the product name: the service is called Verisade, but the counterparty is whichever company operates it. Naming the product as the contracting party is a defect — it leaves the contract with no identifiable counterparty." },
  { token: "[COMPANY REGISTRATION DETAILS — owner to complete]", where: "§20", note: "Company registration number. Jurisdiction of incorporation is captured with the legal name above." },
  { token: "[REGISTERED / NOTICE ADDRESS — owner to complete]", where: "§18, §20", note: "Where formal legal notices are served." },
  { token: "[LEGAL NOTICE EMAIL — owner to complete]", where: "§18, §20", note: "Address for contractual notices." },
  { token: "[SUPPORT EMAIL — owner to complete]", where: "§11, §17, §20", note: "Used for data export and deletion requests; there is no self-serve organization deletion in the product today." },
  { token: "[PRIVACY CONTACT — owner to complete]", where: "§11, §20", note: "Contact for data protection questions; a DPO if one is appointed." },
  { token: "[EFFECTIVE DATE — owner to complete]", where: "Header", note: "The date the Terms are adopted and published." },
  { token: "[JURISDICTION — owner to complete]", where: "§19", note: "Governing law." },
  { token: "[COURTS / DISPUTE FORUM — owner to complete]", where: "§19", note: "Exclusive forum, and whether arbitration is chosen instead." },
  { token: "[REFUND WINDOW — owner to complete]", where: "§7.9", note: "Whether any discretionary refund period is offered beyond statutory rights. The code issues no refunds of any kind today." },
  { token: "[SLA / UPTIME COMMITMENT — owner to complete]", where: "§14.2", note: "There is no service level agreement in the product today. Either publish one or leave §14.2 stating there is none." },
  { token: "[TAX TREATMENT — owner to complete]", where: "§7.10", note: "Whether listed prices are inclusive or exclusive of VAT / sales tax, and who accounts for it." },
  { token: "[PRICE CHANGE NOTICE PERIOD — owner to complete]", where: "§7.11, §18.2", note: "How much notice is given before a price or a material Terms change takes effect." },
  { token: "[DATA RETENTION AFTER TERMINATION — owner to complete]", where: "§17.5", note: "How long Customer Data is kept after an organization stops using the Service, and when it is deleted." },
  { token: "[LIABILITY CAP FLOOR — owner to complete]", where: "§15.3", note: "An amounts-paid cap is currently $0 for every customer, because no paid plan can be purchased yet. A monetary floor is needed for the cap to mean anything." },
  { token: "[MINIMUM AGE — owner to confirm]", where: "§4.2", note: "Left as a numeric blank rather than guessed. Common choices are 16 or 18, or the local age of majority; confirm against the markets served." },
  { token: "[VENDOR IP INDEMNITY — owner to complete]", where: "§16.4", note: "Whether we defend customers against a claim that the Service itself infringes third-party IP, and on what terms. Enterprise buyers will ask for this." },
  { token: "[MONITORING NOTICE URL — owner to link once published]", where: "§3.7", note: "The employee monitoring notice template lives at src/content/legal/monitoring-notice.js; link it here once its page is live." },
];

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------
//
// Block types the renderer understands:
//   { type: "p",           text }
//   { type: "h3",          text }
//   { type: "list",        ordered?, items: [string] }
//   { type: "definitions", items: [{ term, definition }] }
//   { type: "callout",     tone: "critical" | "warning" | "note", title?, items: [string] }
//   { type: "table",       caption?, head: [string], rows: [[string]] }
//   { type: "ref",         label, note }   // a document we have not linked yet
//
// Section numbers live on the section (`number`) and the renderer prints them.
// Sub-clause numbers ("3.5", "7.9") are part of the `h3` text, because they are
// cross-referenced by other clauses — a renderer that renumbered them silently
// would break every cross-reference in the document. If you insert a sub-clause,
// renumber the ones after it AND fix the cross-references that point at them.

export const sections = [
  // -------------------------------------------------------------------------
  {
    id: "acceptance",
    number: 1,
    title: "Agreement to these Terms",
    blocks: [
      {
        type: "p",
        text: "These Terms of Service are an agreement between [PLACEHOLDER — owner to confirm registered company name and jurisdiction of incorporation] (“we”, “us”, “our”) and the organization that uses Verisade (“you”, “your”, the “Customer”). Together with any document these Terms refer to, they are the whole agreement between us about the Service.",
      },
      {
        type: "p",
        text: "Verisade is the name of the Service. The party you contract with is the company named above, which operates it. Where these Terms say “we”, “us” or “our” they mean that company; where they say “Verisade” they mean the software. The two are not interchangeable, and a change to the product name does not change who the contract is with.",
      },
      {
        type: "p",
        text: "You accept these Terms when you do any of the following: create an organization on Verisade; accept an invitation to join an organization; or use the Service in any way. If you do not accept them, do not use the Service.",
      },
      {
        type: "p",
        text: "If you accept these Terms on behalf of a company or other organization, you confirm that you have authority to bind it. In that case “you” means that organization, and it is the party responsible for everything done under its account — including everything done by the people it invites.",
      },
      {
        type: "p",
        text: "Individual people who use the Service under your organization — your staff, your contractors, and any clients you invite to the client portal — are bound by Section 9 (Acceptable use) when they use it. The contract itself is with you, and you remain responsible for their use.",
      },
      {
        type: "callout",
        tone: "note",
        title: "Plain English, on purpose",
        items: [
          "This document avoids legal jargon where ordinary words do the job. Where a legal term of art is genuinely needed — controller, processor, indemnify, material breach — it is used and then explained in the same sentence.",
          "Section headings are for navigation. They do not limit what a section says.",
        ],
      },
    ],
  },

  // -------------------------------------------------------------------------
  {
    id: "definitions",
    number: 2,
    title: "Definitions",
    blocks: [
      {
        type: "definitions",
        items: [
          { term: "Service", definition: "The Verisade web application, the Verisade desktop agent, and any related documentation and support we provide." },
          { term: "Desktop Agent", definition: "The Verisade application you install on a computer to record activity on that computer. It is the only part of the Service that captures screenshots or application usage, and it captures nothing on a machine where it is not installed." },
          { term: "Organization", definition: "A single tenant on Verisade: your workspace, its members, its projects and its data. Every record in the Service belongs to exactly one Organization, and Organizations are isolated from one another in the database itself." },
          { term: "Owner", definition: "The role held by the person who creates the Organization, and by anyone they later grant it to. The Owner is the only role that can change organization settings, buy or cancel a plan, or grant ownership to someone else." },
          { term: "Authorized User", definition: "Anyone you invite to your Organization and who accepts — in any of the eight roles described in Section 5, including clients in the client portal." },
          { term: "Monitored Individual", definition: "Any person whose activity is captured because you installed the Desktop Agent on a machine they use. Usually one of your employees or contractors, but it is anyone whose work — or screen — the agent records." },
          { term: "Customer Data", definition: "Everything you and your Authorized Users put into or generate in the Service: organizations, projects, tasks, files, comments, employee records, invoices, and Tracking Data." },
          { term: "Tracking Data", definition: "The subset of Customer Data captured by the Desktop Agent: screenshots, application and window-title usage, keystroke and unique-key counts with words per minute, active and idle time, and login times. Section 3.1 lists it in full." },
          { term: "Plan", definition: "The tier your Organization is on — Free, Professional, Business or Enterprise — which determines your limits and which features you can reach. Section 7 covers plans; Section 8 covers limits." },
          { term: "Personal Data", definition: "Information relating to an identified or identifiable person, as defined by the data protection law that applies to you. Almost all Tracking Data is Personal Data about your staff." },
          { term: "Controller", definition: "A legal term of art: the party that decides why and how Personal Data is processed. For Customer Data, including all Tracking Data, that party is you." },
          { term: "Processor", definition: "A legal term of art: the party that processes Personal Data on the controller's instructions and for no purpose of its own. For Customer Data, that party is us." },
        ],
      },
    ],
  },

  // -------------------------------------------------------------------------
  // THE section. Placed third — before accounts, before billing — because a
  // customer who reads only the beginning of this document must still hit it.
  {
    id: "monitoring",
    number: 3,
    title: "Lawful monitoring: your responsibility",
    emphasis: "critical",
    lede:
      "Verisade can record the screens and application usage of the people who work for you. That is a serious thing to do to another person, and in most countries it is regulated. We supply the tool. The legal responsibility for using it lawfully is yours, and this section says exactly what that means.",
    blocks: [
      {
        type: "callout",
        tone: "critical",
        title: "The obligation in one paragraph",
        items: [
          "Before you install the Desktop Agent on any machine, you must (a) have a lawful basis for monitoring under the law that applies to you, and (b) tell every person who will be monitored, in advance, what is captured and why. You must not use Verisade to monitor anyone covertly. If you cannot meet these two conditions, do not install the agent — the rest of the product works without it.",
        ],
      },

      { type: "h3", text: "3.1 What is captured" },
      {
        type: "p",
        text: "So that you can describe the monitoring accurately to the people affected, here is the complete list of what the Desktop Agent records on a machine where it is installed:",
      },
      {
        type: "list",
        items: [
          "Screenshots — full captures of the screen, with the application that was in the foreground at the time.",
          "Applications and window titles — which application was in the foreground, its window title, and for how long, down to individual application switches.",
          "Keyboard volume — total keystrokes, unique keys, words per minute and an activity percentage per session. Counts and rates only.",
          "Active and idle time — minute-by-minute active-versus-idle percentages sampled from mouse and keyboard use, plus total, active and idle duration per session.",
          "Login times — when each person's first and subsequent logins of the day happened.",
        ],
      },
      { type: "p", text: "The Desktop Agent does not record:" },
      {
        type: "list",
        items: [
          "The websites or URLs anyone visits. Browsers appear only as applications by name, like any other program.",
          "The content of what is typed. Only counts and rates leave the machine — there is no keylogging.",
          "Anything at all on a machine where the Desktop Agent is not installed. Nothing is captured from the browser.",
        ],
      },

      { type: "h3", text: "3.2 Monitoring is off until you turn it on" },
      {
        type: "p",
        text: "No Tracking Data exists for your Organization until you install the Desktop Agent on a machine. The project management side of Verisade — boards, sprints, task review, reports and the client portal — works fully with the agent installed nowhere. Choosing to monitor is a decision you make, machine by machine.",
      },

      { type: "h3", text: "3.3 What the software does not give you" },
      {
        type: "callout",
        tone: "warning",
        title: "Know these limits before you promise anything to your team",
        items: [
          "There is no pause button and no per-person opt-out inside the application today. Tracking runs whenever the Desktop Agent is running on that machine, and stops when it is not. The practical control is which machines it is installed on.",
          "Screenshots are not blurred, redacted or filtered. Whatever was on the screen is captured, including anything personal, anything belonging to a third party, and anything visible from an adjacent window.",
          "The Service does not distinguish working hours from personal time. If the agent is running, it is capturing.",
          "Do not tell your staff that they can pause monitoring, that private moments are excluded, or that they can opt out in the app. None of those things is true today.",
        ],
      },

      { type: "h3", text: "3.4 Who is responsible for what" },
      {
        type: "p",
        text: "For all Customer Data, including Tracking Data, you are the controller and we are the processor — you decide why and how the data is processed, and we process it on your instructions in order to provide the Service. You decide who is monitored, on which machines, for what purpose, and who inside your Organization can see the result.",
      },
      {
        type: "p",
        text: "We do not decide any of that, and we are not in a position to check it. We do not verify that you have a lawful basis, we do not verify that you have given notice, we do not review your monitoring policy, and we do not provide legal advice. The fact that we have made a feature available, and the fact that we have not objected to how you use it, is not our approval of your monitoring programme.",
      },

      { type: "h3", text: "3.5 What you must do before you install the Desktop Agent" },
      { type: "p", text: "You must, at your own cost and before any monitoring begins:" },
      {
        type: "list",
        ordered: true,
        items: [
          "Identify a lawful basis for the monitoring under every law that applies to you and to the Monitored Individuals — including employment law, data protection law, and any law governing the recording of communications or workplace surveillance in the country, state or region where each person works.",
          "Give clear, specific, written notice to every Monitored Individual, in advance, covering what is captured (Section 3.1 is the list), why, who inside your Organization can see it, how long you keep it, and who they can contact about it. Notice must be given before the agent is installed on a machine they use, not afterwards.",
          "Obtain consent where the applicable law requires consent — and take advice on whether consent from an employee is valid at all in your jurisdiction, since in several it is not, because of the imbalance of power between employer and employee.",
          "Complete any assessment, consultation or filing your law requires before monitoring begins. Depending on where you operate this may include a data protection impact assessment, consultation with a works council, trade union or employee representatives, or notification to a regulator.",
          "Confirm that the machines you install on are within scope. Do not install the Desktop Agent on a personal device without the informed, documented agreement of the person who owns it, and take advice on whether that agreement is sufficient in your jurisdiction.",
          "Configure access deliberately. Owners and admins in your Organization can see the full activity dashboard for everyone in it; a developer or employee can see only their own sessions; clients are blocked from every tracking table at the database level. Grant the owner and admin roles accordingly.",
          "Tell Monitored Individuals how to ask what is held about them, how to object, and who handles that request. You, not we, answer those requests — see Section 11.5.",
          "Repeat all of the above whenever the monitoring changes: new people, new machines, a new purpose, or a new country.",
        ],
      },

      { type: "h3", text: "3.6 What you must not do" },
      {
        type: "list",
        items: [
          "Do not monitor anyone covertly, or in a way a reasonable person in their position would not expect given the notice you gave them.",
          "Do not install the Desktop Agent on a machine used by someone you have not notified.",
          "Do not use Verisade to monitor people who are not your employees, contractors or workers, unless you have an independent lawful basis for doing so and have notified them in the same way.",
          "Do not use Tracking Data for a purpose you did not disclose in your notice.",
          "Do not use Verisade to target monitoring at someone because of a protected characteristic, or in retaliation for protected activity such as raising a grievance, whistleblowing or organising.",
          "Do not present Tracking Data as a complete or authoritative record of a person's work — see Section 14.4 before you rely on it in any disciplinary or employment decision.",
        ],
      },

      { type: "h3", text: "3.7 The monitoring notice template" },
      {
        type: "p",
        text: "We publish an employee monitoring notice template alongside these Terms, written against the exact capture list in Section 3.1, so that the notice you give your team matches what the software actually does.",
      },
      {
        type: "ref",
        label: "Employee Monitoring Notice (template)",
        note: "Published with these Terms. [MONITORING NOTICE URL — owner to link once published]",
      },
      {
        type: "p",
        text: "The template is a starting point that you must adapt to your own circumstances and have reviewed locally. It is not legal advice, using it is not a defence, and it does not transfer any part of the responsibility in this Section 3 to us.",
      },

      { type: "h3", text: "3.8 If you cannot meet this section" },
      {
        type: "p",
        text: "Do not install the Desktop Agent. Use Verisade for project management only. Nothing in the Service requires monitoring to be switched on, and no plan is conditional on it.",
      },

      { type: "h3", text: "3.9 If you breach this section" },
      {
        type: "p",
        text: "Breach of this Section 3 is a material breach of these Terms — meaning a breach serious enough to go to the root of the agreement, not a technicality. Where we have credible evidence of covert or unlawful monitoring, we may suspend your access to the Desktop Agent, to Tracking Data, or to the Service, immediately and without notice, under Section 17.2. Your indemnity for claims arising out of your monitoring is in Section 16.2, and it is the indemnity most likely to be called on under this agreement.",
      },
    ],
  },

  // -------------------------------------------------------------------------
  {
    id: "accounts",
    number: 4,
    title: "Accounts, organizations and eligibility",
    blocks: [
      { type: "h3", text: "4.1 Creating an organization" },
      {
        type: "p",
        text: "Signing up creates an Organization and makes you its Owner. Your Organization starts on the Free plan; no payment details are required and none are taken. Section 7.2 explains how that works.",
      },

      { type: "h3", text: "4.2 Eligibility" },
      {
        type: "p",
        text: "You must be at least [MINIMUM AGE — owner to confirm] years old, or the age of majority where you live if that is higher, to hold an account. You must not use the Service if you are barred from doing so under any applicable law or sanctions regime.",
      },

      { type: "h3", text: "4.3 Invitations" },
      {
        type: "p",
        text: "You add people by inviting them by email with a role. An invitation is a one-time link that expires seven days after it is sent. Nobody can invite someone at or above their own level, nobody can change their own role, and only an Owner can grant ownership. Clients cannot register themselves — they exist only because someone in your Organization invited them to specific projects.",
      },

      { type: "h3", text: "4.4 Account security" },
      {
        type: "list",
        items: [
          "You are responsible for the credentials of everyone in your Organization and for everything done using them.",
          "Remove people promptly when they leave. Suspending or terminating a membership blocks them on their very next request to the Service.",
          "Tell us without undue delay if you believe an account has been compromised, at [SUPPORT EMAIL — owner to complete].",
        ],
      },

      { type: "h3", text: "4.5 One organization, one tenant" },
      {
        type: "p",
        text: "Every record in the Service carries an organization identifier, and the database enforces isolation on every query by comparing it against a claim inside your signed session token — not by trusting the application to filter correctly. Do not attempt to reach data belonging to another Organization; see Section 9.",
      },
    ],
  },

  // -------------------------------------------------------------------------
  {
    id: "roles",
    number: 5,
    title: "Roles and who can do what",
    blocks: [
      {
        type: "p",
        text: "The Service has eight roles. They matter contractually because they decide who inside your Organization can commit you to a charge, and who can see your team's Tracking Data.",
      },
      {
        type: "table",
        caption: "The eight roles, highest to lowest",
        head: ["Role", "What it can do that matters here"],
        rows: [
          ["Owner", "Organization settings, and the only role that can start, change or cancel a paid plan or grant ownership to someone else."],
          ["Admin", "Runs projects, boards and automation; can see the billing page but cannot buy, change or cancel a plan."],
          ["Manager", "Reviews tasks, plans sprints, and can see tracking and reports for people in the Organization."],
          ["HR", "Manages employees, teams, departments and invitations, without touching projects."],
          ["Team lead", "Task and team oversight, including tracking and reports."],
          ["Developer", "Own work and own session history only."],
          ["Employee", "Own work and own session history only."],
          ["Client", "The client portal only. Blocked from every tracking table at the database level."],
        ],
      },
      {
        type: "callout",
        tone: "note",
        items: [
          "Only the Owner can commit your Organization to a recurring charge, and only the Owner can cancel one. Requests from any other role are refused by the server, not merely hidden in the interface.",
          "Owners and admins can see the full activity dashboard for everyone in the Organization. Grant those two roles with that in mind — it is the access decision with the biggest privacy consequence you will make.",
        ],
      },
    ],
  },

  // -------------------------------------------------------------------------
  {
    id: "your-obligations",
    number: 6,
    title: "Your obligations",
    blocks: [
      { type: "p", text: "In addition to Section 3, you agree that you will:" },
      {
        type: "list",
        ordered: true,
        items: [
          "Provide accurate registration details and keep them current.",
          "Be responsible for all Customer Data — including having the right to put it into the Service, and the right to let us process it in order to provide the Service.",
          "Comply with all laws that apply to your use of the Service, including employment, data protection, privacy, confidentiality and export control laws.",
          "Manage your own people: who you invite, in what role, and when you remove them.",
          "Answer requests from your own staff, clients and regulators about Customer Data. We will assist you as described in Section 11.5, but you are the party that owes them the answer.",
          "Keep your own copies of anything you cannot afford to lose. Section 11.4 describes the export the product offers today, and its limits.",
          "Not resell, sublicense or provide the Service to a third party as a service of your own, unless we have agreed that in writing.",
        ],
      },
    ],
  },

  // -------------------------------------------------------------------------
  {
    id: "billing",
    number: 7,
    title: "Plans, pricing and billing",
    blocks: [
      { type: "h3", text: "7.1 The plans" },
      {
        type: "p",
        text: "Plans are priced per organization, not per seat. All prices are in US dollars and are billed monthly.",
      },
      {
        type: "table",
        caption: "Published plan catalogue",
        head: ["Plan", "Price", "Billing"],
        rows: [
          ["Free", "$0", "—"],
          ["Professional", "$49", "per month, per organization"],
          ["Business", "$149", "per month, per organization"],
          ["Enterprise", "$499", "per month, per organization"],
        ],
      },

      { type: "h3", text: "7.2 What applies today: the Free plan" },
      {
        type: "callout",
        tone: "warning",
        title: "Paid plans cannot be purchased yet",
        items: [
          "Payment processing is not enabled on the Service at present. Any attempt to start a paid subscription is refused by the server. Until we enable it, every Organization runs on the Free plan and no charge of any kind can be raised.",
          "The prices in Section 7.1 are the published catalogue for when purchasing opens. They are not a charge you are incurring now.",
          "Sections 7.4 to 7.11 describe how billing will work, and they take effect for your Organization only if and when you actually purchase a paid plan. Nothing in them obliges you to buy one.",
        ],
      },
      {
        type: "p",
        text: "Creating an Organization does not create a subscription record, and an Organization with no subscription record is treated as being on the Free plan — the most restrictive plan, so an interruption in our billing systems can never accidentally grant unlimited use. The Free plan has no time limit and no countdown.",
      },
      {
        type: "callout",
        tone: "note",
        title: "There is no free trial",
        items: [
          "You may see a trial length in our plan catalogue. No trial clock runs today: signing up creates no subscription record, so nothing starts and nothing expires. We do not offer, and you should not rely on, a trial period. If we introduce one, it will be described here first.",
        ],
      },

      { type: "h3", text: "7.3 When purchasing opens" },
      {
        type: "p",
        text: "We will enable purchasing by connecting a payment processor and publishing prices in it. From that point, the remainder of this Section 7 governs any paid subscription you choose to start. We will not migrate you onto a paid plan or charge you without you buying one.",
      },

      { type: "h3", text: "7.4 Who can buy" },
      {
        type: "p",
        text: "Only the Owner of an Organization can start, change or cancel a subscription. By doing so, the Owner commits the Organization to the charge.",
      },

      { type: "h3", text: "7.5 Payment and renewal" },
      {
        type: "list",
        items: [
          "Subscriptions are monthly and renew automatically until cancelled. Each period is charged in advance.",
          "Payment is taken by our payment processor through its own hosted checkout and hosted billing portal. Card details are entered on the processor's pages and never pass through or rest on Verisade systems.",
          "You authorise the recurring charge when you subscribe, and it continues for each renewal until the subscription is cancelled under Section 7.7.",
        ],
      },

      { type: "h3", text: "7.6 Changing plan" },
      {
        type: "p",
        text: "An Organization that already subscribes changes plan in place rather than starting a second subscription. Upgrades and downgrades are prorated: you are charged or credited only for the difference for the remainder of the current period, so an upgrade mid-cycle is not a second full month, and a downgrade does not forfeit what you have already paid.",
      },

      { type: "h3", text: "7.7 Cancellation" },
      {
        type: "list",
        items: [
          "Cancellation takes effect at the end of the period you have already paid for. You keep full access until then.",
          "You can reverse a pending cancellation at any time before that date, and the subscription simply continues.",
          "When the period ends, your Organization returns to the Free plan and to the Free plan's limits. Your data is not deleted — see Section 8.4 for what being over a lower plan's limits means in practice, and Section 17.5 for deletion.",
        ],
      },

      { type: "h3", text: "7.8 Failed payments" },
      {
        type: "p",
        text: "If a payment fails, your Organization keeps working during a grace period while the payment is retried — seven days unless we have published a different period. A card that will retry successfully should not lock a paying customer out. If the grace period passes without a successful payment, the Organization falls back to the Free plan and its limits.",
      },

      { type: "h3", text: "7.9 Refunds" },
      {
        type: "p",
        text: "Cancelling does not generate a refund for the remainder of a period; instead you keep access until that period ends. Beyond that: [REFUND WINDOW — owner to complete]. Nothing in this section affects any refund or cancellation right you have under consumer or other law that cannot be excluded by contract.",
      },

      { type: "h3", text: "7.10 Taxes" },
      { type: "p", text: "[TAX TREATMENT — owner to complete]" },

      { type: "h3", text: "7.11 Price changes" },
      {
        type: "p",
        text: "We may change our prices. A change to the price of a plan you already subscribe to takes effect at your next renewal, and we will give you [PRICE CHANGE NOTICE PERIOD — owner to complete] notice before it does. If you do not accept a price change, cancel under Section 7.7 before it takes effect.",
      },
    ],
  },

  // -------------------------------------------------------------------------
  {
    id: "limits",
    number: 8,
    title: "Plan limits and what happens when you reach one",
    blocks: [
      { type: "h3", text: "8.1 The limits we actually apply" },
      {
        type: "p",
        text: "Limits count everything in your Organization, not per user. Four things are limited, and these are the only ones the Service enforces:",
      },
      {
        type: "table",
        caption: "Enforced limits by plan",
        head: ["", "Free", "Professional", "Business", "Enterprise"],
        rows: [
          ["People", "3", "25", "100", "Unlimited"],
          ["Developers", "3", "25", "100", "Unlimited"],
          ["Projects", "2", "25", "150", "Unlimited"],
          ["Open tasks", "50", "2,000", "20,000", "Unlimited"],
        ],
      },
      {
        type: "p",
        text: "“Open tasks” means tasks still in flight — pending, in progress, awaiting approval, or reviewed. Closing a task frees capacity, so a long-running Organization does not run out of room permanently.",
      },

      { type: "h3", text: "8.2 What is not limited today" },
      {
        type: "callout",
        tone: "note",
        items: [
          "We do not currently apply a storage cap, a limit on how many screenshots you may accumulate, or a retention limit on how long Tracking Data is kept. Nothing in the Service deletes Tracking Data on a schedule.",
          "That is a statement of how the Service works today, not a commitment to keep it that way for ever. If we introduce any of these, we will tell you before it applies to you, under Section 18.",
          "Do not read this as a promise that we will store your data indefinitely. Section 11.4 explains what you can export, and Section 14.5 explains why you should keep your own copies of anything you cannot lose.",
        ],
      },

      { type: "h3", text: "8.3 What happens when you reach a limit" },
      {
        type: "list",
        items: [
          "The action that would exceed the limit is refused, with a message naming the resource, your current count and the limit.",
          "For projects and open tasks the refusal happens in the database itself as well as in the application, so nothing can be talked past a limit from a browser. People and developer limits are applied by the server when an invitation is created, when it is accepted, and when an account is provisioned.",
          "Existing work is never deleted, hidden or locked because of a limit. You keep everything you already have; you simply cannot create more of that one thing until you are back under, or you upgrade.",
          "Two features are not available on the Free plan: automation rules and the client portal. Attempting to use them on Free is refused with a message saying so.",
        ],
      },

      { type: "h3", text: "8.4 Being above the limits of a lower plan" },
      {
        type: "p",
        text: "If your Organization ends up on a plan whose limits are lower than what you already have — by downgrading, cancelling, or after a failed payment — nothing is deleted and nothing becomes unreadable. You keep your data, and creation of the limited resources is refused until you are under the new limit.",
      },
    ],
  },

  // -------------------------------------------------------------------------
  {
    id: "acceptable-use",
    number: 9,
    title: "Acceptable use",
    blocks: [
      {
        type: "p",
        text: "Section 3 sets your monitoring obligations and is not repeated here. In addition, you and your Authorized Users must not:",
      },
      {
        type: "list",
        items: [
          "Break the law, infringe anyone's rights, or help anyone else do either, using the Service.",
          "Upload malware, or content that is unlawful, defamatory, harassing, or that you have no right to share.",
          "Attempt to reach data belonging to another Organization, or any account, system or network you are not authorised to reach.",
          "Probe, scan, or test the security of the Service except under a written arrangement with us, or interfere with its operation — including load that is intended to degrade it for others.",
          "Reverse engineer, decompile or attempt to derive the source of any part of the Service, except to the extent that restriction is unenforceable under the law that applies to you.",
          "Circumvent, or try to circumvent, plan limits, feature gates, role restrictions or the isolation between Organizations.",
          "Modify, repackage or redistribute the Desktop Agent, or install it by any means other than the ones we provide.",
          "Use the Service to build a competing product, or to benchmark it for publication, without our written consent.",
          "Remove or obscure any notice of ownership on any part of the Service.",
        ],
      },
      {
        type: "p",
        text: "We may investigate suspected breaches and take the steps in Section 17. We are not obliged to monitor your use, and we do not.",
      },
    ],
  },

  // -------------------------------------------------------------------------
  {
    id: "ip",
    number: 10,
    title: "Intellectual property",
    blocks: [
      {
        type: "p",
        text: "We own the Service — the software, the Desktop Agent, the interface, the documentation, our name and our marks — together with everything we develop in the course of providing it. Nothing in these Terms transfers any of that to you.",
      },
      {
        type: "p",
        text: "For as long as your subscription or Free plan account is live, we grant you a limited, non-exclusive, non-transferable, revocable right to use the Service and to install and use the Desktop Agent on machines you are entitled to monitor under Section 3, for your own internal business purposes. Anything not expressly granted is reserved.",
      },
      {
        type: "p",
        text: "If you send us feedback or suggestions, we may use them to improve the Service without obligation or payment to you. This does not give us any right to your Customer Data — Section 11 governs that, and feedback does not mean sending us your data.",
      },
    ],
  },

  // -------------------------------------------------------------------------
  {
    id: "your-data",
    number: 11,
    title: "Your data",
    blocks: [
      { type: "h3", text: "11.1 You own it" },
      {
        type: "p",
        text: "As between you and us, Customer Data is yours. We claim no ownership of it. You grant us only the licence we need to host, store, transmit, display, back up and process it in order to provide and support the Service, and to comply with the law.",
      },
      {
        type: "p",
        text: "We do not sell Customer Data. We do not use the content of your Customer Data to advertise to anyone.",
      },

      { type: "h3", text: "11.2 How it is kept separate" },
      {
        type: "p",
        text: "Every table in the Service carries an organization identifier, and the database compares it against a claim inside your signed session token on every query — so isolation between Organizations is enforced by the database, not by the application remembering to filter. Clients invited to the client portal are blocked from every tracking table by the same mechanism.",
      },

      { type: "h3", text: "11.3 Screenshots specifically" },
      {
        type: "p",
        text: "Screenshots are stored in a private per-organization bucket and are never publicly addressable. When the dashboard displays one, it does so through a signed link that stops working ten minutes after it is created. Anyone with an authorised session and the right role can still view them, which is why Section 3.5(6) asks you to grant the owner and admin roles deliberately.",
      },

      { type: "h3", text: "11.4 Getting your data out" },
      {
        type: "callout",
        tone: "note",
        title: "What export exists today",
        items: [
          "The reporting screens export to CSV and PDF over any date range you choose, across five report areas. Client invoices can be downloaded as PDF.",
          "There is no public API and no whole-account export archive today. Screenshots are not included in any bulk export.",
          "If you need data the product cannot export, ask us at [SUPPORT EMAIL — owner to complete] and we will do what is reasonable to help, in a format of our choosing.",
        ],
      },

      { type: "h3", text: "11.5 Requests from the people in your data" },
      {
        type: "p",
        text: "Requests from your staff, contractors or clients about their Personal Data — access, correction, deletion, objection to monitoring — are yours to answer, because you are the controller. Most of what such a request needs is visible to you inside the Service. Where it is not, we will give you reasonable assistance. If such a request reaches us directly, we will not answer it on your behalf; we will pass it to you.",
      },

      { type: "h3", text: "11.6 Privacy documents" },
      {
        type: "p",
        text: "How we handle Personal Data as a processor is described in our Privacy Policy, and our processor obligations are set out in our Data Processing Addendum, which forms part of this agreement where data protection law requires one. If those documents conflict with these Terms on the handling of Personal Data, they take precedence over these Terms. Data protection questions: [PRIVACY CONTACT — owner to complete].",
      },
      { type: "ref", label: "Privacy Policy", note: "Published alongside these Terms." },
      { type: "ref", label: "Data Processing Addendum", note: "Published alongside these Terms." },
    ],
  },

  // -------------------------------------------------------------------------
  {
    id: "confidentiality",
    number: 12,
    title: "Confidentiality",
    blocks: [
      {
        type: "p",
        text: "Each of us may learn confidential information about the other: information marked confidential, or that a reasonable person would understand to be confidential from its nature or the circumstances. Your Customer Data is your confidential information. Non-public details of the Service, including security arrangements and unreleased features, are ours.",
      },
      {
        type: "p",
        text: "Each of us will use the other's confidential information only to perform this agreement, will protect it with at least reasonable care, and will disclose it only to people who need it and who are under equivalent obligations.",
      },
      {
        type: "p",
        text: "This does not apply to information that is public through no fault of the receiver, was already known to the receiver without a duty of confidence, or is independently developed without using the other's information. If either of us is legally compelled to disclose the other's confidential information, we will give notice where we are lawfully able to, so the other can seek protection.",
      },
    ],
  },

  // -------------------------------------------------------------------------
  {
    id: "third-parties",
    number: 13,
    title: "Third-party services",
    blocks: [
      {
        type: "p",
        text: "The Service depends on third parties. Using Verisade means Customer Data is processed by them for the purposes described below.",
      },
      {
        type: "table",
        caption: "Third parties the Service relies on",
        head: ["Provider role", "What it handles"],
        rows: [
          ["Cloud database, authentication and file storage", "Where Customer Data lives, including screenshots and uploaded files, and where sign-in is handled."],
          ["Payment processor", "Hosted checkout, the billing portal, card details and invoices — once purchasing is enabled under Section 7.3. Card data never passes through Verisade."],
          ["Email delivery", "Invitations, verification, notifications and reminders."],
          ["AI inference provider", "Used only if someone in your Organization uses the feature that extracts tasks from an uploaded requirements document. When they do, text from that document is sent to a third-party inference service for processing. Do not use that feature on documents you may not share with a third party."],
        ],
      },
      {
        type: "p",
        text: "The current list of named subprocessors is maintained in our Privacy Policy and Data Processing Addendum rather than here, so it can be kept accurate. We remain responsible to you for the parts of the Service we provide; we are not responsible for third-party services you choose to connect or use independently of Verisade.",
      },
    ],
  },

  // -------------------------------------------------------------------------
  {
    id: "warranties",
    number: 14,
    title: "Availability, warranties and disclaimers",
    blocks: [
      { type: "h3", text: "14.1 What we do promise" },
      {
        type: "p",
        text: "We will provide the Service with reasonable skill and care, and we will not materially reduce the core functionality of a plan you are paying for during a period you have paid for.",
      },

      { type: "h3", text: "14.2 Availability" },
      {
        type: "p",
        text: "We do not currently offer a service level agreement or an uptime commitment. The Service is provided on a commercially reasonable efforts basis and may be unavailable for maintenance, for updates, or because of failures at a provider we depend on. [SLA / UPTIME COMMITMENT — owner to complete].",
      },

      { type: "h3", text: "14.3 The Service is provided “as is”" },
      {
        type: "p",
        text: "Except as expressly stated in these Terms, and to the fullest extent the law allows, the Service is provided as is and as available, and we disclaim all other warranties, whether express, implied or statutory — including any implied warranty of merchantability, fitness for a particular purpose, or non-infringement. We do not warrant that the Service will be uninterrupted, error free, or that it will meet your requirements.",
      },

      { type: "h3", text: "14.4 Tracking Data is a signal, not proof" },
      {
        type: "callout",
        tone: "warning",
        items: [
          "Activity metrics are samples and counts, not a complete or authoritative record of what a person did. Active and idle percentages are sampled from mouse and keyboard use; keystroke figures are volumes, not content; screenshots are moments, not context. The agent captures nothing while it is not running, while a machine is offline, or on any machine where it is not installed.",
          "Thoughtful work often produces low keyboard activity. Busy work often produces high activity. The numbers do not know the difference.",
          "We give no warranty that Tracking Data is complete or accurate, and you should not treat it as the sole basis for any disciplinary, performance, pay or termination decision. If you use it in such a decision, apply human judgement, give the person the chance to respond, and comply with the employment law that applies to them. That decision is yours alone.",
        ],
      },

      { type: "h3", text: "14.5 Backups" },
      {
        type: "p",
        text: "We take operational backups for our own resilience. They are not a data recovery service for you, and we do not guarantee that any particular item can be restored. Keep your own copies of anything you cannot afford to lose.",
      },
    ],
  },

  // -------------------------------------------------------------------------
  {
    id: "liability",
    number: 15,
    title: "Limitation of liability",
    blocks: [
      { type: "h3", text: "15.1 What is never limited" },
      {
        type: "p",
        text: "Nothing in these Terms limits or excludes liability that cannot lawfully be limited or excluded — which in most jurisdictions includes death or personal injury caused by negligence, and fraud or fraudulent misrepresentation.",
      },

      { type: "h3", text: "15.2 Excluded losses" },
      {
        type: "p",
        text: "Subject to Section 15.1, neither of us is liable to the other for indirect or consequential loss, or for loss of profit, revenue, goodwill, anticipated savings, business opportunity, or for loss or corruption of data, however caused, even if the possibility was known.",
      },

      { type: "h3", text: "15.3 The cap" },
      {
        type: "p",
        text: "Subject to Section 15.1 and Section 15.4, our total liability arising out of or in connection with this agreement, in aggregate over any twelve-month period, is limited to the greater of the amounts you actually paid us for the Service in the twelve months before the claim arose, and [LIABILITY CAP FLOOR — owner to complete].",
      },
      {
        type: "callout",
        tone: "warning",
        title: "Why this needs a number in it",
        items: [
          "No paid plan can be purchased today, so every customer has paid us nothing. An amounts-paid cap on its own is therefore a cap of zero, which several jurisdictions will treat as no remedy at all and may refuse to enforce — potentially taking the rest of the clause down with it. A monetary floor must be inserted before these Terms are relied on.",
        ],
      },

      { type: "h3", text: "15.4 What the cap does not cover" },
      {
        type: "p",
        text: "The cap in Section 15.3 does not apply to your obligation to pay amounts properly due, or to your indemnities under Section 16.",
      },

      { type: "h3", text: "15.5 Allocation of risk" },
      {
        type: "p",
        text: "These limits reflect how this agreement is priced, including a plan offered at no charge. They apply to every kind of claim — contract, negligence, statutory or otherwise — and survive termination.",
      },
    ],
  },

  // -------------------------------------------------------------------------
  {
    id: "indemnity",
    number: 16,
    title: "Indemnity",
    blocks: [
      {
        type: "p",
        text: "To indemnify someone means to cover their loss — to defend a claim brought against them and pay the damages, settlements and reasonable legal costs that result.",
      },

      { type: "h3", text: "16.1 General indemnity" },
      {
        type: "p",
        text: "You will indemnify us against claims brought by a third party arising out of Customer Data, your breach of these Terms, or your use of the Service in breach of the law.",
      },

      { type: "h3", text: "16.2 Monitoring indemnity" },
      {
        type: "callout",
        tone: "critical",
        title: "The indemnity most likely to matter",
        items: [
          "You will indemnify us against any claim, investigation, penalty or proceeding arising out of your monitoring of any person using the Service — including claims by a Monitored Individual, an employee representative body, a data protection authority, an employment tribunal or any other regulator — where it arises from your failure to have a lawful basis, your failure to give notice, or any other breach of Section 3.",
          "This is the natural consequence of Section 3.4: you choose who is monitored and why, and we are not able to check whether you did it lawfully.",
        ],
      },

      { type: "h3", text: "16.3 How an indemnified claim is handled" },
      {
        type: "p",
        text: "We will tell you promptly about any claim we want covered, let you control the defence with counsel of your choice, and give you reasonable cooperation at your expense. You may not settle a claim in a way that imposes an obligation or admission on us without our written consent, which we will not unreasonably withhold.",
      },

      { type: "h3", text: "16.4 Our indemnity to you" },
      {
        type: "p",
        text: "[VENDOR IP INDEMNITY — owner to complete: whether we defend the Customer against a claim that the Service itself infringes a third party's intellectual property, and on what terms.]",
      },
    ],
  },

  // -------------------------------------------------------------------------
  {
    id: "termination",
    number: 17,
    title: "Suspension and termination",
    blocks: [
      { type: "h3", text: "17.1 You can stop" },
      {
        type: "p",
        text: "You may stop using the Service at any time. If you are on a paid plan, cancel it under Section 7.7. Cancelling a subscription is not the same as deleting your Organization — see Section 17.5.",
      },

      { type: "h3", text: "17.2 Immediate suspension" },
      {
        type: "p",
        text: "We may suspend all or part of the Service, including access to the Desktop Agent or to Tracking Data, without notice where we reasonably believe it is necessary because of:",
      },
      {
        type: "list",
        items: [
          "credible evidence of covert or unlawful monitoring, or any other breach of Section 3;",
          "a breach of Section 9 that risks harm to another Organization, to a person, or to the Service;",
          "a security incident, a compromised account, or a legal or regulatory requirement.",
        ],
      },
      {
        type: "p",
        text: "We will tell you what happened and what is needed to restore access as soon as we reasonably can, unless the law prevents us.",
      },

      { type: "h3", text: "17.3 Termination for breach" },
      {
        type: "p",
        text: "Either of us may terminate this agreement if the other commits a material breach and does not fix it within 30 days of written notice describing it. A material breach is one that goes to the root of the agreement rather than a technicality; breach of Section 3 is expressly one.",
      },

      { type: "h3", text: "17.4 Termination for convenience" },
      {
        type: "p",
        text: "We may terminate a Free plan account, or discontinue the Free plan, on reasonable notice under Section 18.1. We will not terminate a paid subscription for convenience during a period you have paid for.",
      },

      { type: "h3", text: "17.5 What happens to your data" },
      {
        type: "callout",
        tone: "note",
        items: [
          "There is no self-serve way to delete an Organization in the product today. To have your Organization and its data deleted, ask at [SUPPORT EMAIL — owner to complete].",
          "Export what you need before you ask — Section 11.4 describes what the product can export.",
          "Retention after the agreement ends: [DATA RETENTION AFTER TERMINATION — owner to complete].",
          "Some copies may persist in backups for a period after deletion, and we may retain what the law requires us to retain.",
        ],
      },

      { type: "h3", text: "17.6 What survives" },
      {
        type: "p",
        text: "Sections 3.9, 10, 11.1, 12, 14.3, 15, 16, 19 and 20, and any payment obligation already incurred, survive termination.",
      },
    ],
  },

  // -------------------------------------------------------------------------
  {
    id: "changes",
    number: 18,
    title: "Changes to the Service and to these Terms",
    blocks: [
      { type: "h3", text: "18.1 Changes to the Service" },
      {
        type: "p",
        text: "The Service will change: we add features, we improve things, and occasionally we remove something. We will not materially reduce the core functionality of a plan you are paying for during a period you have already paid for. Where we plan to remove something material, or to start applying a limit we do not apply today — such as those in Section 8.2 — we will give notice under Section 18.2 first.",
      },

      { type: "h3", text: "18.2 Changes to these Terms" },
      {
        type: "list",
        items: [
          "We may update these Terms. The current version always shows a “last updated” date at the top.",
          "For material changes we will give notice by email to the Organization Owner, or in the application, at least [PRICE CHANGE NOTICE PERIOD — owner to complete] before they take effect.",
          "Continuing to use the Service after a change takes effect means you accept the updated Terms. If you do not accept them, stop using the Service and, if you subscribe, cancel under Section 7.7 before the change takes effect.",
          "Changes we make to comply with the law may take effect immediately where we have no choice.",
        ],
      },

      { type: "h3", text: "18.3 Notices" },
      {
        type: "p",
        text: "We give you notice by email to the Organization Owner's address or inside the application. You give us formal legal notice in writing to [LEGAL NOTICE EMAIL — owner to complete] and to [REGISTERED / NOTICE ADDRESS — owner to complete]. Keep your Owner email address current: notice sent to it counts as given.",
      },
    ],
  },

  // -------------------------------------------------------------------------
  {
    id: "law",
    number: 19,
    title: "Governing law and disputes",
    blocks: [
      { type: "h3", text: "19.1 Governing law" },
      {
        type: "p",
        text: "This agreement, and any dispute arising out of it, is governed by the law of [JURISDICTION — owner to complete], without regard to its conflict of laws rules.",
      },

      { type: "h3", text: "19.2 Where disputes are heard" },
      {
        type: "p",
        text: "[COURTS / DISPUTE FORUM — owner to complete: the exclusive forum for disputes, and whether arbitration or another process is chosen instead of the courts.]",
      },

      { type: "h3", text: "19.3 Talk to us first" },
      {
        type: "p",
        text: "Before starting formal proceedings, please raise the issue with us at [LEGAL NOTICE EMAIL — owner to complete] and give us 30 days to resolve it. Most disputes are cheaper to solve this way. This does not stop either of us seeking urgent injunctive relief.",
      },

      { type: "h3", text: "19.4 Consumer and local rights" },
      {
        type: "p",
        text: "If you are a consumer, or if mandatory law in your country gives you rights or a forum that this section cannot override, that law applies despite Sections 19.1 and 19.2.",
      },

      { type: "h3", text: "19.5 General" },
      {
        type: "list",
        items: [
          "Entire agreement: these Terms, with the Privacy Policy and the Data Processing Addendum, are the whole agreement between us and replace anything said before.",
          "Severability: if a provision is unenforceable, the rest stands and the provision is read down to the minimum extent needed.",
          "No waiver: not enforcing a right on one occasion does not waive it.",
          "Assignment: you may not assign this agreement without our consent; we may assign it to a successor of our business.",
          "Force majeure: neither of us is liable for a failure caused by something genuinely beyond reasonable control.",
          "No partnership or agency is created between us, and no third party may enforce these Terms except as expressly stated.",
        ],
      },
    ],
  },

  // -------------------------------------------------------------------------
  {
    id: "contact",
    number: 20,
    title: "Contact",
    blocks: [
      {
        type: "definitions",
        items: [
          { term: "Legal entity", definition: "[PLACEHOLDER — owner to confirm registered company name and jurisdiction of incorporation]" },
          { term: "Registration", definition: "[COMPANY REGISTRATION DETAILS — owner to complete]" },
          { term: "Notice address", definition: "[REGISTERED / NOTICE ADDRESS — owner to complete]" },
          { term: "Legal notices", definition: "[LEGAL NOTICE EMAIL — owner to complete]" },
          { term: "Support and data requests", definition: "[SUPPORT EMAIL — owner to complete]" },
          { term: "Privacy and data protection", definition: "[PRIVACY CONTACT — owner to complete]" },
        ],
      },
      {
        type: "p",
        text: "If something in this document is unclear, ask us before you agree to it. If you are about to start monitoring people with Verisade and you are unsure whether you may, take local employment and data protection advice first — not from us.",
      },
    ],
  },
];

const terms = { meta, lawyerNotice, keyPoint, placeholders, sections };

export default terms;

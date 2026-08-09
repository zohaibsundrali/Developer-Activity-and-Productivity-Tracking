/**
 * Data Processing Addendum — content only. No JSX, no styling.
 *
 * WHY THIS EXISTS COMMERCIALLY
 * The customer is the controller of their employees' data; this product is the
 * processor. Any B2B buyer with a procurement function will ask for a DPA
 * before signing, and a monitoring product that cannot produce one loses the
 * deal at security review. This is that document.
 *
 * It is written against what the software actually does. The security annex
 * lists only measures that exist in the code, and the sub-processor annex lists
 * only providers verified as live in the running configuration. Where a
 * commitment depends on a decision nobody has made yet — retention periods,
 * governing law, transfer mechanism — it is left in "Open items" rather than
 * invented, because a DPA is a contract and an invented number in it is a
 * promise the company would be bound to and could not keep.
 *
 * Sources are named in comments above each section.
 */

import { entity, lastUpdated, legalReviewNotice } from "@/content/legal/entity";
import { subProcessors } from "@/content/legal/privacy";

/* ── Intro ─────────────────────────────────────────────────────────── */

const intro = [
  {
    type: "paragraph",
    text:
      `This Addendum forms part of the agreement between ${entity.legalName} (“Processor”, “we”) and the ` +
      `customer organisation using Verisade (“Controller”, “you”). It governs our processing ` +
      "of personal data on your behalf. Where it conflicts with the main agreement, this Addendum " +
      "prevails on data protection matters.",
  },
  {
    type: "callout",
    tone: "warning",
    title: "Read this before you deploy the desktop agent",
    text:
      "This product can take screenshots of your employees' screens. That makes you the controller " +
      "of an unusually sensitive dataset, and it puts obligations on you that no contract with us " +
      "can discharge: telling your staff, establishing a lawful basis, and in several jurisdictions " +
      "consulting a works council or completing an impact assessment before the first capture. " +
      "Annex C is a plain-language notice you can adapt and give to your staff. It is a starting " +
      "point for the first of those obligations, not a substitute for the rest.",
  },
];

/* ── Sections ──────────────────────────────────────────────────────── */

const sections = [
  {
    id: "definitions",
    heading: "Definitions",
    blocks: [
      {
        type: "definitions",
        items: [
          {
            term: "Controller, Processor, Sub-processor, Personal Data, Processing, Data Subject",
            text:
              "Carry the meanings given in applicable data protection law. Where the UK GDPR, the EU " +
              "GDPR or an equivalent regime applies, those definitions govern.",
          },
          {
            term: "Customer Personal Data",
            text:
              "Personal data we process on your behalf through the service. This includes the " +
              "monitoring data described in Annex A, your staff and client account records, and the " +
              "project, task and time records your people create.",
          },
          {
            term: "Monitoring Data",
            text:
              "The subset of Customer Personal Data captured by the desktop agent: screenshots, " +
              "application and window-title history, keystroke counts and typing rates, active and " +
              "idle measurements, work sessions and sign-in times. Enumerated exactly in Annex A.",
          },
          {
            term: "Sub-processor",
            text: "A third party we engage to process Customer Personal Data. Listed in Annex B.",
          },
        ],
      },
    ],
  },

  {
    id: "roles",
    heading: "Roles of the parties",
    blocks: [
      {
        type: "paragraph",
        text:
          "You are the Controller of Customer Personal Data. You determine the purposes and means of " +
          "processing: you decide whether to deploy the desktop agent and on which machines, who is " +
          "invited into your organisation, what role each person holds, and what you do with what " +
          "the software reports. We are the Processor and act only on your instructions.",
      },
      {
        type: "paragraph",
        text:
          "You warrant that you have a valid legal basis for the processing you instruct, that you " +
          "have given the notices your law requires to every person affected, and that you have " +
          "completed any prior assessment or consultation your law requires before monitoring " +
          "begins. You are responsible for the lawfulness of the data you put into the service and " +
          "of the instructions you give us.",
      },
      {
        type: "paragraph",
        text:
          "We act as an independent controller for a narrow, separate set of data: the account and " +
          "billing details of the person who creates your organisation, and our own operational and " +
          "security logs. That processing is governed by our privacy policy rather than by this " +
          "Addendum.",
      },
    ],
  },

  // Scope: what the software processes, for how long the relationship lasts.
  {
    id: "scope-and-duration",
    heading: "Subject matter, duration, nature and purpose",
    blocks: [
      {
        type: "definitions",
        items: [
          {
            term: "Subject matter",
            text:
              "Provision of project management software and, where you deploy it, desktop activity " +
              "monitoring.",
          },
          {
            term: "Duration",
            text:
              "For the term of the main agreement, plus the period afterwards described in the " +
              "deletion and return section below.",
          },
          {
            term: "Nature and purpose",
            text:
              "Hosting, storage, structuring, retrieval, display and analysis of Customer Personal " +
              "Data so that you can manage projects and, where enabled, observe activity on the " +
              "machines you have chosen to monitor.",
          },
          {
            term: "Types of personal data",
            text:
              "Identification and contact data, employment record data, work product and time " +
              "records, and Monitoring Data. Enumerated in Annex A.",
          },
          {
            term: "Categories of data subject",
            text:
              "Your staff — owners, administrators, managers, team leads, HR, developers and " +
              "employees — and the client contacts you invite into the client portal.",
          },
          {
            term: "Special category data",
            text:
              "The service is not designed to process special category data. Note, honestly, that a " +
              "full-screen screenshot captures whatever was on screen, which can incidentally include " +
              "health, trade union, religious or other sensitive information. Assess this before " +
              "deploying the agent; it is a foreseeable consequence of screen capture, not an edge " +
              "case.",
          },
        ],
      },
    ],
  },

  {
    id: "instructions",
    heading: "Processing on documented instructions",
    blocks: [
      {
        type: "paragraph",
        text:
          "We process Customer Personal Data only on your documented instructions, including as to " +
          "international transfers, unless we are required to do otherwise by law. If we are, we " +
          "will tell you before processing unless that law prohibits it.",
      },
      {
        type: "paragraph",
        text:
          "Your instructions are: this Addendum, the main agreement, the configuration you choose in " +
          "the product, and any further written instruction you give us. We will tell you if, in our " +
          "opinion, an instruction infringes applicable data protection law.",
      },
      {
        type: "paragraph",
        text:
          "We will not sell Customer Personal Data, will not use it for our own advertising, and " +
          "will not use Monitoring Data to train machine-learning models. Where the service offers " +
          "AI-assisted drafting of a task list, only the text of the requirements document your " +
          "staff submit is sent to the AI provider named in Annex B — no Monitoring Data, no " +
          "screenshot and no employee record is sent, and the feature is only ever invoked by a " +
          "deliberate action of your staff.",
      },
    ],
  },

  {
    id: "confidentiality",
    heading: "Confidentiality",
    blocks: [
      {
        type: "paragraph",
        text:
          "We ensure that every person authorised to process Customer Personal Data is bound by an " +
          "appropriate duty of confidentiality, and that access is limited to those who need it to " +
          "provide, support or secure the service.",
      },
      {
        type: "paragraph",
        text:
          "We treat Monitoring Data as the most sensitive category we hold. Screenshots are pictures " +
          "of a named person's screen, and we handle them accordingly: they are stored privately, " +
          "displayed only through short-lived links, and are not accessed by our personnel except " +
          "where necessary to investigate a fault you have reported or a security incident.",
      },
    ],
  },

  // Security: mirrors Annex A of a standard DPA, but every line is code-backed.
  {
    id: "security",
    heading: "Security of processing",
    blocks: [
      {
        type: "paragraph",
        text:
          "We implement appropriate technical and organisational measures to protect Customer " +
          "Personal Data. The measures actually in place are listed in Annex D. We have deliberately " +
          "not listed controls we intend to build but have not built, because a security annex is a " +
          "contractual representation and an aspirational one is a misrepresentation.",
      },
      {
        type: "paragraph",
        text:
          "Annex D also records the current limitations we are aware of. We would rather you learn " +
          "them from this document during procurement than from an incident afterwards.",
      },
      {
        type: "paragraph",
        text:
          "You are responsible for the security decisions that sit on your side of the line: who you " +
          "invite, what role you grant them, which machines you install the agent on, and revoking " +
          "access when someone leaves. Suspending a member takes effect on their next request to the " +
          "service.",
      },
    ],
  },

  {
    id: "sub-processing",
    heading: "Sub-processing",
    blocks: [
      {
        type: "paragraph",
        text:
          "You give general authorisation for us to engage sub-processors. Those engaged today are " +
          "listed in Annex B, together with what each one can see.",
      },
      {
        type: "paragraph",
        text:
          "We impose data protection obligations on each sub-processor that are no less protective " +
          "than those in this Addendum, and we remain fully liable to you for their performance.",
      },
      {
        type: "paragraph",
        text:
          "Before adding or replacing a sub-processor we will give you at least thirty days' notice. " +
          "If you reasonably object on data protection grounds within that period, we will work with " +
          "you to find an alternative; if we cannot, you may terminate the affected part of the " +
          "service without penalty for the remainder of its term.",
      },
    ],
  },

  {
    id: "data-subject-requests",
    heading: "Assisting with data subject requests",
    blocks: [
      {
        type: "paragraph",
        text:
          "The product gives you direct control over most of what a data subject will ask for. Your " +
          "administrators can view, correct and delete account and employee records, an individual " +
          "can already see their own session history, screenshots and keyboard statistics, and " +
          "reports export to CSV and PDF.",
      },
      {
        type: "paragraph",
        text:
          "Where a request cannot be satisfied through the product, we will assist you by " +
          "appropriate technical and organisational measures, taking into account the nature of the " +
          "processing. We will acknowledge a written assistance request within five business days " +
          "and provide the assistance in time for you to meet your own statutory deadline.",
      },
      {
        type: "callout",
        tone: "warning",
        title: "Erasure is manual today — plan for it",
        text:
          "The service has no automated retention or deletion. Deleting a person's account does not " +
          "remove their Monitoring Data, because those records are not linked to the account record " +
          "by a database relationship, and no part of the product deletes stored screenshot files " +
          "from object storage. Erasure of Monitoring Data is therefore carried out by us manually " +
          "on your written instruction. We will complete a scoped erasure instruction within thirty " +
          "days of receiving it and confirm in writing when it is done. This is a limitation of the " +
          "software as it stands, and it is a factor in the retention periods you should set.",
      },
      {
        type: "paragraph",
        text:
          "If a data subject contacts us directly about data we hold on your behalf, we will not " +
          "respond substantively. We will refer them to you and tell you promptly.",
      },
    ],
  },

  {
    id: "breach-notification",
    heading: "Personal data breach notification",
    blocks: [
      {
        type: "paragraph",
        text:
          "We will notify you without undue delay, and in any event within 48 hours, of becoming " +
          "aware of a personal data breach affecting Customer Personal Data. Notification goes to " +
          "the email addresses registered for your organisation's owner and administrators, so keep " +
          "those current.",
      },
      {
        type: "paragraph",
        text: "Our notification will include, to the extent known at the time:",
      },
      {
        type: "list",
        ordered: true,
        items: [
          "the nature of the breach, including the categories and approximate number of data " +
            "subjects and records affected;",
          "whether Monitoring Data — and in particular screenshots — was involved, stated explicitly, " +
            "because the harm profile of a screenshot breach is materially different from that of a " +
            "contact-list breach;",
          "the likely consequences;",
          "the measures taken or proposed to address it and to mitigate its effects; and",
          "a contact point for further information.",
        ],
      },
      {
        type: "paragraph",
        text:
          "Where we cannot provide all of that at once, we will provide it in phases without further " +
          "undue delay. We will not delay an initial notification in order to complete an " +
          "investigation. We will assist you in meeting your own notification duties to your " +
          "supervisory authority and to affected individuals, and we will keep a record of the " +
          "breach and our response.",
      },
      {
        type: "paragraph",
        text:
          `To report a suspected breach to us, write to ${entity.securityContactEmail}.`,
      },
    ],
  },

  {
    id: "deletion-and-return",
    heading: "Deletion and return on termination",
    blocks: [
      {
        type: "paragraph",
        text:
          "On termination or expiry of the main agreement, you may within 30 days ask us in writing " +
          "for a copy of Customer Personal Data. We will provide it in a structured, commonly used, " +
          "machine-readable format. Screenshots are provided as image files with their associated " +
          "records.",
      },
      {
        type: "paragraph",
        text:
          "After that 30-day window, or earlier if you confirm in writing that you need no export, " +
          "we will delete Customer Personal Data — including database records and stored screenshot " +
          "files — within a further 60 days, unless law requires us to retain it, in which case we " +
          "will tell you what is retained and why. We will confirm deletion in writing on request.",
      },
      {
        type: "callout",
        tone: "info",
        title: "Backups",
        text:
          "Data in routine platform backups is deleted as those backups age out on their normal " +
          "cycle rather than being individually purged. Until it does, it remains subject to this " +
          "Addendum. The exact backup retention cycle is set by our infrastructure provider and is " +
          "an open item below — we have not stated a figure we have not verified.",
      },
    ],
  },

  {
    id: "international-transfers",
    heading: "International transfers",
    blocks: [
      {
        type: "paragraph",
        text:
          `Customer Personal Data is hosted in the region configured for the service: ${entity.hostingRegion}. ` +
          "Our sub-processors operate globally and may access or route data outside that region.",
      },
      {
        type: "paragraph",
        text:
          "Where a transfer is restricted by applicable law, it will be made only under an approved " +
          "safeguard — such as the European Commission's standard contractual clauses or the UK " +
          "international data transfer addendum — supported by a transfer risk assessment. The " +
          "specific mechanism in place with each sub-processor is an open item below. We will not " +
          "assert a mechanism we have not executed, and you should treat this as a live question " +
          "during procurement rather than a closed one.",
      },
    ],
  },

  {
    id: "audit",
    heading: "Audit rights",
    blocks: [
      {
        type: "paragraph",
        text:
          "We will make available all information reasonably necessary to demonstrate compliance " +
          "with this Addendum, and allow for and contribute to audits, including inspections, " +
          "conducted by you or an auditor you appoint.",
      },
      {
        type: "list",
        items: [
          "You may request an audit once in any twelve-month period, and additionally following a " +
            "personal data breach affecting your data or a documented instruction from your " +
            "supervisory authority.",
          "Give us at least thirty days' written notice, conduct the audit during business hours, " +
            "and avoid unreasonable disruption to our operations.",
          "Your auditor must not be a competitor of ours and must sign a reasonable confidentiality " +
            "agreement.",
          "We may satisfy an audit request by providing a current third-party report or certification " +
            "where one covers the scope of your request. We hold no such certification today — that " +
            "is stated openly rather than implied — so at present an audit means answering your " +
            "questions and providing evidence directly.",
          "You bear your own audit costs. We bear ours, unless the audit reveals a material breach " +
            "of this Addendum by us, in which case we bear the reasonable costs of the audit.",
        ],
      },
      {
        type: "paragraph",
        text:
          "We will also provide reasonable assistance with any data protection impact assessment or " +
          "prior consultation with a supervisory authority that relates to our processing. Given " +
          "what this product does, we expect that to be a common request and we do not treat it as " +
          "exceptional.",
      },
    ],
  },

  {
    id: "liability-and-law",
    heading: "Liability, term and governing law",
    blocks: [
      {
        type: "paragraph",
        text:
          "This Addendum takes effect when you begin using the service and continues until we have " +
          "deleted or returned all Customer Personal Data. Obligations of confidentiality and " +
          "security survive termination.",
      },
      {
        type: "paragraph",
        text:
          "Liability under this Addendum is subject to the limitations and exclusions in the main " +
          "agreement. Nothing here limits either party's liability where the law does not permit it " +
          "to be limited.",
      },
      {
        type: "paragraph",
        text:
          `This Addendum is governed by the law of ${entity.governingJurisdiction}, and the courts of ` +
          "that jurisdiction have exclusive jurisdiction, without prejudice to a data subject's " +
          "rights to bring proceedings where the law allows.",
      },
    ],
  },

  /* ── Annex A: what is processed ────────────────────────────────── */
  // Sources: src/app/api/upload-screenshot/route.js (screenshots),
  // src/components/admin/DeveloperActivity.jsx:329 (app_usage columns),
  // src/app/api/keyboard-stats/route.js:59-64 (keyboard_stats columns),
  // DeveloperActivity.jsx:545 + :893 (mouse_activities columns),
  // database/schema.sql + 010/014/015 (account and employee records).
  {
    id: "annex-a",
    heading: "Annex A — Categories of data processed",
    blocks: [
      {
        type: "subheading",
        text: "A.1 Monitoring Data (only on machines where you install the desktop agent)",
      },
      {
        type: "table",
        columns: ["Category", "Fields processed"],
        rows: [
          [
            "Screenshots",
            "Full-screen PNG image; the employee's user id and organisation; capture time; a short " +
              "context note supplied by the agent, in practice the foreground application; storage " +
              "location and filename.",
          ],
          [
            "Application usage",
            "Application name, executable name, window title, start and end time, duration, whether " +
              "the application was newly opened, the session it belongs to, and the employee's email.",
          ],
          [
            "Keyboard statistics",
            "Total keys pressed, count of distinct keys, words per minute, keyboard-activity " +
              "percentage, total, active and idle minutes, an activity score, and a per-minute " +
              "summary of those counts. No keystroke content — the system has no field for it.",
          ],
          [
            "Activity and idleness",
            "Active percentage, idle percentage and an activity status, derived from keyboard and " +
              "mouse input. No cursor coordinates and no record of what was clicked.",
          ],
          [
            "Work sessions",
            "Session identifier, start and end time, status, total, active and idle duration, and a " +
              "productivity score.",
          ],
          ["Sign-in records", "Sign-in times per employee, including first sign-in of the day."],
        ],
      },
      {
        type: "callout",
        tone: "info",
        title: "Not captured",
        text:
          "Websites or web addresses visited; the content of anything typed; mouse clicks and cursor " +
          "positions; audio, video, webcam or microphone; location; and anything at all on a machine " +
          "where the agent is not installed. Browser time is derived by matching executable names " +
          "only. These are verified absences in the code, not statements of intent.",
      },
      {
        type: "subheading",
        text: "A.2 Account, employment and work data",
      },
      {
        type: "list",
        items: [
          "Account records: name, email, phone, job title, department, profile photo, active status; " +
            "client-portal contacts additionally carry a company name.",
          "Employee records, where you complete them: job title, phone, postal address, skills, " +
            "employment type and status, joining date, working hours, photo, biography, reporting " +
            "line, team and department. The product has no salary or compensation field.",
          "Work records: projects, tasks, deadlines, comments, time logged against tasks, uploaded " +
            "proof-of-work files, review decisions and rejection reasons.",
          "Communication and audit records: notifications, an approval audit trail, and an email " +
            "delivery log holding recipient, subject, template, delivery status and the provider's " +
            "message id.",
          "Billing records, on a paid plan: plan, subscription and payment status, billing period and " +
            "payment-processor identifiers. No card data reaches our servers.",
        ],
      },
    ],
  },

  /* ── Annex B: sub-processors ───────────────────────────────────── */
  // Verified against the running configuration; see the comment in
  // src/content/legal/privacy.js above the sub-processors section.
  {
    id: "annex-b",
    heading: "Annex B — Sub-processors",
    blocks: [
      {
        type: "paragraph",
        text:
          "This table is generated from the same single list that the privacy policy publishes, so " +
          "the two documents cannot drift apart. A sub-processor disclosure that contradicts itself " +
          "between two documents is worse than one that is merely out of date.",
      },
      {
        type: "table",
        columns: ["Sub-processor", "Purpose", "Data accessible", "Status"],
        rows: subProcessors.map((provider) => [
          provider.name,
          provider.purpose,
          provider.dataReached,
          provider.status,
        ]),
      },
      {
        type: "paragraph",
        text:
          "Not engaged at all, though the integrations exist in the software and are therefore worth " +
          "declaring rather than leaving for an auditor to find: Resend, supported as an alternative " +
          "email provider but not enabled; and EmailJS, whose browser library is initialised on the " +
          "signup page but is never called to send anything, so no data reaches it. If either is " +
          "switched on, this Annex will be updated and notice given under the sub-processing section " +
          "above.",
      },
    ],
  },

  /* ── Annex C: employee notice ──────────────────────────────────── */
  {
    id: "annex-c",
    heading: "Annex C — Notice for your employees",
    blocks: [
      {
        type: "paragraph",
        text:
          "Telling your staff what is being recorded is your obligation, not ours, and in most " +
          "jurisdictions it has to happen before the first capture rather than after it. We ship a " +
          "plain-language template so that obligation is easier to meet than to skip.",
      },
      {
        type: "paragraph",
        text:
          "The template is set out in full immediately after this document. It is written to be " +
          "read by the person being monitored: it states what is captured and how often, who can see " +
          "it, what is explicitly not captured, and how to raise a concern. Adapt it — the bracketed " +
          "passages need your own answers — and have it reviewed alongside the rest of your " +
          "employment documentation.",
      },
    ],
  },

  /* ── Annex D: security measures ────────────────────────────────── */
  // Every item traceable: database/013,014,018 (RLS), 019 (private bucket),
  // src/utils/screenshotFiles.js:27 (600s), src/utils/serverAuth.js:66-89
  // (membership check), src/utils/sessionCookie.js:20-23 + middleware.ts,
  // next.config.mjs:38-60 (headers), database/038 (append-only).
  {
    id: "annex-d",
    heading: "Annex D — Technical and organisational measures",
    blocks: [
      {
        type: "paragraph",
        text: "The measures below are in place in the running service today.",
      },
      {
        type: "definitions",
        items: [
          {
            term: "Tenant isolation",
            text:
              "Every record carries an organisation identifier, and the database compares it against " +
              "a claim inside the user's signed authentication token on every query. Isolation is " +
              "enforced by the database, not by the application remembering to filter. Cross-tenant " +
              "and cross-role isolation are covered by automated end-to-end tests that sign in as " +
              "each role.",
          },
          {
            term: "Screenshot handling",
            text:
              "Screenshots are written to a private bucket that cannot be listed or read directly. " +
              "The organisation identifier forms the leading segment of the storage path and the " +
              "database restricts link-signing to members of that organisation. Images are displayed " +
              "only through signed links that expire ten minutes after they are created. Client " +
              "portal users are excluded outright.",
          },
          {
            term: "Access control",
            text:
              "Eight roles, from owner to client. Nobody can change their own role or invite someone " +
              "above their own level, and only an owner can grant ownership. Client-portal users are " +
              "denied every monitoring table by database rule. Employee profile records are readable " +
              "only by people-operations roles and by the employee themselves. Suspension or " +
              "offboarding takes effect on the member's next request rather than at session expiry.",
          },
          {
            term: "Authentication and session handling",
            text:
              "Sign-in is handled by our authentication provider, which stores passwords hashed. " +
              "Sessions use a server-signed, HttpOnly, same-site cookie valid for twelve hours, and " +
              "every protected API route independently verifies the caller's token rather than " +
              "trusting the cookie.",
          },
          {
            term: "Transport and browser hardening",
            text:
              "HTTPS is enforced with a two-year strict-transport policy including subdomains. " +
              "Framing is blocked, MIME sniffing disabled, referrers truncated across origins, and " +
              "the camera, microphone, geolocation, payment and USB browser APIs are switched off. A " +
              "content security policy is deployed in report-only mode ahead of enforcement.",
          },
          {
            term: "Integrity of audit records",
            text:
              "The approval audit trail, the email delivery log and the system event log have no " +
              "update or delete permission for any application user, so their history cannot be " +
              "rewritten or erased from the product. Reporting-hierarchy changes that would create a " +
              "loop are refused by the database.",
          },
          {
            term: "Ingest hardening",
            text:
              "Uploads from the desktop agent are size-capped, the fields an agent may submit are " +
              "restricted to a fixed list, and the organisation is derived server-side from the " +
              "employee record rather than taken from the request. An optional shared secret can be " +
              "required on the ingest endpoints.",
          },
          {
            term: "Log minimisation",
            text:
              "Server-side event logs are filtered against a fixed allow-list of fields before " +
              "writing, so tokens, passwords, request bodies and payment payloads cannot be recorded. " +
              "Provider errors are redacted before storage.",
          },
        ],
      },
      {
        type: "subheading",
        text: "D.1 Known limitations, disclosed",
      },
      {
        type: "paragraph",
        text:
          "A security annex that lists only strengths is not useful to a buyer. The following are " +
          "true today and are being addressed; they appear as open items below.",
      },
      {
        type: "list",
        items: [
          "The application keeps a second, readable copy of user passwords in its own account tables " +
            "alongside the hashed copy held by the authentication provider, left over from an earlier " +
            "sign-in mechanism. We will not describe our password storage as hashed or encrypted " +
            "while this is the case.",
          "There is no automated retention or deletion of any data, and no part of the product " +
            "deletes stored screenshot files. See the deletion section above.",
          "Within a customer organisation, the database restricts monitoring records to members of " +
            "that organisation and excludes client-portal users; finer limits, such as showing an " +
            "individual only their own records, are applied by the application interface rather than " +
            "by the database.",
          "Screenshots captured before the move to private storage remain in an earlier, " +
            "publicly-readable location until they are migrated, and stay reachable by anyone holding " +
            "their address.",
          "We hold no third-party security certification. Audit requests are answered directly.",
          "The content security policy is deployed in report-only mode and is not yet enforcing.",
        ],
      },
    ],
  },
];

/* ── Open items ────────────────────────────────────────────────────── */

const openItems = [
  {
    title: "Company identity, governing law and notice addresses",
    text:
      "A DPA is a contract and must name the contracting entity, its registered address, the " +
      "governing law and the addresses for notices. All are unset — none exists in the codebase. " +
      "Set them in src/content/legal/entity.js before this document is offered to a customer.",
  },
  {
    title: "Retention periods must be decided before this is signed",
    text:
      "The software enforces no retention period, so this Addendum commits to none. A buyer's " +
      "security review will ask, and “indefinite” is the honest current answer. Decide periods per " +
      "category — screenshots first — build the deletion job, then state the periods here as a " +
      "contractual commitment.",
  },
  {
    title: "Plaintext password columns",
    text:
      "Annex D discloses that a readable copy of user passwords is stored in the application's own " +
      "tables. This is the single item most likely to fail a customer's security review. Remove the " +
      "columns and the code that writes them, then Annex D can be rewritten and this disclosure " +
      "dropped.",
  },
  {
    title: "International transfer mechanism",
    text:
      "No standard contractual clauses or equivalent safeguard has been executed with any " +
      "sub-processor, and the hosting region is not recorded. Put the safeguards in place, record " +
      "the region, then name the mechanism per sub-processor in Annex B.",
  },
  {
    title: "Backup retention cycle",
    text:
      "The deletion section refers to backups ageing out on their normal cycle without stating the " +
      "period, because it is set by the infrastructure provider and has not been verified. Confirm " +
      "it and state it — buyers ask.",
  },
  {
    title: "Breach notification timeframe — confirm 48 hours is operable",
    text:
      "This Addendum commits to notifying you within 48 hours of becoming aware of a breach. That " +
      "is a real contractual obligation and it needs a real process behind it: someone on call, a " +
      "way to detect a breach, and a maintained list of customer administrator contacts. Confirm " +
      "the commitment is operable, or change the number before anyone signs it.",
  },
  {
    title: "Desktop agent ingest authentication",
    text:
      "The shared secret protecting the desktop ingest endpoints is optional and is unset in the " +
      "running configuration, so those endpoints accept uploads without it. Set the secret and roll " +
      "it out to the installed agents; a buyer who reads Annex D closely will ask about this.",
  },
];

/* ── Export ────────────────────────────────────────────────────────── */

export const dpa = {
  kicker: "Legal",
  title: "Data Processing Addendum",
  subtitle:
    "The terms on which we process your employees' data on your behalf: roles, instructions, " +
    "security, sub-processors, breach notification, deletion and audit.",
  lastUpdated,
  appliesTo: `Customers of Verisade`,
  reviewNotice: legalReviewNotice,
  intro,
  sections,
  openItems,
};

export default dpa;

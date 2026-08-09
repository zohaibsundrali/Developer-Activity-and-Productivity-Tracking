/**
 * Privacy Policy — structured content.
 *
 * Plain data only. No JSX, no styling, no components.
 * `src/app/privacy/page.js` imports this and renders it through
 * `src/components/legal/LegalDocument.jsx`.
 *
 * THE RULE THIS FILE WAS WRITTEN UNDER
 * A generic privacy policy on a product that photographs employees' screens is
 * worse than no policy at all: it is a false statement about real people's
 * data, published under the company's name, aimed at the people with the least
 * power to check it. So every sentence below was written from the schema and
 * the code, and where the code has no answer the document says so instead of
 * borrowing a plausible number from a template.
 *
 * SOURCES OF TRUTH — each claim traces to one of these:
 *   screenshot capture + private bucket .... src/app/api/upload-screenshot/route.js,
 *                                            database/019_storage_hardening.sql:27
 *   10-minute signed URLs .................. src/utils/screenshotFiles.js:23-27
 *   keyboard columns (no content) .......... src/app/api/keyboard-stats/route.js:59-64
 *   app usage columns (no URL column) ...... src/components/admin/DeveloperActivity.jsx:329
 *   mouse = active/idle only ............... src/components/admin/DeveloperActivity.jsx:545,893
 *   sessions + logins ...................... src/components/admin/DeveloperActivity.jsx:321,373
 *   browser_usage never read or written .... grep: only 010/013/014/018 DDL, no app code
 *   developer_activities does not exist .... src/app/api/track-activity/route.js:104-122
 *   tenant isolation ....................... database/013_saas_rls.sql,
 *                                            database/018_security_hardening.sql
 *   clients blocked from tracking .......... database/014_client_portal.sql (7f)
 *   employee profile fields ................ database/015_team_employee_management.sql:53-75
 *   plaintext password columns ............. database/014_client_portal.sql:48,
 *                                            src/app/api/auth/signup/route.js:29,
 *                                            src/app/api/invitations/accept/route.js:73-103,
 *                                            src/app/api/developer/change-password/route.js:76-86
 *   session cookie ......................... src/utils/sessionCookie.js:20-23, middleware.ts
 *   transport headers ...................... next.config.mjs:38-60
 *   email provider selection ............... src/utils/emailProvider.js:37-40
 *   email delivery log ..................... database/036_email_log.sql
 *   server event log (no request bodies) ... database/038_system_events.sql,
 *                                            src/utils/systemEvents.js
 *   Hugging Face call ...................... src/app/api/ai-generate-tasks/route.js:12,38-60,187-199
 *   Stripe not configured .................. src/utils/stripeServer.js:17-33
 *   the only scheduled job ................. vercel.json, src/app/api/cron/route.js:8-18
 *
 * DELIBERATELY NOT CLAIMED, because the code does not support it:
 *   - that we record visited URLs (we do not — `browser_usage` is dead weight)
 *   - that we record keystroke content (we do not)
 *   - that we record mouse clicks or cursor position (we do not)
 *   - that passwords are hashed by this application (see section 12 — three
 *     tables hold plaintext copies; saying otherwise in a legal document would
 *     be a false security statement)
 *   - any retention period (nothing in this system deletes anything on a
 *     schedule; inventing "90 days" here would be a lie people would rely on)
 *   - encryption at rest as OUR control (it is our hosting provider's; stated
 *     as reliance, not as something this codebase implements)
 */

import { entity, lastUpdated, legalReviewNotice, TBD } from "./entity";

/**
 * Third parties that actually receive data, verified call site by call site.
 * Exported because `dpa.js` builds its Annex III table from the same array —
 * two lists that can drift apart is how a sub-processor disclosure becomes
 * wrong.
 *
 * NOT on this list, and why:
 *   Resend    — the send path supports it, but RESEND_API_KEY is unset, so
 *               `emailProviderMode()` never selects it (emailProvider.js:39).
 *   EmailJS   — the browser SDK is imported and `init()` is called on the
 *               registration page, but nothing ever calls `send()`. No data
 *               reaches them. It is a dependency to delete, not a processor.
 *   OpenAI /  — both packages are in package.json; neither is imported
 *   Gemini      anywhere in src/. No calls, no data.
 */
export const subProcessors = [
  {
    name: "Supabase",
    purpose:
      "The PostgreSQL database, the authentication service, and the object storage holding screen captures and uploaded files.",
    dataReached: "All of it — every category described in sections 2 and 4.",
    status: "In use",
  },
  {
    name: "Vercel",
    purpose:
      "Hosting for the web application and the scheduled daily job. Requests to the site pass through their network.",
    dataReached:
      "Anything in a request or response in transit, plus connection metadata such as IP address in their platform logs.",
    status: "In use",
  },
  {
    name: "Google (Gmail SMTP)",
    purpose:
      "Delivering outbound email — invitations, verification codes and notifications — over authenticated SMTP.",
    dataReached: "Recipient email address, subject and message body of the emails we send.",
    status: "In use",
  },
  {
    name: "Hugging Face",
    purpose:
      "Optional AI task generation. When an administrator asks the product to turn a project requirements document into a task list, the extracted text of that document (up to the first 6,000 characters) is sent to Hugging Face's inference router and passed to a third-party open-weight model.",
    dataReached:
      "The text of the requirements document you chose to process, and nothing else. Never screen captures, keyboard metrics or employee records.",
    status: "In use, only when an administrator triggers it",
  },
  {
    name: "Stripe",
    purpose:
      "Subscription billing through hosted Checkout and the hosted Customer Portal. Card details are entered on Stripe's own pages and never reach our servers.",
    dataReached: "Billing contact and payment details, once billing is switched on.",
    status: "Integrated but not configured — no secret key is set, checkout refuses, no data has been sent",
  },
];

export const meta = {
  kicker: "Privacy",
  title: "Privacy Policy",
  subtitle:
    "What Verisade records, how it records it, who can see it, and what we still have not decided. Written from the source code, not from a template.",
  lastUpdated,
  appliesTo: `Verisade — the web application, the desktop activity agent, and this website`,
};

export const reviewNotice = legalReviewNotice;

export const intro = [
  {
    type: "paragraph",
    text:
      "Verisade does two things. It runs projects — boards, sprints, task review — and, on machines where a desktop agent has been installed, it records what the person using that machine was doing: pictures of their screen, the applications they had open, how much they typed, and whether they were active or idle.",
  },
  {
    type: "paragraph",
    text:
      "The second half is monitoring software pointed at people, so this policy is specific rather than reassuring. It names the exact fields captured, it names the ones that are not, and where the product falls short of what a privacy policy would normally be able to promise, it says so in the same plain words rather than in a footnote.",
  },
  {
    type: "callout",
    tone: "info",
    title: "If you are the person being monitored, read this first",
    text:
      "We count your keystrokes, but we never record what you typed. The number of keys, how many different keys, and your typing speed are stored. The letters themselves are never captured, never transmitted and never stored — anywhere, by anyone, including your employer. Screen captures are a different matter: those are real pictures of your screen, and section 2 explains exactly what that means.",
  },
];

export const sections = [
  // ─────────────────────────────────────────────────────────────────
  {
    id: "who-we-are",
    heading: "Who we are, and which hat we are wearing",
    blocks: [
      {
        type: "paragraph",
        text: `Verisade is operated by ${entity.legalName}, registered at ${entity.registeredAddress}. You can reach us about anything in this policy at ${entity.privacyContactEmail}.`,
      },
      {
        type: "paragraph",
        text:
          "Which data protection role we play depends on whose data it is, and the distinction matters because it decides who you should be talking to:",
      },
      {
        type: "definitions",
        items: [
          {
            term: "Your employer is the controller of your monitoring data",
            text:
              "If your employer uses Verisade, they decide whether you are monitored, on which machines, why, who inside the company may look at the records, and how long they are kept. Those decisions are theirs alone. We hold and display the data on their instructions — we are their processor. If you want your records, want them corrected, or want them deleted, start with your employer. Section 11 explains what to do if that goes nowhere.",
          },
          {
            term: "We are the controller of our own customer data",
            text:
              "For the account and contact details of the person who signs up, billing records, our log of emails we sent, and our server-side error and security events, we decide the purpose ourselves. For that narrow set, we are the controller and we answer to you directly.",
          },
          {
            term: "We are the controller for this website",
            text:
              "The marketing pages and the sign-in flow. There is no analytics script, no advertising pixel and no third-party tracker anywhere on this site — see section 9.",
          },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────
  {
    id: "desktop-agent",
    heading: "What the desktop agent records",
    blocks: [
      {
        type: "paragraph",
        text:
          "None of this exists unless somebody installs the desktop agent on a machine. The web application on its own — the boards, the sprints, the task review — records nothing about how you use your computer. Nothing is captured from a browser, and nothing is captured from a phone.",
      },
      {
        type: "paragraph",
        text:
          "Where the agent is installed and running, it captures the following. This is the complete list, taken from the columns the application actually reads and writes:",
      },
      {
        type: "subheading",
        text: "Screen captures",
      },
      {
        type: "paragraph",
        text:
          "The agent takes an image of the screen and uploads it. Stored with it are the time it was taken, the employee it belongs to, the organisation, the storage path, and a short context note that is normally the name of the application that was active.",
      },
      {
        type: "list",
        items: [
          "The image is the whole screen as it was. It is not blurred, cropped, redacted or filtered, and there is no way to exclude an application from capture.",
          "Whatever was on screen is in the image — a document, a chat window, a personal email, a bank page left open in another window.",
          "Images are limited to 10 MB and are stored as PNG, JPEG or WebP.",
          "How often a capture is taken is a setting inside the desktop agent, which is built and distributed outside this codebase. It is not configurable from the web application and we cannot state the interval here — your employer can.",
        ],
      },
      {
        type: "subheading",
        text: "Applications and window titles",
      },
      {
        type: "paragraph",
        text:
          "For each application used: its display name, the name of the executable file, the title of the window, when it came to the foreground, when it left, and how long it was in use — recorded per switch, not just per day.",
      },
      {
        type: "callout",
        tone: "warning",
        title: "Window titles reveal more than application names do",
        text:
          "The title bar of a document window is usually the document's filename. The title bar of a browser window is usually the title of the page being read. So although this product does not record web addresses, a browser window title can still show which page someone had open. This is the single most under-appreciated field in the whole system, and it is why it is called out here rather than buried in the list above.",
      },
      {
        type: "subheading",
        text: "Keyboard metrics — counts, never content",
      },
      {
        type: "list",
        items: [
          "Total keystrokes and the number of distinct keys used.",
          "Words per minute and a keyboard activity percentage.",
          "A per-minute summary, and total, active and idle minutes for the period.",
          "An overall activity score.",
        ],
      },
      {
        type: "callout",
        tone: "info",
        title: "Said plainly, both halves",
        text:
          "We count keystrokes but we never record what you typed. There is no keylogger in this product. No column stores key content, no endpoint accepts it, and nothing in the interface could display it. What is stored is how much someone typed and how fast — not a single character of what.",
      },
      {
        type: "subheading",
        text: "Active or idle",
      },
      {
        type: "paragraph",
        text:
          "Mouse and keyboard input are sampled to work out whether the person was using the machine. What is stored is a status — active or idle — and a percentage for each. Cursor coordinates are not stored, mouse clicks are not counted, and there is no record of what was clicked on.",
      },
      {
        type: "subheading",
        text: "Sessions and sign-ins",
      },
      {
        type: "paragraph",
        text:
          "When a tracked session started and ended, its total, active and idle duration, its status, and a productivity score the system calculates from that activity. Separately, the time of each sign-in.",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────
  {
    id: "not-recorded",
    heading: "What the desktop agent does not record",
    blocks: [
      {
        type: "paragraph",
        text:
          "These are not policy promises we could quietly change. They are absences in the software, and each was checked against the code:",
      },
      {
        type: "list",
        items: [
          "Keystroke content. No characters, no words, no passwords, no messages. Only counts and rates.",
          "Websites and web addresses. There is no browsing history in this product. Browsers appear in the application list by their name, exactly like any other program, and the figure the dashboard labels as browser time is worked out by matching application names against a short list of known browser executables — not by reading anything from the browser itself.",
          "Cursor position and mouse clicks.",
          "Camera, microphone, location, files on disk, clipboard contents, or the content of email and chat other than as it appears in a screen capture.",
          "Anything on a device without the agent installed, and anything at all while the agent is not running.",
        ],
      },
      {
        type: "callout",
        tone: "plain",
        title: "Two pieces of unused plumbing, disclosed for completeness",
        text:
          "The database contains a table named `browser_usage`, which sounds as though it stores browsing history. It does not: no code in this product reads from it or writes to it, and no part of the system can populate it. Separately, an endpoint named `track-activity` accepts batches of activity from the desktop agent, validates them, and then deliberately stores nothing, because the table it was written for has never existed. Both are mentioned because someone auditing the schema will find them and reasonably want an explanation.",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────
  {
    id: "other-data",
    heading: "The other data the product holds",
    blocks: [
      {
        type: "definitions",
        items: [
          {
            term: "Account and identity",
            text:
              "Name, work email address, phone number, job title, department, team, role, and whether the account is active. For an organisation: company name, industry, size, country and timezone.",
          },
          {
            term: "Employee records",
            text:
              "Where an employer fills them in: job title, phone, address, skills, employment type and status, joining date, work schedule, photo, biography, and who the person reports to. There is no salary field anywhere in this product.",
          },
          {
            term: "Work product",
            text:
              "Projects, tasks, comments, time logs, sprint and epic data, and the files an employee uploads as proof of completed work — together with review decisions, approval reasons and rejection reasons.",
          },
          {
            term: "Client portal data",
            text:
              "For clients an organisation invites: name, email, company and phone, the projects they are linked to, their approvals and comments, and their support and invoice threads.",
          },
          {
            term: "Invitations",
            text:
              "The email address invited, the role offered, a single-use token, and an expiry seven days out.",
          },
          {
            term: "Notifications and email delivery records",
            text:
              "In-app notifications, and one row per outbound email recording the recipient, subject, template, provider, the provider's message id, whether it sent, and any error. Error text is redacted before it is stored.",
          },
          {
            term: "Server-side events",
            text:
              "A durable record of server-side failures and security-relevant events — a rejected sign-in token, a blocked suspended account, a failed scheduled job. These carry opaque identifiers and short status codes only: request bodies, tokens, passwords and payment payloads are filtered out before anything is written.",
          },
          {
            term: "Billing",
            text:
              "Plan, subscription status, period dates and invoice records, once billing is switched on. Card numbers are entered on Stripe's own pages and never reach us.",
          },
        ],
      },
      {
        type: "callout",
        tone: "plain",
        title: "What we do not collect at the web layer",
        text:
          "The application does not record your IP address or browser user-agent against your activity. Two columns exist for that purpose in an old table, and nothing in the product ever writes to them. Our hosting and database providers do keep their own connection logs, which necessarily include IP addresses — that is infrastructure logging, outside our application, and covered by their terms.",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────
  {
    id: "how-we-collect",
    heading: "How the data reaches us",
    blocks: [
      {
        type: "list",
        items: [
          "From the desktop agent, which posts screen captures and activity records to our ingest endpoints. The employee identifier in the request is checked against a real record, and the organisation is worked out on our side from that record rather than taken from the request.",
          "From the web application, when someone signs in, creates a project, edits a profile, submits work or invites a colleague.",
          "From your employer, when they set up the organisation and add people to it.",
          "From Stripe, when billing is enabled and a subscription changes.",
          "We do not buy data, we do not enrich it from third-party sources, and we do not receive it from data brokers.",
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────
  {
    id: "why-we-process",
    heading: "Why we process it, and the lawful basis",
    blocks: [
      {
        type: "paragraph",
        text:
          "For everything an employer records about their own staff, the employer chooses the lawful basis and has to be able to justify it. We cannot choose it for them and this policy does not purport to. In practice it is usually the employer's legitimate interests or the performance of the employment contract; in some countries consent, a works council agreement, or a completed impact assessment is required first, and consent freely given is hard to establish between an employer and an employee.",
      },
      {
        type: "paragraph",
        text: "For the data where we are the controller, our own bases are:",
      },
      {
        type: "table",
        columns: ["What we process", "Why", "Lawful basis"],
        rows: [
          [
            "Account and contact details of the signing-up administrator",
            "To create and operate the account they asked for",
            "Performance of a contract",
          ],
          [
            "Billing and subscription records",
            "To charge for the service and keep financial records",
            "Contract, and legal obligation for record-keeping",
          ],
          [
            "Email delivery log",
            "To answer “we never received the invitation” with evidence rather than a shrug",
            "Legitimate interests — operating a service that can be supported",
          ],
          [
            "Server-side error and security events",
            "To detect failures and abuse, and to investigate incidents",
            "Legitimate interests — keeping the service secure and working",
          ],
          [
            "Service email to administrators",
            "Invitations, verification codes and notifications they asked for",
            "Performance of a contract",
          ],
        ],
      },
      {
        type: "paragraph",
        text:
          "We do not use anyone's data for advertising, we do not sell or rent it, we do not share it with data brokers, and we do not use employee monitoring data to train machine learning models — ours or anyone else's.",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────
  {
    id: "who-can-see-it",
    heading: "Who can see it",
    blocks: [
      {
        type: "list",
        items: [
          "Owners and administrators of an organisation can see the full activity dashboard for everyone in that organisation, including screen captures.",
          "An individual employee sees their own sessions, screen captures and metrics through their own screens.",
          "Clients invited into the client portal are denied access to every monitoring table by a database policy. They never see employee emails, employment records, productivity data or activity tracking.",
          "No customer can reach another customer's data. Every table carries an organisation identifier, and the database compares it against a claim inside the caller's signed session token on every single query.",
          "On our side, access is limited to the people who need it to operate the service.",
        ],
      },
      {
        type: "callout",
        tone: "warning",
        title: "Precisely where each of those limits is enforced",
        text:
          "Two of the rules above are enforced by the database itself and hold even if the interface has a bug: separation between organisations, and the exclusion of client-portal accounts from monitoring data. The third — that an ordinary employee sees only their own records — is applied by the application screens and the API, not by the database rule underneath them, which grants read access to monitoring records to staff accounts in the organisation generally. We state this precisely rather than rounding it up, because “only you can see your own data” would be a stronger claim than the code currently supports. Narrowing that database rule is in the open items at the end of this policy.",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────
  {
    id: "sub-processors",
    heading: "Sub-processors and other third parties",
    blocks: [
      {
        type: "paragraph",
        text:
          "We use the following third parties, and only these. Each entry was confirmed by finding the code that actually calls the service — providers whose API keys exist in the configuration but which nothing ever calls are deliberately absent from this table.",
      },
      {
        type: "table",
        columns: ["Provider", "What it does", "What it can reach", "Status"],
        rows: subProcessors.map((p) => [p.name, p.purpose, p.dataReached, p.status]),
      },
      {
        type: "callout",
        tone: "warning",
        title: "The AI feature sends your document text to a third party",
        text:
          "When an administrator uses “generate tasks from a requirements document”, the text extracted from that document — up to the first 6,000 characters — is sent to Hugging Face's inference router and processed by an open-weight model hosted there. If your requirements documents contain client names, personal data or anything confidential, that content leaves our infrastructure. The feature only runs when an administrator explicitly triggers it, and it never touches screen captures, keyboard metrics or employee records. If you do not want document text sent off-platform, do not use it.",
      },
      {
        type: "paragraph",
        text:
          "We also disclose data where we are legally compelled to, and in the event of a merger or acquisition — in which case the acquirer is bound by this policy until it is properly replaced and everyone affected has been told.",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────
  {
    id: "cookies",
    heading: "Cookies and browser storage",
    blocks: [
      {
        type: "paragraph",
        text:
          "This site runs no analytics, no advertising pixels, no session-replay tooling and no third-party trackers. Fonts are served from our own domain, so loading a page here does not tell anyone else that you visited.",
      },
      {
        type: "definitions",
        items: [
          {
            term: "dt_session — strictly necessary",
            text:
              "One cookie, set after you sign in. It is signed so it cannot be forged, marked HttpOnly so scripts cannot read it, restricted with SameSite=Lax, sent only over HTTPS in production, and it expires after twelve hours. It exists to keep you signed in and to stop someone reaching an area of the app they are not entitled to.",
          },
          {
            term: "Browser storage",
            text:
              "The application keeps your signed-in session and some interface preferences in your browser's own local and session storage. That data stays in your browser and is cleared when you sign out.",
          },
        ],
      },
      {
        type: "paragraph",
        text:
          "Because the only cookie is strictly necessary for a service you asked for, there is no consent banner. If analytics are ever added, this section and that position change together.",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────
  {
    id: "retention",
    heading: "How long it is kept",
    blocks: [
      {
        type: "callout",
        tone: "critical",
        title: "Nothing is deleted automatically. This is the honest answer.",
        text:
          "There is no retention period in this software. No table has an expiry column, no scheduled job removes old records, and the one job that does run daily only sends deadline reminders and creates recurring tasks. Every screen capture, every keystroke count, every application record and every session stays in the database and in object storage until a person deliberately deletes it. A policy that claimed “we keep monitoring data for 90 days” would be describing software that does not exist.",
      },
      {
        type: "paragraph",
        text:
          "For monitoring data, retention is your employer's decision to make and enforce, because they are the controller. If you are an employer using Verisade: pick a period, write it into the notice you give your staff, and put a real mechanism behind it. An indefinite pile of screen captures is a growing liability, and it is the first thing a regulator or a claimant's lawyer will ask about.",
      },
      {
        type: "paragraph",
        text:
          "Deleting data today is a manual operation, and the data model does not make it tidy. Monitoring records carry an organisation identifier with no foreign key back to the organisation, so deleting an organisation does not remove its sessions, keystroke statistics, application usage, screen capture records or sign-in records. Deleting a person's account does not remove their monitoring history. And no code path in the application deletes an object from storage, so removing a screen capture's database row leaves the image file itself in the bucket. Doing it properly means a deliberate sequence across both the database and object storage.",
      },
      {
        type: "callout",
        tone: "warning",
        title: "Retention periods to be set",
        text: `${TBD}: a retention period for monitoring data (screen captures, keyboard metrics, application usage, sessions, sign-ins); a retention period for account and employee records after an account closes; a retention period for the email delivery log and the server-side event log; and the backup retention period, after which deleted data is genuinely gone. Then build the mechanism that enforces each one — a period written in a policy and enforced by nothing is a statement that will not survive contact with an audit.`,
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────
  {
    id: "your-rights",
    heading: "Your rights over your data",
    blocks: [
      {
        type: "paragraph",
        text:
          "Depending on where you live, you may have some or all of the rights below. We will honour them wherever we can, whether or not your jurisdiction compels us to.",
      },
      {
        type: "definitions",
        items: [
          {
            term: "Access — see what is held about you",
            text:
              "Including the screen captures. An administrator can pull an individual's full activity history for any date range from the dashboard.",
          },
          {
            term: "Rectification — have wrong data corrected",
            text:
              "Profile and employment records are directly editable. If activity has been attributed to the wrong person, say so and it can be corrected.",
          },
          {
            term: "Erasure — have data deleted",
            text:
              "Subject to what your employer is legally entitled to keep. Read section 10 first: deletion here is real, but it is manual, and you are entitled to a straight answer about what was actually removed.",
          },
          {
            term: "Portability — get a machine-readable copy",
            text:
              "Every report tab exports to CSV, which is a portable format. Screen capture images can be downloaded individually.",
          },
          {
            term: "Objection — say no to a particular use",
            text:
              "Especially to monitoring itself, or to a specific part of it. An objection has to be considered on its merits and answered, not filed.",
          },
          {
            term: "Restriction — have processing paused while a dispute is resolved",
            text:
              "For example while you contest the accuracy of a record being used in a performance decision.",
          },
          {
            term: "Not to be subject to a purely automated decision",
            text:
              "The product calculates a productivity score and awards or deducts productivity points automatically. It does not itself make any decision about a person — but if your employer uses those numbers to decide something that affects you, you are entitled to human review, to see the records relied on, and to put your side first.",
          },
        ],
      },
      {
        type: "subheading",
        text: "How to exercise them",
      },
      {
        type: "list",
        ordered: true,
        items: [
          "If you are someone's employee: ask your employer. They are the controller and they hold the decision. We cannot hand over their employees' records to a requester without their instruction, and you would not want a vendor that would.",
          `If you are a Verisade customer, or your employer has not responded: write to ${entity.privacyContactEmail}. We will acknowledge within five working days and respond substantively within thirty days, and we will tell you if we need longer and why.`,
          `If you are not satisfied, you can complain to your local data protection authority. ${entity.supervisoryAuthority}.`,
        ],
      },
      {
        type: "paragraph",
        text:
          "Exercising any of these rights is not a disciplinary matter and must never be treated as one.",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────
  {
    id: "security",
    heading: "How the data is protected",
    blocks: [
      {
        type: "paragraph",
        text:
          "Only measures that exist in the product today are listed. Nothing here is planned, partial or aspirational.",
      },
      {
        type: "list",
        items: [
          "Separation between customers is enforced by the database, not by application code remembering to filter: every table carries an organisation identifier that PostgreSQL row-level security checks against a claim inside your signed session token on every query.",
          "Screen captures are written to a private storage bucket keyed by organisation. They have no durable public address; the dashboard renders each one through a signed link that stops working ten minutes after it is created.",
          "Client-portal accounts are denied access to every monitoring table by a database policy rather than by hiding a menu item.",
          "Every protected API call verifies the caller's token on the server and re-checks their membership, so suspending or offboarding someone cuts off access on their very next request instead of whenever their token would have expired.",
          "Navigation is gated by a signed, HttpOnly session cookie issued only after the identity token has been validated server-side. It cannot be forged from the browser.",
          "HTTPS is enforced by HSTS for two years including subdomains, framing is denied, MIME sniffing is blocked, referrers are trimmed, and camera, microphone, geolocation, payment and USB access are switched off at the browser level. A Content Security Policy is deployed in report-only mode and is not yet enforcing.",
          "The email delivery log, the project activity feed and the server-side event log have no update or delete rule at all, so a signed-in session cannot rewrite or erase them.",
          "The endpoints that receive data from the desktop agent cap payload size, accept only known fields, and derive the organisation from the employee record on the server rather than trusting the request.",
          "Sensitive values are filtered out of logs before they are written: tokens, passwords, API keys and payment payloads are never recorded.",
          "Encryption in transit is enforced. Encryption at rest for the database and object storage is provided by our hosting provider under their platform controls — it is their control, and we describe it as reliance rather than as something this application implements.",
        ],
      },
      {
        type: "subheading",
        text: "Two weaknesses we are not going to hide",
      },
      {
        type: "callout",
        tone: "critical",
        title: "Account passwords are currently stored in plain text",
        text:
          "Signing in runs through a managed authentication service that stores a properly hashed password. Separately, and left over from an older login path, the product also writes an unencrypted copy of the password into the staff, administrator and client profile tables, and the change-password endpoint reads and rewrites that plain-text copy. That is a defect, not a design. It means anyone with database-level read access — or a leaked backup — obtains usable passwords, and because people reuse passwords the damage would not stop at this product. We are stating it rather than writing the sentence a template would supply, because “your password is encrypted” would be false. Until it is fixed, treat your Verisade password as a password you must not use anywhere else.",
      },
      {
        type: "callout",
        tone: "warning",
        title: "Screen captures taken before the storage change",
        text:
          "Screen captures created before the private bucket was introduced still live in a publicly readable bucket and are still displayed from their stored public address. Anyone holding one of those addresses can open the image without signing in. Captures taken since the change are unaffected. Moving the remaining objects is a one-off migration and it has not been completed.",
      },
      {
        type: "paragraph",
        text: `Found a security problem? Write to ${entity.securityContactEmail}. We will not pursue anyone who reports a vulnerability to us in good faith and gives us a reasonable chance to fix it.`,
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────
  {
    id: "breach",
    heading: "If something goes wrong",
    blocks: [
      {
        type: "paragraph",
        text:
          "If personal data we hold is exposed, lost or accessed without authorisation, we will notify the affected customer without undue delay and in any event within 48 hours of becoming aware of it, so that they can meet their own reporting deadlines. We will say what happened, what data and roughly how many people are affected — stated specifically where screen captures are involved, because that is a far more intrusive exposure than a table of counts — what we are doing about it, and who to talk to.",
      },
      {
        type: "callout",
        tone: "warning",
        title: "The detection side of that commitment",
        text: `The product keeps a durable server-side event log and an email delivery log, which are the raw material for spotting an incident. There is no alerting, no on-call rotation and no written incident response procedure. ${TBD}: define how anyone becomes aware in the first place, who is notified, and who is authorised to send the customer notification.`,
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────
  {
    id: "transfers",
    heading: "International transfers",
    blocks: [
      {
        type: "paragraph",
        text: `Data is stored in the hosting region configured for our database and object storage: ${entity.hostingRegion}. Our providers — Supabase, Vercel, Google and Hugging Face — operate global infrastructure, so data may be processed in other countries.`,
      },
      {
        type: "paragraph",
        text:
          "Where a transfer leaves a jurisdiction that restricts them, it must be covered by an approved mechanism such as an adequacy decision or the Standard Contractual Clauses together with a transfer impact assessment.",
      },
      {
        type: "callout",
        tone: "warning",
        title: "Transfer mechanism not yet in place",
        text: `${TBD}: confirm the hosting region, identify which provider transfers actually cross a restricted border, and put the appropriate Standard Contractual Clauses in place. Naming a mechanism in a policy does not create it, so this section describes the position honestly rather than asserting a safeguard that has not been executed.`,
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────
  {
    id: "children",
    heading: "Children",
    blocks: [
      {
        type: "paragraph",
        text:
          "Verisade is workplace software sold to organisations. It is not directed at children, it is not offered to individuals under 16, and accounts are created only by an employer for a member of their workforce.",
      },
      {
        type: "paragraph",
        text:
          "We do not knowingly collect data from a child. Employers should note that where a jurisdiction permits the employment of people under 18, monitoring a minor typically attracts a higher standard of justification. If you believe a child's data has reached us, write to us and we will delete it.",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────
  {
    id: "changes",
    heading: "Changes to this policy",
    blocks: [
      {
        type: "paragraph",
        text:
          "When this policy changes we update the date at the top. If a change materially affects what is collected, who can see it, how long it is kept, or which third parties receive it, we will tell account administrators by email before it takes effect and give them a reasonable period to object or to leave.",
      },
      {
        type: "paragraph",
        text:
          "A new category of monitoring — anything the desktop agent does not capture today — will always be announced in advance. It will never be introduced quietly through a version bump.",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────
  {
    id: "contact",
    heading: "Contact",
    blocks: [
      {
        type: "definitions",
        items: [
          { term: "Privacy questions and rights requests", text: entity.privacyContactEmail },
          { term: "Security reports", text: entity.securityContactEmail },
          { term: "Data protection officer or representative", text: entity.dataProtectionContact },
          { term: "Postal address", text: entity.registeredAddress },
          { term: "Supervisory authority", text: entity.supervisoryAuthority },
        ],
      },
      {
        type: "paragraph",
        text:
          "If you are an employee whose employer uses Verisade and you cannot get a straight answer from them, you may still write to us. We cannot hand over their records without their instruction, but we will tell you truthfully what the software does and does not capture, and we will point you at the notice they should have given you.",
      },
    ],
  },
];

export const openItems = [
  {
    title: "Company identity: registered legal name, company number, registered address.",
    text:
      "None of this exists anywhere in the codebase, so none of it could be filled in. A privacy notice that does not identify the controller by name and address fails the most basic transparency requirement in nearly every regime.",
  },
  {
    title: "Two monitored contact addresses: privacy and security.",
    text:
      "Not personal inboxes. Every rights request, complaint and vulnerability report in this document routes to them, and a route to nowhere is worse than no route at all.",
  },
  {
    title: "Retention periods — and the mechanism that enforces them.",
    text:
      "Nothing in this system deletes anything on a schedule. Decide: how long screen captures live, how long the other monitoring signals live, how long account and employee records survive an account closing, how long the email and event logs are kept, and how long backups hold data after deletion. Then build it. This is the single largest gap between what this policy has to say and what a buyer will expect it to say.",
  },
  {
    title: "Jurisdiction and supervisory authority.",
    text:
      "Which country's law governs, and which authority a data subject may complain to. This also determines whether parts of this product may lawfully be pointed at employees at all.",
  },
  {
    title: "Confirm the hosting region and execute a transfer mechanism.",
    text:
      "The Supabase project's region is a deployment fact the source code does not record. Until it is confirmed and the Standard Contractual Clauses are in place where they are needed, section 14 describes a gap rather than a safeguard.",
  },
  {
    title: "Remove the plain-text password columns and the code that maintains them.",
    text:
      "Three tables store an unencrypted copy of the password and the change-password endpoint reads and rewrites it. Until that is gone, this policy has to carry the disclosure in section 12, every prospect will read it, and the exposure is real regardless of what the document says. Note also that changing a password through that endpoint updates only the plain-text copy and not the credential the authentication service actually checks.",
  },
  {
    title: "Migrate the screen captures still sitting in the public bucket.",
    text:
      "Those images open for anyone holding the URL, with no sign-in. The remaining count is queryable and the fix is a one-off object migration. Until it is done, the disclosure in section 12 has to stay.",
  },
  {
    title: "Narrow the database rule for monitoring records.",
    text:
      "The rule grants read access to staff accounts across the organisation; the “you see only your own” limit lives in the application layer above it. Until the database rule matches the promise, section 7 has to describe the difference, and the marketing claim that an employee can see “only their own” is stronger than the database supports.",
  },
  {
    title: "Define an incident response process behind the 48-hour commitment.",
    text:
      "There is logging but no alerting, no on-call rotation and no written procedure. The clock in section 13 starts when someone becomes aware — decide how anyone becomes aware.",
  },
  {
    title: "Decide whether the Hugging Face AI feature stays on by default.",
    text:
      "It sends requirements-document text to a third-party inference provider. There is currently no per-organisation switch to disable it. Consider making it opt-in per organisation, so a customer with confidential requirements documents can turn it off rather than having to remember not to click the button.",
  },
  {
    title: "Remove the unused EmailJS dependency, or start disclosing it.",
    text:
      "The browser SDK is imported and initialised on the registration page with a public key, but nothing ever calls it to send. It is left off the sub-processor table because no data reaches them — but a third-party SDK loaded on a page is the kind of thing an auditor finds and asks about. Delete it.",
  },
];

const privacy = { ...meta, reviewNotice, intro, sections, openItems };
export default privacy;

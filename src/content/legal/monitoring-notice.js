/**
 * Employee monitoring notice — a template the CUSTOMER gives to their own staff.
 *
 * WHO THIS IS FOR
 * Not the buyer. The person being monitored. Every sentence here is written to
 * be read by someone who has just been told that software will be taking
 * pictures of their screen, and who wants a straight answer about what that
 * means. No legalese, no "we may collect certain information", no hedging.
 *
 * WHY IT SHIPS WITH THE PRODUCT
 * Telling staff is the customer's legal obligation and in most jurisdictions it
 * has to happen before the first capture. Almost no competitor ships a notice,
 * which leaves every customer to write one from scratch — and a customer who
 * has to write it from scratch usually does not. Making the honest path the
 * easy path is the point.
 *
 * BRACKETED PASSAGES are for the customer to complete. They are deliberately
 * conspicuous: a notice handed out with "[your manager]" still in it is
 * embarrassing, which is exactly the pressure needed to get it filled in.
 *
 * Every factual claim matches the code, and matches the privacy policy in
 * src/content/legal/privacy.js. If one changes, change both.
 */

import { lastUpdated } from "@/content/legal/entity";

const sections = [
  {
    id: "notice-what-this-is",
    heading: "What this is",
    blocks: [
      {
        type: "paragraph",
        text:
          "[Employer name] uses software called Verisade on [which computers — for example, " +
          "company-issued laptops used by the engineering team]. Part of it records what happens on " +
          "those computers while you work.",
      },
      {
        type: "paragraph",
        text:
          "You should know exactly what that means, so this note sets it out. If anything here is " +
          "unclear, or you disagree with it, there is a section at the end about how to raise it.",
      },
    ],
  },

  // Matches src/app/api/upload-screenshot/route.js, DeveloperActivity.jsx:329,
  // src/app/api/keyboard-stats/route.js:59-64, DeveloperActivity.jsx:545/893.
  {
    id: "notice-what-is-recorded",
    heading: "What is recorded",
    blocks: [
      {
        type: "paragraph",
        text: "While the software is running on your work computer, it records five things.",
      },
      {
        type: "definitions",
        items: [
          {
            term: "Pictures of your screen",
            text:
              "The software takes screenshots — actual images of your whole screen, exactly as it " +
              "looked at that moment. If a personal message, a bank page or a private document was " +
              "visible, it is in the picture. Each image is saved with your name, the time, and the " +
              "app you were using. [How often: ask your IT team for the capture interval and write " +
              "it here — people are far more comfortable with a number than with a blank.]",
          },
          {
            term: "Which apps you use, and the title of the window",
            text:
              "The name of each program you use, how long you spend in it, and the title bar of the " +
              "window. Window titles often include the name of the file you have open, or the title " +
              "of the web page you are reading, so this can say more than just “a browser was open”.",
          },
          {
            term: "How much you type — but never what you type",
            text:
              "The software counts your keystrokes: how many keys you pressed, how many different " +
              "keys, and your words per minute. It does not record the words. Nothing you type is " +
              "captured, stored or sent anywhere — not your messages, not your passwords, not your " +
              "documents. The software has nowhere to put them. It counts, it does not read.",
          },
          {
            term: "Whether you were active or idle",
            text:
              "Your keyboard and mouse are watched only to tell whether the computer was being used " +
              "or sitting still. This produces an “active” and “idle” percentage. Where your mouse " +
              "pointer was, and what you clicked on, are not recorded.",
          },
          {
            term: "Your work sessions and sign-in times",
            text:
              "When a tracked session started and finished, how long it ran, how much of it was " +
              "active, and when you signed in each day.",
          },
        ],
      },
    ],
  },

  // Verified absences — see the privacy policy comments for the checks.
  {
    id: "notice-what-is-not-recorded",
    heading: "What is not recorded",
    blocks: [
      {
        type: "paragraph",
        text:
          "This list matters as much as the one above. These things are not captured — not " +
          "because someone promised not to look, but because the software has no ability to do it.",
      },
      {
        type: "list",
        items: [
          "The websites you visit. Web addresses are never recorded. A browser shows up the same way " +
            "any other program does — by its name. (Window titles can still show the title of a page " +
            "you have open, so it is not total invisibility.)",
          "What you type. Only how many keys you pressed and how fast.",
          "Your mouse clicks, or where your cursor was.",
          "Your camera, your microphone, or any audio or video.",
          "Your location.",
          "Anything on a computer that does not have the software installed. Your own phone and your " +
            "own laptop are not touched by this.",
          "Anything at all when the software is not running.",
        ],
      },
    ],
  },

  {
    id: "notice-who-sees-it",
    heading: "Who can see it",
    blocks: [
      {
        type: "list",
        items: [
          "[Names or roles — for example: the owner and the two IT administrators] can see the full " +
            "activity dashboard for anyone in the organisation, including your screenshots.",
          "You can see your own sessions, your own screenshots and your own keyboard statistics, " +
            "through the app.",
          "Clients and external contacts who use the client portal cannot see any of it. They are " +
            "blocked from it by the system itself, not just by hiding a menu.",
          "The company that makes the software stores it and keeps it running. Their staff do not " +
            "look at it except when investigating a fault or a security problem.",
        ],
      },
      {
        type: "paragraph",
        text:
          "Screenshots are kept in private storage. When one is displayed, the link that shows it " +
          "stops working ten minutes later, so a copied link cannot be passed around.",
      },
    ],
  },

  {
    id: "notice-why",
    heading: "Why we are doing this",
    blocks: [
      {
        type: "paragraph",
        text:
          "[Say why, specifically and honestly. “To improve productivity” tells nobody anything and " +
          "reads as evasive. Something like “to give accurate hours to clients we bill hourly”, or " +
          "“a contract with a customer requires it”, is a real reason people can weigh. If you " +
          "cannot write a specific reason down, that is worth noticing before you deploy this.]",
      },
      {
        type: "paragraph",
        text:
          "[State what the data will and will not be used for. For example: whether it is reviewed " +
          "routinely or only when there is a specific concern, and whether it feeds into performance " +
          "reviews, pay or disciplinary decisions. Being clear here prevents most of the anxiety " +
          "this software otherwise creates.]",
      },
    ],
  },

  {
    id: "notice-how-long",
    heading: "How long it is kept",
    blocks: [
      {
        type: "paragraph",
        text:
          "[State the period — for example: “screenshots are deleted after 30 days; activity " +
          "statistics are kept for 12 months”.]",
      },
      {
        type: "callout",
        tone: "warning",
        title: "Before you hand this out",
        text:
          "The software does not delete anything on its own today. There is no automatic expiry, and " +
          "deleting someone's account does not remove their screenshots. If you state a retention " +
          "period in this notice, you are committing to something the software will not do for you — " +
          "someone has to actually do it. Either put that process in place first, or tell your staff " +
          "the truth about how long the data currently stays.",
      },
    ],
  },

  {
    id: "notice-turning-it-off",
    heading: "Can it be turned off?",
    blocks: [
      {
        type: "paragraph",
        text:
          "Not from inside the app. There is no pause button and no per-person opt-out. The software " +
          "records whenever it is running on that computer, and stops when it is not.",
      },
      {
        type: "paragraph",
        text:
          "In practice this means: [set out your own rules — for example, whether staff may close " +
          "the agent during breaks, whether it should be closed before doing anything personal, and " +
          "whether it runs outside working hours. If it runs during unpaid breaks, say so; people " +
          "will find out either way, and finding out on their own is much worse.]",
      },
      {
        type: "paragraph",
        text:
          "If you need to do something private, do it on your own device rather than on the " +
          "monitored computer. That is the honest advice, and it is better than discovering the " +
          "boundary afterwards.",
      },
    ],
  },

  {
    id: "notice-your-rights",
    heading: "Your rights",
    blocks: [
      {
        type: "list",
        items: [
          "You can ask to see what has been recorded about you, including your screenshots. Much of " +
            "it you can already view yourself in the app.",
          "You can ask for information about you to be corrected if it is wrong.",
          "You can ask for your data to be deleted, and we will consider it against any reason we " +
            "have to keep it.",
          "You can ask for a copy of your data in a form you can take elsewhere.",
          "You can object to being monitored, and ask us to explain the grounds we are relying on.",
          "You can complain to [the relevant data protection authority] if you are not satisfied " +
            "with how we handle your request.",
        ],
      },
      {
        type: "paragraph",
        text:
          "Asking any of these will not be held against you. [Confirm this in your own words, and " +
          "mean it.]",
      },
    ],
  },

  {
    id: "notice-raise-a-concern",
    heading: "How to raise a concern",
    blocks: [
      {
        type: "paragraph",
        text:
          "If you are uncomfortable with any of this, or you think something is being recorded that " +
          "should not be, say so. You can:",
      },
      {
        type: "list",
        items: [
          "Speak to [name and role — the person who actually owns this, not a generic inbox].",
          "Email [address], if you would rather have it in writing.",
          "Raise it through [employee representative, works council, union, or HR contact], if you " +
            "would rather not raise it directly.",
        ],
      },
      {
        type: "paragraph",
        text:
          "You will get a response within [number] working days. If you think something has gone " +
          "wrong with your data — a screenshot that captured something it should not have, or " +
          "someone seeing data they should not — report it straight away to [address] so it can be " +
          "dealt with quickly.",
      },
    ],
  },

  {
    id: "notice-acknowledgement",
    heading: "Acknowledgement",
    blocks: [
      {
        type: "paragraph",
        text:
          "[Optional. If you ask staff to sign, keep the wording as an acknowledgement that they " +
          "have read and understood this notice — not as consent to be monitored. In many places an " +
          "employee cannot freely refuse an employer, so a signature is not valid consent and " +
          "treating it as such can undermine the legal basis you are actually relying on. Take " +
          "advice on this specific point.]",
      },
      {
        type: "paragraph",
        text:
          "I confirm that I have read and understood this notice, and that I have had the chance to " +
          "ask questions about it.",
      },
      {
        type: "paragraph",
        text: "Name: ………………………………    Signature: ………………………………    Date: …………………",
      },
    ],
  },
];

export const monitoringNotice = {
  kicker: "Template",
  title: "Notice to employees: what this software records",
  subtitle:
    "A plain-language notice for you to adapt and give to the people you monitor. Written to be " +
    "read by them, not by a lawyer. Passages in [square brackets] need your own answers.",
  lastUpdated,
  intro: [
    {
      type: "callout",
      tone: "info",
      title: "How to use this",
      text:
        "Copy it, fill in every bracketed passage, put it on your own letterhead, and give it to " +
        "each affected person before the software is installed — not after. Keep a record of when " +
        "you handed it out and to whom. Delete this box before sending.",
    },
  ],
  sections,
};

export default monitoringNotice;

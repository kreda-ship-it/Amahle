import type { OpeningHours } from "./organization";
import { describeDays, formatTime, groupHours } from "./hours";

/**
 * The salon's policies, as words on a page.
 *
 * Why this is a file of prose rather than rows in a table: it is a legal
 * statement the owner signs off on, it changes perhaps twice a year, and
 * nothing in the application queries it. DECISIONS #11 — a config file for
 * one salon, a CMS when the third salon asks to edit their own. Keeping it
 * here also means a change to what the salon promises its customers arrives
 * as a diff somebody can read, which is the right amount of ceremony for
 * this particular kind of text.
 *
 * WHAT IT IS NOT: a hardcoded page about Kedus. Every salon-specific fact —
 * the name, the phone number, the hours — arrives in `SalonFacts` from
 * `getOrganization()`, and a fact the salon has not filled in yet drops its
 * sentence rather than printing a gap. The wording is what any braiding
 * salon would say; the details are what this one says.
 *
 * Deliberately absent: deposits, cancellation fees, and anything else that
 * implies money moves before the appointment. v1 takes no payment (DECISIONS
 * #12), and a policy promising a deposit that nothing collects is a policy
 * that teaches customers to skim the rest.
 */

/**
 * Written by hand, not from the file's modification date.
 *
 * A "last updated" line is a promise that somebody reviewed the text on that
 * day. A build date would move every time the site deploys and quietly turn
 * that promise into a lie.
 */
export const POLICIES_UPDATED = "August 2026";

/** The salon's own details, so the wording below never names one. */
export type SalonFacts = {
  name: string;
  phone: string | null;
  /** The number for sending a photograph of a style. */
  textNumber: string | null;
  hours: OpeningHours[];
};

/** One rule: a short heading, then a paragraph or two. */
export type PolicyItem = {
  heading: string;
  body: string[];
};

/** A run of related rules, with an anchor so it can be linked to directly. */
export type PolicyGroup = {
  /** Used as the element id, so /policies#information works. */
  id: string;
  title: string;
  intro?: string;
  items: PolicyItem[];
};

/**
 * "Monday – Saturday, 9:00 am – 5:30 pm", or null when the salon has not
 * filled its hours in.
 *
 * Only the first group is printed. A salon whose Saturday differs gets
 * "Monday – Friday, …" here and the full seven days on the Visit page, which
 * is the page somebody opens with that exact question.
 */
function openingLine(hours: OpeningHours[]): string | null {
  const [first] = groupHours(hours);

  if (!first || first.length === 0) return null;

  const day = first[0]!;

  return `${describeDays(first)}, ${formatTime(day.open)} – ${formatTime(day.close)}`;
}

/**
 * The handful of rules somebody needs BEFORE they press the button, as
 * against the page they can read afterwards.
 *
 * Five lines, and they were chosen by asking which rules cost somebody
 * something if they meet them for the first time in the chair. Cancellation
 * notice is not here: it matters later and it is on the confirmation. Coming
 * with unwashed hair, or not mentioning a scalp condition, is a wasted
 * appointment or a hurt customer, and it is too late to say so on the day.
 *
 * These are a summary and they say so on the page. The wording that governs
 * is in `policyGroups` — which is why this list stays short enough that
 * somebody actually reads it rather than becoming a second copy of the page
 * that drifts out of step with the first.
 */
export function bookingEssentials(salon: SalonFacts): string[] {
  const photoNumber = salon.textNumber ?? salon.phone;

  return [
    "Come with clean, detangled hair. If you would like it washed here, add the wash when you choose your service — it needs time set aside.",

    photoNumber
      ? `Text a clear photo of the style you want to ${photoNumber}, so we agree on size and length before the day rather than in the chair.`
      : "Bring a clear photo of the style you want, so we agree on size and length before we start.",

    "There is a twenty-minute grace period. After that we may have to shorten the service or move you to another day.",

    "Nothing is charged now and there is no deposit. Cash is preferred on the day; tips are cash only.",

    "Tell us below about any allergy, sensitivity or scalp condition. It is the one thing we cannot work around if we hear it too late.",
  ];
}

/**
 * Every policy the salon publishes, in the order a customer needs them:
 * booking first, because that is why they are on this page, and the legal
 * material last, because nobody arrives wanting to read it.
 */
export function policyGroups(salon: SalonFacts): PolicyGroup[] {
  const reachUs = salon.phone
    ? `call or text us on ${salon.phone}`
    : "call the salon";

  const photoNumber = salon.textNumber ?? salon.phone;
  const opening = openingLine(salon.hours);

  return [
    {
      id: "booking",
      title: "Booking with us",
      intro:
        "Booking an appointment — online, or over the phone — means you agree to what is on this page.",
      items: [
        {
          heading: "What booking online does",
          body: [
            `It holds a time with a named stylist and shows you a confirmation with a reference number. Nothing is charged: ${salon.name} takes no payment online and asks for no deposit. You pay at the salon on the day.`,
          ],
        },
        {
          heading: "Arriving on time",
          body: [
            "There is a twenty-minute grace period. After that we may have to shorten your service or move you to another day, because somebody else is booked into that chair behind you.",
            "If you know you are running late, tell us as early as you can and we will do what we can with the time left.",
          ],
        },
        {
          heading: "Changing or cancelling",
          body: [
            `Give us as much notice as you can, and at least 48 hours where that is possible — ${reachUs}. A braiding appointment is several hours of one stylist's day, and a late cancellation is a day we cannot fill.`,
            "No fee is charged for cancelling. If appointments are missed repeatedly with no word, we may ask you to book by phone in future rather than online.",
          ],
        },
        {
          heading: "If we have to change your appointment",
          body: [
            "Illness and emergencies happen to us too. If we have to move your appointment we will contact you as soon as we know and offer you the earliest time we have.",
          ],
        },
        {
          heading: "Walk-ins",
          body: [
            opening
              ? `Walk-ins are welcome during opening hours — ${opening} — and we fit you in when there is room. Booking ahead is the only way to be sure of a time.`
              : "Walk-ins are welcome and we fit you in when there is room. Booking ahead is the only way to be sure of a time.",
          ],
        },
      ],
    },

    {
      id: "paying",
      title: "Paying",
      items: [
        {
          heading: "How to pay",
          body: [
            "Cash is preferred. Cards are accepted. We do not take Zelle.",
          ],
        },
        {
          heading: "Prices",
          body: [
            "The prices on our services page are starting prices. Extra length, extra thickness, or hair that needs more work before we begin can cost more. We tell you the price before we start, never after we finish.",
          ],
        },
        {
          heading: "Tips",
          body: [
            "Tips are appreciated and are cash only. They cannot be added to a card payment.",
          ],
        },
      ],
    },

    {
      id: "hair",
      title: "Your hair",
      items: [
        {
          heading: "Come with your hair ready",
          body: [
            "Please arrive with clean, detangled hair. Washing and detangling on the day takes time your appointment may not have, and it can cost extra.",
            "If you would like your hair washed, choose it as an add-on when you book. That way the time is set aside for it.",
          ],
        },
        photoNumber
          ? {
              heading: "Send us the style first",
              body: [
                `Text a clear photo of the style you want to ${photoNumber} before your appointment. It is the quickest way for us to agree on size, length and finish, and it saves the conversation happening while you are already in the chair.`,
              ],
            }
          : {
              heading: "Bring the style with you",
              body: [
                "Bring a clear photo of the style you want. It is the quickest way for us to agree on size, length and finish.",
              ],
            },
        {
          heading: "How long it takes",
          body: [
            "It depends entirely on the style. Knotless braids, small sizes and intricate work take considerably longer than the same style done large. The times shown when you book are our honest estimate, not a guarantee.",
          ],
        },
        {
          heading: "Hair you bring yourself",
          body: [
            "Extensions you bring must be clean and tangle-free. If it is not usable we will tell you before we start rather than work with it.",
            "Professional-grade hair is available to buy at the salon if you would rather not source it yourself.",
          ],
        },
        {
          heading: "Tell us about allergies and scalp conditions",
          body: [
            "This one matters more than anything else on this page. Tell us — in the notes box when you book, or in person before we start — about any allergy, sensitivity, scalp condition, medication or previous reaction to braiding hair or products.",
            "We cannot know unless you tell us. If you have reacted to synthetic hair before, say so and we will talk about what to use instead.",
          ],
        },
        {
          heading: "Braiding should not hurt",
          body: [
            "Tension is part of braiding; pain is not. If anything feels too tight, say so while we are working and we will loosen it. It is much easier to fix at the time than afterwards.",
          ],
        },
        {
          heading: "Check your hair before you leave",
          body: [
            "Look at your hair in the mirror and tell us then if something is not what you wanted. We will adjust it on the spot — that is much easier while you are still with us.",
            "Once you have left the salon we cannot guarantee changes, and completed services are not refundable.",
          ],
        },
      ],
    },

    {
      id: "responsibility",
      title: "What we can and cannot promise",
      items: [
        {
          heading: "What we promise",
          body: [
            "We will tell you honestly if a style will not work on your hair, or if it will damage it, rather than take the booking and let you find out.",
          ],
        },
        {
          heading: "What we are not responsible for",
          body: [
            "We are not responsible for reactions to extensions or products you supply yourself, or for reactions arising from something you did not tell us about. Nor for changes to your hair after you leave — how a style is maintained, slept in and taken down affects it as much as how it was installed.",
          ],
        },
        {
          heading: "Your legal rights",
          body: [
            "Nothing on this page removes rights you have under Maryland or United States law.",
          ],
        },
      ],
    },

    {
      id: "information",
      title: "Your information",
      intro:
        "You never make an account with us. Here is exactly what we hold and why.",
      items: [
        {
          heading: "What we ask for",
          body: [
            "Your name, your phone number, and your email address if you choose to give it. Whatever you write in the notes box. What you booked, with which stylist, and when.",
          ],
        },
        {
          heading: "Why we hold it",
          body: [
            "To hold your appointment, to reach you if anything about it changes, and so that the person doing your hair next time knows what was done last time.",
            "Your phone number is how we recognise you. That is why we ask for it and why there is no password to remember.",
          ],
        },
        {
          heading: "Notes about your hair",
          body: [
            "Allergies, sensitivities, what worked and what did not — we keep these as part of your record so they are not lost when a different stylist does your hair. They are treated as confidential and are seen only by the people who need them to do your hair safely.",
          ],
        },
        {
          heading: "Who can see it",
          body: [
            `Our own staff, and each of them only sees what their job requires. Nobody outside ${salon.name} does. We do not sell your details, rent them, or hand them to anyone for marketing.`,
          ],
        },
        {
          heading: "Where it is kept",
          body: [
            "In a hosted database with access controls, not in a notebook at the front desk. We never hold card numbers — no payment is taken through this website.",
          ],
        },
        {
          heading: "How long we keep it",
          body: [
            "We keep your customer record and appointment history while you are a customer, and for a reasonable period afterwards for our own business records. Ask us and we will remove what we are not required to keep.",
          ],
        },
        {
          heading: "Asking us what we hold",
          body: [
            `${reachUs.charAt(0).toUpperCase()}${reachUs.slice(1)} and ask. You can see what we have, correct anything wrong, and ask us to delete it.`,
          ],
        },
        {
          heading: "Booking for someone under 18",
          body: [
            "A parent or guardian should make the booking and give the contact details. We take a child's name so we know who is coming; we do not ask children for their own details.",
          ],
        },
        {
          heading: "This website",
          body: [
            "There is no advertising, no tracking across other sites, and no third-party analytics on these pages. Our host keeps ordinary server logs, as every website host does.",
          ],
        },
      ],
    },

    {
      id: "photos",
      title: "Photographs",
      items: [
        {
          heading: "Pictures of your hair",
          body: [
            "We sometimes photograph a finished style for our gallery and social media. We ask first, every time, and no is a complete answer — it changes nothing about your appointment. Tell us at any point afterwards if you change your mind and we will take it down.",
          ],
        },
      ],
    },
  ];
}

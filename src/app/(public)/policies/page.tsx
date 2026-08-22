import type { Metadata } from "next";

import { getOrganization } from "@/lib/site/organization";
import { policyGroups, POLICIES_UPDATED } from "@/lib/site/policies";

import { BookingCta } from "../booking-cta";
import { PageHeading } from "../page-heading";

/**
 * One page for everything a customer agrees to: how booking works, what to
 * bring, what we do with their phone number.
 *
 * One page rather than a /terms and a /privacy, because the booking form has
 * one line above its button and that line can only point somewhere once. A
 * customer who follows it should land on the rules about their appointment,
 * with the data protection material further down the same page for the
 * smaller number of people who came looking for it.
 *
 * The words all live in /lib/site/policies. This file is layout.
 */

export const metadata: Metadata = {
  title: "Policies",
  description:
    "How booking works, what to bring to your appointment, and what we do with your details.",
};

export default async function PoliciesPage() {
  const org = await getOrganization();

  const groups = policyGroups({
    name: org.name,
    phone: org.phone,
    textNumber: org.content.textNumber,
    hours: org.content.hours,
  });

  return (
    <>
      <PageHeading
        eyebrow="Policies"
        title="Before you book"
        intro="Short version: come with clean hair, tell us about anything on your scalp, give us notice if you cannot make it, and bring cash. The rest is below."
      />

      <div className="shell py-12 lg:grid lg:grid-cols-[14rem_1fr] lg:gap-16 lg:py-16">
        {/*
          A contents list, not a sidebar of links to other pages. On a phone
          it is a row above the text; from `lg` it follows you down beside it,
          because this page is long and somebody who came for one section
          should not have to scroll past four others to find their way back.
        */}
        <nav aria-label="On this page" className="lg:sticky lg:top-32 lg:self-start">
          <h2 className="label text-ink-muted">On this page</h2>

          <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2 lg:flex-col lg:gap-2">
            {groups.map((group) => (
              <li key={group.id}>
                <a
                  href={`#${group.id}`}
                  className="text-sm text-ink-muted transition-colors hover:text-brand"
                >
                  {group.title}
                </a>
              </li>
            ))}
          </ul>

          <p className="mt-8 text-xs text-ink-muted">
            Last updated {POLICIES_UPDATED}
          </p>
        </nav>

        <div className="mt-12 max-w-2xl lg:mt-0">
          {groups.map((group) => (
            /*
              `scroll-mt` keeps a heading clear of the sticky header when it
              is jumped to. Without it the browser scrolls the heading to the
              very top of the window, where the header sits on top of it.
            */
            <section key={group.id} id={group.id} className="mt-16 scroll-mt-28 first:mt-0">
              <h2 className="font-display text-3xl font-light text-balance">
                {group.title}
              </h2>

              {group.intro && (
                <p className="mt-3 leading-relaxed text-ink-muted text-pretty">
                  {group.intro}
                </p>
              )}

              <div className="mt-8 space-y-8">
                {group.items.map((item) => (
                  <div key={item.heading}>
                    <h3 className="label border-b border-brand/30 pb-3 text-ink">
                      {item.heading}
                    </h3>

                    <div className="mt-3 space-y-3">
                      {item.body.map((paragraph, index) => (
                        <p
                          key={index}
                          className="leading-relaxed text-ink-muted text-pretty"
                        >
                          {paragraph}
                        </p>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}

          <p className="mt-16 border-t border-line pt-6 text-sm text-ink-muted text-pretty">
            Anything here you would like explained, or something that does not
            fit your situation?{" "}
            {org.phone ? (
              <a
                href={`tel:${org.phone.replace(/[^\d+]/g, "")}`}
                className="underline underline-offset-4 transition-colors hover:text-brand"
              >
                Call us on {org.phone}
              </a>
            ) : (
              "Give us a ring"
            )}{" "}
            and ask. We would far rather answer it before your appointment than
            after.
          </p>
        </div>
      </div>

      <BookingCta phone={org.phone} />
    </>
  );
}

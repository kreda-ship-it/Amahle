import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { getServiceTree, groupServices } from "@/lib/services/categories";
import { getOrganization } from "@/lib/site/organization";
import { formatDuration, formatPrice } from "@/lib/site/pricing";
import { stockStylePhoto } from "@/lib/site/stock-photos";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { BookingCta } from "../booking-cta";
import { PhoneLink } from "../phone-link";
import { PageHeading } from "../page-heading";

/**
 * The services and pricing page.
 *
 * The whole menu, grouped into the categories the salon chose, in the order it
 * chose. Nothing here is written down in code — add a service in the database
 * and it appears; change its category and it moves.
 *
 * The headings come from `service_categories` rather than the old `category`
 * text column, and that is a correction rather than a refactor: sixty of the
 * eighty-four services carried no text at all and were printed under a
 * heading called "More". See /lib/services/categories.
 *
 * Laid out as a printed price list: a number, a name, what it involves, and
 * the money in a column down the right-hand edge. Somebody on this page is
 * running their eye down that column, so the column is what the layout is
 * built around.
 */

export const metadata: Metadata = {
  title: "Services & Pricing",
  description:
    "Our full list of services, what each one costs, and how long to set aside.",
};

/** One service, as the public page needs it. */
type Service = {
  id: string;
  name: string;
  description: string | null;
  category_id: string | null;
  price: number;
  price_display: string;
  duration_minutes: number;
  is_bookable_online: boolean;
};

export default async function ServicesPage() {
  const org = await getOrganization();
  const supabase = await createSupabaseServerClient();

  /*
   * `buffer_minutes` is absent from this list and cannot be added: it is the
   * cleanup and prep time between clients, and migration 007 never granted it
   * to `anon`. Asking for it would fail rather than leak it, which is the
   * point of column grants.
   *
   * No filter on `is_active` or `deleted_at` — the policy applies both, and
   * filtering by a column would require SELECT privilege on it.
   */
  const { data, error } = await supabase
    .from("services")
    .select(
      "id, name, description, category_id, price, price_display, duration_minutes, is_bookable_online",
    )
    .eq("org_id", org.id)
    .order("display_order");

  const services: Service[] = data ?? [];

  /* Two levels, because the menu has two: Braiding holds no services of its
     own and everything sits under with- or without-extensions. A service
     filed nowhere still belongs on the page, so it falls into "More". */
  const tree = await getServiceTree(org.id);
  const { groups, unfiled } = groupServices(services, tree);

  const sections: { key: string; heading: string; services: Service[] }[] = [];

  for (const group of groups) {
    if (group.direct.length > 0) {
      sections.push({
        key: group.category.id,
        heading: group.category.name,
        services: group.direct,
      });
    }

    for (const section of group.sections) {
      /* A sub-heading printed under its parent rather than beside it —
         "Braiding · With extensions" says what "With extensions" cannot. */
      sections.push({
        key: section.category.id,
        heading: `${group.category.name} · ${section.category.name}`,
        services: section.services,
      });
    }
  }

  if (unfiled.length > 0) {
    sections.push({ key: "more", heading: "More", services: unfiled });
  }

  // True when at least one service says "call us", so the note explaining why
  // only appears on a page that actually needs it.
  const hasCallOnly = services.some((service) => !service.is_bookable_online);

  return (
    <>
      <PageHeading
        eyebrow="Services"
        title="Everything we do, and what it costs"
        intro={
          'Prices marked "from" depend on your hair’s length and condition. ' +
          "If you are not sure which service you need, call us and we will talk " +
          "it through."
        }
      />

      {error ? (
        <p className="shell py-12 text-ink-muted">
          Our price list is briefly unavailable. Please call{" "}
          <PhoneLink phone={org.phone} /> and we will talk it through.
        </p>
      ) : services.length === 0 ? (
        <p className="shell py-12 text-ink-muted">
          Our price list is being updated. Please call{" "}
          <PhoneLink phone={org.phone} /> in the meantime.
        </p>
      ) : (
        sections.map((section) => (
          <section key={section.key} className="shell pt-14">
            <div className="label flex items-baseline justify-between border-b border-brand/30 pb-3 text-ink">
              <h2>{section.heading}</h2>
              <span className="text-ink-muted">From</span>
            </div>

            <ul className="divide-y divide-line">
              {section.services.map((service, index) => {
                const price = formatPrice(
                  service.price,
                  service.price_display,
                  org.currency,
                );
                const duration = formatDuration(service.duration_minutes);
                const thumbnail = stockStylePhoto(service.name);

                const inner = (
                  <>
                    {/*
                      Numbered within its own category rather than straight
                      through all twenty-four. The number is there to help
                      somebody say "the third one down under braids" on the
                      phone, and a run from 1 to 24 does not help with that.
                    */}
                    <span className="label w-5 shrink-0 pt-1 text-ink-muted tabular-nums">
                      {String(index + 1).padStart(2, "0")}
                    </span>

                    {/*
                      Empty alt, on purpose. The photograph is a stand-in
                      chosen by the code, not a picture of this service, and
                      describing it to somebody who cannot see it would be
                      describing a decision we made rather than the salon's
                      work. An empty alt tells a screen reader to skip it.
                    */}
                    <Image
                      src={thumbnail.url}
                      alt=""
                      width={64}
                      height={64}
                      className="size-14 shrink-0 bg-surface-sunk object-cover sm:size-16"
                    />

                    <div className="min-w-0 flex-1">
                      <h3 className="font-display text-xl leading-tight font-normal transition-colors group-hover:text-brand sm:text-2xl">
                        {service.name}
                      </h3>

                      <p className="label mt-1 text-ink-muted">{duration}</p>

                      {service.description && (
                        <p className="mt-2 text-sm leading-relaxed text-ink-muted text-pretty">
                          {service.description}
                        </p>
                      )}

                      {/*
                        DECISIONS #23: a service that cannot be booked online
                        still appears on the price list. is_bookable_online
                        controls the Book button, not visibility.

                        The phone number is the link here rather than the row,
                        because a link inside a link is not valid HTML and
                        browsers resolve it by guessing.
                      */}
                      {!service.is_bookable_online &&
                        (org.phone ? (
                          <a
                            href={`tel:${org.phone.replace(/[^\d+]/g, "")}`}
                            className="label mt-2 inline-block border-b border-brand pb-0.5 text-brand transition-colors hover:border-brand-strong hover:text-brand-strong"
                          >
                            Please call to book
                          </a>
                        ) : (
                          <p className="label mt-2 text-brand">
                            Please call to book
                          </p>
                        ))}
                    </div>

                    {/*
                      A 'hidden' price prints an invitation rather than a
                      number. The number still exists in the database and the
                      salon knows it — this is a presentation choice.
                    */}
                    <div className="shrink-0 pt-0.5 text-right">
                      <span className="font-display text-2xl font-normal whitespace-nowrap tabular-nums sm:text-3xl">
                        {price ?? <span className="label">Ask</span>}
                      </span>
                    </div>
                  </>
                );

                /*
                 * A bookable service is one tap from a time. `s0` is the
                 * booking page's own parameter for "person 0 wants these
                 * services", so this lands on the time picker with the
                 * service already chosen rather than on the menu again.
                 *
                 * A call-only service is not a link at all — the phone
                 * number inside it is.
                 */
                return (
                  <li key={service.id}>
                    {service.is_bookable_online ? (
                      <Link
                        href={`/book?s0=${service.id}`}
                        className="group flex items-start gap-4 py-5"
                      >
                        {inner}
                      </Link>
                    ) : (
                      <div className="flex items-start gap-4 py-5">{inner}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}

      {hasCallOnly && (
        <p className="shell mt-10 py-5 text-sm text-ink-muted text-pretty">
          Some of our longer braiding services are booked by phone rather than
          online, so we can plan the day with you before you come in.
        </p>
      )}


      <BookingCta phone={org.phone} />
    </>
  );
}

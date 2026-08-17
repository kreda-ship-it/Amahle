import type { Metadata } from "next";

import { getOrganization } from "@/lib/site/organization";
import { formatDuration, formatPrice } from "@/lib/site/pricing";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * The services and pricing page.
 *
 * The whole menu, grouped into the categories the salon chose, in the order it
 * chose. Nothing here is written down in code — add a service in the database
 * and it appears; change its category and it moves.
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
  category: string | null;
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
      "id, name, description, category, price, price_display, duration_minutes, is_bookable_online",
    )
    .eq("org_id", org.id)
    .order("display_order");

  const services: Service[] = data ?? [];

  // Group into categories, keeping the salon's chosen order. A service with no
  // category still belongs on the page, so it falls into "More".
  const categories = new Map<string, Service[]>();

  for (const service of services) {
    const category = service.category ?? "More";
    const existing = categories.get(category);

    if (existing) existing.push(service);
    else categories.set(category, [service]);
  }

  // True when at least one service says "call us", so the note explaining why
  // only appears on a page that actually needs it.
  const hasCallOnly = services.some((service) => !service.is_bookable_online);

  return (
    <div className="mx-auto max-w-3xl px-5 py-16">
      <h1 className="font-display text-4xl font-semibold sm:text-5xl">
        Services &amp; Pricing
      </h1>

      <p className="mt-4 text-lg text-ink-muted text-pretty">
        Prices marked &ldquo;from&rdquo; depend on your hair&rsquo;s length and
        condition. If you are not sure which service you need, call us and we
        will talk it through.
      </p>

      {error ? (
        <p className="mt-12 text-ink-muted">
          Our price list is briefly unavailable. Please call{" "}
          {org.phone ?? "the salon"} and we will talk it through.
        </p>
      ) : services.length === 0 ? (
        <p className="mt-12 text-ink-muted">
          Our price list is being updated. Please call{" "}
          {org.phone ?? "the salon"} in the meantime.
        </p>
      ) : (
        <div className="mt-12 space-y-14">
          {[...categories].map(([category, categoryServices]) => (
            <section key={category}>
              <h2 className="font-display text-2xl font-semibold">
                {category}
              </h2>

              <ul className="mt-5 divide-y divide-line border-t border-line">
                {categoryServices.map((service) => {
                  const price = formatPrice(
                    service.price,
                    service.price_display,
                    org.currency,
                  );
                  const duration = formatDuration(service.duration_minutes);

                  return (
                    <li
                      key={service.id}
                      className="flex flex-wrap justify-between gap-x-6 gap-y-2 py-5"
                    >
                      <div className="min-w-56 flex-1">
                        <h3 className="font-medium">{service.name}</h3>

                        {service.description && (
                          <p className="mt-1 text-sm text-ink-muted text-pretty">
                            {service.description}
                          </p>
                        )}

                        {/*
                          DECISIONS #23: a service that cannot be booked online
                          still appears on the price list. is_bookable_online
                          controls the Book button, not visibility.
                        */}
                        {!service.is_bookable_online && (
                          <p className="mt-2 text-sm font-medium text-brand">
                            Please call to book
                          </p>
                        )}
                      </div>

                      <div className="text-right">
                        {/*
                          A 'hidden' price prints an invitation rather than a
                          number. The number still exists in the database and
                          the salon knows it — this is a presentation choice.
                        */}
                        <p className="font-medium whitespace-nowrap">
                          {price ?? "Call for a price"}
                        </p>

                        {duration && (
                          <p className="mt-1 text-sm text-ink-muted whitespace-nowrap">
                            {duration}
                          </p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      {hasCallOnly && (
        <p className="mt-14 rounded-2xl bg-surface-sunk px-6 py-5 text-sm text-ink-muted text-pretty">
          Some of our longer braiding services are booked by phone rather than
          online, so we can plan the day with you before you come in.
        </p>
      )}

      {org.phone && (
        <div className="mt-10">
          <a
            href={`tel:${org.phone.replace(/[^\d+]/g, "")}`}
            className="inline-block rounded-full bg-brand px-6 py-3 font-medium text-white transition-colors hover:bg-brand-strong"
          >
            Call {org.phone}
          </a>
        </div>
      )}
    </div>
  );
}

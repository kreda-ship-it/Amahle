import Image from "next/image";

import { imageUrl } from "@/lib/site/images";
import { getOrganization, type OpeningHours } from "@/lib/site/organization";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * The homepage.
 *
 * Every word on it comes from the database. Nothing here knows it is Kedus —
 * the salon's name, its copy, its opening hours and its service menu are all
 * read at request time, which is what lets the same file serve the next salon
 * without being edited.
 */

/** `09:00` reads as `9:00 am`. The stored value stays 24-hour and sortable. */
function formatTime(value: string): string {
  const [hours, minutes] = value.split(":");
  const hour = Number(hours);

  if (!Number.isInteger(hour)) return value;

  const suffix = hour < 12 ? "am" : "pm";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;

  return `${hour12}:${minutes ?? "00"} ${suffix}`;
}

/**
 * Collapses runs of days that open and close at the same time, so six
 * identical rows print as "Monday – Saturday". Real opening hours are almost
 * always a few blocks rather than seven separate answers, and a salon that
 * genuinely differs every day still gets seven rows.
 */
function groupHours(hours: OpeningHours[]): OpeningHours[][] {
  return hours.reduce<OpeningHours[][]>((groups, entry) => {
    const current = groups.at(-1);
    const previous = current?.at(-1);

    if (
      current &&
      previous &&
      previous.open === entry.open &&
      previous.close === entry.close
    ) {
      current.push(entry);
      return groups;
    }

    groups.push([entry]);
    return groups;
  }, []);
}

function describeDays(group: OpeningHours[]): string {
  if (group.length === 1) return group[0].day;

  return `${group[0].day} – ${group[group.length - 1].day}`;
}

export default async function Home() {
  const org = await getOrganization();
  const supabase = await createSupabaseServerClient();

  /*
   * No filter on `is_active` or `deleted_at`. Row-level security applies both
   * already — `services_select_anon` is `deleted_at is null and is_active` —
   * and filtering by a column also requires SELECT privilege on it, which
   * `anon` deliberately does not have.
   *
   * One consequence worth knowing: a logged-in staff member reads this page
   * through `services_select_member` instead, which shows inactive services
   * too. So an owner may see a slightly fuller menu here than a customer
   * does. Harmless, and it is the same data they can already see in the staff
   * area — but it means the homepage is not what to check when confirming
   * what the public can see. Log out for that.
   */
  const { data: services, error } = await supabase
    .from("services")
    .select("name, category")
    .eq("org_id", org.id)
    .order("display_order");

  // Group into categories, keeping the order the salon chose.
  const categories = new Map<string, string[]>();

  for (const service of services ?? []) {
    const category = service.category ?? "More";
    const existing = categories.get(category);

    if (existing) existing.push(service.name);
    else categories.set(category, [service.name]);
  }

  const hourGroups = groupHours(org.content.hours);
  const heroImage = imageUrl(org.content.heroImagePath);

  return (
    <>
      {/*
        Hero. The photograph sits BESIDE the words, never behind them.

        Text laid over a photograph is the usual way to do this and it goes
        wrong constantly: the contrast depends on whichever part of the image
        happens to be behind each letter, so a photo the salon swaps next month
        can quietly make its own tagline unreadable. Side by side, the words are
        on a plain background and always legible, whatever the photo turns out
        to be. It also means no second white-text version of this section to
        keep in step.

        With no photograph the grid is one column and this is exactly the page
        that existed before — a salon with no photo yet is not a broken salon.
      */}
      <section className="mx-auto max-w-5xl px-5 pt-16 pb-12 sm:pt-24">
        <div
          className={
            heroImage
              ? "grid items-center gap-10 lg:grid-cols-2"
              : "grid gap-10"
          }
        >
          <div>
            {org.content.foundedYear && (
              <p className="text-sm font-medium tracking-widest text-brand uppercase">
                Since {org.content.foundedYear}
              </p>
            )}

            <h1 className="mt-4 font-display text-4xl leading-tight font-semibold text-balance sm:text-6xl">
              {org.name}
            </h1>

            {org.content.tagline && (
              <p className="mt-5 max-w-2xl text-lg text-ink-muted text-pretty sm:text-xl">
                {org.content.tagline}
              </p>
            )}

            {/*
              The call to action is a phone number, not a Book button. Online
              booking arrives in Phase 4; until it does, the phone is how this
              salon genuinely takes bookings, and a button that goes nowhere is
              worse than no button.
            */}
            <div className="mt-8 flex flex-wrap gap-3">
              {org.phone && (
                <a
                  href={`tel:${org.phone.replace(/[^\d+]/g, "")}`}
                  className="rounded-full bg-brand px-6 py-3 font-medium text-white transition-colors hover:bg-brand-strong"
                >
                  Call {org.phone}
                </a>
              )}

              {org.content.textNumber && (
                <a
                  href={`sms:${org.content.textNumber.replace(/[^\d+]/g, "")}`}
                  className="rounded-full border border-brand px-6 py-3 font-medium text-brand transition-colors hover:bg-surface-sunk"
                >
                  Text {org.content.textNumber}
                </a>
              )}
            </div>
          </div>

          {heroImage && (
            /*
             * The fixed aspect ratio is what stops the page jumping as the
             * photo arrives: the space is reserved before the file has
             * downloaded. `fill` lets the image cover that space at whatever
             * dimensions it happens to have, and `sizes` tells the browser it
             * will never need more than half the window's width on a large
             * screen, so a phone downloads a phone-sized file.
             */
            <div className="relative aspect-4/3 overflow-hidden rounded-3xl bg-surface-sunk">
              <Image
                src={heroImage}
                alt={org.content.heroImageAlt ?? org.name}
                fill
                priority
                sizes="(min-width: 1024px) 50vw, 100vw"
                className="object-cover"
              />
            </div>
          )}
        </div>
      </section>

      {/* About */}
      {org.content.about && (
        <section className="mx-auto max-w-5xl px-5 py-12">
          <p className="max-w-3xl text-lg leading-relaxed text-pretty">
            {org.content.about}
          </p>
        </section>
      )}

      {/* Promotion */}
      {org.content.promotion && (
        <section className="mx-auto max-w-5xl px-5 py-4">
          <p className="rounded-2xl bg-surface-sunk px-6 py-5 font-display text-lg">
            {org.content.promotion}
          </p>
        </section>
      )}

      {/* What we do */}
      <section className="mx-auto max-w-5xl px-5 py-12">
        <h2 className="font-display text-3xl font-semibold">What we do</h2>

        {error ? (
          <p className="mt-6 text-ink-muted">
            Our service list is briefly unavailable. Please call us and we will
            talk it through.
          </p>
        ) : categories.size === 0 ? (
          <p className="mt-6 text-ink-muted">
            Our service list is being updated. Please call us in the meantime.
          </p>
        ) : (
          <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[...categories].map(([category, names]) => (
              <div
                key={category}
                className="rounded-2xl border border-line p-6"
              >
                <h3 className="font-display text-xl font-semibold">
                  {category}
                </h3>

                <p className="mt-1 text-sm text-ink-muted">
                  {names.length} {names.length === 1 ? "service" : "services"}
                </p>

                <ul className="mt-4 space-y-1 text-sm">
                  {names.slice(0, 4).map((name) => (
                    <li key={name}>{name}</li>
                  ))}
                </ul>

                {names.length > 4 && (
                  <p className="mt-2 text-sm text-ink-muted">
                    and {names.length - 4} more
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        {/*
          Prices are not shown here on purpose. `price_display` can be exact,
          from, or hidden, and rendering that properly needs the helper written
          for the services page. A wrong price on a homepage is worse than no
          price at all.
        */}
      </section>

      {/* Hours and address */}
      <section className="mx-auto max-w-5xl px-5 py-12">
        <div className="grid gap-10 sm:grid-cols-2">
          {hourGroups.length > 0 && (
            <div>
              <h2 className="font-display text-3xl font-semibold">
                Opening hours
              </h2>

              <dl className="mt-6 space-y-2">
                {hourGroups.map((group) => (
                  <div
                    key={group[0].day}
                    className="flex justify-between gap-4 border-b border-line pb-2 text-sm"
                  >
                    <dt>{describeDays(group)}</dt>
                    <dd className="text-ink-muted">
                      {formatTime(group[0].open)} – {formatTime(group[0].close)}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          {org.address && (
            <div>
              <h2 className="font-display text-3xl font-semibold">Find us</h2>
              <p className="mt-6 text-lg leading-relaxed">{org.address}</p>
            </div>
          )}
        </div>
      </section>
    </>
  );
}

import Image from "next/image";
import Link from "next/link";

import { describeDays, formatTime, groupHours } from "@/lib/site/hours";
import { imageUrl } from "@/lib/site/images";
import { getOrganization } from "@/lib/site/organization";
import { formatDuration, formatPrice } from "@/lib/site/pricing";
import {
  STOCK_WORK_COUNT,
  stockBanner,
  stockLogo,
  stockStylePhoto,
  stockWorkPhoto,
} from "@/lib/site/stock-photos";
import { mapsHref } from "@/lib/site/url";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { BookingCta } from "./booking-cta";
import { PhoneLink } from "./phone-link";

/**
 * The homepage.
 *
 * Every word on it comes from the database. Nothing here knows it is Kedus —
 * the salon's name, its copy, its opening hours and its service menu are all
 * read at request time, which is what lets the same file serve the next salon
 * without being edited.
 *
 * Every band of content is wrapped in `shell` and nothing else. That one
 * class is why the headline, the prices under it and the photographs under
 * those all begin on the same vertical line at every screen width — see the
 * note on it in globals.css.
 */

/** One service, as this page needs it. */
type FeaturedService = {
  id: string;
  name: string;
  category: string | null;
  price: number;
  price_display: string;
  duration_minutes: number;
  is_bookable_online: boolean;
};

/**
 * Which services to print on the front page.
 *
 * The full menu is twenty-four long and belongs on the services page. A front
 * page wants a spread — somebody arriving should see that this salon braids
 * AND colours AND cuts, not the first six things in one category.
 *
 * So: at most two from each category, in the salon's own order, up to six.
 * No cleverness about which two, because the salon already decided that when
 * it set `display_order`.
 */
function featured(services: FeaturedService[], limit = 6): FeaturedService[] {
  const takenPerCategory = new Map<string, number>();
  const chosen: FeaturedService[] = [];

  for (const service of services) {
    if (chosen.length >= limit) break;

    const category = service.category ?? "More";
    const taken = takenPerCategory.get(category) ?? 0;

    if (taken >= 2) continue;

    takenPerCategory.set(category, taken + 1);
    chosen.push(service);
  }

  return chosen;
}

/**
 * Where a service on the price list should take you.
 *
 * `s0` is how the booking page reads "person 0 has chosen these services" out
 * of the URL, so handing it a service id lands on the time picker with that
 * service selected. See the note at the top of book/page.tsx: the URL holds
 * the choices, the database holds the holds.
 */
function bookHref(
  service: { id: string; is_bookable_online: boolean },
  phone: string | null,
): string {
  if (!service.is_bookable_online && phone) {
    return `tel:${phone.replace(/[^\d+]/g, "")}`;
  }

  return `/book?s0=${service.id}`;
}

/**
 * "Silver Spring, MD" from "7851 Eastern Ave, Silver Spring, MD 20910".
 *
 * Everything after the street, with the ZIP dropped — a ZIP code is for a
 * postal service, and the line above a headline is telling somebody roughly
 * where in the world this salon is.
 */
function placeLine(address: string | null): string | null {
  if (!address) return null;

  const parts = address.split(",").map((part) => part.trim());
  if (parts.length < 2) return null;

  const town = parts[1];
  const state = (parts[2] ?? "").split(/\s+/)[0] ?? "";

  return state ? `${town}, ${state}` : (town ?? null);
}

export default async function Home() {
  const org = await getOrganization();
  const supabase = await createSupabaseServerClient();

  /*
   * Three queries at once rather than one after another. They do not depend
   * on each other, so waiting for the first before starting the second would
   * simply make the page slower by the length of the shortest one.
   *
   * No filter on `is_active` or `deleted_at` anywhere below. Row-level
   * security applies both already — `services_select_anon` is
   * `deleted_at is null and is_active` — and filtering by a column also
   * requires SELECT privilege on it, which `anon` deliberately does not have.
   *
   * One consequence worth knowing: a logged-in staff member reads this page
   * through `services_select_member` instead, which shows inactive services
   * too. So an owner may see a slightly fuller menu here than a customer
   * does. Harmless, and it is the same data they can already see in the staff
   * area — but it means the homepage is not what to check when confirming
   * what the public can see. Log out for that.
   */
  const [servicesResult, employeesResult, galleryResult] = await Promise.all([
    supabase
      .from("services")
      .select(
        "id, name, category, price, price_display, duration_minutes, is_bookable_online",
      )
      .eq("org_id", org.id)
      .order("display_order"),

    supabase
      .from("employees")
      .select("id, full_name, position, photo_path")
      .eq("org_id", org.id)
      .order("display_order"),

    supabase
      .from("gallery_images")
      .select("id, storage_path, alt_text")
      .eq("org_id", org.id)
      .order("display_order")
      .limit(6),
  ]);

  const services: FeaturedService[] = servicesResult.data ?? [];
  const styles = featured(services);
  const employees = employeesResult.data ?? [];
  const galleryImages = galleryResult.data ?? [];

  const hourGroups = groupHours(org.content.hours);
  const place = placeLine(org.address);

  /*
   * The salon's own photograph if it has uploaded one, and a stand-in from
   * /lib/site/stock-photos otherwise. The page cannot tell the
   * difference, which is the point — the day a real photograph is uploaded
   * this line stops reaching for the stand-in on its own.
   */
  const stock = stockBanner();
  const uploadedLogo = imageUrl(org.content.logoPath);
  const fallbackLogo = stockLogo();
  const logo = uploadedLogo ?? fallbackLogo.url;
  const logoAlt = uploadedLogo ? org.name : fallbackLogo.alt;
  const heroPath = imageUrl(org.content.heroImagePath);
  const hero = heroPath
    ? { url: heroPath, alt: org.content.heroImageAlt ?? org.name }
    : stock;

  /*
   * The work grid: every gallery photograph the salon has uploaded, then
   * stand-ins to fill the row out to six. A half-empty grid looks like a
   * fault; a full one looks like a salon that has been busy.
   */
  const work = [
    ...galleryImages.map((image) => ({
      key: image.id,
      url: imageUrl(image.storage_path),
      alt: image.alt_text ?? "Work by our stylists",
    })),
    ...Array.from({ length: Math.max(0, 6 - galleryImages.length) }, (_, i) => {
      const photo = stockWorkPhoto(i % STOCK_WORK_COUNT);

      return { key: `stock-${i}`, url: photo.url, alt: photo.alt };
    }),
  ].filter((image) => image.url !== null);

  return (
    <>
      {/* ---------------------------------------------------------------
          Hero.

          The logo, centred and large, then the words, then the photograph
          full width underneath. A luxury shopfront leads with its name, not
          with a picture of a customer — the picture is the proof, and proof
          comes second.

          The logo is gold artwork on a black square, and `blend-gold` is what
          stops that square from showing as a box. See the note on the utility
          in globals.css; it is the reason there is no visible edge here.
          --------------------------------------------------------------- */}
      <section className="shell pt-12 pb-14 text-center lg:pt-20 lg:pb-20">
        <Image
          src={logo}
          alt={logoAlt}
          width={1164}
          height={824}
          priority
          sizes="(min-width: 1024px) 44rem, 90vw"
          className="blend-gold mx-auto h-auto w-full max-w-md sm:max-w-lg lg:max-w-2xl"
        />

        {place && <p className="label mt-8 text-brand">{place}</p>}

        <h1 className="mx-auto mt-5 max-w-4xl font-display text-4xl leading-[1.08] font-light text-balance sm:text-5xl lg:text-6xl">
          {org.content.tagline ?? org.name}
        </h1>

        {org.content.about && (
          <p className="mx-auto mt-7 max-w-2xl leading-relaxed text-ink-muted text-pretty">
            {org.content.about}
          </p>
        )}

        <div className="mt-10 flex flex-wrap justify-center gap-4">
          <Link
            href="/book"
            className="btn bg-brand text-ink-inverse hover:bg-brand-strong"
          >
            Book an appointment
          </Link>

          {org.phone && (
            <a
              href={`tel:${org.phone.replace(/[^\d+]/g, "")}`}
              className="btn border border-brand/40 text-brand hover:border-brand hover:bg-brand hover:text-ink-inverse"
            >
              Call {org.phone}
            </a>
          )}
        </div>

        {/*
          The line under the buttons. `promotion` is whatever the salon wants
          said this month — it is one field, it changes often, and it is the
          only piece of copy on the site the owner edits regularly.
        */}
        {org.content.promotion && (
          <p className="label mt-8 text-ink-muted">{org.content.promotion}</p>
        )}

        {/*
          The three or four small facts a salon otherwise repeats down the
          phone all day — parking, cash, whether you can walk in. Nothing
          renders until the salon fills `highlights` in, so this is invisible
          rather than empty.
        */}
        {org.content.highlights.length > 0 && (
          <ul className="mx-auto mt-12 flex max-w-3xl flex-wrap justify-center gap-x-10 gap-y-3 border-t border-brand/20 pt-8">
            {org.content.highlights.map((highlight) => (
              <li key={highlight} className="label text-ink-muted">
                {highlight}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/*
        The photograph, edge to edge.

        Deliberately outside `shell`, which is the one place on the site that
        rule is broken. A full-bleed image has no margins to notice, and that
        is the whole effect — the page stops being a document with a picture
        in it and becomes a room you are looking into.
      */}
      <figure className="relative aspect-4/3 w-full bg-surface-sunk sm:aspect-3/2 lg:aspect-2/1">
        {/*
          `object-[center_28%]` pulls the crop upwards. The salon uploads
          whatever photograph it has, and portraits are the common case — a
          centred crop of a portrait in a wide frame lands on the chin.
        */}
        <Image
          src={hero.url}
          alt={hero.alt}
          fill
          sizes="100vw"
          className="object-cover object-[center_28%]"
        />

        {/*
          The photograph fades into the page at top and bottom instead of
          stopping at a hard line. Same intent as the blend on the logo: no
          visible edge anywhere, so the page reads as one surface rather than
          as a stack of rectangles.

          `pointer-events-none` because this sits over the image and must not
          swallow a click meant for anything underneath it.
        */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-gradient-to-b from-surface via-transparent to-surface opacity-90"
        />
      </figure>

      {/* ---------------------------------------------------------------
          The price list.

          Ruled and right-aligned on the money — somebody here is running
          their eye down that column looking for one number, so the column is
          what the layout is built around.
          --------------------------------------------------------------- */}
      <section className="shell py-16 lg:py-24">
        <div className="flex items-end justify-between gap-6 border-b border-brand/30 pb-4">
          <h2 className="font-display text-3xl font-light sm:text-4xl xl:text-5xl">Services</h2>

          <Link
            href="/services"
            className="label shrink-0 text-brand transition-colors hover:text-brand-strong"
          >
            {`All ${services.length} services →`}
          </Link>
        </div>

        {servicesResult.error ? (
          <p className="pt-8 text-ink-muted">
            Our price list is briefly unavailable. Please call{" "}
            <PhoneLink phone={org.phone} /> and we will talk it through.
          </p>
        ) : styles.length === 0 ? (
          <p className="pt-8 text-ink-muted">
            Our price list is being updated. Please call{" "}
            <PhoneLink phone={org.phone} /> in the meantime.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {styles.map((service) => {
              const price = formatPrice(
                service.price,
                service.price_display,
                org.currency,
              );
              const duration = formatDuration(service.duration_minutes);
              const thumbnail = stockStylePhoto(service.name);

              return (
                <li key={service.id}>
                  {/*
                    Straight to the time picker with this service already
                    chosen — `s0` is the booking page's own parameter for
                    "person 0 wants these services". Landing on the full menu
                    again after you have just tapped a service is asking the
                    same question twice.

                    A service the salon does not take online goes to the
                    phone instead of into a flow that would refuse it.
                  */}
                  <Link
                    href={bookHref(service, org.phone)}
                    className="group flex items-center gap-5 py-5"
                  >
                    {/*
                      Empty alt, on purpose. The photograph is a stand-in
                      chosen by the code, not a picture of this service, so
                      describing it would be describing a decision we made
                      rather than the salon's work.
                    */}
                    <Image
                      src={thumbnail.url}
                      alt=""
                      width={80}
                      height={80}
                      className="size-16 shrink-0 bg-surface-sunk object-cover sm:size-20"
                    />

                    <span className="min-w-0 flex-1">
                      <span className="block font-display text-xl leading-tight transition-colors group-hover:text-brand sm:text-2xl">
                        {service.name}
                      </span>

                      <span className="label mt-1.5 block text-ink-muted">
                        {[duration, service.category]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>

                    {/*
                      A 'hidden' price prints an invitation rather than a
                      number. The number still exists in the database and the
                      salon knows it — this is a presentation choice.
                    */}
                    <span className="shrink-0 font-display text-2xl font-normal tabular-nums sm:text-3xl">
                      {price ?? <span className="label text-ink-muted">Ask</span>}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ---------------------------------------------------------------
          The people.

          No stock portraits here, deliberately. A photograph of a stranger
          printed under a real employee's name is a lie about a real person.
          Until these five sit for a picture they get their initials, which is
          honest and keeps the layout identical for the day they do.
          --------------------------------------------------------------- */}
      {employees.length > 0 && (
        <section className="shell py-16 lg:py-24">
          <div className="flex items-end justify-between gap-6 border-b border-brand/30 pb-4">
            <h2 className="font-display text-3xl font-light sm:text-4xl xl:text-5xl">Our team</h2>

            <Link
              href="/team"
              className="label shrink-0 text-brand transition-colors hover:text-brand-strong"
            >
              Meet everyone &rarr;
            </Link>
          </div>

          <ul className="grid grid-cols-2 gap-x-5 gap-y-8 pt-8 sm:grid-cols-3 lg:grid-cols-5">
            {employees.map((employee) => {
              const photo = imageUrl(employee.photo_path);

              return (
                <li key={employee.id}>
                  {photo ? (
                    <Image
                      src={photo}
                      alt={employee.full_name}
                      width={320}
                      height={384}
                      sizes="(min-width: 1024px) 18vw, 45vw"
                      className="aspect-5/6 w-full bg-surface-sunk object-cover"
                    />
                  ) : (
                    <div
                      aria-hidden
                      className="flex aspect-5/6 w-full items-center justify-center border border-line bg-surface-sunk font-display text-3xl font-light text-ink-muted"
                    >
                      {employee.full_name
                        .split(/\s+/)
                        .map((word) => word[0] ?? "")
                        .slice(0, 2)
                        .join("")
                        .toUpperCase()}
                    </div>
                  )}

                  <h3 className="mt-3 font-display text-xl leading-tight font-normal">
                    {employee.full_name}
                  </h3>

                  {employee.position && (
                    <p className="label mt-1 text-ink-muted">
                      {employee.position}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Recent work. */}
      {work.length > 0 && (
        <section className="shell py-16 lg:py-24">
          <div className="flex items-end justify-between gap-6 border-b border-brand/30 pb-4">
            <h2 className="font-display text-3xl font-light sm:text-4xl xl:text-5xl">Recent work</h2>

            {org.content.social.instagram && (
              <a
                href={org.content.social.instagram}
                target="_blank"
                rel="noopener noreferrer"
                className="label shrink-0 text-brand transition-colors hover:text-brand-strong"
              >
                Instagram &rarr;
              </a>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 pt-8 sm:grid-cols-3">
            {work.map((image) => (
              <Link
                key={image.key}
                href="/gallery"
                className="relative aspect-square overflow-hidden bg-surface-sunk"
              >
                <Image
                  src={image.url!}
                  alt={image.alt}
                  fill
                  sizes="(min-width: 640px) 30vw, 45vw"
                  className="object-cover transition-opacity hover:opacity-85"
                />
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ---------------------------------------------------------------
          Visit.

          Address on one side, hours on the other. Two columns rather than one
          long stack, because these are the two questions somebody scrolling
          this far is holding at the same time: where, and when.
          --------------------------------------------------------------- */}
      <section className="shell py-16 lg:py-24">
        <div className="grid gap-10 border-t border-brand/30 pt-10 lg:grid-cols-2 lg:gap-16">
          <div>
            <h2 className="label text-ink-muted">Visit</h2>

            {org.address && (
              <>
                {/*
                  The address itself is the link. Somebody looking at an
                  address on a phone is trying to get there — making them find
                  a separate "directions" word first is a step for no reason.
                */}
                <a
                  href={mapsHref(org.address)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-4 block font-display text-2xl leading-snug text-balance underline decoration-brand/40 underline-offset-8 transition-colors hover:decoration-brand sm:text-3xl"
                >
                  {org.address}
                </a>

                <a
                  href={mapsHref(org.address)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="label mt-4 inline-block border-b border-brand pb-1 text-brand transition-colors hover:border-brand-strong hover:text-brand-strong"
                >
                  Directions &rarr;
                </a>
              </>
            )}

            {/*
              A link out to the reviews, and no quotation. What people wrote
              on Yelp belongs to them, and reprinting it here without asking
              is not ours to do. A star rating typed into our own code would
              be worse — a number nobody could check and nobody would update.
            */}
            {org.content.social.yelp && (
              <p className="mt-8">
                <a
                  href={org.content.social.yelp}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="label border-b border-line pb-1 text-ink-muted transition-colors hover:border-ink hover:text-ink"
                >
                  Read our reviews &rarr;
                </a>
              </p>
            )}
          </div>

          {hourGroups.length > 0 && (
            <div>
              <h2 className="label text-ink-muted">Opening hours</h2>

              <dl className="mt-4">
                {hourGroups.map((group) => (
                  <div
                    key={group[0].day}
                    className="flex justify-between gap-4 border-b border-line py-3.5 text-sm"
                  >
                    <dt>{describeDays(group)}</dt>
                    <dd className="text-ink-muted tabular-nums">
                      {formatTime(group[0].open)} &ndash;{" "}
                      {formatTime(group[0].close)}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>
      </section>

      <BookingCta phone={org.phone} />

    </>
  );
}

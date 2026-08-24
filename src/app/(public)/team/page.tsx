import type { Metadata } from "next";
import Image from "next/image";

import { imageUrl } from "@/lib/site/images";
import { getServiceTree } from "@/lib/services/categories";
import { getOrganization } from "@/lib/site/organization";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { BookingCta } from "../booking-cta";
import { PhoneLink } from "../phone-link";
import { PageHeading } from "../page-heading";

/**
 * The team page.
 *
 * Note what this page does NOT have access to. `phone` and `email` sit on the
 * same `employees` row as everything below, and migration 008 never granted
 * either column to `anon`. A query asking for them fails rather than leaking
 * them, which is a guarantee — "remember not to select it" is not.
 */

export const metadata: Metadata = {
  title: "Our Team",
  description: "The people who look after you, and what each of them does.",
};

type Employee = {
  id: string;
  full_name: string;
  photo_path: string | null;
  position: string | null;
  bio: string | null;
};

/**
 * "Selam Tesfaye" becomes "ST", for the block shown when someone has no
 * photograph. First and last word only, so a middle name does not produce
 * three letters and a double-barrelled surname still gives two.
 */
function initials(fullName: string): string {
  const words = fullName.trim().split(/\s+/);
  if (words.length === 0) return "";

  const first = words[0]?.[0] ?? "";
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? "") : "";

  return (first + last).toUpperCase();
}

export default async function TeamPage() {
  const org = await getOrganization();
  const supabase = await createSupabaseServerClient();

  /*
   * Three straightforward queries rather than one nested one.
   *
   * PostgREST can usually follow a foreign key and fetch the related rows in
   * a single request, but the keys between these tables are composite —
   * (service_id, org_id) rather than just (service_id), per DECISIONS #21 —
   * and inference across those is exactly the sort of thing that works until
   * it quietly does not. Three small queries and a join in memory is a few
   * milliseconds and no guesswork. There are twenty-odd rows in each.
   */
  const [employeesResult, linksResult, servicesResult, tree] = await Promise.all([
    supabase
      .from("employees")
      .select("id, full_name, photo_path, position, bio")
      .eq("org_id", org.id)
      .order("display_order"),

    supabase
      .from("employee_services")
      .select("employee_id, service_id")
      .eq("org_id", org.id),

    supabase
      .from("services")
      .select("id, category_id")
      .eq("org_id", org.id)
      .order("display_order"),

    getServiceTree(org.id),
  ]);

  const employees: Employee[] = employeesResult.data ?? [];
  const failed = Boolean(employeesResult.error);

  /*
   * service id -> the TOP-LEVEL heading it hangs from, so a link row can be
   * turned into a name without searching the services list every time.
   *
   * Top-level and not the leaf: "Fikir — Braiding" is what a customer is
   * asking about. "Fikir — With extensions · Without extensions" is the same
   * fact, longer, and phrased as though she does two different jobs.
   */
  const categoryOfService = new Map<string, string>();
  for (const service of servicesResult.data ?? []) {
    const top = service.category_id
      ? tree.topOf.get(service.category_id)
      : undefined;

    if (top) categoryOfService.set(service.id, top.name);
  }

  /*
   * employee id -> the categories they work across.
   *
   * Categories rather than the services themselves, deliberately. Selam
   * covers most of the menu; printing it under her name is a wall of text
   * nobody reads. "Braiding · Hair colour · Haircut & trim" answers the
   * question a customer is actually asking — can this person do my hair.
   *
   * A Set because a stylist doing eight services in one category should have
   * that category named once. Insertion order follows the services query,
   * which is ordered by display_order, so categories appear in the salon's
   * own order rather than alphabetically.
   */
  const categoriesOfEmployee = new Map<string, Set<string>>();
  for (const service of servicesResult.data ?? []) {
    const category = categoryOfService.get(service.id);
    if (!category) continue;

    for (const link of linksResult.data ?? []) {
      if (link.service_id !== service.id) continue;

      const existing = categoriesOfEmployee.get(link.employee_id);
      if (existing) existing.add(category);
      else categoriesOfEmployee.set(link.employee_id, new Set([category]));
    }
  }

  return (
    <>
      <PageHeading
        eyebrow="Team"
        title="The people who look after you"
        intro="Ask for someone by name when you call, or let us match you with whoever is free."
      />

      {failed || employees.length === 0 ? (
        <p className="shell py-12 text-ink-muted">
          Our team page is briefly unavailable. Please call{" "}
          <PhoneLink phone={org.phone} /> — we are still here.
        </p>
      ) : (
        <ul className="shell grid grid-cols-2 gap-x-5 gap-y-10 py-10 sm:grid-cols-3 lg:grid-cols-5">
          {employees.map((employee) => {
            const photo = imageUrl(employee.photo_path);
            const categories = [
              ...(categoriesOfEmployee.get(employee.id) ?? []),
            ];

            return (
              <li key={employee.id}>
                {photo ? (
                  <Image
                    src={photo}
                    alt={employee.full_name}
                    width={400}
                    height={480}
                    sizes="(min-width: 640px) 280px, 45vw"
                    className="aspect-5/6 w-full bg-surface-sunk object-cover"
                  />
                ) : (
                  /*
                   * No photograph is an ordinary state, not a fault — several
                   * of these people may never sit for one. Initials in a block
                   * of exactly the same proportions keep the row from lurching
                   * on the day a photograph is added.
                   *
                   * There is no stand-in photograph here, unlike the hero and
                   * the gallery. A stock picture of a stranger printed under a
                   * real employee's name is a lie about a real person, and no
                   * design preview is worth that.
                   *
                   * aria-hidden because the name is written immediately below:
                   * a screen reader announcing "S T Selam Tesfaye" is noise.
                   */
                  <div
                    aria-hidden
                    className="flex aspect-5/6 w-full items-center justify-center border border-line bg-surface-sunk font-display text-3xl font-light text-ink-muted sm:text-4xl"
                  >
                    {initials(employee.full_name)}
                  </div>
                )}

                <h2 className="mt-3 font-display text-xl leading-tight font-normal font-semibold sm:text-xl">
                  {employee.full_name}
                </h2>

                {employee.position && (
                  <p className="label mt-1 text-ink-muted">
                    {employee.position}
                  </p>
                )}

                {employee.bio && (
                  <p className="mt-2 text-sm leading-relaxed text-ink-muted text-pretty">
                    {employee.bio}
                  </p>
                )}

                {/*
                  An employee with no services is a legitimate state, not
                  missing data — a receptionist is part of the team and
                  performs none. So this line simply does not render for them,
                  rather than printing an empty label.
                */}
                {categories.length > 0 && (
                  <p className="label mt-2 border-t border-line pt-2 text-ink-muted">
                    {categories.join(" · ")}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}


      <BookingCta phone={org.phone} />
    </>
  );
}

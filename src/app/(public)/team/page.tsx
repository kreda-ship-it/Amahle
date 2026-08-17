import type { Metadata } from "next";
import Image from "next/image";

import { imageUrl } from "@/lib/site/images";
import { getOrganization } from "@/lib/site/organization";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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
 * "Selam Tesfaye" becomes "ST", for the circle shown when someone has no
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
  const [employeesResult, linksResult, servicesResult] = await Promise.all([
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
      .select("id, category")
      .eq("org_id", org.id)
      .order("display_order"),
  ]);

  const employees: Employee[] = employeesResult.data ?? [];
  const failed = Boolean(employeesResult.error);

  // service id -> its category, so a link row can be turned into a category
  // name without searching the services list every time.
  const categoryOfService = new Map<string, string>();
  for (const service of servicesResult.data ?? []) {
    if (service.category) categoryOfService.set(service.id, service.category);
  }

  /*
   * employee id -> the categories they work across.
   *
   * Categories rather than the services themselves, deliberately. Selam
   * covers all twenty-four; printing them under her name is a wall of text
   * nobody reads. "Hairstyles · Braids & More · Coloring" answers the
   * question a customer is actually asking — can this person do my hair.
   *
   * A Set because a stylist doing eight services in one category should have
   * that category named once. Insertion order follows the services query,
   * which is ordered by display_order, so categories appear in the salon's
   * own order rather than alphabetically.
   */
  const categoriesOfEmployee = new Map<string, Set<string>>();
  for (const service of servicesResult.data ?? []) {
    const category = service.category;
    if (!category) continue;

    for (const link of linksResult.data ?? []) {
      if (link.service_id !== service.id) continue;

      const existing = categoriesOfEmployee.get(link.employee_id);
      if (existing) existing.add(category);
      else categoriesOfEmployee.set(link.employee_id, new Set([category]));
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-5 py-16">
      <h1 className="font-display text-4xl font-semibold sm:text-5xl">
        Our Team
      </h1>

      <p className="mt-4 max-w-2xl text-lg text-ink-muted text-pretty">
        The people who look after you. Ask for someone by name when you call,
        or let us match you with whoever is free.
      </p>

      {failed || employees.length === 0 ? (
        <p className="mt-12 text-ink-muted">
          Our team page is briefly unavailable. Please call{" "}
          {org.phone ?? "the salon"} — we are still here.
        </p>
      ) : (
        <ul className="mt-12 grid gap-10 sm:grid-cols-2">
          {employees.map((employee) => {
            const photo = imageUrl(employee.photo_path);
            const categories = [
              ...(categoriesOfEmployee.get(employee.id) ?? []),
            ];

            return (
              <li key={employee.id} className="flex gap-5">
                {photo ? (
                  <Image
                    src={photo}
                    alt={employee.full_name}
                    width={96}
                    height={96}
                    className="size-20 shrink-0 rounded-full object-cover sm:size-24"
                  />
                ) : (
                  /*
                   * No photograph is an ordinary state, not a fault — several
                   * of these people may never sit for one. Initials in a
                   * circle keep the layout identical to a card that has a
                   * photo, so the page does not lurch when one is added.
                   *
                   * aria-hidden because the name is written immediately
                   * beside it: a screen reader announcing "S T Selam Tesfaye"
                   * is noise.
                   */
                  <div
                    aria-hidden
                    className="flex size-20 shrink-0 items-center justify-center rounded-full bg-surface-sunk font-display text-xl font-semibold text-brand sm:size-24"
                  >
                    {initials(employee.full_name)}
                  </div>
                )}

                <div className="min-w-0">
                  <h2 className="font-display text-xl font-semibold">
                    {employee.full_name}
                  </h2>

                  {employee.position && (
                    <p className="mt-0.5 text-sm font-medium text-brand">
                      {employee.position}
                    </p>
                  )}

                  {employee.bio && (
                    <p className="mt-2 text-ink-muted text-pretty">
                      {employee.bio}
                    </p>
                  )}

                  {/*
                    An employee with no services is a legitimate state, not
                    missing data — a receptionist is part of the team and
                    performs none. So this line simply does not render for
                    them, rather than printing an empty label.
                  */}
                  {categories.length > 0 && (
                    <p className="mt-3 text-sm text-ink-muted">
                      {categories.join(" · ")}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {org.phone && (
        <div className="mt-14">
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

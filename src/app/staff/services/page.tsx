import type { Metadata } from "next";

import { requirePermission } from "@/lib/auth";
import { getServiceTree, groupServices } from "@/lib/services/categories";
import { getOrganization } from "@/lib/site/organization";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { ServiceRow, type ServiceRowData } from "./service-row";

/**
 * The menu.
 *
 * The most overdue screen in the project, and the one with a running cost:
 * every price, duration, buffer and lead time in the tree is a placeholder
 * shaped like a real number. They were invented so the booking engine could be
 * built and seen working. Until now, correcting one when Selam sends her real
 * figures has meant somebody writing SQL.
 *
 * WHAT THIS DOES NOT EDIT, and it is most of the tree. The categories, the
 * questions and the answers with their own price and minute deltas are four
 * more tables, and the answers are where a braiding price actually comes from
 * — size, length, whose hair. This screen edits the service itself. The
 * question tree is its own screen and its own decision, and shipping half of
 * it now is better than shipping neither.
 */

export const metadata: Metadata = {
  title: "Services",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function ServicesPage() {
  /* Setting prices is service.manage — Owner and Manager by default. Whether
     the receptionist should hold it is an open question in ROADMAP, and the
     same key governs durations and prices together. */
  await requirePermission("service.manage");

  const org = await getOrganization();
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("services")
    .select(
      `id, name, category_id, price, duration_minutes, buffer_minutes,
       lead_minutes, latest_start_time, is_bookable_online, is_active`,
    )
    .is("deleted_at", null)
    .order("display_order");

  const services = (data ?? []) as ServiceRowData[];

  /*
   * The house rule a blank cleanup gap falls back to, shown in the form so
   * "empty" says what it will actually do.
   *
   * Read straight from the row rather than through getOrganization(), whose
   * Organization type is shaped for the public site and deliberately exposes
   * only what a shopfront needs. A cleanup gap is not that — it is internal,
   * and migration 007's comment says so.
   */
  const { data: settings } = await supabase
    .from("organizations")
    .select("public_settings")
    .eq("id", org.id)
    .maybeSingle();

  const defaultBuffer =
    (settings?.public_settings as Record<string, unknown> | null)
      ?.default_buffer_minutes ?? null;

  /*
   * Grouped the way the salon lists them, from `service_categories` — the
   * tree migration 027 built and nothing read until now. Two levels, so a
   * sub-heading prints beneath its parent rather than beside it.
   *
   * A service filed nowhere lands in "Everything else". Nothing is there
   * today, and something will be the moment a service is added without a
   * heading chosen.
   */
  const tree = await getServiceTree(org.id);
  const { groups, unfiled } = groupServices(services, tree);

  const sections: { key: string; heading: string; list: ServiceRowData[] }[] =
    [];

  for (const group of groups) {
    if (group.direct.length > 0) {
      sections.push({
        key: group.category.id,
        heading: group.category.name,
        list: group.direct,
      });
    }

    for (const section of group.sections) {
      sections.push({
        key: section.category.id,
        heading: `${group.category.name} · ${section.category.name}`,
        list: section.services,
      });
    }
  }

  if (unfiled.length > 0) {
    sections.push({ key: "none", heading: "Everything else", list: unfiled });
  }

  return (
    <div className="flex max-w-4xl flex-col gap-6 p-5 lg:p-8">
      <header>
        <p className="label text-ink-muted">The menu</p>
        <h1 className="mt-1 font-display text-3xl lg:text-4xl">Services</h1>
        <p className="mt-2 max-w-prose text-sm text-ink-muted">
          Every number here is read by the booking form and the calendar the
          moment you save it. The prices and times in this list started as
          placeholders — this is where the real ones go.
        </p>
      </header>

      {error ? (
        <p className="text-ink-muted">
          The menu could not be loaded. {error.message}
        </p>
      ) : services.length === 0 ? (
        <p className="text-ink-muted">No services yet.</p>
      ) : (
        sections.map((section) => (
          <section key={section.key} className="border border-line">
            <h2 className="border-b border-line bg-surface-sunk px-4 py-2.5 font-medium">
              {section.heading}
              <span className="ml-2 text-sm font-normal text-ink-muted">
                {section.list.length}
              </span>
            </h2>

            <ul className="divide-y divide-line">
              {section.list.map((service) => (
                <ServiceRow
                  key={service.id}
                  service={service}
                  currency={org.currency}
                  defaultBuffer={
                    typeof defaultBuffer === "number" ? defaultBuffer : null
                  }
                />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

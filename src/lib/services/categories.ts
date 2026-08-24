import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * The menu's own shape.
 *
 * Migration 027 built `service_categories` — real rows, two levels deep in
 * places — and left the older `services.category` TEXT column in place with
 * a note saying "the text column goes when the pages move". This is the
 * pages moving.
 *
 * IT WAS NOT A TIDY-UP. The text column was not merely clumsy, it was wrong
 * and it was live: sixty of the salon's eighty-four services carried NULL,
 * which every page turned into a heading called "More", and the other
 * twenty-four sat under five headings that predate the menu Selam actually
 * gave us. The tree, meanwhile, was filled in correctly on all eighty-four
 * and read by nothing.
 *
 * WHY A COLUMN OF TEXT COULD NEVER HAVE DONE THIS JOB. Moving a style to
 * another heading meant retyping a string on that one row. Renaming a
 * heading meant finding every row carrying that exact string and rewriting
 * each of them, with nothing to say when you had got them all — miss two and
 * the salon has three headings where it had one, spelled almost the same.
 * A category has to be a row before it can be renamed, reordered, or dragged
 * into.
 *
 * SERVER ONLY, and the types say so: `Map` does not survive the journey to a
 * browser. Pages resolve the names they need here and pass down strings.
 */

export type Category = {
  id: string;
  name: string;
  parent_id: string | null;
  display_order: number;
};

/** A top-level heading and the sub-headings beneath it, in the salon's order. */
export type Branch = {
  category: Category;
  children: Category[];
};

export type ServiceTree = {
  branches: Branch[];
  /** Every category, sub-categories included. */
  byId: Map<string, Category>;
  /** The top-level ancestor of any category, by that category's own id. */
  topOf: Map<string, Category>;
};

const EMPTY: ServiceTree = { branches: [], byId: new Map(), topOf: new Map() };

/**
 * The whole tree, in the order the salon keeps it.
 *
 * One query rather than one per level. There are eighteen categories and
 * there will never be many more — a salon's menu has headings, not a
 * hierarchy — so assembling in memory beats a recursive CTE nobody can read.
 *
 * DEPTH IS CAPPED AT TWO, and that is the schema's intent rather than this
 * function's shortcut: migration 027's comment says the mind map is "two
 * levels deep in places". A grandchild would be filed under its own parent
 * and lose its grandparent, which is visible and wrong rather than silent
 * and wrong — the failure a reader can spot.
 */
export async function getServiceTree(orgId: string): Promise<ServiceTree> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("service_categories")
    .select("id, name, parent_id, display_order")
    .eq("org_id", orgId)
    .order("display_order");

  if (error || !data) {
    console.error("getServiceTree failed", error);
    return EMPTY;
  }

  const categories = data as Category[];
  const byId = new Map(categories.map((category) => [category.id, category]));

  const roots = categories.filter((category) => category.parent_id === null);

  const branches: Branch[] = roots.map((category) => ({
    category,
    children: categories.filter((child) => child.parent_id === category.id),
  }));

  const topOf = new Map<string, Category>();

  for (const branch of branches) {
    topOf.set(branch.category.id, branch.category);
    for (const child of branch.children) topOf.set(child.id, branch.category);
  }

  /*
   * A category whose parent has itself been retired is not in any branch, so
   * it would vanish along with everything filed under it. Treat it as
   * top-level instead: a heading in an odd place is a much smaller failure
   * than a dozen services silently disappearing from the price list.
   */
  for (const category of categories) {
    if (!topOf.has(category.id)) {
      topOf.set(category.id, category);
      branches.push({ category, children: [] });
    }
  }

  return { branches, byId, topOf };
}

/** One heading's worth of services. */
export type Section<T> = { category: Category; services: T[] };

export type Group<T> = {
  /** The top-level heading. */
  category: Category;
  /** Services hanging straight off it, with no sub-heading. */
  direct: T[];
  /** Its sub-headings, in the salon's order. Empty ones are dropped. */
  sections: Section<T>[];
};

/**
 * Services filed under the tree, ready to render.
 *
 * Order within a bucket is the order they arrived in — every caller has
 * already asked the database for `display_order`, and re-sorting here would
 * be a second opinion about a decision the query already made.
 *
 * `unfiled` is not a fallback nobody hits. A service created through the
 * staff screen with no heading chosen lands there, and dropping it would
 * mean a service that exists, can be booked, and appears on no page.
 */
export function groupServices<T extends { category_id: string | null }>(
  services: T[],
  tree: ServiceTree,
): { groups: Group<T>[]; unfiled: T[] } {
  const bucket = new Map<string, T[]>();
  const unfiled: T[] = [];

  for (const service of services) {
    const category = service.category_id
      ? tree.byId.get(service.category_id)
      : undefined;

    if (!category) {
      unfiled.push(service);
      continue;
    }

    const list = bucket.get(category.id);
    if (list) list.push(service);
    else bucket.set(category.id, [service]);
  }

  const groups: Group<T>[] = [];

  for (const branch of tree.branches) {
    const direct = bucket.get(branch.category.id) ?? [];

    const sections = branch.children
      .map((category) => ({
        category,
        services: bucket.get(category.id) ?? [],
      }))
      .filter((section) => section.services.length > 0);

    /* A heading with nothing under it is not a heading. Braiding holds no
       services of its own — everything is under with- or without-extensions
       — and it still earns its place because its sections do. */
    if (direct.length === 0 && sections.length === 0) continue;

    groups.push({ category: branch.category, direct, sections });
  }

  return { groups, unfiled };
}

/**
 * What to call one service's heading when there is no heading above it.
 *
 * "With extensions" on its own says nothing; beneath "Braiding" it says
 * everything. So a lone label spells out the path and a nested one does not.
 */
export function pathOf(
  categoryId: string | null,
  tree: ServiceTree,
): string | null {
  if (!categoryId) return null;

  const category = tree.byId.get(categoryId);
  if (!category) return null;

  const top = tree.topOf.get(category.id);

  return top && top.id !== category.id
    ? `${top.name} · ${category.name}`
    : category.name;
}

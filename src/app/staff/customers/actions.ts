"use server";

import { requirePermission } from "@/lib/auth";
import { searchCustomers, type CustomerMatch } from "@/lib/customers/find";
import { getOrganization } from "@/lib/site/organization";

/**
 * What the search box may ask the server.
 *
 * `customer.view` on every call. That is not the security boundary — row-level
 * security is, and it would return nothing to a stranger regardless — but a
 * server action is a public HTTP endpoint the moment a client component
 * imports it, so it states its own requirement rather than inheriting the
 * page's.
 */
export async function findCustomers(query: string): Promise<CustomerMatch[]> {
  await requirePermission("customer.view");

  const org = await getOrganization();

  return searchCustomers(org.id, query);
}

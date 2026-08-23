import { can } from "@/lib/auth";

/**
 * What appears in the sidebar, and who may see it.
 *
 * Two rules, both easy to break here and expensive to break here.
 *
 * PERMISSION, NEVER ROLE. Services appears for somebody holding
 * `service.manage`, not for somebody whose role is called Manager. The
 * permissions are rows in the database and a salon may rearrange them; a
 * sidebar that reads roles would quietly disagree with what the screens
 * themselves allow.
 *
 * NOTHING PRETENDS TO WORK. `built: false` renders the item dimmed and
 * unclickable. The salon can see where this is going without ever pressing
 * something that does nothing — which is how software teaches people it is
 * unreliable.
 */
export type NavItem = {
  label: string;
  href: string;
  built: boolean;
  /** Null means everybody signed in may see it. */
  permission: string | null;
};

const ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/staff",           built: true,  permission: null },
  { label: "The day",   href: "/staff/day",       built: true,  permission: null },
  { label: "The week",  href: "/staff/week",      built: true,  permission: null },
  { label: "Planning",  href: "/staff/plan",      built: true,  permission: "appointment.manage" },
  { label: "Take a booking", href: "/staff/book", built: true,  permission: "appointment.create" },
  { label: "Tomorrow's calls", href: "/staff/calls", built: true, permission: null },
  { label: "Who does what", href: "/staff/who-does-what", built: true, permission: null },
  { label: "You",       href: "/staff/me",        built: true,  permission: null },
  { label: "Customers", href: "/staff/customers", built: false, permission: "customer.view" },
  { label: "Team",      href: "/staff/team",      built: false, permission: "employee.record.manage" },
  { label: "Services",  href: "/staff/services",  built: true,  permission: "service.manage" },
  { label: "Settings",  href: "/staff/settings",  built: false, permission: "organization.edit" },
];

/**
 * The items this person may see.
 *
 * Every permission is asked in parallel — each is a round trip and none
 * depends on another.
 */
export async function navFor(): Promise<NavItem[]> {
  const allowed = await Promise.all(
    ITEMS.map(async (item) =>
      item.permission === null ? true : await can(item.permission),
    ),
  );

  return ITEMS.filter((_, index) => allowed[index]);
}

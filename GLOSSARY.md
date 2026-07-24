# GLOSSARY.md — Amahle

One word per concept. Used in schema, code, comments, and UI copy — everywhere.

This exists because the original spec used several words for the same thing, and
inconsistent vocabulary produces inconsistent code.

---

## Use these words

| Use | Not | Meaning |
|---|---|---|
| **organization** | tenant, salon, business, company, shop | A business using Amahle. One row in `organizations`. |
| **customer** | client, guest, patron | A person who receives services. Has no login. |
| **employee** | staff, stylist, worker, team member | A person who works at the organization. |
| **appointment** | booking, reservation, slot | A scheduled service for a customer with an employee. |
| **service** | treatment, offering, procedure | Something the salon does — a cut, a colour. |
| **profile** | account, user | A person who can log in. |
| **role** | permission group, user type | A named set of permissions. |
| **permission** | right, capability, access | A single thing someone can do. |

Note: "stylist" is fine in customer-facing UI copy where it reads more naturally
than "employee." It is **never** a variable name, table name, or column name.

---

## Terms with a specific meaning here

**Soft delete** — setting `deleted_at` to a timestamp instead of removing the
row. The record is hidden from normal queries but still exists.

**RLS (Row-Level Security)** — a Postgres feature where the database itself
decides which rows a given user is allowed to see. Rules live in the database,
not the application.

**org_id scoping** — every query filters to the current organization's rows.
Enforced by RLS, not by remembering to write it.

**Canonical creation path** — the single function that creates a given record
type. `createAppointment()` is the only way an appointment is ever made.

**Field-level permission** — access control on a specific column, not the whole
row. A stylist can see a customer's allergies without seeing their outstanding
balance.

**Audit tier** — `critical` for sensitive data, money, permissions, and
deletions. `routine` for ordinary operations.

**Source** (on an appointment) — `online` if a customer booked it themselves,
`staff` if someone entered it by hand from a phone call.

**Buffer** — padding time after a service, for cleanup and reset, before the
employee is available again.

**Availability** — an employee's working hours, minus time off, minus existing
appointments, minus buffers.

---

## Naming conventions

- Tables: plural, snake_case — `appointments`, `employee_services`
- Columns: snake_case — `starts_at`, `is_bookable_online`
- Booleans: `is_` or `has_` prefix — `is_active`, `has_deposit`
- Timestamps: `_at` suffix — `created_at`, `starts_at`, `deleted_at`
- Foreign keys: singular table name + `_id` — `customer_id`
- Functions: camelCase, verb first — `createAppointment()`, `getAvailability()`
- Files and folders: kebab-case — `booking-form.tsx`
- React components: PascalCase — `BookingForm`

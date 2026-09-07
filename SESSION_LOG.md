# SESSION_LOG.md — Amahle

Three lines at the end of every working session. This is what makes tomorrow
resumable.

Newest entry at the top.

---

## Template

```
## [date] — [what you set out to do]
**Built:**
**Broke / unresolved:**
**Next:**
```

---

## 2026-09-07 — Audit the whole thing, then fix what it found

**Built:** An audit of the system against what commercial salon software does,
then seven commits acting on it. The audit itself is **not in the repo** — it
lives in a chat window and a hosted page, which is its own finding and is
recorded below.

**The one real bug, and it was everywhere.** Five screens built their day
boundary as `new Date('2026-08-23T00:00:00')`. JavaScript reads a date-time
carrying no offset as LOCAL time — the server's, not the salon's. Vercel runs
UTC, so a New York salon's "23 August" was really 22 Aug 20:00 to 23 Aug 19:59.
Every appointment starting after 8pm fell off its own day, last night's evening
bookings appeared on this morning's grid, and nothing on screen said so because
the grid draws to 22:00 either way. The receptionist would have seen an empty
column, quoted the slot, and been refused by the exclusion constraint.

`salonInstant()` already existed and already handled the two mornings a year the
clocks move. The five places simply did not use it. `salonDayRange()` wraps it
and is half-open — `[midnight, next midnight)` — matching the `tstzrange` the
exclusion constraint already uses, so `.lte` became `.lt` at every call site.
Proved by transpiling the real function and running it: the 23-hour and 25-hour
days both come out right.

**Layout faults share one shape, and this file already described it.** A grid
ITEM's containing block is its own grid area, so a sticky element inside one can
never travel outside its own cell. That was written up in `day-grid.tsx` in
August, when the column headings were lifted into their own grid to fix it
vertically. Nobody noticed the clock had the identical disease horizontally — it
stuck for exactly its own 3.25rem of sideways scroll and then left. Each row is
now a flex pair with the gutter as a sibling of the grid rather than a cell
inside it.

**A bug I introduced and then found two steps later.** The status key was
rendered inside `DatePicker`, which was defensible while the calendar sprang
open on every navigation. Teaching the calendar to stay folded turned that into
"the only way to mark an appointment has permanently disappeared", because the
folded calendar returns a date chip and nothing else. The key now has its own
box, its own X and its own memory. Worth remembering as a shape: making one
thing persistent can promote a temporary annoyance into a permanent fault.

**Three faults in one gesture**, all reported as "it glitches a bit". The
sideways drag preview used `translateX(across * 100%)` — a percentage of the
ELEMENT, which is `calc(100%/lanes - 4px)` of a column, so one appointment slid
four pixels short and two overlapping ones slid half a column. Nothing was
clamped, so a block dragged left off the first stylist left the table entirely.
And on the week view the day crossed was folded into the vertical shift, sending
a block twenty-four hours down the grid on its way to tomorrow.

**Four pixels is a mouse number.** Pressing a touchscreen and lifting off moves
several pixels every time, from the contact patch changing shape — so tapping an
appointment on a tablet moved it. Touch now needs twelve. Raising it alone would
have traded one wrong move for another, because the block jumped by the whole
threshold the instant it began following; recognition now re-anchors to where
the pointer actually is.

**`~/Documents` is iCloud-synced.** Confirmed by the symlink at
`~/Library/Mobile Documents/com~apple~CloudDocs/Documents`. When Next rewrites a
build file while iCloud holds a copy in flight, macOS writes `routes.d 2.ts`
beside it, and tsconfig pulls `.next/types/**` into the programme — so tsc
reported duplicate-identifier errors nobody wrote. Excluded by name. Nothing in
`src/` or `supabase/` is duplicated today, checked; that it *could* be is the
actual problem.

**Broke / unresolved:** **Nothing has still been through a browser end to end.**
Four things were confirmed by eye — the services search, the clock pinned left,
the corner, the hour lines, the sideways drag — but there has been no walk
through all eighteen routes as Owner, Receptionist and Stylist. That was the
largest outstanding risk on 2026-08-22 and there are now ten more commits
standing on it.

`SCHEMA.md` has never heard of migrations 038–044 — two tables and five
functions, including `set_appointment_status()`, the only path a status changes
by, and `update_my_employee_details()`. Both are security boundaries.
`ROADMAP.md` shows seven of Phase 5's nine steps unticked when they are built,
and describes the who-does-what screen as read-only and riskless when it now
inserts rows.

The audit is not in version control. Every other piece of reasoning in this
project is, precisely so it survives the session that produced it.

`services.category` is read by nothing since `e680188` and is still in the
table. The permission grid — which role holds which of the twelve keys — exists
nowhere in the documents and has to be reconstructed by reading five migrations.

Untouched from the audit's own P0 list: no customer search, no way to open an
appointment and see its notes, no password reset, no rota drawn on the calendar
so an empty column still cannot be told from an unstaffed one, and no production
database.

**Next:** The browser sweep — three logins, one pass, defects written down and
only the blocking ones fixed in place. Then the P0 list in the order the audit
set: actual timestamps, the appointment panel, customer search, the rota drawn,
password reset, prod and a rehearsed restore.

---

## 2026-08-22 (later) — The staff side, end to end

**Built:** Phase 5 was eight unexplained checkboxes. It is now scoped in
ROADMAP with the reasoning behind every argued decision, and six of its nine
steps are built: the shell, manual entry in four stages, statuses and the
highlighter, who does what, the week, and the day-before call round. Nine
commits.

**The booking engine stopped being unreachable.** Yesterday's note said it was
"complete and unreachable" — nothing in TypeScript could call `get_visit_slots`,
`visit_totals` or the question tree, and `getBookableServices()` filtered on
`is_bookable_online`, which excludes precisely the braiding services a phone
booking exists for. `/staff/book` is the first screen that reaches any of it:
the tree, priced answers, several services in one visit, and a time the
receptionist may set herself.

**Reading `create_appointment()` line by line changed the design twice.** Staff
bypass is only half true — `v_source = 'online'` gates the past-time check, the
online-bookable check and the lead's availability, but NOT the finishing chain,
which always needs a genuinely free assistant. The receptionist can overrule a
rota; she cannot conjure a colleague. And the caller supplies who *leads* and
nothing else, so the form must not offer to pick finishers.

**Two features turned out to need no migration at all.** The status highlighter:
`appointments_update` already permits `appointment.manage` and the audit trigger
already logs old and new because it is written by trigger rather than by
application code. A `security definer` function would have been a second write
path to a table that has a working one. And moving an appointment: the fill
trigger already carries `ends_at` and `blocked_until` across when `starts_at`
moves.

**The day became a grid** — people across, time down. A card list cannot answer
the question the desk asks, which is not "what is booked" but "where is the
gap"; a gap is a shape and only a grid has shapes. Who gets a column is derived
from `employee_services.role`, not stored — a stored `is_stylist` flag would be
a second version of a truth the booking path already reads. Assistants share
one column and are allowed to look double-booked, because nobody is ever booked
*with* a named assistant.

Generalising that grid for the week view produced the session's one genuinely
transferable lesson: the obvious fix — pass a function saying which column a
row belongs to — **cannot cross the server-to-client boundary**, because props
must be serialisable. So the server tags each row with `column_id` and the grid
no longer knows what a column MEANS. One component now draws both views.

**Broke / unresolved:** **Nothing has been through a browser.** Nine commits,
six screens, all verified by TypeScript, ESLint and route checks — none by a
human clicking. That is the largest outstanding risk in the project today.

**A parallel session committed `aee9d14` mid-work**, adding a sidebar and
dashboard and moving the day view to `/staff/day`. The sidebar and dashboard
were kept. Three things it left behind were fixed: `/staff/day` had no
`requireProfile()` and its comment claimed the layout was the guard — a layout
is not re-run between pages that share it, and `proxy.ts` says in its own
comment that it guards nothing; the status highlighter had been orphaned when
the day view moved; and the sidebar advertised the booking form as unbuilt.
Worth knowing two agents can be in this repo at once.

The day grid's first version had three proportion faults, all mine: no padding
because `StaffShell` supplies none, fixed 11rem columns, and blocks clamped to
46px so four lines of text would fit — which made a twenty-minute trim look
like an hour and defeated the only thing a grid does better than a list.

I killed the running dev server with an over-broad `pkill`. Restarted.

**Three stages remain and all three need migrations.** Live editing and
planning mode wait on `move_visit()` — which needs
`appointments_no_double_booking` to become deferrable, because shifting a
chained visit trips the constraint mid-statement on a final state that is
perfectly legal. My profile waits on a function letting a stylist set their own
status and edit their own details; `employee.record.manage` is all-or-nothing
across the whole team and cannot express "yourself".

**Deferred on purpose, all three recorded:** Google Calendar until the staff
calendar has been used; automated messages, per DECISIONS #29; and Power BI,
where the finding worth keeping is that it connects with a Postgres role rather
than a Supabase JWT — so `current_org_id()` returns null and every policy
denies, while connecting as `postgres` bypasses RLS and reads every salon's
allergies. The work is a `reporting` schema of views, not the BI tool.

Website colour and content editing was ruled out of v1 as the CMS, DECISIONS
#11; organization settings and the logo were ruled in. Announcements were
declined again as the internal notes system.

**Next:** Click through it. Then the second migration, and steps 5, 6 and 9.
The service menu editor in Phase 6 is the item with the most cost attached to
not having it — every price and duration in the tree is still a guess, and
correcting one means writing SQL.

---

## 2026-08-22 — The booking engine, and the day the staff look at

**Built:** Migrations 027 to 038, all applied to dev, plus the staff day view.
The system now models how Kedus actually works rather than how a booking system
usually assumes a salon works. Four things it did not know this morning:

**A service is not one price and one duration.** 027 gave the menu a tree of
categories, questions and answers, each answer carrying a price delta and a
minutes delta. 029 computes the totals in the database — never in the website,
because the running total a customer watches and the number written to their
appointment must come from the same arithmetic. A medium-big waist-length boho
knotless braid with salon hair prices at $325 and 8h15 rather than $220 and 6h.

**Wash and blow-dry is free beside other work and charged alone.** One flag,
applied where the price is computed. Its forty-five minutes always count — free
is not instant, and zeroing the time with the money would overbook every
braiding appointment by exactly a wash.

**A visit can need two people.** DECISIONS #32. The salon's washers and
assistants are not stylists, and only they do take-outs — so "take my braids out
and put new ones in" could not be scheduled at all. Availability now anchors on
the scarce service and fits the rest around it. Proved on real data: nobody
performs both take-down and knotless braids, the old function returned zero
times forever, the new one returns 78.

**A braider is not in the chair for six hours.** The biggest one. They found the
style across the scalp — 2h30, three hours for micro braids, one for simple
cornrows — then move on while an assistant works the length down. 033 to 038
model that as a `lead` row and `finish` rows sharing a visit. On one Monday,
knotless braids went from 3 bookable start times to 9 for one stylist. The
software had been modelling the salon's braiders as roughly sixty per cent less
productive than they are.

Also: the last booking taken is now separate from the closing time, per service,
because a trim at 18:45 is a normal day and braids at 18:45 are not. And the
real team replaced the five people I had invented — Maki, Fikir, Ethopi, Jerry,
Mekdi, Rani, Sofi, the owners Dagnu and Mimi, and eight assistants — with
Selam's stylist matrix applied as the authority on who does what.

The staff area, which was a list of permission keys, is now the day: grouped by
person, visits marked so a founding and a finishing read as one head, and a star
on anyone the customer asked for by name. There is no role check in that file —
row-level security decides what comes back, so a stylist sees their column and a
receptionist sees the salon from identical code.

**Broke / unresolved:** Nothing broken. Several things deliberately unfinished.

EVERY PRICE, DURATION AND LEAD TIME IN THE TREE IS A GUESS. They are shaped like
real numbers so the engine could be built and seen working. Selam's real figures
are update statements whenever they arrive; nothing depends on them being right.

The 16:30 cutoff on knotless braids is currently unreachable — the two-hour
overhang cap stops it at 15:00 first. Deferred deliberately.

Two judgements in the stylist matrix need Selam: Braided Ponytail and Circle
Half Cornrows Half Curls are filed as with-extensions on the common answer
rather than a known one, and Fikir's Hair Trim cell was blank rather than Y or
N, so Fikir is off it.

Days off are one a week each, staggered, and invented. Real time off replaces
them.

Announcements were asked for and not built — they are the internal notes system
PROJECT.md rules out of v1, and that is a scope decision to make on purpose.

Demo bookings sit on the calendar so the day view has something in it. Three
customers named "Demo — …"; the removal statement is in commit fce0537.

Two bugs worth remembering, both found by testing rather than reading. The
availability search returned the SAME times with and without the customer's
answers, because candidates were generated from the service's base duration
while the answers made the job longer — the failure this whole line of work
exists to prevent, reintroduced one layer up. And adding a parameter to
schedule_permits created a SECOND function beside the original rather than
replacing it; four overloads where there should have been two, working only
because Postgres prefers an exact arity match.

**Next:** The dense one-screen entry form for phone bookings — PROJECT.md calls
it the feature that decides whether this survives contact with reality, and it
now has a day to land in. After that the customer funnel: one question per page,
the visit strip with its + button and per-service professional dropdown, then
the professional and date steps.

Nothing customer-facing uses any of this yet. The public site still calls
get_available_slots() and books single-employee visits, so the engine is
complete and unreachable.

---

## 2026-08-21 — Redesign the public site, and wire up the things that should be tappable

**Built:** The shopfront now looks like the salon rather than like a template.
Dark warm near-black, gold, Cormorant Garamond at weight 300 over Jost, square
corners, letterspaced small capitals. Committed as 166f418.

Three rounds got there, and two of them were wrong. The first was editorial
print on cream paper — serif, hairlines, narrow column — and read as dated. The
second was bold geometric sans on dark, which had the right colours and the
wrong voice. The third was picked from options shown side by side before
anything was built, which is what should have happened first.

Three decisions in that commit are load-bearing and are written up in its
message. The dark palette is a class on ONE element in the public layout rather
than on `:root`, so `/staff` and `/login` inherit nothing and stay light — that
is also the hook a second salon's colours will hang on. Every band of content is
wrapped in a single `shell` utility, which is why headings, prices and
photographs all start on the same vertical line at every width; the drift before
it came from each page carrying its own padding. And the logo is gold artwork on
a black square drawn with `mix-blend-mode: screen`, which makes the black
disappear into the page with no cut-out and no halo.

The gold was measured, not chosen. Decoding the logo and counting its brightest
pixels put it at #f0d050, so that is what the site uses. An earlier muted
antique gold was the more tasteful choice and failed the only test that
mattered: it could not be seen.

Also wired up, because they were the same visit: tapping a service goes to
`/book?s0=<id>` and lands on the time picker with that service already chosen
rather than asking again; addresses in the footer, on the homepage and on the
contact page open a map; and every printed phone number dials, through one
`PhoneLink` component instead of six copies of the same `tel:` rule.

**Broke / unresolved:** Nothing broken. Two temporary things are in the tree and
both are marked in the code. The photographs in `lib/site/stock-photos.ts` are
Unsplash stand-ins used only where the database has no image, and
`next.config.ts` allows that host for as long as they exist. The logo sits in
`/public/brand/` rather than Supabase Storage; the code reads
`public_settings.logo` first, so uploading it retires the fallback with nothing
else edited.

`supabase/scripts/set-kedus-highlights.sql` has NOT been run — it fills in the
three small facts under the hero and the values in it are guesses, not Selam's.

Two bugs found by looking at renders rather than at code: the footer came out
near-black on near-black, because `ink-inverse` means "text on the brand colour"
and the brand colour is now gold; and a terracotta link measured 3.4:1 against
the background, under the 4.5:1 small text needs.

**Next:** The braiding option engine from the mind map. The plan is agreed and
nothing is built. Ten categories, but only Braiding is an engine — the rest are
flat lists the current `services` table already handles. Prices and durations
add up from the options chosen, and that addition has to happen inside
`create_appointment()` rather than in the form, or the calendar can be lied to.
Photo-upload requests get their own table with no slot attached, because an
appointment row holds its time the moment it exists and an unpriced request has
no time to hold. Stage 1 is the category tree, and it needs Selam's numbers
before it is worth starting.

---

## 2026-08-20 — Audit the booking flow, then fix what it found

**Built:** An audit of every public page and the whole booking path, read
against how the established salon platforms build the same thing. Eight
findings. Then the two that mattered, plus two screens' worth of flow.

**Migration 026 — the rota became a rule.** `get_available_slots()` was the only
function in the database that read `employee_working_hours` or
`employee_time_off`. `hold_slot()` and `create_appointment()` never did: they
checked the services, the employee and the overlap against existing
appointments, then accepted whatever `starts_at` they were handed. The booking
form posts that time as a hidden field, so a request carrying a time the picker
never offered was held and booked — three in the morning, a closed Sunday, or
the middle of a stylist's booked holiday. Time off is not an appointment, so the
exclusion constraint never saw it either. Nothing at all refused that row.

The fix that suggests itself is to check the time appears in the list
availability offered, and it is wrong. Migration 018 deliberately stopped
offering times on a grid — each free stretch starts its own sequence from
wherever the previous appointment ended — so the offered list changes shape as
bookings arrive. A customer holding 10:45 while somebody else books 09:00–10:30
would find 10:45 gone from the list, not because it was taken but because the
stretch it is measured from now begins elsewhere. Membership would refuse a
booking that is valid and held.

The rota did not move, so `schedule_permits()` asks the rota: working hours,
time off, lead time, horizon. What makes it safe is that availability can only
ever offer times already satisfying all four, so it permits a superset of what
is offered and can never refuse something a customer was shown.
`test-availability.sql` check 9 asserts that relationship directly rather than
trusting it — which is what lets the offering rules change freely afterwards.
DECISIONS #30.

**The alternatives offered when a slot is taken.** `findAlternatives()` computed
and ranked them well and none of it reached anybody: the links carried
`services` and `at`, which nothing reads, and no `party`, so `clampParty()`
returned null and the customer landed back on "how many people are coming?" —
losing every choice, at the moment they were most likely to give up. They are
forms posting to `chooseTime` now, so one tap holds the new slot. That moved the
error block above the booking form, because a form cannot contain a form.

**Two screens of flow.** `/book` no longer opens by asking how many people are
coming; one is the default and the party screen sits behind a link. And the flat
list of twenty-four services is grouped by category, with the categories as a
filter rather than a step — a separate screen charges a tap to everybody,
including the man who wants a haircut and can already see it.

**Written down:** DECISIONS #30 (above) and #31 (the buffer is dropped only when
nothing follows it — the arithmetic does not work below 30 minutes, and above it
the buffer is sweeping hair off the floor rather than slack in the schedule).
Plus a ROADMAP section holding five designed-not-built changes to how times are
offered, the segmented-services generalisation on the wash-aware note, no-show
marking pulled into Phase 5's first version, and two new open questions.

**Broke / unresolved:**

**Two false alarms, both worth remembering.** The first test run reported that
nothing refused a 3am booking — correctly, because the migration had been
written but never pushed. `supabase migration list` showed it local with an
empty remote, which is the query to reach for first next time. The second was
`test-availability.sql` failing six of eight checks: it picks one employee,
inserts working hours for that employee, then asks `get_available_slots` for the
whole salon. Fine when written, because nobody else had a rota. Broken since
2026-08-18, when `seed-working-hours.sql` gave every bookable employee the
salon's full opening hours, so three or four stylists now answer every query and
every count is multiplied. Scoped to one stylist and fixed. **Neither was a
fault in the booking code, and roughly half this session went into establishing
that.**

**iCloud is syncing the project.** The build failed once on `routes.d 2.ts` and
two siblings — conflict copies inside `.next`, because `~/Documents` syncs by
default. Deleted, and the build passed. It will recur, and it produces errors
that look like broken code. The project wants to live outside `~/Documents`.

**The braiding catalogue is designed and nowhere on disk.** Category → (with
extensions?) → style → size → length → colour, with price and duration
accumulating. Two new tables (`service_option_groups`, `service_options`), one
new column (`services.extensions`), a snapshot table (`appointment_options`)
copying the chosen options onto the appointment the way `price` already is, and
three functions taking an option list so duration is computed in the database
rather than passed in. `schedule_permits()` needs no change, which is the
DECISIONS #30 shape paying off early. Three migrations, 027–029. **Not
approved, not written, and it exists only in the conversation** — the largest
loose thread here.

Two smaller ones: the length list was proposed and never corrected (bob,
shoulder, bra-strap, mid-back, waist, hip, knee), and whether the receptionist
gets `service.manage` is still open — the conversation assumed they can edit
durations and the database does not allow it, and the same key also controls
prices.

**Also noticed, not fixed:** the services page has no Book button. A customer
reading the price list, deciding on a wash and blow dry, has to go and find the
booking page. The only route into booking on the whole site is the nav link.

**Next:** The day view. Phase 5, and the thing with a deadline attached — a
customer can book tonight and nobody at the salon can see it, because there is
no calendar and no manual entry. Build the day view first and let the staff
shell fall out of it rather than framing an area before there is anything to put
in it; manual entry immediately after. Check who holds `appointment.view_all`
before starting, because the day view's first real question is whose
appointments you are allowed to see.

The braiding catalogue after that, not before. It is probably the highest-value
feature in the product for this salon, and it is a lot of machinery to build in
front of a calendar that does not exist.

---

## 2026-08-17 (later) — Phase 4 begins: the customer record

**Built:** Migration 012 — `customers`, `customer_care_notes`, `customer_flags`.
The first tables holding data about people who never agreed to be in a database,
and the first place this project's standing rule ran out.

That rule was "RLS hides rows, grants hide columns," and it has carried every
table so far. It does not reach field-level permissions. A grant is granted to a
*Postgres* role, and there are only three — `anon`, `authenticated`,
`service_role`. Every logged-in member of staff, owner through stylist, connects
as `authenticated`. So a column grant can say "all staff" or "no staff" and can
never say "stylists yes, receptionists no", which is the whole of DECISIONS #9.

The fix is that allergies, sensitivities and hair formula moved to their own
table, where the question becomes a row-level policy calling `has_permission()`.
Field-level became row-level, on machinery that already existed and was already
tested. `customer_flags` was always going to work this way — it carries a
`min_permission` per row so each flag names its own audience — so this makes the
customer record one idea instead of two. Written up as DECISIONS #27, including
the alternative not taken: one table read through a view that blanks columns.
That gives per-*column* granularity rather than per-*group*, and was rejected for
the machinery it drags in, not because it was wrong.

`min_permission` references `permissions (key)`. A typo there would otherwise
create a flag nobody on earth can read, owner included, and nothing would report
it as an error.

Matching is on `phone_digits`, a generated column Postgres computes as `phone`
with every non-digit stripped. `+1 (202) 555-0143` and `+12025550143` are one
person and two strings; the second insert is now refused by the database rather
than by a tidy input box in a browser that an import or the SQL editor never
sees. It deliberately does *not* invent a missing country code — that would
hardcode one country into a multi-tenant schema.

Four permission keys, and the first that Receptionist and Stylist have ever held:
migration 003 promised theirs would arrive with customers, and they have.
Receptionist gets financial flags and no clinical detail; Stylist gets allergies
and no financial flags. No `anon` grants on any of the three tables — not a
restricted list, nothing at all. The booking form will go through
`createAppointment()`.

`test-tenant-isolation.sql` extended to give the other salon a customer, an
allergy and a flag. It needed it: before that, `customers` could have shipped
with no policy at all and the script would still have printed a passing row. Ten
columns now, and it passed — `1, 4, 21, 0, 0, 0, 0, 0, 0, 0`. The 21 is not a
number that merely looks plausible; it is Owner 9 + Manager 7 + Receptionist 3 +
Stylist 2, so the backfill did exactly what was designed and no role picked up
anything extra. `audit-tenant-safety.sql` returned no rows.

**Broke / unresolved:** The first `db push` did not reach the database, and both
of us believed it had. `supabase migration list` showed `remote` empty for 012
while every earlier migration had a value. Cause never established — most likely
the confirmation prompt, or the trailing space in the folder name, which makes
`cd ~/Documents/Salon System` land somewhere else. **Check `migration list`
rather than trusting that a push succeeded.**

The generated TypeScript types describe `phone_digits` as writable and nullable.
Both are wrong — Postgres refuses writes to a generated column, and `phone` is
not null. Nothing enforces this in the editor; just don't write to it.

Docker still isn't installed, so `db push` warns that it failed to cache the
migrations catalog. Harmless, and unchanged from previous sessions.

`audit_log` now holds copies of allergies and hair formulas inside `changes`.
That is correct — it is what an audit trail is for — but it means the eventual
audit-viewing screen has a hard constraint attached: its gate must be at least as
strict as `customer.view_sensitive` or it is the back door around every policy in
migration 012. Noted in SCHEMA.md so it isn't discovered late.

Under the approved grid a Stylist cannot write care notes, only read them. So a
stylist recording their own hair formula after an appointment is not possible
yet. That is a Phase 6 decision, not an oversight, but it will come up the first
time someone tries.

Permissions attach to a *role*, not to a person. The ask this session was for
per-staff-member control — "Hanna can see financial flags, other stylists can't"
— and that does not exist. Deliberately not smuggled into 012: it needs a
per-profile overrides table and a rewrite of `has_permission()`, which every
policy in the database depends on. Logged as an open question in ROADMAP.

The SESSION_LOG entry for 2026-08-15 (the app half) is still missing.

**Next:** `employee_working_hours` and `employee_time_off` — availability cannot
be computed without them — then seeding the salon's real working hours, then
`createAppointment()`. The phone normalisation helper and its organization
setting land with the booking form.

---

## 2026-08-17 — Phase 3, the first thing on screen

**Built:** Generated database types, at last. `supabase gen types typescript
--linked` reads the schema off Salon dev over the network, so Docker never came
into it. Both Supabase clients now take `<Database>`, and the cast in
`getProfile()` is gone — it typechecks without one, which is only true because
migration 010 *replaced* `profiles_role_id_fkey` rather than adding a second
path to `roles`. Two paths and PostgREST could not have inferred the embedded
role.

`src/lib/site/organization.ts` — `getOrganization()`, the only place a page
learns which salon it serves. It returns the org's `id`, and every public page
scopes its queries by that; no page names a salon. The slug comes from
`SITE_ORG_SLUG`, defaulting to `kedus-hair-salon` so a fresh clone runs without
anyone discovering an undocumented variable first. One deployment serves one
salon today. When several share one, the slug comes from the request hostname
instead — two lines inside `currentOrgSlug()` and nothing else in the app.
`public_settings` is read defensively rather than trusted: a salon with no
about paragraph gets a page without one, not a crash.

The `(public)` route group, so `/login` and `/staff` do not inherit a salon's
header and footer. A tool is not a shopfront. The page title template lives in
that layout rather than the root, because the root must not know which salon it
is serving.

The homepage. Every word from the database: name, tagline, about, the
Tuesday–Thursday promotion, the five service categories derived from `services`,
opening hours, address. No Book button — booking is Phase 4 and the phone is how
this salon actually takes bookings — and no nav links, because each page adds
its own as it is built.

`globals.css` now holds semantic tokens and no component names a colour.
`@theme inline` is load-bearing: it compiles utilities to read `var(--brand)`
rather than baking the hex in, so a per-salon colour read from the database will
actually take effect later. Plain `@theme` resolves at build time and would
silently do nothing. Committed to light in both system settings — a salon's
colours are chosen against daylight, and auto-inverting them produces something
nobody approved. Fraunces added for headings; the unused Geist Mono removed.

Migration 011 — `gallery_images`, and `services.image_url` /
`employees.photo_url` renamed to `image_path` / `photo_path`. A full Storage URL
contains the project's own domain, and the day the prod project is created every
stored URL points at the old one and every photograph breaks at once, silently.
Both columns were null on every row, so the rename moved no data. `alt_text` is
`not null` with a check against whitespace: made optional it would be skipped
every time. No new permission key — the gallery is guarded by
`organization.edit`, which already covers the tagline and the hours, and which
meant not rewriting `create_organization()` for the third migration running.
That function is how migration 009 came to exist.

`middleware.ts` → `proxy.ts`, deprecated in Next 16. Done by hand rather than
with the codemod, which renames the function but would have left every comment
in the repo talking about middleware. `src/lib/auth/middleware.ts` →
`session.ts` while there: it was named after a convention that has now been
renamed out from under it. Proxy runs on the Node runtime by default where
middleware ran on Edge.

Five commits, and the first `git push` in a while — GitHub was five behind, not
one. Everything from the services table onward had been local-only.

**Proven, not just written:** The homepage was served and the HTML read back, not
eyeballed. Five categories with counts 8, 7, 3, 3, 3 — 24, matching the seed.
Hours collapsed into runs: "Monday – Saturday 9:00 am – 7:00 pm" and "Sunday
9:00 am – 5:00 pm". Instagram, TikTok and Yelp in the footer and **no Facebook**,
because it is null in the seed — the null-skipping working rather than asserted.

Isolation holds with `gallery_images` — 1, 4, 8, 0, 0, 0, 0. The test now
inserts a photograph for the other salon and counts it, so the promise that a
missing policy makes the counts stop matching is true for this table too. The
permission count did not move, which is the reused `organization.edit` showing
up as an absence. `audit-tenant-safety.sql`: no rows.

`alt_text` is required in the generated Insert type — a `not null` constraint
arriving in TypeScript without anyone writing it twice. A typo in a `.select()`
is now a compile error rather than a blank page. No deprecation warning in a
fresh dev or build, and `/staff` still 307s to `/login` while logged out.

**Broke / unresolved:** I said a logged-in owner would see a different homepage
than a customer, then checked: there is no visible difference. `services_select_
anon` filters `is_active` and `services_select_member` does not, but the seed
never sets `is_active = false`, so both return the same 24 rows. The mechanism is
real and currently invisible. Set `is_active = false` on one service to see it.
The lesson is the ordinary one — I asserted a behaviour instead of testing it.

The `site-images` bucket **still does not exist**. `supabase storage ls` returns
nothing. The CLI manages objects but cannot create a bucket, so it is a dashboard
click, and nothing can be uploaded until it happens. Migration 011 deliberately
does not touch the `storage` schema, which this project does not own.

There are no photographs at all. Asked to take them from the salon's social
accounts: the Instagram profile *is* publicly readable and returned 12
`scontent-*.cdninstagram.com` thumbnails, but those URLs are signed and expire
within hours, so a gallery built on them is broken by next week. They are also
compressed squares, poor as a hero image, and the people in them agreed to an
Instagram post rather than to a commercial website. TikTok needs JavaScript and
a login and returned nothing. The originals are on the phone that posted them —
ask the salon, along with headshots of the real team.

The homepage has never been opened on a real phone. `/login` and `/staff` still
carry `dark:` variants while the public site is light-only, so on a dark-mode
machine the login inputs will look dark against a light page — cosmetic, in the
staff area, left alone rather than touching four files outside the stage. The
five invented stylists are still in the data. DECISIONS #25 (how the site
resolves its organization, and the second-salon workflow) and #26 (theme tokens
in, never raw CSS from the database) are still unwritten.

Twice a running dev server served 500s after files moved underneath it. Restart
after any rename; the error means nothing.

Still no Vercel deploy and no prod project. Docker still not installed, so
`db push` warns about a catalogue cache it cannot build — third session, still
harmless.

**Next:** The `site-images` bucket, then `imageUrl()` and a hero image on the
homepage — where per-salon personalisation actually shows up. Then services and
pricing, which is where `price_display` finally gets a `formatPrice()` helper.

---

## 2026-08-15 — Phase 3, the database half

**Built:** Four migrations. `services` (007) with `price_display` taking `exact`,
`from` or `hidden`, so a salon can quote "from $120" or nothing at all rather
than being forced into a flat number. `employees` and `employee_services` (008),
where `profile_id` is nullable because an employee who never logs in still
belongs on the calendar. A regression fix (009). Composite foreign keys on
`roles` and `audit_log` (010). Two new permissions, `service.manage` and
`employee.record.manage`, both backfilled to Kedus, whose roles predate them.

`supabase/scripts/seed-kedus.sql` — 24 services with their real names and
categories, five employees, 66 mappings, the salon's real contact details
replacing the South African placeholders, and hours, socials and site copy in
`public_settings`. Sourced from kedushairsalonandbraiding.com.

`supabase/scripts/audit-tenant-safety.sql` — the session's most useful hour. It
asks the database what tables exist and reports any breaking the tenant rules:
missing `org_id`, RLS off, RLS on with no policies, a foreign key to a tenant
table not carrying `org_id`, `DELETE` granted, `anon` holding a table-wide grant,
missing `deleted_at`, or a `security definer` function without a pinned
`search_path`. No rows means clean. Unlike the isolation test it covers tables
that do not exist yet.

DECISIONS #21–24. Three commits.

**Proven, not just written:** Isolation holds with all three new tables — 1, 4,
8, 0, 0, 0. `select phone from employees` as `anon` is refused by Postgres, so a
stylist's number cannot reach a public page regardless of what any future query
asks for. An attempt to link Kedus's stylist to another salon's service fails on
`employee_services_service_same_org`; without the composite key it would have
succeeded silently with every RLS policy satisfied. A price change logs only the
`price` key with `from` and `to`; a soft delete logs as `entity.deleted` at
`critical` rather than as an update.

**Broke / unresolved:** Migration 007 was pasted into the SQL editor instead of
pushed, so the schema applied but the history table did not know — fixed with
`migration repair`. The rule that avoids it: migrations go through `db push`,
scripts go in the SQL editor.

I reintroduced a bug migration 004 had already fixed. Extending
`create_organization()` in 007 and 008 with `CREATE OR REPLACE`, I carried the
pre-004 signature along, and Postgres permits *adding* a default back — so
onboarding without naming a timezone silently meant Africa/Johannesburg again.
No organization was created in the window. Migration 009 restores it and the
function comment now says why not to.

The audit script found three foreign keys from migrations 001 and 006 pointing
at tenant tables by id alone: `profiles.role_id`, `role_permissions.role_id`,
`audit_log.actor_id`. None was exploitable, because `has_permission()` joins
`role_permissions` on both `role_id` and `org_id` — a profile aimed at another
salon's role gets nothing rather than someone else's access. That is one
undocumented line doing load-bearing work. Fixed in 010. The lesson worth
keeping: DECISIONS #21 was already written down and the violations were still
there.

**The seed's fictional half.** Every service name and category is real, as are
the hours, contacts, socials, tagline and two $40 prices. Every other price,
every duration and all five employees are invented. Two of those bite later:
durations are what Phase 4 computes availability from, so real ones block the
booking form, and the five staff are fictional people who must be replaced before
this site reaches a real domain or someone will phone up asking for Hanna.

The salon's own site is a source, not the truth — it links a Facebook page they
do not use, and gives an address mixing a DC street with a Maryland ZIP. Recorded
as Maryland; needs confirming before it hits a map. Their Instagram handle is
still unverified: the site says `kedus_hb`, the TikTok is `kedushairsalon`.

A stray `insert` ran three times and made three "Test Stylist" rows, because
`full_name` is deliberately not unique — two real people can share a name. Extras
soft-deleted. Guarding against a double-click belongs in the Phase 6 create form,
not in the database.

Still no Vercel deploy and no prod project. Still no generated database types, so
`getProfile()` casts. Docker still not installed, so `db push` warns about a
catalog cache it cannot build; harmless so far.

**Next:** Phase 3's pages — homepage, services and pricing, team, gallery,
contact — all reading from the tables seeded today. The first session with
something on screen.

---

## 2026-08-09 — Phase 2, the application half

**Built:** The Next.js app now talks to Supabase. Browser and server clients
from `@supabase/ssr`, with `.env.local.example` committed so the required
variables are documented. `/lib/auth` holding `getUser`, `getProfile`, `can`,
`requireProfile`, `requirePermission` — `can()` delegates to `has_permission()`
in Postgres, so the app and the RLS policies cannot disagree. Staff login at
`/login` through a server action, so the password is never handled by browser
JavaScript. Middleware refreshing the session token before every page load.
`/staff`, the first page the database guards. Five commits.

**Proven, not just written:** signed in as the Kedus Owner in a real browser and
got three yeses from the permissions catalogue. `/staff` typed straight into the
address bar while signed out redirects to `/login`. `grep` confirms the only
three `.auth.` calls in `src/` sit inside `/lib/auth`.

**Broke / unresolved:** `env.ts` first read variables as `process.env[name]`.
Next.js substitutes values by finding the literal text at build time, so that
would have arrived empty inside middleware — caught before it shipped, fixed by
naming each variable in full. The Owner password was lost and reset directly in
`auth.users` with SQL; acceptable on dev, not a habit to carry to prod. No
generated database types, so `getProfile()` casts. Session refresh works but
nothing tests it automatically — proving it needs an hour of waiting. Still no
Vercel deploy and no prod project.

**Next:** Phase 3, the public website. The `services` and `employees` tables
with their RLS policies come first, then the pages that read them.

---

## 2026-08-08 — Multi-tenant foundation

**Built:** Supabase CLI installed and linked to Salon dev. Six migrations:
tenancy core (organizations, profiles, roles, permissions, role_permissions),
access control (14 RLS policies, column-level grants, two `security definer`
helper functions, `settings` split into public and private), the permissions
catalogue plus `create_organization()`, timezone/currency moved to New York and
USD, `create_profile()`, and `audit_log`. Kedus Hair Salon and Braiding created
on dev with its four system roles, and its first Owner profile. DECISIONS #14–20.

`audit_log` is written by triggers rather than by application code, because the
RLS policies allow direct table updates through the API with no function in the
path — a function-based approach would have been quietly incomplete. The trigger
is `security definer` so it can write to a table that grants INSERT to nobody.
Verified: a real edit logs one row containing only what changed; an edit that
changes nothing logs nothing.

Phase 1 was redefined mid-session. It was written as "the whole database"; it is
now the multi-tenant foundation, with the remaining five tables moved into the
phases that use them. Phase 1 is complete, 14 of 14.

**Proven, not just written:** a second organization created inside a rolled-back
transaction is invisible to the Kedus owner — 1, 4, 4, 0. The permissions chain
resolves end to end from login through role to a yes/no, and an unknown
permission key denies rather than errors. Kept as
`supabase/scripts/test-tenant-isolation.sql`; re-run after adding any table.

**Broke / unresolved:** The first two migrations were run in the SQL editor
before the CLI worked, so the migration history needed repairing twice — schema
changes go through `db push` from now on. No prod project; deferred deliberately,
with the trigger recorded as the first real customer record. Remaining tables not
built — employees, services, customers, appointments, audit_log. Docker isn't
installed, so `supabase db dump` and local development don't work; not needed so
far. Nothing in the Next.js app talks to Supabase yet — no environment variables,
no client, no login page. The Kedus row's phone and address still hold the
original South African placeholders while `create-kedus-organization.sql` says
the US ones, so the script no longer reproduces the row — one update statement
fixes it. An unused throwaway auth user may exist in the dashboard; delete it if
so.

**Next:** Phase 2, the application half — environment variables, Supabase
browser and server clients, the `/lib/auth` module, and a staff login page.
`@supabase/supabase-js` and `@supabase/ssr` approved but not yet installed.

---

## [date] — Project setup

**Built:** Foundation documents added to repo. Nothing else yet.

**Broke / unresolved:** Nothing.

**Next:** git init, GitHub repo, Supabase dev + prod projects, Next.js scaffold,
first deploy to Vercel.

---

<!--
How to use this file:

At the START of a session, paste the top entry into Claude Code so it knows
where you left off.

At the END of a session, ask Claude Code to write the new entry. It knows what
it built. Check it, then commit it.

Be honest in "Broke / unresolved." A log that only records successes is a log
that lies to you in three weeks.
-->

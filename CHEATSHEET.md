# CHEATSHEET.md — Amahle

Your workflow reference. For you, not for Claude Code.

---

## Starting a session

1. Open the terminal in the project folder
2. `git status` — make sure you're clean before you start
3. `git pull` if you worked elsewhere
4. Start Claude Code
5. Paste the top entry of SESSION_LOG.md so it knows where you left off
6. Say what you want to build **this session** — one thing

## Ending a session

1. Make sure everything works
2. Commit
3. Ask Claude Code to write the SESSION_LOG.md entry
4. Check it's honest, then commit that too
5. `git push`

---

## The build cycle — never skip a step

```
PLAN  →  REVIEW  →  APPROVE  →  BUILD  →  TEST  →  COMMIT
```

- **Plan** — Claude Code describes what it will change and which files
- **Review** — you read it; if you don't understand it, ask before approving
- **Approve** — say go
- **Build** — it writes the code
- **Test** — you click through it yourself, in the browser
- **Commit** — restore point, so the next step can't destroy this one

If something goes wrong three steps later, the commit is what saves you.

---

## Git

```bash
git status                    # what's changed
git diff                      # what changed, line by line
git add .                     # stage everything
git commit -m "message"       # save a restore point
git push                      # send to GitHub

git log --oneline             # history
git checkout .                # throw away uncommitted changes
git revert HEAD               # undo the last commit, safely
```

**Commit message style:** what changed, in plain words.

```
add booking form
fix double-booking on same stylist
add RLS policies to appointments
```

---

## Opening the site on your computer

This is the one you'll do every single session.

**1. Open Terminal.**

**2. Go to the project folder.**

```bash
cd "/Users/kalkidanreda/Documents/Salon System "
```

The quotes are not optional. This folder's name has spaces in it — **including
one on the end**, after "System". Without quotes the terminal reads it as three
separate words and says `no such file or directory`.

Easier way: type `cd ` (with a space), then drag the project folder from Finder
onto the Terminal window. It fills in the path correctly. Press Enter.

To check you're in the right place, run `pwd`. It should print the project
folder.

**3. Start the site.**

```bash
npm run dev
```

**4. Wait for it to say Ready.** You'll see something like:

```
▲ Next.js 16.2.11 (Turbopack)
- Local:        http://localhost:3000
✓ Ready in 168ms
```

**5. Open `http://localhost:3000` in your browser.** On a Mac you can hold
Cmd and click the link in Terminal.

**6. Leave that Terminal window alone.** The site only runs while that command
is running. Closing the window or pressing `Ctrl-C` stops the site, and the
browser will say it can't connect.

To use the terminal for something else — `git status`, a Supabase command —
**open a second Terminal tab** with Cmd-T and work there.

**7. Editing a file reloads the browser by itself.** Save the file, look at the
browser, it's already updated. You don't restart anything.

**8. When you're finished:** click the Terminal window and press `Ctrl-C`.

### If it doesn't work

| What you see | What it means |
|---|---|
| `no such file or directory` | Step 2 — you're not in the project folder, or the quotes are missing |
| `command not found: npm` | Node isn't installed, or this is a fresh computer |
| `Cannot find module` | Run `npm install`, then try again. Needed after a fresh clone or a `git pull` that changed `package.json` |
| `Port 3000 is in use` | See below — it's already running somewhere |
| Browser says it can't connect | The terminal running `npm run dev` was closed |
| Every page is a 500 error | A file was renamed while the server was running. `Ctrl-C` and start it again |

---

## Next.js

```bash
npm run dev                   # local dev server, usually localhost:3000
npm run build                 # production build — run this before deploying
npm run lint                  # check for problems
npx tsc --noEmit              # check the types without building anything
```

`npx tsc --noEmit` is the fastest way to know you haven't broken anything. It
reads every file and tells you about wrong column names, missing fields and
typos, in a couple of seconds. Run it before you commit.

If something behaves strangely and you can't explain it:

```bash
rm -rf .next && npm run dev   # clear the build cache and restart
```

### "Port 3000 is in use"

You already have a dev server running somewhere — often in a terminal tab you
forgot about. Next will quietly start on 3001 instead, which is confusing
because your changes appear to do nothing on the address you have open.

```bash
lsof -ti :3000 | xargs kill   # stop whatever is holding port 3000
```

Then `npm run dev` again and it will take 3000 back.

### After any file is renamed or moved, restart the dev server

A running server keeps serving the old file list, so every page turns into a
500 error even though nothing is actually wrong. Stop it with `Ctrl-C` and
start it again. The error means nothing — don't go looking for a bug.

---

## Supabase

- **Dev project** — safe, break anything
- **Prod project** — the salon's real data, treat with respect

Environment variables live in `.env.local`, which is **never committed**.

### Always type `npx` in front

Supabase is installed inside this project, not on your whole computer. Plain
`supabase db push` gives you `command not found`. It is always:

```bash
npx supabase <command>
```

### The commands

```bash
npx supabase projects list               # which projects exist, and which one is linked
npx supabase migration list              # what's applied here vs on the server
npx supabase migration new name_of_it    # create an empty migration file
npx supabase db push                     # apply migrations to the linked project
npx supabase db reset                    # wipe and rebuild — DEV ONLY
```

`projects list` prints `"linked":true` next to the project you are pointed at.
**Check that before anything that writes.** Never run `db reset` against prod.

You will see a warning about Docker every time you push. Docker isn't installed
and doesn't need to be — the command still works. Ignore it.

---

## Making a database change, start to finish

Do these in order. Each step depends on the one before it.

**1. Ask Claude Code to plan the migration and read it before it runs.**
A migration is the one thing that is genuinely hard to undo.

**2. Create the file**

```bash
npx supabase migration new what_it_does
```

This makes an empty file in `supabase/migrations/` with a timestamp in front.
The timestamp is how Postgres knows what order to run them in — never rename
one.

**3. Apply it**

```bash
npx supabase db push
```

Migrations go through `db push`. **Never paste a migration into the dashboard's
SQL editor** — the change lands but the history table doesn't know, and it has
had to be repaired twice already. Scripts go in the SQL editor; migrations go
through `db push`.

**4. Regenerate the types — do not skip this**

```bash
npx supabase gen types typescript --linked --schema public > src/lib/supabase/database.types.ts
```

This file tells TypeScript what every table and column is called. If you skip
it, the file describes a database that no longer exists, and it will confidently
tell you a column is fine when it isn't.

**5. Prove nothing leaked.** Open the SQL editor in the dashboard and run both:

- `supabase/scripts/test-tenant-isolation.sql` — one salon must not see
  another's rows. The numbers to expect are written at the top of the file, and
  they change as tables are added. **If they don't match, stop and ask.**
- `supabase/scripts/audit-tenant-safety.sql` — asks the database which tables
  break the rules. **No rows means clean.** It found three real problems the
  first time it ran.

**6. Check the app still compiles**

```bash
npx tsc --noEmit
```

**7. Commit** — the migration file, the regenerated types, and any script you
changed, together.

---

## Storage (photos)

Photo files live in a Supabase bucket called `site-images`. The database only
stores the *path* to a photo, never a full web address.

```bash
npx supabase storage ls --experimental                    # list buckets
npx supabase storage ls "ss:///site-images/" --linked --experimental
npx supabase storage cp ./photo.jpg "ss:///site-images/hero.jpg" --linked --experimental
```

Two things the terminal **cannot** do, both dashboard jobs:

- **Creating a bucket.** Storage → New bucket.
- **Deleting a file.** `storage rm` reports success and deletes nothing. Use
  Storage → tick the file → Delete.

---

## Phrases that keep Claude Code on track

- "Plan first, don't write anything yet"
- "Show me the plan before you save"
- "Explain that in plain English"
- "One thing at a time — just do the first part"
- "What should I test now?"
- "Is this in v1 scope?"
- "Why did you choose that approach?"
- "What could break because of this change?"

---

## When something breaks

1. Don't panic and don't start changing things randomly
2. Copy the **whole** error message
3. Paste it to Claude Code and ask for a plain-English explanation **before** a fix
4. Ask what it will change before it changes it
5. If you're deep in a mess: `git checkout .` and go back to the last commit

Losing twenty minutes of work is much cheaper than debugging a broken app you
can't return from.

---

## Rules for yourself

- One feature per session where you can manage it
- Commit more often than feels necessary
- If you don't understand what was built, you haven't finished — ask
- Never develop against the salon's live database
- When you want to add something not in v1, write it in ROADMAP.md under "After
  v1" instead of building it
- When you make a decision, write it in DECISIONS.md the same day

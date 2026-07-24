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

## Next.js

```bash
npm run dev                   # local dev server, usually localhost:3000
npm run build                 # production build — run this before deploying
npm run lint                  # check for problems
```

If something behaves strangely and you can't explain it:

```bash
rm -rf .next && npm run dev   # clear the build cache and restart
```

---

## Supabase

- **Dev project** — safe, break anything
- **Prod project** — the salon's real data, treat with respect

Environment variables live in `.env.local`, which is **never committed**.

```bash
supabase migration new name_of_change    # create a migration file
supabase db push                         # apply migrations
supabase db reset                        # wipe and rebuild dev — DEV ONLY
```

Never run `db reset` against prod. Check which project you're linked to first.

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

# Amahle

A business operating system for beauty businesses. Currently being built for one
real hair salon.

---

## Folders

| Folder | What's in it |
|---|---|
| **frontend/** | The Next.js app — public website, staff app, and the server code behind them |
| **backend/supabase/** | The database — migrations (schema history) and SQL scripts (seeds, fixes, tests) |
| **docs/** | Every project document except this one and CLAUDE.md |

## Documents

| File | What it's for | Who reads it |
|---|---|---|
| **docs/PROJECT.md** | What the app is, who it's for, why the architecture is what it is | Claude Code, first thing every session |
| **CLAUDE.md** | The rules Claude Code must follow | Claude Code, automatically |
| **docs/ROADMAP.md** | Scope, phases, what's done and what's pending | Both |
| **docs/DECISIONS.md** | Every decision, dated, with reasoning | Both |
| **docs/SCHEMA.md** | Every table and column in plain English | Both |
| **docs/GLOSSARY.md** | One word per concept, used everywhere | Both |
| **docs/SESSION_LOG.md** | What happened each session | Both |
| **docs/CHEATSHEET.md** | Commands and workflow | You |

## Stack

Next.js (App Router) · TypeScript · Tailwind · Supabase (Postgres, Auth, RLS) ·
Vercel

## v1 scope

Public website · online booking · shared staff calendar with manual entry ·
customer records · employee records · role-based permissions

Everything else is deliberately out. See docs/ROADMAP.md.

## Getting started

```bash
cd frontend
npm install
cp .env.local.example .env.local    # fill in Supabase keys
npm run dev
```

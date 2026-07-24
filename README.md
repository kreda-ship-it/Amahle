# Amahle

A business operating system for beauty businesses. Currently being built for one
real hair salon.

---

## Documents

| File | What it's for | Who reads it |
|---|---|---|
| **PROJECT.md** | What the app is, who it's for, why the architecture is what it is | Claude Code, first thing every session |
| **CLAUDE.md** | The rules Claude Code must follow | Claude Code, automatically |
| **ROADMAP.md** | Scope, phases, what's done and what's pending | Both |
| **DECISIONS.md** | Every decision, dated, with reasoning | Both |
| **SCHEMA.md** | Every table and column in plain English | Both |
| **GLOSSARY.md** | One word per concept, used everywhere | Both |
| **SESSION_LOG.md** | What happened each session | Both |
| **CHEATSHEET.md** | Commands and workflow | You |

## Stack

Next.js (App Router) · TypeScript · Tailwind · Supabase (Postgres, Auth, RLS) ·
Vercel

## v1 scope

Public website · online booking · shared staff calendar with manual entry ·
customer records · employee records · role-based permissions

Everything else is deliberately out. See ROADMAP.md.

## Getting started

```bash
npm install
cp .env.example .env.local    # fill in Supabase keys
npm run dev
```

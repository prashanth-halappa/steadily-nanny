# Monorepo Template

A Bun monorepo starter for shipping a mobile app with a real backend fast: **Expo SDK 57 (React Native) + Express 5 + Supabase**, with the cross-cutting mechanisms a production app needs already wired in — auth, layered API architecture, monetization (RevenueCat), push notifications, remote-config/kill-switch, an LLM integration (Google Vertex AI via the Vercel AI SDK), a store-rating prompt, and i18n. It ships with one compiling example feature (the "widget" domain) end-to-end so none of this is theoretical — clone it, run it, and it boots.

This is a **template**, not a shared runtime library. You copy it once per app and diverge freely from there.

## The two jobs this repo supports

| You want to… | Read, in order |
|---|---|
| **Create a new app from this template** | [`SETUP.md`](./SETUP.md) (code-side: identities, env, EAS) → [`PROVISIONING.md`](./PROVISIONING.md) (dashboard-side: Supabase, Apple, Google, RevenueCat, Sentry, PostHog, EAS, Cloud Run) → boot it and confirm it against `docs/09-TESTING.md`'s suite |
| **Build features in an app made from this template** | [`CLAUDE.md`](./CLAUDE.md) (toolchain rules, conventions, the add-a-feature recipe) → [`docs/README.md`](./docs/README.md) (the architecture/conventions playbook set, docs 01–10) |

An AI agent (or a human) with nothing but this repo should be able to do either job start to finish without outside context. If you get stuck and the answer isn't written down anywhere in this repo, that's a documentation defect — the same severity as a code defect.

## How it fits together

```
apps/mobile (Expo SDK 57, expo-router, NativeWind, TanStack Query, Zustand+MMKV)
   │  axios + Supabase JWT (single-flight 401 refresh)
   ▼
apps/api (Express 5, /api/v1/* behind validateSupabaseToken; /api/jobs/* behind an API key)
   │  supabaseService (service-role key, bypasses RLS — server-only)
   ▼
Supabase (Postgres + Auth + Storage; RLS on every table)
   └── LLM: Google Gemini via the Vercel AI SDK, through Vertex AI (ADC — no API key)

packages/shared-types — the contract both apps import (no build step, path-alias only)
```

The one working feature, top to bottom — `apps/api/src/domains/widget/` (migration → repository → service → controller → routes) and `apps/mobile/src/domains/widget/` + its API endpoint/hooks/screen — is the reference implementation for every doc in this repo and the pattern you copy for your own first feature (see `CLAUDE.md`'s "add a feature" recipe).

## What's NOT in v1

This template is deliberately slim. Legal/consent publishing, translation tooling, most of the email template library, Cloudflare edge workers, a re-consent gate, a content-generation gate, and a few other subsystems are **documented but not shipped** — see [`PORTING.md`](./PORTING.md) for the full list, why each was left out, and how to bring it in later if your app needs it. [`GOLDEN-FIXES.md`](./GOLDEN-FIXES.md) is the living record of hard-won production bugs and where their fixes live in this repo (or, for the excluded subsystems, that they're documented-only for now).

## Repo layout

```
apps/
  api/      Express 5 + Supabase + Vertex AI — see docs/04, docs/05
  mobile/   Expo SDK 57 + expo-router + NativeWind — see docs/06, docs/07
packages/
  shared-types/   Zod schemas, DTOs, error codes, app-config shape — see docs/03
supabase/
  migrations/     8 SQL migrations: profiles, devices, jobs, app-config/beta, subscriptions, cron+Vault, widget example
docs/               The architecture/conventions playbook (10 numbered docs) — read via docs/README.md
scripts/setup.ts    The identity find-replace tool — see SETUP.md
```

**Package manager: Bun `1.3.9`, everywhere — never `npm`/`yarn`.** See `docs/01-STACK.md` for the full toolchain list.

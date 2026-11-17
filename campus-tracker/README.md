# MBA Admissions OS

A personal MBA admissions command center: schools, applications, requirements, essays with version history, documents, recommenders, AI coaching, interviews, scholarships, finances and decisions.
Stack: Next.js (App Router), TypeScript, Tailwind v4, Supabase (Postgres, Auth, Storage), Anthropic Claude API, Recharts, Zod.

## Setup
1. `npm install`
2. Create a Supabase project. In the SQL editor run every file in `supabase/migrations/` in order (001 to 018).
3. Copy `.env.example` to `.env.local` and fill in:
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (Project Settings > API). These are inlined at build time.
   - `ANTHROPIC_API_KEY` (optional: without it, AI features show "not configured" and everything else works). Runtime, server only.
   - `SUPABASE_SERVICE_ROLE_KEY` is NOT used by the app. Never put it in client code.
4. In Supabase Auth settings, decide whether email confirmation is required (the login page handles both).
5. `npm run dev`, open http://localhost:3000, create an account. On first login the 26 research-candidate schools are created (names, countries and cities only; no statistics are seeded).

## Tests
- `npm test` runs unit tests for pure logic (readiness, deadline risk, scoring, calculations).
- `npm run test:import` backs up one user in an in-memory Postgres and restores it as another user in a fresh database (counts, triggers, ready stage, ownership, RLS, idempotent re-run).
- `npm run test:db` runs the migrations in an in-memory Postgres (PGlite) and tests RLS isolation, stage guards, essay versioning and storage policy as two separate users.
- These do not replace testing against your real Supabase project and a browser. See AUDIT.md for what has and has not been verified.

## Deployment and portability
- [docs/DEPLOY.md](docs/DEPLOY.md): Vercel, Docker (compose, Fly.io, Render, Railway, a VPS), environment variable table (build-time vs runtime), Supabase Auth URLs, checklist.
- [docs/MIGRATING.md](docs/MIGRATING.md): move to a new Supabase project (migrations, backup, restore, copying the Storage bucket, verification).
- The `Dockerfile` and `docker-compose.yml` are checked statically only; the image has not been built or run. The Vercel and other host steps are likewise unrun.
- Install on a phone: the app has a web manifest and icons ("Add to Home Screen" over HTTPS). There is no service worker, so offline mode is not supported.
- Settings has a full JSON backup and a "Restore from a backup" (merge only, never overwrites). Uploaded files in Storage are not part of the backup and must be copied separately.
- `GET /api/health` returns `{"ok":true}` without authentication, for container and host health checks.

## Integrations needing credentials or not built
- Anthropic API: needs `ANTHROPIC_API_KEY`.
- Email sending and Google Calendar: NOT configured. Reminders are in-app only; email drafts are for you to copy and send yourself.

## Data handling
- Every table is owner-only via Row Level Security. Storage bucket `documents` is private; files live under `<user_id>/...`.
- School facts must carry a source URL, name, access date and publication year, and show verification status. Nothing is invented.
- AI output is labelled and never fabricates achievements or recommender opinions.

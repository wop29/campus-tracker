# MBA Admissions OS: QA and Product Audit

Audit date: 2026-11-16. Scope: the 15-step journey you specified, plus security and fabricated-data checks.

## 1. Read this first: what was and was not tested

This app was built in this session and audited in the same session. The audit had **no live Supabase project, no Anthropic key and no browser session against a running instance**. So I could test the database layer, the business logic, the build and the HTTP edge, but **not the screens working end to end**.

| Layer | How it was tested | Result |
|---|---|---|
| Database (RLS, triggers, constraints, storage policy) | `npm run test:db`: migrations run in a real Postgres engine (PGlite), exercised as two separate users | 23/23 pass |
| Business logic (readiness, deadline risk, scoring, NBA rules, diffing, finance maths, prompt builders and validators) | `npm test`, 177 unit tests | 177/177 pass |
| Code vs schema (every table, column, rpc and onConflict referenced by the app) | `node scripts/check-queries.mjs`, 311 references; I planted 5 errors to prove it detects them | 0 problems |
| Types and production build | `tsc --noEmit`, `next build` | Clean, 24 routes |
| HTTP edge | Ran the built server: signed-out page requests redirect to /login; signed-out API calls return 401 JSON; security headers present | Pass |
| Page rendering in headless Chrome against a stand-in backend that returns empty data (14 pages, desktop plus one mobile view) | Every page loads and renders its empty state with 0 JavaScript or console errors | Pass (rendering only) |
| **Forms, buttons, charts with real data, and dashboard metric values** | **Not run** | **NOT TESTED** |
| **Data actually persisting to a live Supabase project** | **Not run** | **NOT TESTED** |
| **Live AI output (Anthropic)** | **Not run.** Only prompt builders and response validators were tested on fixed inputs | **NOT TESTED** |

The status column in section 4 therefore says **PASS (backend)** where the database and logic layer was verified. It never means "the screen works". Treat the UI as unverified until you run section 5.

## 2. Prioritized bug list

### Fixed during the audit
| ID | Severity | Finding | Fix | Regression test |
|---|---|---|---|---|
| BUG-001 | High | The "cannot be Ready with open mandatory requirements" rule could be bypassed by inserting an application directly with `stage='ready'`, because default requirements are created after the row exists. Any API client could skip the blocker rule. | Migration `017_fix_ready_insert_guard.sql` | `test:db` BUG-001 (failed first, passes now) |
| BUG-002 | Medium | Signed-out API calls were redirected to the login page (HTML), so a client with an expired session would try to parse HTML as JSON. | `proxy.ts` returns `401 {"error":"unauthorized"}` for `/api/*` | Verified on the running build |
| BUG-003 | Low | `X-Powered-By` exposed; no basic security headers. | `next.config.ts` | Verified on the running build |
| BUG-004 | Low | Email-confirmation links had no landing route, so a new user finished confirmation and was sent to the login page. | Added `/auth/callback` and `emailRedirectTo` | Build only; needs a live check |

### Open (not fixed)
| ID | Severity | Finding |
|---|---|---|
| OPEN-01 | High (process) | **No end-to-end test has been run.** Whether any screen works against real Supabase is unknown. Section 5 gives the exact run order. |
| OPEN-02 | Medium | **No password reset flow** (no "forgot password"). A locked-out user cannot recover the account from the UI. |
| OPEN-03 | Medium | **Multi-table writes are not transactional** (create application plus deadline, stage plus decision, deposit date plus deadline, recommendation status plus checklist item). A network failure part-way leaves partial data. The application create has a compensating delete; the others only show an error toast. Fix: move each into a Postgres function and call it with `rpc`. |
| OPEN-04 | Medium | **No pagination.** Lists load whole tables. Supabase returns at most 1000 rows per request by default, so a very large table would truncate silently. Fine for one applicant's data; not for activity logs over years. |
| OPEN-05 | Medium | **No rate limiting on AI endpoints.** Only signed-in users can call them, but a bug or abuse could run up Anthropic cost. Add a per-user daily cap. |
| OPEN-06 | Low | Reminders and notifications are generated only when the Overview page is opened, not on a schedule. In-app only. |
| OPEN-07 | Low | The DB cannot enforce that the UI's final checklist items (essays within limit, transcripts attached) were true at submission; that is enforced in the UI only. The DB enforces only "explicit confirmation present". |
| OPEN-08 | Low | Moving a submitted application back to a pre-submission stage is blocked by the UI but not by the database. |
| OPEN-09 | Low | `/search` results link to list pages, not to the specific record. |
| OPEN-10 | Low | The pipeline has no drag and drop; stage changes happen on the application page or by dropdown. |
| OPEN-11 | Low | Priority convention is 1 = highest everywhere (checked across modules). Documented on screen. |
| OPEN-12 | Info | The competitiveness score uses transparent rules over your own records (GMAT/GRE position in scale, etc.). It is not compared with school averages in the score itself. |
| OPEN-13 | Info | Scholarship and school figures in different currencies are never added together without a recorded FX rate; they are shown per currency. Intentional. |

## 3. Security and data access (verified by tests unless marked)

| Check | Result |
|---|---|
| RLS enabled on all 38 tables (the 36 in your spec plus saved_comparisons and essay_stories); owner-only policies | PASS (tested as two users: no read, no insert-as-other, 0 rows affected on update/delete) |
| Activity log is read-only to users and invisible to others | PASS |
| Cross-user foreign key attachment (user B attaching rows to user A's application) | PASS (blocked by trigger, 31 FK pairs covered) |
| Storage: private bucket, files only under `<user_id>/`, 25 MB limit, MIME allow-list | PASS at policy level (stand-in schema; real Supabase Storage not run) |
| Service-role key not used anywhere in app code | PASS (grep) |
| Only the two public Supabase values use `NEXT_PUBLIC_` | PASS (grep) |
| Anthropic key only read server-side; AI modules import `server-only` | PASS (grep) |
| Every API route checks the user first | PASS (6 of 6 routes; 401 verified on the running build) |
| No `dangerouslySetInnerHTML`, `eval`, or browser storage for data | PASS (grep) |
| Prompt-injection via stored essays or stories | NOT TESTED (model output never executed; it is rendered as text) |

## 4. Feature-by-feature audit

Legend: **PASS (backend)** = database and logic layer verified, UI not run. **FAIL** = a defect was found and is still open. **NOT IMPLEMENTED** = no working feature exists. **NOT TESTED** = could not be exercised here. After BUG-001 was fixed, no item is currently FAIL.

### Your 15-step journey

| # | Step | Status | What was verified | What was not |
|---|---|---|---|---|
| 1 | Create applicant profile | PASS (backend) | One profile per user, GPA cannot exceed scale, date ranges, completeness scoring (missing/incomplete/needs verification/complete), test validity windows (unit tests) | Form submission in the browser; sign-up and email confirmation against live Supabase |
| 2 | Add target schools | PASS (backend) | 26 schools seed idempotently with names/countries/cities only; add/soft-delete columns exist; owner-only | Add/remove dialogs; no fabricated statistics is true by construction (no stats seeded) |
| 3 | Compare schools | PASS (backend) | Comparison limited to 2 to 5 schools by a DB constraint; every data point requires source name and URL (DB rejects otherwise); missing values render "Not researched" (logic) | Comparison table rendering, save/load, CSV export in the browser |
| 4 | Create applications | PASS (backend) | 17 default requirements auto-created; duplicate application rejected; negative fee and bad stage rejected; INSERT as Ready/Submitted now rejected (BUG-001) | Create dialog; partial-failure behaviour (OPEN-03) |
| 5 | Add deadlines | PASS (backend) | Timezone-aware conversion across DST, risk logic (green/yellow/red, boundary cases), nearest-deadline selection (unit tests); cross-user attach blocked | Inline deadline editing UI; dashboard timeline rendering |
| 6 | Create and complete requirements | PASS (backend) | Custom requirements; completion timestamp set and cleared; Ready blocked until mandatory items complete; readiness weights and renormalisation (unit tests) | Checklist UI; configurable weights screen |
| 7 | Upload documents | NOT TESTED | File-type and size validation, safe naming, storage path rule, storage policy (unit and DB tests) | **Actual upload, signed-URL download and preview against real Supabase Storage** |
| 8 | Create and revise essays | PASS (backend) | Every saved draft creates an immutable version; no-change save creates none; versions cannot be edited; deleting an application keeps the essay; word counting and limit states; word diff; restore creates a new version (unit and DB tests) | Editor, unsaved-changes warning, compare view in the browser |
| 9 | Add recommenders | PASS (backend) | Per-school tracking rows; one row per recommender and application; submission-to-checklist matching and reminder timing (unit tests) | Pipeline UI; AI drafts (no live key); nothing is ever sent |
| 10 | Run AI profile assessments | NOT TESTED | Prompt builders, context ranking, response schema validation, refusal to save malformed output, "speculative estimate" label check (53 unit tests). Rule-based competitiveness scoring tested. | **Any live model call**; output quality |
| 11 | Generate Next Best Actions | PASS (backend) | Rules engine with documented scoring; dedupe keys; dismissed/completed never resurrected; snooze timing; sync planning (30 unit tests). Labelled "rules engine", not AI. | Persistence through the ai_recommendations table live; the accept/dismiss/snooze/convert buttons |
| 12 | Track application submission | PASS (backend) | Submitted requires explicit confirmation (DB); submitted date defaulted; checklist derivation and over-limit blocking (unit tests) | Confirmation dialog UI; dashboard KPI update after submission |
| 13 | Manage interviews | NOT TESTED | Question origins constrained (verified-historical requires a source note, DB); score aggregation and chart gating (unit tests) | Mock interview flow, timer, AI feedback (no live key); recording is local-only by design |
| 14 | Track scholarships and expenses | PASS (backend) | FX conversion never mixes currencies without a rate; budget definitions; payback and edge cases (zero uplift, zero borrowing, missing rate); non-negative amount constraints (about 30 unit tests) | Forms, charts, CSV export in the browser |
| 15 | Record admissions decisions | PASS (backend) | One decision per application; decision values constrained; weighted decision matrix ignores unrated criteria (unit tests) | Decision UI; stage and decision staying consistent after a partial failure (OPEN-03) |

### Cross-cutting requirements from your spec

| Requirement | Status | Note |
|---|---|---|
| Dashboard metrics derived from real records, no hardcoded numbers | PASS (static) / metric values NOT TESTED | No hardcoded metrics found; KPI logic unit-tested; values not seen on screen |
| Each KPI card clickable to a filtered page | NOT TESTED | Link targets exist and the target pages declare the matching query parameters; not clicked |
| Persistence after logout and login | NOT TESTED | Requires live Supabase |
| Row Level Security and user ownership | PASS | See section 3 |
| Audit logging | PASS (backend) | 15 core tables log insert/update/delete |
| Soft deletion where appropriate | PASS (backend) | Columns present; code filters on them |
| Data export / backup | PASS (code) / NOT TESTED | JSON backup of the user's tables and CSV exports exist (code review only) |
| AI outputs distinguished from verified facts | PASS (code review) | AI label component used; rule-based output labelled as rules |
| AI never fabricates; speculative probabilities forbidden | PARTIAL, NOT TESTED live | Prompts forbid it and a validator flags unlabelled probabilities; live behaviour unverified |
| Four AI modes with database context | NOT TESTED live | Context retrieval logic tested |
| Notifications and deadline reminders (30/14/7/3/1) | PASS (backend), in-app only | Generated on Overview load (OPEN-06) |
| Email sending | **NOT IMPLEMENTED** | Deliberately: drafts only, nothing is sent |
| Google Calendar integration | **NOT IMPLEMENTED** | Not configured; the UI says so |
| Password reset | **NOT IMPLEMENTED** | OPEN-02 |
| Pagination for large tables | **NOT IMPLEMENTED** | OPEN-04 |
| Drag-and-drop pipeline | **NOT IMPLEMENTED** | OPEN-10; dropdown stage changes instead |
| Audio interview recording saved to storage | **NOT IMPLEMENTED** | Local playback only, by design |
| Multi-user support | PASS (schema) | Every row is user-owned; single-user UI |
| Responsive / mobile layout | NOT TESTED | Collapsible sidebar and responsive classes exist; never rendered |
| Accessibility | NOT TESTED | Labels and roles present in code; no audit run |

## 5. Run order to complete the audit on your machine (about 30 minutes)

1. Create a Supabase project. In the SQL editor run every file in `supabase/migrations/` in numeric order (001, 002, 011, 013, 015, 016, 017).
2. `cp .env.example .env.local`, fill the two public Supabase values, and optionally `ANTHROPIC_API_KEY`.
3. `npm install && npm test && npm run test:db && node scripts/check-queries.mjs && npm run build`
4. `npm run dev`. Create two accounts in two browsers. Walk the 15 steps in section 4 as account A, refreshing and signing out and in after each step.
5. As account B confirm you see none of A's data, and that a direct URL such as `/applications/<A's id>` shows nothing.
6. With Chrome connected, I can drive steps 1 to 15 and report PASS or FAIL per screen, if you give me the running URL and a throwaway account.

## Update: fun / Duolingo-style / portable pass
Added: Journey page (8 units, 28 lessons, derived from real data, nothing locked), XP ledger (`xp_events`, trigger-written, once per real event, daily caps), levels, streaks, quests, badges, persisted celebrations; four themes (sunny, ocean, berry, midnight) saved in the database; original mascot; Docker, PWA manifest, health route; backup import with trigger workarounds; DEPLOY.md and MIGRATING.md.
Verified: tsc clean, 214 unit tests, 35 DB tests, 13 import tests, 345 query references with 0 problems, 168 contrast checks with 0 failures, `next build` passes, all 15 pages render with 0 JS errors against an empty stand-in backend.
NOT verified: any of it against a live Supabase, Docker image build, PWA install on a device, gamification with real data in a browser (empty state only), live AI.
Known gaps: no XP backfill for rows created before migration 018; Overview/Interview charts and finance budget tab use hardcoded colors that look off in the midnight theme; Nunito font is not loaded; day cap uses UTC while streaks use browser time; storage files are not moved by the importer.

# Email reminders (Campus Quest)

Reminders are meant to feel fun, encouraging and calm. Never nagging. So this is **not** one email every day. A student gets an email only when there is a good reason, and never more than one a day:

| Kind | When it is sent | What it says |
| --- | --- | --- |
| `deadline_week` | An application that is not submitted yet has its deadline exactly 7 days away. Again at 3 days and at 1 day. | "You have a week, here is the short list": up to 4 mandatory items still open, with a button to that application. |
| `result_soon` | A submitted application expects its result tomorrow or today (one email per result, not both days). | A warm note: "Whatever it says, you did the work." |
| `nudge` | No progress for 2 full days. Sent after 2, 5 and 12 full days of silence. After 3 weeks (21 days) one final "we will be here when you are ready" note, then nothing at all until the student comes back. | What they have done so far ("4 of 9 ready") and ONE tiny step of about 2 minutes, taken from their real open items. |
| `celebration` | Yesterday they reached a milestone: first item done, half way, all items ready, or submitted. | A short well done. |

If two things are true on the same day, the one higher in the table wins. On a day a student is simply active, nothing is sent. Every email has a one-click unsubscribe link.

Nothing is sent until you add the settings below. Without an email provider the app runs in "dry run" mode: it works out who would get an email and logs it, but sends nothing.

## 1. Run the database update

In Supabase, open **SQL Editor** and run these two files, one after the other (paste the contents, click **Run**). Both are safe to run more than once.

1. `supabase/migrations/020_reminders.sql` adds `reminder_log`: one row per student per day an email went out (this is what stops double emails). It also adds a `reminder_streaks` helper that is no longer used.
2. `supabase/migrations/024_reminder_kinds.sql` adds the `kind` column to `reminder_log`, so the app knows which kind of email each one was. The nudge schedule is worked out from this history.

If you skip step 2, emails still go out, but the kind is not saved and the job's reply includes a warning. Run it before going live so the nudge schedule stays correct.

## 2. Add environment variables in Vercel

Vercel: open your project, then **Settings > Environment Variables**. Add each one for **Production**, then redeploy (Deployments > the latest one > Redeploy).

| Name | What to put | Where to find it |
| --- | --- | --- |
| `CRON_SECRET` | A long random string (at least 32 characters) | Make one up, or run `openssl rand -hex 32`. Vercel sends it automatically to the daily job. |
| `REMINDER_SECRET` | A different long random string | Same as above. Signs the unsubscribe links. If you change it, old unsubscribe links stop working. |
| `SUPABASE_SERVICE_ROLE_KEY` | The `service_role` key | Supabase: **Project Settings > API > service_role** (click Reveal). Server only. Never put it in a variable that starts with `NEXT_PUBLIC_`. |
| `NEXT_PUBLIC_APP_URL` | Your app's address, for example `https://your-app.vercel.app` | Your Vercel domain. Used for the links inside emails. |

Then pick **one** way to send email:

**Option A: Resend (recommended)**

| Name | What to put |
| --- | --- |
| `RESEND_API_KEY` | resend.com > **API Keys** > Create API key (Sending access is enough). |
| `REMINDER_FROM` | For example `Campus Quest <reminders@yourdomain.com>`. The domain must be verified in Resend (**Domains** > Add domain, then add the DNS records it shows). For a quick test you can use `onboarding@resend.dev`, which only delivers to your own Resend account email. |

Free plan: 100 emails a day and 3,000 a month.

**Option B: Gmail (or any SMTP)**

| Name | What to put |
| --- | --- |
| `SMTP_HOST` | `smtp.gmail.com` |
| `SMTP_PORT` | `465` |
| `SMTP_USER` | Your full Gmail address |
| `SMTP_PASS` | A Gmail **app password** (not your normal password). Turn on 2-Step Verification, then go to myaccount.google.com/apppasswords and create one. |
| `REMINDER_FROM` | Optional. Defaults to `SMTP_USER`. |

Gmail allows about 500 emails a day from a personal account (2,000 for Google Workspace). If `RESEND_API_KEY` is set, Resend is used and the SMTP settings are ignored.

Optional extras:

- `REMINDER_MAX_PER_RUN`: the most emails one run sends (default 100, to stay inside the Resend free limit). Each run checks up to 1,000 students.
- `REMINDER_HOURLY=1`: only set this if you add an hourly scheduler (see section 4).

## 3. Test it safely

The job runs once a day and lives at `/api/cron/daily-reminders`. Add `?dry=1` to preview without sending or saving anything:

```
curl -H "Authorization: Bearer YOUR_CRON_SECRET" "https://your-app.vercel.app/api/cron/daily-reminders?dry=1"
```

You get back:

- a summary: how many students were checked, how many emails of each kind would go out (`kinds`), and why the others were skipped (`skipped.nothing_today` is the normal case: no reason to write today);
- `previews`: up to 20 emails, each with its `kind`, the `reason` it was chosen (for example "Harbor University deadline is 7 days away (2026-11-30)"), the subject and the full text;
- `quiet`: up to 20 students who get nothing today, each with the reason (for example "no progress for 3 days, nudge 1 of 3 already sent: next check-in at day 5").

Email addresses are partly hidden.

To send for real, run the same command without `?dry=1`. Running it twice on the same day is safe: each student gets at most one email per day in their own time zone.

Students can also see a preview in **Settings > Email reminders > Preview my next email**. It shows today's email if one is planned, and otherwise says why not and shows an example check-in built from their own list.

## 4. When emails go out

Vercel's free (Hobby) plan runs scheduled jobs only once a day, so `vercel.json` runs the job at **12:00 UTC**, which is **19:00 in Jakarta**. Everyone who gets an email that day gets it at that moment, whatever time they picked. (For a student in New York that is 7 am; in London, noon.)

The time a student picks in Settings (8 am, 12 pm or 7 pm in their own time zone) becomes exact only with an hourly scheduler. The endpoint is built to be called every hour. Two free ways:

- **cron-job.org** (or any free cron service): create a job that calls `https://your-app.vercel.app/api/cron/daily-reminders?hourly=1` every hour with the header `Authorization: Bearer YOUR_CRON_SECRET`.
- **Supabase pg_cron + pg_net**: schedule an hourly `net.http_get` to the same URL with the same header.

With `?hourly=1` (or `REMINDER_HOURLY=1`), a student is emailed only once their local time has reached their chosen hour, and still at most once per local day. You can keep the Vercel daily job too: whichever run comes first after the student's hour sends, the other one skips them.

## Who gets an email

First, the basics. A student can only be emailed when all of these are true:

- They finished the first-run setup (`settings.onboarding.done` is true). Reminders default to on at 19:00 Asia/Jakarta if they never changed them.
- Email reminders are on (`settings.onboarding.reminders.email` is not false).
- No email has been sent yet on their local date.

Then the app looks for a reason to write today, in this order. The first one that fits is the only email that day.

1. **Deadline** (`deadline_week`). An application in Researching, Shortlisted, Preparing or Ready has its main deadline exactly 7, 3 or 1 day(s) away, counted in the student's own time zone. If two applications qualify, the nearer deadline is the one in the email.
2. **Result** (`result_soon`). A submitted application with no final decision recorded expects its result tomorrow or today. If the note went out the day before, it is not repeated on the day. The date comes from `applications.expected_result_on` when that column exists and is filled in; otherwise from `program_requirements.decision_dates` (a list such as `[{ "round": "Round 2", "decision_date": "2027-03-25" }]`), matched to the application's round. If neither column exists yet, this kind is simply never sent. No error.
3. **Nudge** (`nudge`, and `nudge_final` for the last one). See the schedule below.
4. **Celebration** (`celebration`). The student was active yesterday and one of these happened yesterday: they submitted an application, got every mandatory item ready, crossed the half way mark on a checklist, or finished their very first item.

### The nudge schedule

"Progress" means any of: earning XP, changing a checklist item, editing an essay, or submitting. Signing up counts as the first sign of life. Days are counted in the student's own time zone, and only full days count (the day they were last active and today do not).

| Full days with no progress | What happens |
| --- | --- |
| 0 or 1 | Nothing. |
| 2 | First nudge. |
| 5 | Second nudge. |
| 12 | Third nudge. |
| 21 | One final note: "we will be here when you are ready". |
| After that | Nothing, however long they stay away. |

So a student who was last active on a Monday hears from us on Thursday (Tuesday and Wednesday were the two silent days), then the next Sunday, then a week later, then once more at three weeks. That is four emails in three weeks, and then silence.

Details that keep it gentle:

- As soon as the student makes progress, the count starts again from zero.
- Two nudges are never closer than 3 days apart, even if the job missed a day and is catching up.
- If the job was down around day 21, the final note can still go out up to 6 days late. After that it is skipped for good.
- A deadline or result email on the same day takes priority. The nudge then goes out on a later day.
- Students whose applications are all submitted or closed are not nudged, because there is nothing left for them to do.
- Emails sent before migration 024 (the old daily emails, with no kind saved) are counted as nudges, so nobody gets a burst of check-ins when this goes live.

### Tone rules

Every subject line and opening has 4 to 6 versions. Which one a student sees is picked from their user id and the date, so the wording varies from email to email but stays the same if the job runs twice. The tests (`tests/reminders.test.ts`) check every version of every email for the house rules: no alarm words ("urgent", "last chance", "don't miss", "running out" and similar), no words in capitals, no long dashes, not the word "actually", and at most one exclamation mark per email. If you add or edit copy in `lib/reminders.ts`, run `npm test`.

## Unsubscribing

Every email has a one-click unsubscribe link (and the `List-Unsubscribe` header, so Gmail and Apple Mail show their own unsubscribe button). It turns `reminders.email` off for every kind of email; the student can turn it back on in Settings. The link is signed with `REMINDER_SECRET`, so it cannot be used to unsubscribe someone else.

## Important: let the job through the sign-in check

`proxy.ts` sends any signed-out request to `/api/...` a 401. The daily job and the unsubscribe link have no signed-in user, so both paths must be allowed in the `open` check in `proxy.ts`:

```ts
const p = req.nextUrl.pathname;
const open = p.startsWith('/login') || p.startsWith('/auth') || p === '/api/health'
  || p === '/api/cron/daily-reminders' || p === '/api/reminders/unsubscribe';
```

Both routes check their own secret (`CRON_SECRET` or the signed link), so this is safe.

## Later

Web push notifications (a browser or phone notification instead of an email) are a natural next step and can reuse the same decision (`decideReminder` in `lib/reminders.ts`).

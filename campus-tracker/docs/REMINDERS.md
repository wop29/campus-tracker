# Daily email reminders

Once a day, each student who turned reminders on gets one short email: the single most useful next step (with a button that opens the right page), up to two upcoming deadlines with days left, their streak if they have one, and a one-click unsubscribe link. Students who already made progress that day are skipped.

Nothing is sent until you add the settings below. Without an email provider the app runs in "dry run" mode: it works out who would get an email and logs it, but sends nothing.

## 1. Run the database update

In Supabase, open **SQL Editor**, paste the contents of `supabase/migrations/020_reminders.sql`, and click **Run**. It is safe to run more than once. It adds:

- `reminder_log`: one row per student per day an email went out (this is what stops double emails).
- `reminder_streaks`: a helper that works out each student's streak in their own time zone.

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
| `REMINDER_FROM` | For example `MBA Planner <reminders@yourdomain.com>`. The domain must be verified in Resend (**Domains** > Add domain, then add the DNS records it shows). For a quick test you can use `onboarding@resend.dev`, which only delivers to your own Resend account email. |

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

- `REMINDER_MAX_PER_RUN`: the most emails one run sends (default 100, to stay inside the Resend free limit). Each run also looks at no more than 200 students; the rest are picked up the next day.
- `REMINDER_HOURLY=1`: only set this if you add an hourly scheduler (see section 4).

## 3. Test it safely

The daily job lives at `/api/cron/daily-reminders`. Add `?dry=1` to preview without sending or saving anything:

```
curl -H "Authorization: Bearer YOUR_CRON_SECRET" "https://your-app.vercel.app/api/cron/daily-reminders?dry=1"
```

You get back a summary (how many students were checked, how many are due, why the others were skipped) and up to 20 previews with the subject and the full text of each email. Email addresses are partly hidden.

To send for real, run the same command without `?dry=1`. Running it twice on the same day is safe: each student gets at most one email per day in their own time zone.

Students can also see a text preview of their own email in **Settings > Daily email nudge > Preview today's email**.

## 4. When emails go out

Vercel's free (Hobby) plan runs scheduled jobs only once a day, so `vercel.json` runs the job at **12:00 UTC**, which is **19:00 in Jakarta**. Everyone due that day gets their email at that moment, whatever time they picked. (For a student in New York that is 7 am; in London, noon.)

The time a student picks in Settings (8 am, 12 pm or 7 pm in their own time zone) becomes exact only with an hourly scheduler. The endpoint is built to be called every hour. Two free ways:

- **cron-job.org** (or any free cron service): create a job that calls `https://your-app.vercel.app/api/cron/daily-reminders?hourly=1` every hour with the header `Authorization: Bearer YOUR_CRON_SECRET`.
- **Supabase pg_cron + pg_net**: schedule an hourly `net.http_get` to the same URL with the same header.

With `?hourly=1` (or `REMINDER_HOURLY=1`), a student is emailed only once their local time has reached their chosen hour, and still at most once per local day. You can keep the Vercel daily job too: whichever run comes first after the student's hour sends, the other one skips them.

## Who gets an email

A student is emailed when all of these are true:

- They finished the first-run setup (`settings.onboarding.done` is true). Reminders default to on at 19:00 Asia/Jakarta if they never changed them.
- Daily emails are on (`settings.onboarding.reminders.email` is not false).
- No reminder has been sent yet on their local date.
- They have not already made progress today (no XP earned today in their time zone).

## Unsubscribing

Every email has a one-click unsubscribe link (and the `List-Unsubscribe` header, so Gmail and Apple Mail show their own unsubscribe button). It turns `reminders.email` off; the student can turn it back on in Settings. The link is signed with `REMINDER_SECRET`, so it cannot be used to unsubscribe someone else.

## Important: let the job through the sign-in check

`proxy.ts` sends any signed-out request to `/api/...` a 401. The daily job and the unsubscribe link have no signed-in user, so both paths must be allowed in the `open` check in `proxy.ts`:

```ts
const p = req.nextUrl.pathname;
const open = p.startsWith('/login') || p.startsWith('/auth') || p === '/api/health'
  || p === '/api/cron/daily-reminders' || p === '/api/reminders/unsubscribe';
```

Both routes check their own secret (`CRON_SECRET` or the signed link), so this is safe.

## Later

Web push notifications (a browser or phone notification instead of an email) are a natural next step and can reuse the same "who is due" logic in `lib/reminders.ts`.

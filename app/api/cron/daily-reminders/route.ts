// Reminder emails for Campus Quest. Called by Vercel Cron (vercel.json, once a day at 12:00 UTC = 19:00 Jakarta)
// with "Authorization: Bearer <CRON_SECRET>". Most days most people get NO email: lib/reminders.ts decides, per user,
// whether today is a deadline_week, result_soon, nudge or celebration day (at most one email, highest priority wins).
// Safe to call more often: reminder_log has one row per user per local date and the row is claimed BEFORE sending,
// so nobody gets two emails on the same day.
//   ?dry=1     preview as JSON (kind, reason, subject, text), sends nothing, writes nothing
//   ?hourly=1  (or REMINDER_HOURLY=1) also wait until each user's chosen local hour; use with an hourly scheduler
import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { buildReminderFacts, composeReminder, decideReminder, isReminderDue, readReminderPrefs, safeTimeZone, type DueReason, type LogKind } from '@/lib/reminders';
import { adminClient, loadAccountEmails, loadOnboardedProfiles } from '@/lib/email/reminder-data';
import { HISTORY_DAYS, isMissingSchema, loadReminderHistory, loadReminderRows } from '@/lib/email/reminder-rows';
import { emailProvider, sendEmails, type OutgoingEmail } from '@/lib/email/send';
import { unsubscribeUrl } from '@/lib/email/token';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_PROFILES = 1000;   // profiles scanned per run
const MAX_USERS = 1000;      // users whose data is loaded per run (most get no email on a given day, so everyone is checked)
const DEFAULT_MAX_SENDS = 100; // Resend free plan: 100 emails a day

const fail = (status: number, error: string) => NextResponse.json({ ok: false, error }, { status });
const sameSecret = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
const mask = (email: string) => email.replace(/^(.)[^@]*(@.*)$/, '$1***$2');
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function appUrl(req: NextRequest): string {
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL?.trim() || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '');
  return (fromEnv || req.nextUrl.origin).replace(/\/+$/, '');
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) return fail(500, 'CRON_SECRET is not set on the server. See docs/REMINDERS.md.');
  if (!sameSecret(req.headers.get('authorization') ?? '', `Bearer ${cronSecret}`)) return fail(401, 'unauthorized');

  const sb = adminClient();
  if (!sb) return fail(500, 'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set on the server. See docs/REMINDERS.md.');
  const dry = ['1', 'true'].includes(req.nextUrl.searchParams.get('dry') ?? '');
  const respectHour = ['1', 'true'].includes(req.nextUrl.searchParams.get('hourly') ?? '') || process.env.REMINDER_HOURLY === '1';
  const secret = process.env.REMINDER_SECRET?.trim() ?? '';
  if (!secret && !dry) return fail(500, 'REMINDER_SECRET is not set on the server (needed for unsubscribe links). See docs/REMINDERS.md.');
  const maxSends = Math.max(0, Math.min(500, Number(process.env.REMINDER_MAX_PER_RUN) || DEFAULT_MAX_SENDS));
  const provider = emailProvider();
  const base = appUrl(req);
  const now = new Date();

  try {
    const profiles = await loadOnboardedProfiles(sb, MAX_PROFILES);
    const ids = profiles.map((p) => p.user_id);
    const since = new Date(now.getTime() - HISTORY_DAYS * 86_400_000).toISOString().slice(0, 10);
    const history = await loadReminderHistory(sb, ids, since);
    const skipped: Record<DueReason | 'no_email' | 'nothing_today' | 'over_cap', number> = { due: 0, off: 0, not_onboarded: 0, already_sent: 0, too_early: 0, no_email: 0, nothing_today: 0, over_cap: 0 };

    // Who may get an email at all right now (reminders on, onboarded, nothing sent yet on their local date).
    const due: { p: (typeof profiles)[number]; tz: string; localDate: string }[] = [];
    for (const p of profiles) {
      const prefs = readReminderPrefs(p.settings);
      const r = isReminderDue(prefs, now, (history.get(p.user_id) ?? []).map((h) => h.sentOn), { respectHour });
      if (!r.due) { skipped[r.reason]++; continue; }
      if (due.length >= MAX_USERS) { skipped.over_cap++; continue; }
      due.push({ p, tz: safeTimeZone(prefs.timezone), localDate: r.localDate });
    }

    const dueIds = due.map((d) => d.p.user_id);
    const [emails, rows] = await Promise.all([loadAccountEmails(sb, dueIds), loadReminderRows(sb, dueIds, now, history)]);

    // Which of them have something worth an email today, and what kind.
    const kinds: Record<LogKind, number> = { deadline_week: 0, result_soon: 0, nudge: 0, nudge_final: 0, celebration: 0 };
    const quiet: { to: string; reason: string }[] = [];
    const outgoing: { userId: string; localDate: string; kind: LogKind; reason: string; msg: OutgoingEmail }[] = [];
    for (const d of due) {
      const to = emails.get(d.p.user_id) ?? d.p.email ?? '';
      if (!EMAIL.test(to)) { skipped.no_email++; continue; }
      const mine = rows.get(d.p.user_id);
      if (!mine) continue;
      // Signing up counts as the first sign of life, so a brand new account is not treated as "silent forever".
      const facts = buildReminderFacts({ ...mine, activityAt: [...mine.activityAt, d.p.created_at] }, { userId: d.p.user_id, name: d.p.preferred_name || d.p.full_name?.split(/\s+/)[0] || null, timezone: d.tz }, now);
      const decision = decideReminder(facts);
      const unsub = secret ? unsubscribeUrl(base, d.p.user_id, secret) : `${base}/settings`;
      const email = composeReminder(decision, facts, { appUrl: base, unsubscribeUrl: unsub, seed: `${d.p.user_id}:${d.localDate}` });
      if (!email || decision.kind === null) { skipped.nothing_today++; if (quiet.length < 20) quiet.push({ to: mask(to), reason: decision.reason }); continue; }
      if (outgoing.length >= maxSends) { skipped.over_cap++; continue; }
      kinds[decision.logKind]++;
      outgoing.push({
        userId: d.p.user_id, localDate: d.localDate, kind: decision.logKind, reason: decision.reason,
        msg: { to, subject: email.subject, html: email.html, text: email.text, headers: secret ? { 'List-Unsubscribe': `<${unsub}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : undefined },
      });
    }

    const summary = { provider, respectHour, scanned: profiles.length, due: due.length, skipped, kinds };
    if (dry) {
      return NextResponse.json({ ok: true, dry: true, ...summary, wouldSend: outgoing.length,
        previews: outgoing.slice(0, 20).map((o) => ({ to: mask(o.msg.to), localDate: o.localDate, kind: o.kind, reason: o.reason, subject: o.msg.subject, text: o.msg.text })),
        quiet });
    }
    if (provider === 'none') {
      return NextResponse.json({ ok: true, dry: true, note: 'No email provider configured (RESEND_API_KEY or SMTP_*). Nothing was sent or logged.', ...summary, wouldSend: outgoing.length });
    }

    // Claim each (user, local date) first. Only rows we actually inserted get an email, so overlapping runs cannot double send.
    const claimed = new Set<string>();
    let logKinds = true; // false when migration 024 is not applied yet: emails still go out, the kind is just not recorded
    for (let i = 0; i < outgoing.length; i += 100) {
      const slice = outgoing.slice(i, i + 100);
      const claim = (withKind: boolean) => sb.from('reminder_log')
        .upsert(slice.map((o) => ({ user_id: o.userId, sent_on: o.localDate, subject: o.msg.subject, ...(withKind ? { kind: o.kind } : {}) })), { onConflict: 'user_id,sent_on', ignoreDuplicates: true })
        .select('user_id,sent_on');
      let { data, error } = await claim(logKinds);
      if (error && logKinds && isMissingSchema(error.message)) { logKinds = false; ({ data, error } = await claim(false)); }
      if (error) return fail(500, `Could not write reminder_log (are migrations 020 and 024 applied?): ${error.message}`);
      for (const r of (data ?? []) as { user_id: string; sent_on: string }[]) claimed.add(`${r.user_id}:${r.sent_on}`);
    }
    const toSend = outgoing.filter((o) => claimed.has(`${o.userId}:${o.localDate}`));
    const { results } = await sendEmails(toSend.map((o) => o.msg), { idempotencyKey: `reminders-${createHash('sha256').update(toSend.map((o) => `${o.userId}:${o.localDate}`).join(',')).digest('hex').slice(0, 40)}` });

    const failed = toSend.filter((_, i) => !results[i]?.ok);
    for (const f of failed) await sb.from('reminder_log').delete().eq('user_id', f.userId).eq('sent_on', f.localDate); // free the slot so a later run can retry
    const errors = [...new Set(results.filter((r) => !r.ok).map((r) => r.error ?? 'unknown error'))].slice(0, 5);
    return NextResponse.json({ ok: failed.length === 0, ...summary, sent: toSend.length - failed.length, failed: failed.length, alreadyClaimed: outgoing.length - toSend.length, errors,
      ...(logKinds ? {} : { warning: 'reminder_log.kind is missing. Run supabase/migrations/024_reminder_kinds.sql so the nudge cadence can be tracked.' }) });
  } catch (e) {
    console.error('[daily-reminders]', e);
    return fail(500, (e as Error).message);
  }
}

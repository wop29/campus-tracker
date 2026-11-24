'use client';
import { useEffect, useState } from 'react';
import { Bell, Mail } from 'lucide-react';
import { Button, Card, ErrorBox, Field, Select } from '@/components/ui';
import { useToast } from '@/components/toast';
import { supabaseBrowser } from '@/lib/supabase/client';
import { saveSettingsPatch } from '@/lib/settings';
import { REMINDER_HOURS, browserTimeZone, timeZoneOptions } from '@/lib/onboarding';
import {
  EMAIL_NOT_CONNECTED, EMAIL_PROMISE, buildReminderFacts, composeReminder, decideReminder, firstName, pickTinyStep, readReminderPrefs,
  withReminderPatch, withTimezonePatch, type Decision, type ReminderPrefs,
} from '@/lib/reminders';
import { loadReminderRows } from '@/lib/email/reminder-rows';
import { useEmailConfigured } from './use-email-status';

const hourLabel = (h: number) => (h === 0 ? '12 am' : h < 12 ? `${h} am` : h === 12 ? '12 pm' : `${h - 12} pm`);
/** The reminder job runs once a day at 12:00 UTC. Shown in the user's own time zone. */
function cronTimeIn(tz: string): string {
  const d = new Date(); d.setUTCHours(12, 0, 0, 0);
  try { return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(d); } catch { return '7:00 PM'; }
}

/** Friendly names for common zones. The list itself comes from timeZoneOptions() (shared with Welcome). */
const ZONES: { tz: string; label: string }[] = [
  { tz: 'Asia/Hong_Kong', label: 'Hong Kong' },
  { tz: 'Australia/Melbourne', label: 'Melbourne' },
  { tz: 'America/Toronto', label: 'Toronto' },
  { tz: 'America/Vancouver', label: 'Vancouver' },
  { tz: 'UTC', label: 'UTC' },
  { tz: 'Asia/Jakarta', label: 'Jakarta, Bandung, Surabaya (WIB)' },
  { tz: 'Asia/Makassar', label: 'Makassar, Bali, Balikpapan (WITA)' },
  { tz: 'Asia/Jayapura', label: 'Jayapura, Ambon (WIT)' },
  { tz: 'Asia/Singapore', label: 'Singapore, Kuala Lumpur' },
  { tz: 'Asia/Tokyo', label: 'Tokyo, Seoul' },
  { tz: 'Australia/Perth', label: 'Perth' },
  { tz: 'Australia/Adelaide', label: 'Adelaide' },
  { tz: 'Australia/Brisbane', label: 'Brisbane' },
  { tz: 'Australia/Sydney', label: 'Sydney, Melbourne, Canberra' },
  { tz: 'Pacific/Auckland', label: 'Auckland' },
  { tz: 'Europe/London', label: 'London, Edinburgh' },
  { tz: 'Europe/Amsterdam', label: 'Amsterdam, Berlin, Paris' },
  { tz: 'America/New_York', label: 'New York, Boston, Toronto' },
  { tz: 'America/Chicago', label: 'Chicago, Houston' },
  { tz: 'America/Denver', label: 'Denver' },
  { tz: 'America/Los_Angeles', label: 'Los Angeles, San Francisco, Vancouver' },
];
const zoneLabel = (tz: string) => ZONES.find((z) => z.tz === tz)?.label ?? tz.replace(/_/g, ' ').replace(/\//g, ', ');

const KIND_LABEL: Record<string, string> = { deadline_week: 'Deadline heads-up', result_soon: 'Result day note', nudge: 'Gentle check-in', celebration: 'Celebration' };
type Preview = { today: boolean; label: string; note: string; subject: string; html: string };

/** Email reminders: on/off, preferred time, time zone, last sent, and a preview built from the user's own data. */
export function RemindersSection() {
  const toast = useToast();
  const emailReady = useEmailConfigured();
  const [prefs, setPrefs] = useState<ReminderPrefs | null>(null);
  const [rawEmail, setRawEmail] = useState(true);
  const [lastSent, setLastSent] = useState<string | null | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [deviceTz, setDeviceTz] = useState<string | null>(null);

  useEffect(() => {
    setDeviceTz(browserTimeZone());
    let cancelled = false;
    void (async () => {
      try {
        const sb = supabaseBrowser();
        const { data: u } = await sb.auth.getUser();
        if (!u.user) return;
        const { data, error: e } = await sb.from('applicant_profiles').select('settings').eq('user_id', u.user.id).maybeSingle();
        if (e) throw new Error(e.message);
        const settings = (data?.settings as Record<string, unknown> | null) ?? {};
        const ob = (settings.onboarding ?? {}) as { reminders?: { email?: unknown } };
        if (cancelled) return;
        setPrefs(readReminderPrefs(settings));
        setRawEmail(typeof ob.reminders?.email === 'boolean' ? ob.reminders.email : true);
        const { data: log, error: le } = await sb.from('reminder_log').select('sent_at,sent_on').order('sent_on', { ascending: false }).limit(1);
        const row = log?.[0] as { sent_at: string | null; sent_on: string } | undefined;
        if (!cancelled) setLastSent(le || !row ? null : row.sent_at ?? row.sent_on);
      } catch (e) { if (!cancelled) setError(`We could not load your reminder settings. ${(e as Error).message}`); }
    })();
    return () => { cancelled = true; };
  }, []);

  async function save(patch: { email?: boolean; hourLocal?: number; timezone?: string }) {
    if (saving || !prefs) return;
    setSaving(true); setError(null);
    try {
      const sb = supabaseBrowser();
      const { data: u } = await sb.auth.getUser();
      if (!u.user) throw new Error('You are signed out. Sign in again and retry.');
      const { data, error: e } = await sb.from('applicant_profiles').select('settings').eq('user_id', u.user.id).maybeSingle();
      if (e) throw new Error(e.message);
      let merged = (data?.settings as Record<string, unknown> | null) ?? {};
      const { timezone, ...rem } = patch;
      if (Object.keys(rem).length) merged = withReminderPatch(merged, rem);
      if (timezone) merged = withTimezonePatch(merged, timezone);
      const saved = await saveSettingsPatch(sb, { onboarding: merged.onboarding });
      setPrefs(readReminderPrefs(saved));
      if (patch.email !== undefined) setRawEmail(patch.email);
      setPreview(null);
      toast(patch.email === false ? 'Email reminders turned off' : patch.email === true ? 'Email reminders turned on' : timezone ? 'Time zone saved' : 'Reminder time saved');
    } catch (e) {
      setError(`That did not save. ${(e as Error).message}`); toast('Not saved. Please try again.', 'err');
    } finally { setSaving(false); }
  }

  async function showPreview() {
    if (previewing || !prefs) return;
    setPreviewing(true); setError(null);
    try {
      const sb = supabaseBrowser();
      const now = new Date();
      const { data: u } = await sb.auth.getUser();
      if (!u.user) throw new Error('You are signed out. Sign in again and retry.');
      const uid = u.user.id;
      const [rows, who] = await Promise.all([loadReminderRows(sb, [uid], now), sb.from('applicant_profiles').select('preferred_name,full_name,created_at').eq('user_id', uid).maybeSingle()]);
      const mine = rows.get(uid);
      if (!mine) throw new Error('We could not find your applications yet.');
      const p = who.data as { preferred_name: string | null; full_name: string | null; created_at: string | null } | null;
      const meta = (u.user.user_metadata ?? {}) as { full_name?: unknown; name?: unknown };
      const name = firstName(p?.preferred_name, p?.full_name, typeof meta.full_name === 'string' ? meta.full_name : null, typeof meta.name === 'string' ? meta.name : null);
      const facts = buildReminderFacts({ ...mine, activityAt: [...mine.activityAt, p?.created_at] }, { userId: uid, name, timezone: prefs.timezone }, now);
      const origin = window.location.origin;
      const opts = { appUrl: origin, unsubscribeUrl: `${origin}/settings` };
      const decision = decideReminder(facts);
      const todays = composeReminder(decision, facts, opts);
      if (todays && decision.kind) {
        setPreview({ today: true, label: KIND_LABEL[decision.kind], note: 'This is the email planned for you today.', subject: todays.subject, html: todays.html });
      } else {
        // Nothing is planned today. Show what a gentle check-in would look like, so there is still something to see.
        const sample: Decision = { kind: 'nudge', logKind: 'nudge', final: false, silentDays: 2, reason: 'example', ...pickTinyStep(facts) };
        const email = composeReminder(sample, facts, opts)!;
        setPreview({ today: false, label: KIND_LABEL.nudge, note: 'No email is planned for you today. Here is what a check-in would look like, built from your own list.', subject: email.subject, html: email.html });
      }
    } catch (e) { setError(`We could not build the preview. ${(e as Error).message}`); }
    finally { setPreviewing(false); }
  }

  const on = rawEmail;
  const zones = prefs ? [...new Set([prefs.timezone, ...(deviceTz ? [deviceTz] : []), ...timeZoneOptions()])] : [];
  return (
    <Card className="my-4 space-y-4">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-extrabold"><Bell size={18} aria-hidden /> Email reminders</h2>
        <p className="text-sm text-secondary">{EMAIL_PROMISE}</p>
        {emailReady === false && <p className="mt-2 rounded-lg bg-fun-yellow/20 p-2 text-sm" role="status">{EMAIL_NOT_CONNECTED} Your choices below are saved and will be used then.</p>}
      </div>
      {error && <ErrorBox message={error} />}
      {!prefs ? <p className="text-sm text-secondary" role="status">Loading...</p> : (
        <>
          <div className="flex min-h-11 items-center justify-between gap-3">
            <span className="text-sm font-semibold" id="reminder-toggle-label">Gentle email reminders (only when it helps, never daily)</span>
            <button type="button" role="switch" aria-checked={on} aria-labelledby="reminder-toggle-label" disabled={saving} onClick={() => void save({ email: !on })}
              className="relative flex h-11 w-14 shrink-0 items-center justify-center disabled:cursor-wait">
              <span className={`relative block h-7 w-12 rounded-full border-2 transition ${on ? 'border-fun-green-dark bg-fun-green' : 'border-border bg-bg'}`}>
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-surface shadow transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
              </span>
            </button>
          </div>
          {!prefs.onboarded && on && <p className="text-xs text-secondary">Emails start once you finish the quick setup.</p>}

          <div>
            <p className="mb-1.5 text-sm font-semibold" id="reminder-hour-label">Preferred time</p>
            <div role="radiogroup" aria-labelledby="reminder-hour-label" className="flex flex-wrap gap-2">
              {REMINDER_HOURS.map((h) => (
                <button key={h} type="button" role="radio" aria-checked={prefs.hourLocal === h} disabled={saving || !on} onClick={() => void save({ hourLocal: h })}
                  className={`min-h-11 rounded-xl border-2 border-b-4 px-3 py-1.5 text-sm font-bold transition disabled:opacity-50 ${prefs.hourLocal === h ? 'border-fun-green-dark bg-fun-green text-on-fun' : 'border-border bg-bg hover:border-line'}`}>
                  {hourLabel(h)}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-secondary">For now, on a day we do write, the email arrives at about {cronTimeIn(prefs.timezone)} your time. We will switch to your preferred time soon.</p>
          </div>

          <Field label="Time zone" hint="Used for reminder times and for counting days to your deadlines." className="max-w-md">
            <Select value={prefs.timezone} disabled={saving} onChange={(e) => void save({ timezone: e.target.value })} className="min-h-11">
              {zones.map((tz) => <option key={tz} value={tz}>{zoneLabel(tz)}{tz === deviceTz ? ' (this device)' : ''}</option>)}
            </Select>
          </Field>

          <p className="flex items-center gap-1.5 text-xs text-secondary"><Mail size={14} aria-hidden />
            {lastSent === undefined ? 'Checking...' : lastSent ? `Last email sent ${new Date(lastSent).toLocaleString()}` : 'No email sent yet.'}
          </p>

          <div>
            <Button variant="secondary" className="min-h-11" onClick={() => void showPreview()} disabled={previewing}>{previewing ? 'Building preview...' : preview ? 'Refresh preview' : 'Preview my next email'}</Button>
            {preview && (
              <div className="mt-3 rounded-xl border-2 bg-bg p-3" aria-live="polite">
                <p className="text-xs text-secondary"><span className="font-bold">{preview.label}{preview.today ? '' : ' (example)'}. </span>{preview.note}</p>
                <p className="mt-2 text-sm"><span className="font-semibold">Subject: </span>{preview.subject}</p>
                {/* Sandboxed: the email's own HTML, so the preview looks exactly like the real thing, buttons included. */}
                <iframe title={`Email preview: ${preview.subject}`} srcDoc={preview.html} sandbox="" className="mt-2 h-[560px] w-full rounded-lg border bg-white" />
              </div>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

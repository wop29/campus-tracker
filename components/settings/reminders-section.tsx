'use client';
import { useEffect, useState } from 'react';
import { Bell, Mail } from 'lucide-react';
import { Button, Card, ErrorBox } from '@/components/ui';
import { useToast } from '@/components/toast';
import { supabaseBrowser } from '@/lib/supabase/client';
import { saveSettingsPatch } from '@/lib/settings';
import { REMINDER_HOURS } from '@/lib/onboarding';
import { buildReminderFacts, composeReminder, decideReminder, pickTinyStep, readReminderPrefs, withReminderPatch, type Decision, type ReminderPrefs } from '@/lib/reminders';
import { loadReminderRows } from '@/lib/email/reminder-rows';

const hourLabel = (h: number) => (h === 0 ? '12 am' : h < 12 ? `${h} am` : h === 12 ? '12 pm' : `${h - 12} pm`);
/** The daily cron runs at 12:00 UTC. Shown in the user's own time zone. */
function cronTimeIn(tz: string): string {
  const d = new Date(); d.setUTCHours(12, 0, 0, 0);
  try { return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(d); } catch { return '12:00 UTC'; }
}

const KIND_LABEL: Record<string, string> = { deadline_week: 'Deadline heads-up', result_soon: 'Result day note', nudge: 'Gentle check-in', celebration: 'Celebration' };
type Preview = { today: boolean; label: string; note: string; subject: string; text: string };

/** Email reminders: on/off, preferred time, last sent, and a preview built from the user's own data. */
export function RemindersSection() {
  const toast = useToast();
  const [prefs, setPrefs] = useState<ReminderPrefs | null>(null);
  const [rawEmail, setRawEmail] = useState(true);
  const [lastSent, setLastSent] = useState<string | null | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => {
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
      } catch (e) { if (!cancelled) setError(`Could not load reminder settings. ${(e as Error).message}`); }
    })();
    return () => { cancelled = true; };
  }, []);

  async function save(patch: { email?: boolean; hourLocal?: number }) {
    if (saving || !prefs) return;
    setSaving(true); setError(null);
    try {
      const sb = supabaseBrowser();
      const { data: u } = await sb.auth.getUser();
      if (!u.user) throw new Error('Not signed in');
      const { data, error: e } = await sb.from('applicant_profiles').select('settings').eq('user_id', u.user.id).maybeSingle();
      if (e) throw new Error(e.message);
      const merged = withReminderPatch((data?.settings as Record<string, unknown> | null) ?? {}, patch);
      const saved = await saveSettingsPatch(sb, { onboarding: merged.onboarding });
      setPrefs(readReminderPrefs(saved));
      if (patch.email !== undefined) setRawEmail(patch.email);
      toast(patch.email === false ? 'Email reminders turned off' : patch.email === true ? 'Email reminders turned on' : 'Reminder time saved');
    } catch (e) {
      setError(`Could not save. ${(e as Error).message}`); toast('Reminder settings not saved', 'err');
    } finally { setSaving(false); }
  }

  async function showPreview() {
    if (previewing || !prefs) return;
    setPreviewing(true); setError(null);
    try {
      const sb = supabaseBrowser();
      const now = new Date();
      const { data: u } = await sb.auth.getUser();
      if (!u.user) throw new Error('Not signed in');
      const uid = u.user.id;
      const [rows, who] = await Promise.all([loadReminderRows(sb, [uid], now), sb.from('applicant_profiles').select('preferred_name,full_name,created_at').eq('user_id', uid).maybeSingle()]);
      const mine = rows.get(uid);
      if (!mine) throw new Error('No data found');
      const p = who.data as { preferred_name: string | null; full_name: string | null; created_at: string | null } | null;
      const facts = buildReminderFacts({ ...mine, activityAt: [...mine.activityAt, p?.created_at] }, { userId: uid, name: p?.preferred_name || p?.full_name?.split(/\s+/)[0] || null, timezone: prefs.timezone }, now);
      const origin = window.location.origin;
      const opts = { appUrl: origin, unsubscribeUrl: `${origin}/settings` };
      const decision = decideReminder(facts);
      const todays = composeReminder(decision, facts, opts);
      if (todays && decision.kind) {
        setPreview({ today: true, label: KIND_LABEL[decision.kind], note: `Planned for today: ${decision.reason}.`, subject: todays.subject, text: todays.text });
      } else {
        // Nothing is planned today. Show what a gentle check-in would look like, so there is still something to see.
        const sample: Decision = { kind: 'nudge', logKind: 'nudge', final: false, silentDays: 2, reason: 'example', ...pickTinyStep(facts) };
        const email = composeReminder(sample, facts, opts)!;
        setPreview({ today: false, label: KIND_LABEL.nudge, note: `No email is planned for you today (${decision.reason}). Here is an example of a check-in, built from your own list.`, subject: email.subject, text: email.text });
      }
    } catch (e) { setError(`Could not build the preview. ${(e as Error).message}`); }
    finally { setPreviewing(false); }
  }

  const on = rawEmail;
  return (
    <Card className="my-4 space-y-4">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-extrabold"><Bell size={18} aria-hidden /> Email reminders</h2>
        <p className="text-sm text-secondary">Not a daily email. We only write when it helps: when a deadline is a week away, when a result is due, or if you have been away for a couple of days.</p>
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-secondary">
          <li>A deadline is a week away (and again at 3 days and 1 day): a short list of what is left.</li>
          <li>A result is due tomorrow or today: a kind note.</li>
          <li>You have been away for a couple of days: one tiny 2 minute step. These check-ins get rarer, and stop after 3 weeks until you are back.</li>
          <li>You reached a milestone: a quick well done.</li>
        </ul>
        <p className="mt-2 text-sm text-secondary">Never more than one email a day, and most days none.</p>
      </div>
      {error && <ErrorBox message={error} />}
      {!prefs ? <p className="text-sm text-secondary" role="status">Loading...</p> : (
        <>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-semibold" id="reminder-toggle-label">Send me email reminders</span>
            <button type="button" role="switch" aria-checked={on} aria-labelledby="reminder-toggle-label" disabled={saving} onClick={() => void save({ email: !on })}
              className={`relative h-7 w-12 shrink-0 rounded-full border-2 transition disabled:cursor-wait ${on ? 'border-fun-green-dark bg-fun-green' : 'border-border bg-bg'}`}>
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-surface shadow transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
            </button>
          </div>
          {!prefs.onboarded && on && <p className="text-xs text-secondary">Emails start once you finish the quick setup.</p>}

          <div>
            <p className="mb-1.5 text-sm font-semibold">Preferred time</p>
            <div role="radiogroup" aria-label="Preferred reminder time" className="flex flex-wrap gap-2">
              {REMINDER_HOURS.map((h) => (
                <button key={h} type="button" role="radio" aria-checked={prefs.hourLocal === h} disabled={saving || !on} onClick={() => void save({ hourLocal: h })}
                  className={`rounded-xl border-2 border-b-4 px-3 py-1.5 text-sm font-bold transition disabled:opacity-50 ${prefs.hourLocal === h ? 'border-fun-green-dark bg-fun-green text-on-fun' : 'border-border bg-bg hover:border-line'}`}>
                  {hourLabel(h)}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-secondary">Time zone: {prefs.timezone}. For now, on a day you get an email it arrives at about {cronTimeIn(prefs.timezone)} your time. Your preferred time is used once hourly sending is switched on.</p>
          </div>

          <p className="flex items-center gap-1.5 text-xs text-secondary"><Mail size={14} aria-hidden />
            {lastSent === undefined ? 'Checking...' : lastSent ? `Last email sent ${new Date(lastSent).toLocaleString()}` : 'No email sent yet.'}
          </p>

          <div>
            <Button variant="secondary" onClick={() => void showPreview()} disabled={previewing}>{previewing ? 'Building preview...' : preview ? 'Refresh preview' : 'Preview my next email'}</Button>
            {preview && (
              <div className="mt-3 rounded-xl border-2 bg-bg p-3" aria-live="polite">
                <p className="text-xs text-secondary"><span className="font-bold">{preview.label}{preview.today ? '' : ' (example)'}. </span>{preview.note}</p>
                <p className="mt-2 text-sm"><span className="font-semibold">Subject: </span>{preview.subject}</p>
                <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-sm text-secondary">{preview.text}</pre>
              </div>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

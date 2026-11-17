'use client';
import { useEffect, useState } from 'react';
import { Bell, Mail } from 'lucide-react';
import { Button, Card, ErrorBox } from '@/components/ui';
import { useToast } from '@/components/toast';
import { supabaseBrowser } from '@/lib/supabase/client';
import { saveSettingsPatch } from '@/lib/settings';
import { loadOverviewData } from '@/lib/overview-data';
import { fetchXpEvents } from '@/lib/gamification-data';
import { computeStreak } from '@/lib/gamification';
import { REMINDER_HOURS } from '@/lib/onboarding';
import { buildReminderSnapshot, composeReminderEmail, readReminderPrefs, withReminderPatch, type ReminderPrefs } from '@/lib/reminders';

const hourLabel = (h: number) => (h === 0 ? '12 am' : h < 12 ? `${h} am` : h === 12 ? '12 pm' : `${h - 12} pm`);
/** The daily cron runs at 12:00 UTC. Shown in the user's own time zone. */
function cronTimeIn(tz: string): string {
  const d = new Date(); d.setUTCHours(12, 0, 0, 0);
  try { return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(d); } catch { return '12:00 UTC'; }
}

/** Daily email nudge: on/off, preferred time, last sent, and a preview of today's email built from the user's own data. */
export function RemindersSection() {
  const toast = useToast();
  const [prefs, setPrefs] = useState<ReminderPrefs | null>(null);
  const [rawEmail, setRawEmail] = useState(true);
  const [lastSent, setLastSent] = useState<string | null | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ subject: string; text: string } | null>(null);
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
      toast(patch.email === false ? 'Daily emails turned off' : patch.email === true ? 'Daily emails turned on' : 'Reminder time saved');
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
      const [data, events, who] = await Promise.all([loadOverviewData(sb), fetchXpEvents(sb).catch(() => []), sb.from('applicant_profiles').select('preferred_name,full_name').maybeSingle()]);
      const st = computeStreak(events.map((e) => e.occurred_at), now, prefs.timezone);
      const p = who.data as { preferred_name: string | null; full_name: string | null } | null;
      const snap = buildReminderSnapshot({ ...data, name: p?.preferred_name || p?.full_name?.split(/\s+/)[0] || null, intake: prefs.intake, streak: st.current, activeToday: st.todayCounts }, now);
      const origin = window.location.origin;
      const email = composeReminderEmail(snap, { appUrl: origin, unsubscribeUrl: `${origin}/settings`, seed: now.toISOString().slice(0, 10) });
      setPreview({ subject: email.subject, text: email.text });
    } catch (e) { setError(`Could not build the preview. ${(e as Error).message}`); }
    finally { setPreviewing(false); }
  }

  const on = rawEmail;
  return (
    <Card className="my-4 space-y-4">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-extrabold"><Bell size={18} aria-hidden /> Daily email nudge</h2>
        <p className="text-sm text-secondary">One short email a day with your single most useful next step and any deadline coming up. Skipped on days you already made progress.</p>
      </div>
      {error && <ErrorBox message={error} />}
      {!prefs ? <p className="text-sm text-secondary" role="status">Loading...</p> : (
        <>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-semibold" id="reminder-toggle-label">Send me a daily reminder email</span>
            <button type="button" role="switch" aria-checked={on} aria-labelledby="reminder-toggle-label" disabled={saving} onClick={() => void save({ email: !on })}
              className={`relative h-7 w-12 shrink-0 rounded-full border-2 transition disabled:cursor-wait ${on ? 'border-fun-green-dark bg-fun-green' : 'border-border bg-bg'}`}>
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-surface shadow transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
            </button>
          </div>
          {!prefs.onboarded && on && <p className="text-xs text-secondary">Daily emails start once you finish the quick setup.</p>}

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
            <p className="mt-1.5 text-xs text-secondary">Time zone: {prefs.timezone}. For now emails go out once a day, at about {cronTimeIn(prefs.timezone)} your time. Your preferred time is used once hourly sending is switched on.</p>
          </div>

          <p className="flex items-center gap-1.5 text-xs text-secondary"><Mail size={14} aria-hidden />
            {lastSent === undefined ? 'Checking...' : lastSent ? `Last email sent ${new Date(lastSent).toLocaleString()}` : 'No reminder email sent yet.'}
          </p>

          <div>
            <Button variant="secondary" onClick={() => void showPreview()} disabled={previewing}>{previewing ? 'Building preview...' : preview ? "Refresh today's preview" : "Preview today's email"}</Button>
            {preview && (
              <div className="mt-3 rounded-xl border-2 bg-bg p-3" aria-live="polite">
                <p className="text-sm"><span className="font-semibold">Subject: </span>{preview.subject}</p>
                <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-sm text-secondary">{preview.text}</pre>
              </div>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

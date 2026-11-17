'use client';
import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Download, XCircle } from 'lucide-react';
import { z } from 'zod';
import { Button, Card, ErrorBox, Field, Input, Loading, PageHeader } from '@/components/ui';
import { useToast } from '@/components/toast';
import { useOverviewData } from '@/components/overview/use-overview';
import { supabaseBrowser } from '@/lib/supabase/client';
import { DEFAULT_WEIGHTS, type Weights } from '@/lib/logic/readiness';
import { WEIGHT_KEYS, baseCurrencySchema, parseReminderDays, parseSettings, saveSettingsPatch, weightsSchema, workingHoursSchema, DEFAULT_REMINDER_DAYS } from '@/lib/settings';
import { buildBackup } from '@/lib/backup';
import { downloadFile } from '@/lib/export';
import { ThemeSection } from '@/components/settings/theme-section';
import { ImportSection } from '@/components/settings/import-section';
import { RemindersSection } from '@/components/settings/reminders-section';
import { HIGH_AT, MEDIUM_AT } from '@/lib/nba';
import { titleCase } from '@/lib/utils';

const nameSchema = z.string().trim().max(80, 'At most 80 characters');
type Status = { supabase: boolean; anthropic: boolean } | { error: string } | null;

function useSave() {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    if (saving) return false;
    setSaving(true);
    try { await fn(); toast(ok); return true; } catch (e) { toast((e as Error).message, 'err'); return false; } finally { setSaving(false); }
  };
  return { saving, run };
}
const Section = ({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) => (
  <Card className="mb-4"><h2 className="text-base font-semibold">{title}</h2>{hint && <p className="mb-3 mt-0.5 text-xs text-secondary">{hint}</p>}<div className={hint ? '' : 'mt-3'}>{children}</div></Card>
);

export default function SettingsPage() {
  const { data, error, loading, reload } = useOverviewData();
  if (loading) return <Loading label="Loading settings..." />;
  if (error || !data) return <ErrorBox message={error ?? 'Could not load settings'} onRetry={() => void reload()} />;
  const s = parseSettings(data.settings);
  return (
    <div className="max-w-3xl">
      <PageHeader title="Settings" subtitle="Your preferences are stored in your account, not in this browser." />
      <ThemeSection />
      <RemindersSection />
      <ProfileSection onSaved={reload} />
      <PlanningSection hours={s.workingHours} days={s.reminderDays} currency={s.baseCurrency} onSaved={reload} />
      <WeightsSection weights={s.weights} onSaved={reload} />
      <IntegrationSection />
      <BackupSection />
      <ImportSection />
      <Section title="How Next Best Actions are scored" hint="A rules engine, not AI. The same data always gives the same result.">
        <ul className="list-disc space-y-1 pl-5 text-sm text-secondary">
          <li>Deadline proximity, up to 40 points: overdue 40, within 3 days 38, 7 days 32, 14 days 24, 21 days 16, 30 days 10, 60 days 5.</li>
          <li>Mandatory item, 15 points. Low readiness, up to 10 points. Known weakness (missing test score, no recommender, no measurable impact, over word limit), 8 points.</li>
          <li>Rule impact, up to 15 points. Quick wins, up to 10 points (less effort scores higher). Effort minutes are planning estimates.</li>
          <li>{HIGH_AT} or more is high priority, {MEDIUM_AT} or more is medium, below that is low.</li>
          <li>Deadline risk: red if overdue, or too little time for the open mandatory items (assumed half a day each), or 3 days or less with any open; yellow within 14 days with open items.</li>
        </ul>
      </Section>
    </div>
  );
}

function ProfileSection({ onSaved }: { onSaved: () => void }) {
  const { saving, run } = useSave();
  const [email, setEmail] = useState<string>('');
  const [name, setName] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const sb = supabaseBrowser();
    void (async () => {
      const { data: u } = await sb.auth.getUser();
      setEmail(u.user?.email ?? '');
      const { data: p } = await sb.from('applicant_profiles').select('preferred_name,full_name').is('deleted_at', null).maybeSingle();
      setName(p?.preferred_name ?? p?.full_name ?? ''); setReady(true);
    })();
  }, []);
  const save = async () => {
    const p = nameSchema.safeParse(name);
    if (!p.success) { setErr(p.error.issues[0].message); return; }
    setErr(null);
    if (await run(() => saveSettingsPatch(supabaseBrowser(), {}, { preferred_name: p.data || null }), 'Profile saved')) onSaved();
  };
  return (
    <Section title="Profile">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Display name" error={err}><Input value={name} onChange={(e) => setName(e.target.value)} disabled={!ready} maxLength={80} /></Field>
        <Field label="Email" hint="Managed by your sign-in account"><Input value={email} readOnly aria-readonly="true" className="bg-bg" /></Field>
      </div>
      <Button className="mt-3" onClick={save} disabled={saving || !ready}>{saving ? 'Saving...' : 'Save profile'}</Button>
    </Section>
  );
}

function PlanningSection({ hours, days, currency, onSaved }: { hours: number | null; days: number[]; currency: string; onSaved: () => void }) {
  const { saving, run } = useSave();
  const [h, setH] = useState(hours != null ? String(hours) : '');
  const [d, setD] = useState(days.join(', '));
  const [c, setC] = useState(currency);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const save = async () => {
    const e: Record<string, string> = {}; const patch: Record<string, unknown> = {};
    if (h.trim() !== '') { const p = workingHoursSchema.safeParse(h); if (p.success) patch.working_hours_per_day = p.data; else e.h = p.error.issues[0].message; }
    const rd = parseReminderDays(d); if (rd.ok) patch.reminder_days = rd.days; else e.d = rd.error;
    const cc = baseCurrencySchema.safeParse(c); if (cc.success) patch.base_currency = cc.data; else e.c = cc.error.issues[0].message;
    setErrs(e);
    if (Object.keys(e).length) return;
    if (await run(() => saveSettingsPatch(supabaseBrowser(), patch), 'Planning settings saved')) onSaved();
  };
  return (
    <Section title="Planning and reminders">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Working hours per day" error={errs.h} hint="Used by the daily action plan"><Input type="number" step="0.5" min="0.5" max="16" value={h} onChange={(x) => setH(x.target.value)} /></Field>
        <Field label="Reminder days before a deadline" error={errs.d} hint={`Comma separated. Default ${DEFAULT_REMINDER_DAYS.join(', ')}`}><Input value={d} onChange={(x) => setD(x.target.value)} /></Field>
        <Field label="Base currency" error={errs.c} hint="Budget and spending totals are converted to this"><Input value={c} onChange={(x) => setC(x.target.value.toUpperCase())} maxLength={3} /></Field>
      </div>
      <Button className="mt-3" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button>
    </Section>
  );
}

function WeightsSection({ weights, onSaved }: { weights: Weights; onSaved: () => void }) {
  const { saving, run } = useSave();
  const [w, setW] = useState<Record<string, string>>(Object.fromEntries(WEIGHT_KEYS.map((k) => [k, String(weights[k])])));
  const [err, setErr] = useState<string | null>(null);
  const sum = useMemo(() => WEIGHT_KEYS.reduce((a, k) => a + (Number(w[k]) || 0), 0), [w]);
  const save = async () => {
    const parsed = weightsSchema.safeParse(Object.fromEntries(WEIGHT_KEYS.map((k) => [k, w[k].trim() === '' ? NaN : Number(w[k])])));
    if (!parsed.success) { setErr(sum !== 100 ? `Weights add up to ${sum}, they must add up to 100` : 'Each weight must be a whole number from 0 to 100'); return; }
    setErr(null);
    if (await run(() => saveSettingsPatch(supabaseBrowser(), { readiness_weights: parsed.data }), 'Readiness weights saved')) onSaved();
  };
  return (
    <Section title="Readiness weights" hint="How much each requirement category counts toward an application's readiness percentage. Categories an application does not have are left out automatically.">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {WEIGHT_KEYS.map((k) => <Field key={k} label={titleCase(k)}><Input type="number" min="0" max="100" step="1" value={w[k]} onChange={(e) => setW({ ...w, [k]: e.target.value })} /></Field>)}
      </div>
      <p className={`mt-2 text-sm ${sum === 100 ? 'text-success' : 'text-danger'}`} role="status">Total: {sum} / 100</p>
      {err && <p className="text-xs text-danger" role="alert">{err}</p>}
      <div className="mt-3 flex gap-2">
        <Button onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save weights'}</Button>
        <Button variant="secondary" onClick={() => { setW(Object.fromEntries(WEIGHT_KEYS.map((k) => [k, String(DEFAULT_WEIGHTS[k])]))); setErr(null); }}>Reset to defaults</Button>
      </div>
    </Section>
  );
}

function IntegrationSection() {
  const [st, setSt] = useState<Status>(null);
  useEffect(() => { void fetch('/api/status').then(async (r) => setSt(r.ok ? await r.json() : { error: `Status check failed (${r.status})` })).catch((e) => setSt({ error: (e as Error).message })); }, []);
  const row = (label: string, ok: boolean | null, okText: string, offText: string) => (
    <li className="flex items-start gap-2 py-2 text-sm">
      {ok ? <CheckCircle2 size={16} className="mt-0.5 text-success" aria-hidden /> : <XCircle size={16} className="mt-0.5 text-secondary" aria-hidden />}
      <span><span className="font-medium">{label}: </span>{ok === null ? 'Checking...' : ok ? okText : offText}</span>
    </li>
  );
  const ok = st && !('error' in st) ? st : null;
  return (
    <Section title="Integrations" hint="Only the status is shown. Keys are never sent to your browser.">
      {st && 'error' in st && <ErrorBox message={st.error} />}
      <ul className="divide-y">
        {row('Database and sign-in (Supabase)', ok ? ok.supabase : st ? false : null, 'Connected', 'Not reachable')}
        {row('AI features (Anthropic)', ok ? ok.anthropic : st ? false : null, 'Configured', 'Not configured. Set ANTHROPIC_API_KEY on the server to enable AI features. Everything else keeps working.')}
        {row('Email', false, '', 'Not configured. This app does not send email. Anything that would be an email is only drafted for you to copy and send yourself.')}
        {row('Google Calendar', false, '', 'Not configured. No events are created or synced.')}
      </ul>
      <p className="mt-2 text-xs text-secondary">Notifications are in-app only: they appear in the bell menu and on the Notifications page.</p>
    </Section>
  );
}

function BackupSection() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const run = async () => {
    if (busy) return;
    setBusy(true); setProgress('Starting...');
    try {
      const backup = await buildBackup(supabaseBrowser(), (d, t) => setProgress(`Reading tables ${d} of ${t}`));
      downloadFile(`mba-admissions-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(backup, null, 2), 'application/json');
      const rows = Object.values(backup.row_counts).reduce((a, b) => a + b, 0);
      toast(`Backup downloaded (${rows} rows)`);
    } catch (e) { toast((e as Error).message, 'err'); }
    setBusy(false); setProgress(null);
  };
  return (
    <Section title="Data backup" hint="Downloads all of your data as one JSON file, including soft-deleted records. Uploaded files are not included, only their storage paths.">
      <Button variant="secondary" onClick={run} disabled={busy}><Download size={14} /> {busy ? 'Exporting...' : 'Download full backup (JSON)'}</Button>
      {progress && <p className="mt-2 text-xs text-secondary" role="status">{progress}</p>}
      <p className="mt-2 text-xs text-secondary">The file contains personal information. Store it somewhere private.</p>
    </Section>
  );
}

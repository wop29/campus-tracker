'use client';
import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { Card, ErrorBox } from '@/components/ui';
import { useToast } from '@/components/toast';
import { supabaseBrowser } from '@/lib/supabase/client';
import { saveSettingsPatch } from '@/lib/settings';
import { THEMES, DEFAULT_THEME, applyTheme, isThemeId, readThemeCookie, writeThemeCookie, type ThemeId } from '@/components/theme/themes';

/** Self-contained appearance settings. Clicking a swatch previews the theme live and saves it to applicant_profiles.settings.theme. */
export function ThemeSection() {
  const toast = useToast();
  const [current, setCurrent] = useState<ThemeId>(DEFAULT_THEME);
  const [saving, setSaving] = useState<ThemeId | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setCurrent(readThemeCookie() ?? DEFAULT_THEME);
    let cancelled = false;
    void (async () => {
      try {
        const sb = supabaseBrowser();
        const { data: u } = await sb.auth.getUser();
        if (!u.user) return;
        const { data } = await sb.from('applicant_profiles').select('settings').eq('user_id', u.user.id).maybeSingle();
        const t = (data?.settings as Record<string, unknown> | null)?.theme;
        if (!cancelled && isThemeId(t)) setCurrent(t);
      } catch { /* the cookie hint stays */ }
    })();
    return () => { cancelled = true; };
  }, []);

  async function choose(id: ThemeId) {
    if (id === current || saving) return;
    const previous = current;
    setError(null); setSaving(id); setCurrent(id); applyTheme(id);
    try {
      await saveSettingsPatch(supabaseBrowser(), { theme: id });
      writeThemeCookie(id);
      toast(`Theme saved: ${THEMES.find((t) => t.id === id)?.label}`);
    } catch (e) {
      setCurrent(previous); applyTheme(previous);
      const msg = e instanceof Error ? e.message : 'Could not save the theme';
      setError(`Could not save the theme. ${msg}`);
      toast('Theme not saved', 'err');
    } finally { setSaving(null); }
  }

  return (
    <Card className="space-y-4">
      <div><h2 className="text-lg font-extrabold">Appearance</h2><p className="text-sm text-secondary">Pick a theme. It changes right away and is saved to your profile, so it follows you to any device.</p></div>
      {error && <ErrorBox message={error} />}
      <div role="radiogroup" aria-label="Theme" className="grid gap-3 sm:grid-cols-2">
        {THEMES.map((t) => {
          const selected = t.id === current;
          return (
            <button key={t.id} type="button" role="radio" aria-checked={selected} disabled={saving !== null} onClick={() => void choose(t.id)}
              data-theme={t.id}
              className={`rounded-2xl border-2 border-b-4 bg-bg p-3 text-left text-ink transition disabled:cursor-wait ${selected ? 'border-fun-green-dark' : 'border-border hover:border-line'}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-extrabold">{t.label}</span>
                {selected && <span className="inline-flex items-center gap-1 rounded-full bg-fun-green px-2 py-0.5 text-xs font-extrabold text-on-fun"><Check size={12} aria-hidden />{saving === t.id ? 'Saving' : 'Selected'}</span>}
              </div>
              <p className="mt-0.5 text-xs text-secondary">{t.blurb}</p>
              <div className="mt-2 flex items-center gap-1.5" aria-hidden>
                {['green', 'blue', 'orange', 'pink', 'yellow', 'purple'].map((c) => <span key={c} className="h-5 w-5 rounded-full border-b-2" style={{ background: `var(--color-fun-${c})`, borderColor: `var(--color-fun-${c}-dark)` }} />)}
              </div>
              <div className="mt-2 rounded-xl border-2 bg-surface p-2" aria-hidden>
                <div className="h-2 w-2/3 rounded-full bg-ink/80" /><div className="mt-1.5 h-2 w-1/2 rounded-full bg-secondary/50" />
                <div className="mt-2 inline-block rounded-lg border-b-2 border-fun-green-dark bg-fun-green px-2 py-0.5 text-[10px] font-extrabold text-on-fun">Button</div>
              </div>
            </button>
          );
        })}
      </div>
      <p className="text-xs text-secondary">Reduce motion: the app already follows your device setting. When it is on, confetti is skipped and the mascot and progress bars stay still.</p>
    </Card>
  );
}

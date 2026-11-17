'use client';
import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { AiLabel, Button, Card, ProgressBar } from '@/components/ui';
import { useToast } from '@/components/toast';
import { supabaseBrowser } from '@/lib/supabase/client';
import { AI_MODES, REVIEW_SECTIONS, orderScores, reviewResponseSchema, type AiMode, type EssayVersionRow, type StoredReview } from '@/lib/essays';
import { errMsg } from './data';

export function AiEvalPanel({ essayId, dirty, hasText, latest, onStored }: { essayId: string; dirty: boolean; hasText: boolean; latest: EssayVersionRow | null; onStored: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState<AiMode | null>(null);
  const [fresh, setFresh] = useState<StoredReview | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const shown = fresh ?? latest?.ai_review ?? null;

  async function run(mode: AiMode) {
    if (busy) return;
    setNotice(null);
    if (dirty) { setNotice('Save your draft first. The AI reads the saved version, not the text in the editor.'); return; }
    if (!hasText) { setNotice('Write something and save it before asking for a review.'); return; }
    setBusy(mode);
    try {
      const res = await fetch('/api/ai/essay-review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ essayId, mode }) });
      const body = await res.json().catch(() => null);
      if (res.status === 404) { setNotice('The AI essay review service is not available yet in this build.'); return; }
      if (res.status === 503 || body?.error === 'not_configured') { setNotice(body?.message ?? 'AI is not configured. Add ANTHROPIC_API_KEY to .env.local to enable reviews. Everything else keeps working.'); return; }
      if (res.status === 401) { setNotice('You are signed out. Sign in again and retry.'); return; }
      if (!res.ok) { setNotice(body?.message ?? `The review failed (status ${res.status}). Try again.`); return; }
      const parsed = reviewResponseSchema.safeParse(body);
      if (!parsed.success) { setNotice('The review came back in an unexpected format, so it was not saved.'); return; }
      const stored: StoredReview = { ...parsed.data, mode, reviewedAt: new Date().toISOString() };
      setFresh(stored);
      // Attach to the newest version row (the one that was just reviewed).
      const sb = supabaseBrowser();
      const { data: lv, error: e1 } = await sb.from('essay_versions').select('id').eq('essay_id', essayId).order('version_number', { ascending: false }).limit(1).maybeSingle();
      if (e1 || !lv) throw new Error(e1?.message ?? 'Could not find the version to attach the review to');
      const { error: e2 } = await sb.from('essay_versions').update({ ai_review: stored }).eq('id', lv.id);
      if (e2) throw new Error(`Review shown but not saved: ${e2.message}`);
      toast('Review saved on the latest version'); onStored();
    } catch (e) { toast(errMsg(e), 'err'); } finally { setBusy(null); }
  }

  const scores = shown ? orderScores(shown.scores ?? {}) : [];
  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between"><h2 className="flex items-center gap-1.5 text-sm font-semibold"><Sparkles size={14} /> AI evaluation</h2><AiLabel /></div>
      <p className="text-xs text-secondary">AI feedback is a second opinion about the text you wrote. It does not write your essay or know your history beyond what you saved.</p>
      <div className="flex flex-wrap gap-1.5">{AI_MODES.map((m) => <Button key={m.mode} size="sm" variant="secondary" title={m.hint} disabled={!!busy} onClick={() => void run(m.mode)}>{busy === m.mode ? 'Working...' : m.label}</Button>)}</div>
      {notice && <p className="rounded-md bg-warning/10 p-2 text-xs" role="status">{notice}</p>}
      {shown && (
        <div className="space-y-3 border-t pt-3">
          <p className="text-xs text-secondary">{shown.mode ? `Mode: ${AI_MODES.find((m) => m.mode === shown.mode)?.label ?? shown.mode}. ` : ''}{fresh ? 'Just now' : latest ? `Stored on version ${latest.version_number}` : ''}</p>
          {scores.length > 0 && <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">{scores.map((s) => (
            <div key={s.label}><div className="flex justify-between text-xs"><span>{s.label}</span><span className="font-medium">{s.value}/10</span></div><ProgressBar value={s.value * 10} tone={s.value >= 7 ? 'success' : s.value >= 5 ? 'warning' : 'danger'} /></div>))}</div>}
          {REVIEW_SECTIONS.map((sec) => { const items = shown.review?.[sec.key] ?? []; return items.length ? <div key={sec.key}><h3 className="text-xs font-semibold">{sec.label}</h3><ul className="ml-4 list-disc text-sm">{items.map((x, i) => <li key={i}>{x}</li>)}</ul></div> : null; })}
          {shown.suggestions && <div><h3 className="text-xs font-semibold">Suggestions</h3><p className="whitespace-pre-line text-sm">{shown.suggestions}</p></div>}
        </div>
      )}
    </Card>
  );
}

'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { BookMarked } from 'lucide-react';
import { Badge, Button, Card, ErrorBox, Loading } from '@/components/ui';
import { useToast } from '@/components/toast';
import { supabaseBrowser } from '@/lib/supabase/client';
import { must, useQuery } from '@/lib/hooks';
import { STORY_CATEGORY_LABEL, deriveUsage, rankStories, type StoryRow } from '@/lib/stories';
import { errMsg, syncStoryUsage } from './data';

type L = { story_id: string; essay_id: string; essays: { deleted_at: string | null } | null };
export function StoryLinker({ essayId, prompt, schoolId }: { essayId: string; prompt: string | null; schoolId: string | null }) {
  const toast = useToast();
  const stories = useQuery<StoryRow[]>((sb) => sb.from('story_bank').select('*').is('deleted_at', null).order('title'), []);
  const links = useQuery<L[]>((sb) => sb.from('essay_stories').select('story_id, essay_id, essays(deleted_at)') as never, []);
  const [busy, setBusy] = useState<string | null>(null);
  const [showRank, setShowRank] = useState(false);
  const all = stories.data ?? [];
  const linked = useMemo(() => new Set((links.data ?? []).filter((l) => l.essay_id === essayId).map((l) => l.story_id)), [links.data, essayId]);
  const counts = useMemo(() => deriveUsage((links.data ?? []).map((l) => ({ story_id: l.story_id, essay_deleted_at: l.essays?.deleted_at ?? 'x' }))), [links.data]);
  const ranked = useMemo(() => rankStories(prompt, all, { schoolId, usageCounts: counts }).filter((r) => !linked.has(r.story.id)).slice(0, 5), [prompt, all, schoolId, counts, linked]);

  async function toggle(storyId: string, on: boolean) {
    if (busy) return; setBusy(storyId);
    try {
      const sb = supabaseBrowser();
      if (on) { const { error } = await sb.from('essay_stories').insert({ essay_id: essayId, story_id: storyId }); if (error && error.code !== '23505') throw new Error(error.message); }
      else await must(sb.from('essay_stories').delete().eq('essay_id', essayId).eq('story_id', storyId));
      await syncStoryUsage(sb, [storyId]);
      await links.reload(); await stories.reload();
    } catch (e) { toast(errMsg(e), 'err'); } finally { setBusy(null); }
  }
  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between"><h2 className="flex items-center gap-1.5 text-sm font-semibold"><BookMarked size={14} /> Stories used in this essay</h2><Button size="sm" variant="secondary" onClick={() => setShowRank((s) => !s)}>{showRank ? 'Hide' : 'Recommend stories'}</Button></div>
      {stories.loading || links.loading ? <Loading /> : stories.error || links.error ? <ErrorBox message={(stories.error || links.error)!} /> : !all.length ? (
        <p className="text-sm text-secondary">Your story bank is empty. <Link className="text-accent underline" href="/essays">Add stories in the Story Bank tab</Link> to link them here.</p>
      ) : (<>
        {showRank && <div className="rounded-md bg-bg p-2">
          <p className="mb-1 text-xs text-secondary">Ranked by overlap between this essay's saved prompt and each story's category, competencies and related prompts. Reasons are listed so you can judge them.</p>
          {!prompt?.trim() ? <p className="text-sm">Add the essay prompt in Essay details to get recommendations.</p> : !ranked.length ? <p className="text-sm">No unlinked story clearly matches this prompt.</p> : (
            <ul className="space-y-2">{ranked.map((r) => (<li key={r.story.id} className="text-sm"><div className="flex items-center gap-2"><span className="font-medium">{r.story.title}</span><Badge tone="accent">{STORY_CATEGORY_LABEL[r.story.category]}</Badge><span className="text-xs text-secondary">score {r.score}</span>
              <Button size="sm" className="ml-auto" disabled={busy === r.story.id} onClick={() => void toggle(r.story.id, true)}>Link</Button></div>
              <ul className="ml-4 list-disc text-xs text-secondary">{r.reasons.map((x, i) => <li key={i}>{x}</li>)}</ul></li>))}</ul>)}
        </div>}
        <ul className="max-h-60 space-y-1 overflow-auto text-sm">{all.map((s) => (
          <li key={s.id}><label className="flex items-center gap-2"><input type="checkbox" checked={linked.has(s.id)} disabled={busy === s.id} onChange={(e) => void toggle(s.id, e.target.checked)} />
            <span>{s.title}</span><span className="text-xs text-secondary">{STORY_CATEGORY_LABEL[s.category]}, used in {counts.get(s.id) ?? 0}</span></label></li>))}</ul>
      </>)}
    </Card>
  );
}

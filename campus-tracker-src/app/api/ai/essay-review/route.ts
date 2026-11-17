import { NextResponse } from 'next/server';
import { loadContext } from '@/lib/ai-context';
import { EssayReviewBody, essayReviewPrompt, validateEssayReview } from '@/lib/coach';
import { countWords } from '@/lib/logic/text';
import { badOutput, callJson, dbFailure, guard, notFound } from '@/lib/coach-server';

export async function POST(req: Request) {
  const g = await guard(req, EssayReviewBody); if ('res' in g) return g.res;
  const { sb, body } = g;
  try {
    const { data: essay, error: e1 } = await sb.from('essays').select('id,title,prompt,word_limit,draft,school_id,application_id').eq('id', body.essayId).is('deleted_at', null).maybeSingle();
    if (e1) throw e1; if (!essay) return notFound('Essay');
    const { data: latest, error: e2 } = await sb.from('essay_versions').select('id,version_number,text').eq('essay_id', essay.id).order('version_number', { ascending: false }).limit(1).maybeSingle();
    if (e2) throw e2;
    // The working draft is the most recent text; fall back to the latest saved version.
    const draft = (essay.draft?.trim() ? essay.draft : latest?.text ?? '').trim();
    if (!draft) return NextResponse.json({ error: 'empty_draft', message: 'This essay has no draft text yet. Write something before requesting a review.' }, { status: 400 });
    const words = countWords(draft);
    if (body.mode === 'reduce_words' && !essay.word_limit) return NextResponse.json({ error: 'invalid_request', message: 'Set a word limit on the essay before using reduce words.' }, { status: 400 });

    const ctx = await loadContext(sb, { mode: 'essay_review', essayId: essay.id, schoolId: essay.school_id, applicationId: essay.application_id, query: `${essay.title} ${essay.prompt ?? ''} ${draft.slice(0, 1500)}`, maxChars: 12000, includeEssayDraft: false });
    const p = essayReviewPrompt({ mode: body.mode, contextText: ctx.text, title: essay.title, prompt: essay.prompt, wordLimit: essay.word_limit, draft, wordCount: words });
    const out = await callJson(p.system, p.user, 6000); if ('res' in out) return out.res;
    const v = validateEssayReview(out.raw, body.mode); if (!v.ok) return badOutput(v.error);

    const review = { ...v.value, mode: body.mode, reviewedAt: new Date().toISOString(), model: out.model };
    // Attach the review to a version holding exactly the reviewed text, creating a snapshot if the draft moved on.
    let versionId = latest?.id ?? null;
    if (!latest || latest.text.trim() !== draft) {
      const { data: nv, error } = await sb.from('essay_versions').insert({ essay_id: essay.id, version_number: (latest?.version_number ?? 0) + 1, text: draft, word_count: words, change_notes: 'Snapshot saved for AI review', ai_review: review }).select('id').single();
      if (error) throw error; versionId = nv.id;
    } else {
      const { error } = await sb.from('essay_versions').update({ ai_review: review }).eq('id', latest.id); if (error) throw error;
    }
    const { data: a, error: e3 } = await sb.from('ai_assessments').insert({ kind: 'essay', school_id: essay.school_id, subject_id: essay.id, result: { ...v.value, mode: body.mode, versionId }, model: out.model, input_snapshot: { ...ctx.snapshot, mode: body.mode, wordCount: words, versionId } }).select('id').single();
    if (e3) throw e3;
    return NextResponse.json({ scores: v.value.scores, review: v.value.review, ...(v.value.suggestions ? { suggestions: v.value.suggestions } : {}), assessmentId: a.id });
  } catch (e) { return dbFailure(e); }
}

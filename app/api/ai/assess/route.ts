import { NextResponse } from 'next/server';
import { loadContext } from '@/lib/ai-context';
import { ASSESSMENT_DISCLAIMER, AssessBody, gapAssessPrompt, profileAssessPrompt, validateGap, validateProfile } from '@/lib/coach';
import { badOutput, callJson, dbFailure, guard, notFound } from '@/lib/coach-server';

export async function POST(req: Request) {
  const g = await guard(req, AssessBody); if ('res' in g) return g.res;
  const { sb, body } = g;
  try {
    let schoolName = '';
    if (body.kind === 'school_gap') {
      const { data, error } = await sb.from('schools').select('id,name').eq('id', body.schoolId!).is('deleted_at', null).maybeSingle();
      if (error) throw error; if (!data) return notFound('School'); schoolName = data.name;
    }
    const ctx = await loadContext(sb, { mode: body.kind === 'profile' ? 'assess_profile' : 'school_gap', schoolId: body.schoolId, maxChars: 16000 });
    const p = body.kind === 'profile' ? profileAssessPrompt(ctx.text) : gapAssessPrompt(ctx.text, schoolName, ctx.hasSchoolData);
    const out = await callJson(p.system, p.user, 4000); if ('res' in out) return out.res;
    const v = body.kind === 'profile' ? validateProfile(out.raw) : validateGap(out.raw);
    if (!v.ok) return badOutput(v.error);
    const result = body.kind === 'profile'
      ? { ...v.value, disclaimer: v.value.disclaimer || ASSESSMENT_DISCLAIMER, assumptions: ASSESSMENT_DISCLAIMER }
      : { ...v.value, school_data_status: ctx.hasSchoolData ? 'researched' : 'not_researched', assumptions: ASSESSMENT_DISCLAIMER };
    const { data, error } = await sb.from('ai_assessments').insert({ kind: body.kind, school_id: body.schoolId ?? null, subject_id: body.schoolId ?? null, result, model: out.model, input_snapshot: ctx.snapshot }).select('id,created_at').single();
    if (error) throw error;
    return NextResponse.json({ assessmentId: data.id, createdAt: data.created_at, result, usedContext: ctx.used });
  } catch (e) { return dbFailure(e); }
}

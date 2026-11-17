import { NextResponse } from 'next/server';
import { loadContext } from '@/lib/ai-context';
import { InterviewBody, evaluatePrompt, followUpPrompt, generateQuestionsPrompt, validateEvaluation, validateFollowUp, validateGenerated } from '@/lib/interview';
import { badOutput, callJson, dbFailure, guard, notFound } from '@/lib/coach-server';

export async function POST(req: Request) {
  const g = await guard(req, InterviewBody); if ('res' in g) return g.res;
  const { sb, body } = g;
  try {
    if (body.action === 'generate_questions') {
      const { data: school, error } = await sb.from('schools').select('id,name').eq('id', body.schoolId).is('deleted_at', null).maybeSingle();
      if (error) throw error; if (!school) return notFound('School');
      const ctx = await loadContext(sb, { mode: 'interview', schoolId: school.id, query: body.category ?? '', maxChars: 12000 });
      const count = body.count ?? 5;
      const p = generateQuestionsPrompt({ schoolName: school.name, category: body.category, count, contextText: ctx.text, hasSchoolData: ctx.hasSchoolData });
      const out = await callJson(p.system, p.user, 2000); if ('res' in out) return out.res;
      const v = validateGenerated(out.raw); if (!v.ok) return badOutput(v.error);
      const rows = v.value.questions.slice(0, count).map((q) => ({ school_id: school.id, category: body.category ?? q.category, question: q.question, origin: 'ai_generated' as const }));
      const { data, error: e2 } = await sb.from('interview_questions').insert(rows).select('*'); if (e2) throw e2;
      return NextResponse.json({ questions: data, usedContext: ctx.used });
    }
    const { data: q, error: qe } = await sb.from('interview_questions').select('id,session_id,school_id,category,question').eq('id', body.questionId).maybeSingle();
    if (qe) throw qe; if (!q) return notFound('Question');
    let schoolId: string | null = q.school_id;
    if (!schoolId && q.session_id) { const { data: s } = await sb.from('interview_sessions').select('school_id').eq('id', q.session_id).maybeSingle(); schoolId = s?.school_id ?? null; }
    const ctx = await loadContext(sb, { mode: 'interview', schoolId, query: `${q.category} ${q.question} ${body.answer}`, maxChars: 12000 });

    if (body.action === 'follow_up') {
      const { data: sess, error: se } = await sb.from('interview_sessions').select('id').eq('id', body.sessionId).maybeSingle();
      if (se) throw se; if (!sess) return notFound('Session');
      const p = followUpPrompt({ question: q.question, category: q.category, answer: body.answer, contextText: ctx.text });
      const out = await callJson(p.system, p.user, 800); if ('res' in out) return out.res;
      const v = validateFollowUp(out.raw); if (!v.ok) return badOutput(v.error);
      await sb.from('interview_questions').update({ answer: body.answer }).eq('id', q.id);
      const { data: last } = await sb.from('interview_questions').select('asked_order').eq('session_id', sess.id).order('asked_order', { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
      const { data, error } = await sb.from('interview_questions').insert({ session_id: sess.id, school_id: schoolId, category: q.category, question: v.value.question, origin: 'ai_generated', asked_order: (last?.asked_order ?? 0) + 1 }).select('*').single();
      if (error) throw error;
      return NextResponse.json({ question: data, reason: v.value.reason ?? null });
    }

    // evaluate
    const p = evaluatePrompt({ question: q.question, category: q.category, answer: body.answer, contextText: ctx.text, hasSchoolData: ctx.hasSchoolData });
    const out = await callJson(p.system, p.user, 2500); if ('res' in out) return out.res;
    const v = validateEvaluation(out.raw); if (!v.ok) return badOutput(v.error);
    const e = v.value;
    const { error: ue } = await sb.from('interview_questions').update({ answer: body.answer }).eq('id', q.id); if (ue) throw ue;
    const feedbackText = [...e.feedback, ...(e.unsupported_claims.length ? ['Check these claims against your records: ' + e.unsupported_claims.join('; ')] : [])].map((f) => `- ${f}`).join('\n');
    const { data: fb, error: fe } = await sb.from('interview_feedback').insert({ question_id: q.id, scores: e.scores, feedback: feedbackText, source: 'ai' }).select('*').single(); if (fe) throw fe;
    const { error: ae } = await sb.from('ai_assessments').insert({ kind: 'interview', school_id: schoolId, subject_id: q.id, result: e, model: out.model, input_snapshot: ctx.snapshot }); if (ae) throw ae;
    return NextResponse.json({ feedback: fb, scores: e.scores, feedbackItems: e.feedback, unsupportedClaims: e.unsupported_claims, practiceQuestions: e.practice_questions, usedContext: ctx.used });
  } catch (e) { return dbFailure(e); }
}

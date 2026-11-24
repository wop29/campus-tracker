// One-click unsubscribe from the reminder emails. The link carries the user id and an HMAC of it
// (REMINDER_SECRET), so it works without signing in and cannot be forged for someone else.
// GET (link click) and POST (Gmail / Apple Mail "List-Unsubscribe-Post" one-click) both turn reminders off.
import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { adminClient } from '@/lib/email/reminder-data';
import { verifyUnsubscribeToken } from '@/lib/email/token';
import { withReminderPatch } from '@/lib/reminders';

export const dynamic = 'force-dynamic';

const page = (status: number, title: string, body: string, appUrl: string) => new NextResponse(
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title></head>
<body style="margin:0;background:#f7f7f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#3c3c3c;">
<div style="max-width:440px;margin:48px auto;padding:0 16px;"><div style="background:#fff;border:2px solid #e5e5e5;border-radius:16px;padding:28px 22px;text-align:center;">
<h1 style="margin:0 0 10px;font-size:22px;">${title}</h1><p style="margin:0 0 18px;font-size:16px;line-height:1.5;">${body}</p>
<a href="${appUrl}/settings" style="display:inline-block;background:#58cc02;color:#fff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:12px;border-bottom:4px solid #58a700;">Open settings</a>
</div></div></body></html>`,
  { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
);

async function unsubscribe(req: NextRequest) {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL?.trim() || req.nextUrl.origin).replace(/\/+$/, '');
  const u = req.nextUrl.searchParams.get('u'), t = req.nextUrl.searchParams.get('t');
  if (!verifyUnsubscribeToken(u, t, process.env.REMINDER_SECRET?.trim())) {
    return page(400, 'That link did not work', 'The unsubscribe link is incomplete or has expired. You can turn email reminders off in Settings instead.', appUrl);
  }
  const sb = adminClient();
  if (!sb) return page(500, 'Something went wrong', 'Email settings are not available right now. You can turn email reminders off in Settings instead.', appUrl);
  const { data, error } = await sb.from('applicant_profiles').select('settings').eq('user_id', u!).maybeSingle();
  if (error) return page(500, 'Something went wrong', 'We could not update your email settings. Please try again in a minute, or turn email reminders off in Settings.', appUrl);
  if (data) {
    const settings = withReminderPatch((data.settings as Record<string, unknown> | null) ?? {}, { email: false });
    const { error: we } = await sb.from('applicant_profiles').update({ settings }).eq('user_id', u!);
    if (we) return page(500, 'Something went wrong', 'We could not update your email settings. Please try again in a minute, or turn email reminders off in Settings.', appUrl);
  }
  return page(200, 'You are unsubscribed', 'We will not send you reminder emails anymore. Your plan and progress are safe. If you miss them, you can turn them back on anytime in Settings.', appUrl);
}

export const GET = unsubscribe;
export async function POST(req: NextRequest) {
  const res = await unsubscribe(req);
  return res.status === 200 ? new NextResponse(null, { status: 200 }) : res;
}

// Provider-agnostic email sender. Server only: reads secrets from the environment and never exposes them.
//  1. RESEND_API_KEY set           -> Resend HTTP API (fetch, no SDK). From address: REMINDER_FROM.
//  2. SMTP_HOST, SMTP_USER, SMTP_PASS set -> SMTP via nodemailer (works with a Gmail app password).
//  3. Neither                      -> dry run: logs and skips, nothing is sent.
import 'server-only';

export type OutgoingEmail = { to: string; subject: string; html: string; text: string; headers?: Record<string, string> };
export type SendResult = { ok: boolean; id?: string; error?: string; skipped?: boolean };
export type Provider = 'resend' | 'smtp' | 'none';

const env = (k: string) => (process.env[k] ?? '').trim();

export function emailProvider(): Provider {
  if (env('RESEND_API_KEY')) return 'resend';
  if (env('SMTP_HOST') && env('SMTP_USER') && env('SMTP_PASS')) return 'smtp';
  return 'none';
}
/** The From header. Resend needs REMINDER_FROM on a verified domain (or onboarding@resend.dev for testing to yourself). */
export function fromAddress(): string {
  return env('REMINDER_FROM') || (emailProvider() === 'smtp' ? env('SMTP_USER') : '');
}

const RESEND_BATCH = 100;

async function sendResend(msgs: OutgoingEmail[], idempotencyKey?: string): Promise<SendResult[]> {
  const from = fromAddress();
  if (!from) return msgs.map(() => ({ ok: false, error: 'REMINDER_FROM is not set' }));
  const out: SendResult[] = [];
  for (let i = 0; i < msgs.length; i += RESEND_BATCH) {
    const chunk = msgs.slice(i, i + RESEND_BATCH);
    const body = chunk.map((m) => ({ from, to: [m.to], subject: m.subject, html: m.html, text: m.text, ...(m.headers ? { headers: m.headers } : {}) }));
    try {
      const res = await fetch('https://api.resend.com/emails/batch', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env('RESEND_API_KEY')}`, 'Content-Type': 'application/json', ...(idempotencyKey ? { 'Idempotency-Key': `${idempotencyKey}-${i / RESEND_BATCH}`.slice(0, 256) } : {}) },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => null)) as { data?: { id: string }[]; message?: string; name?: string } | null;
      if (!res.ok) { const error = `Resend ${res.status}: ${json?.message ?? json?.name ?? 'request failed'}`; out.push(...chunk.map(() => ({ ok: false, error }))); continue; }
      out.push(...chunk.map((_, j) => ({ ok: true, id: json?.data?.[j]?.id })));
    } catch (e) {
      out.push(...chunk.map(() => ({ ok: false, error: `Resend request failed: ${(e as Error).message}` })));
    }
  }
  return out;
}

async function sendSmtp(msgs: OutgoingEmail[]): Promise<SendResult[]> {
  const nodemailer = (await import('nodemailer')).default;
  const port = Number(env('SMTP_PORT')) || 465;
  const transport = nodemailer.createTransport({ host: env('SMTP_HOST'), port, secure: port === 465, auth: { user: env('SMTP_USER'), pass: env('SMTP_PASS') }, pool: true, maxConnections: 2 });
  const from = fromAddress();
  const out: SendResult[] = [];
  try {
    for (const m of msgs) {
      try {
        const info = await transport.sendMail({ from, to: m.to, subject: m.subject, html: m.html, text: m.text, headers: m.headers });
        out.push({ ok: true, id: info.messageId });
      } catch (e) { out.push({ ok: false, error: `SMTP: ${(e as Error).message}` }); }
    }
  } finally { transport.close(); }
  return out;
}

/** Sends every message and returns one result per message, in order. Never throws. */
export async function sendEmails(msgs: OutgoingEmail[], opts: { idempotencyKey?: string } = {}): Promise<{ provider: Provider; results: SendResult[] }> {
  const provider = emailProvider();
  if (!msgs.length) return { provider, results: [] };
  if (provider === 'resend') return { provider, results: await sendResend(msgs, opts.idempotencyKey) };
  if (provider === 'smtp') return { provider, results: await sendSmtp(msgs) };
  console.info(`[email] No provider configured (RESEND_API_KEY or SMTP_*). Dry run, skipped ${msgs.length} email(s).`);
  return { provider, results: msgs.map(() => ({ ok: false, skipped: true, error: 'No email provider configured' })) };
}
export async function sendEmail(msg: OutgoingEmail): Promise<SendResult> {
  return (await sendEmails([msg])).results[0];
}

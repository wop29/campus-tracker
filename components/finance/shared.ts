import type { ZodError } from 'zod';
import { fmtMoney } from '@/lib/utils';

export type SchoolLite = { id: string; name: string; short_name: string | null };
export type AppLite = { id: string; school_id: string; stage: string; round: string | null; program: string; intake: string; application_fee: number | null; fee_currency: string; deleted_at: string | null };

export function fieldErrors(err: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of err.issues) { const k = String(i.path[0] ?? '_'); if (!out[k]) out[k] = i.message; }
  return out;
}
/** Currency-safe money formatting that falls back to plain text for unknown codes. */
export function money(n: number | null | undefined, currency: string): string {
  try { return fmtMoney(n, currency); } catch { return n == null ? '-' : `${n.toLocaleString('en-US')} ${currency}`; }
}
export const moneyDec = (n: number, currency: string) => { try { return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n); } catch { return `${n.toFixed(2)} ${currency}`; } };
export const schoolLabel = (s?: SchoolLite) => (s ? s.short_name || s.name : '');
export const appLabel = (a: AppLite | undefined, schools: Map<string, SchoolLite>) => (a ? `${schoolLabel(schools.get(a.school_id)) || 'School'} - ${a.program}${a.round ? `, ${a.round}` : ''} (${a.intake})` : '');
export function downloadText(name: string, text: string, mime = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

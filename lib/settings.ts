import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_WEIGHTS, type Weights } from './logic/readiness.ts';

export const DEFAULT_REMINDER_DAYS = [30, 14, 7, 3, 1];
export const WEIGHT_KEYS = Object.keys(DEFAULT_WEIGHTS) as (keyof Weights)[];

export const workingHoursSchema = z.coerce.number({ error: 'Enter a number of hours' }).min(0.5, 'At least 0.5 hours').max(16, 'At most 16 hours');
export const baseCurrencySchema = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Use a 3-letter currency code such as USD');
export const reminderDaysSchema = z.array(z.number().int().min(1).max(365)).min(1, 'Enter at least one day').max(10, 'At most 10 reminder days');
export const weightsSchema = z.object(Object.fromEntries(WEIGHT_KEYS.map((k) => [k, z.number().int().min(0).max(100)])) as Record<keyof Weights, z.ZodNumber>)
  .refine((w) => Object.values(w).reduce((a, b) => a + b, 0) === 100, { message: 'Weights must add up to 100' });

/** Parses a comma separated list such as "30, 14, 7" into sorted unique descending days. Returns an error message on bad input. */
export function parseReminderDays(text: string): { ok: true; days: number[] } | { ok: false; error: string } {
  const parts = text.split(/[,\s]+/).filter(Boolean);
  if (!parts.length) return { ok: false, error: 'Enter at least one day' };
  const nums = parts.map(Number);
  if (nums.some((n) => !Number.isInteger(n))) return { ok: false, error: 'Use whole numbers separated by commas' };
  const r = reminderDaysSchema.safeParse([...new Set(nums)].sort((a, b) => b - a));
  return r.success ? { ok: true, days: r.data } : { ok: false, error: r.error.issues[0].message };
}

export type AppSettings = { workingHours: number | null; reminderDays: number[]; weights: Weights; baseCurrency: string };

/** Reads the settings jsonb defensively: anything missing or invalid falls back to the documented default. */
export function parseSettings(raw: Record<string, unknown> | null | undefined): AppSettings {
  const s = raw ?? {};
  const wh = workingHoursSchema.safeParse(s.working_hours_per_day);
  const rd = reminderDaysSchema.safeParse(s.reminder_days);
  const rw = weightsSchema.safeParse(s.readiness_weights);
  const bc = baseCurrencySchema.safeParse(s.base_currency);
  return {
    workingHours: s.working_hours_per_day != null && wh.success ? wh.data : null,
    reminderDays: rd.success ? rd.data : DEFAULT_REMINDER_DAYS,
    weights: rw.success ? (rw.data as Weights) : DEFAULT_WEIGHTS,
    baseCurrency: bc.success ? bc.data : 'USD',
  };
}

/** Merges a patch into applicant_profiles.settings (keeping keys owned by other modules). Creates the profile row if it does not exist. */
export async function saveSettingsPatch(sb: SupabaseClient, patch: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const { data: u, error: ue } = await sb.auth.getUser();
  if (ue || !u.user) throw new Error('Not signed in');
  const { data: row, error } = await sb.from('applicant_profiles').select('id,settings').eq('user_id', u.user.id).maybeSingle();
  if (error) throw new Error(error.message);
  const settings = { ...((row?.settings as Record<string, unknown>) ?? {}), ...patch };
  const { error: we } = await sb.from('applicant_profiles').upsert({ user_id: u.user.id, settings, ...extra }, { onConflict: 'user_id' });
  if (we) throw new Error(we.message);
  return settings;
}

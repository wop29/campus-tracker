// One-click unsubscribe tokens: an HMAC of the user id with REMINDER_SECRET. No table needed, nothing to store.
// Server only (uses node:crypto). The secret is passed in so this stays testable and never reads env by itself.
import { createHmac, timingSafeEqual } from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function unsubscribeToken(userId: string, secret: string): string {
  if (!secret) throw new Error('REMINDER_SECRET is not set');
  return createHmac('sha256', secret).update(`reminders-unsubscribe:${userId.toLowerCase()}`).digest('base64url');
}

/** Constant-time check. False for a missing secret, a malformed user id or a wrong token. */
export function verifyUnsubscribeToken(userId: string | null | undefined, token: string | null | undefined, secret: string | null | undefined): boolean {
  if (!secret || !userId || !token || !UUID.test(userId)) return false;
  const a = Buffer.from(unsubscribeToken(userId, secret)), b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function unsubscribeUrl(appUrl: string, userId: string, secret: string): string {
  const u = new URL('/api/reminders/unsubscribe', appUrl);
  u.searchParams.set('u', userId);
  u.searchParams.set('t', unsubscribeToken(userId, secret));
  return u.toString();
}

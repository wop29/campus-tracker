import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/** Liveness probe for Docker and hosting platforms. Unauthenticated on purpose and reveals nothing but `ok`. */
export function GET() {
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}

import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_COOKIE, getClientIp } from '@/lib/auth';
import { insertAudit } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, '', { path: '/', maxAge: 0 });
  await insertAudit('logout', undefined, undefined, getClientIp(req));
  return res;
}

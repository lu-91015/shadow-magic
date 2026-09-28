import { NextRequest, NextResponse } from 'next/server';
import {
  expectedPassword,
  expectedGuestPassword,
  createSessionToken,
  getClientIp,
  ADMIN_COOKIE,
  ADMIN_COOKIE_OPTS,
  type Role,
} from '@/lib/auth';
import { insertAudit } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const { password } = await req.json().catch(() => ({}) as any);
  const ip = getClientIp(req);
  let role: Role;
  if (password === expectedPassword()) role = 'admin';
  else if (password === expectedGuestPassword()) role = 'guest';
  else {
    await insertAudit('login_failed', undefined, { password: '***' }, ip);
    return NextResponse.json({ ok: false, error: '密码错误' }, { status: 401 });
  }
  const token = createSessionToken(role);
  const res = NextResponse.json({ ok: true, role });
  res.cookies.set(ADMIN_COOKIE, token, ADMIN_COOKIE_OPTS);
  await insertAudit('login', undefined, { role }, ip);
  return res;
}

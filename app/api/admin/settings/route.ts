import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getClientIp, ADMIN_COOKIE_OPTS, ADMIN_COOKIE, requireView } from '@/lib/auth';
import { getKv, setKv, insertAudit } from '@/lib/db';
import { setBiliCookie } from '@/lib/bilibili';
import { UID } from '@/lib/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (!(await requireView(req)))
    return NextResponse.json({ ok: false }, { status: 401 });
  const [cookie, sess] = await Promise.all([
    getKv('BILI_COOKIE'),
    getKv('BILI_SESSDATA'),
  ]);
  return NextResponse.json({
    ok: true,
    uid: UID,
    hasCookie: !!cookie,
    hasSess: !!sess,
    cookieMasked: cookie ? cookie.slice(0, 12) + '…' : null,
  });
}

export async function POST(req: NextRequest) {
  if (!(await requireAdmin(req)))
    return NextResponse.json({ ok: false }, { status: 401 });
  const body = await req.json().catch(() => ({}) as any);
  const ip = getClientIp(req);
  if (body.cookie !== undefined || body.sess !== undefined) {
    await setBiliCookie(
      body.cookie === '' ? undefined : body.cookie,
      body.sess === '' ? undefined : body.sess,
    );
    await insertAudit('settings_set', 'bili_cookie', { hasCookie: !!body.cookie }, ip);
  }
  if (body.key && body.value !== undefined) {
    await setKv(String(body.key), String(body.value));
    await insertAudit('settings_set', String(body.key), undefined, ip);
  }
  return NextResponse.json({ ok: true });
}

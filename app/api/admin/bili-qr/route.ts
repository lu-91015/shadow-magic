import { NextRequest, NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { requireAdmin, getClientIp } from '@/lib/auth';
import { biliQrGenerate, biliQrPoll, setBiliCookie } from '@/lib/bilibili';
import { insertAudit } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!(await requireAdmin(req)))
    return NextResponse.json({ ok: false }, { status: 401 });
  const { action, qrcode_key } = await req.json().catch(() => ({}) as any);
  const ip = getClientIp(req);

  if (action === 'generate') {
    try {
      const { url, qrcodeKey } = await biliQrGenerate();
      const qr = await QRCode.toDataURL(url, { margin: 1, width: 260 });
      return NextResponse.json({ ok: true, url, qrcodeKey, qr });
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: e?.message ?? '生成失败' });
    }
  }

  if (action === 'poll') {
    if (!qrcode_key)
      return NextResponse.json({ ok: false, error: '缺少 qrcode_key' }, { status: 400 });
    const r = await biliQrPoll(qrcode_key);
    if (r.status === 'success' && r.cookieStr) {
      await setBiliCookie(r.cookieStr, r.sess);
      await insertAudit('bili_qr_login', undefined, undefined, ip);
      return NextResponse.json({ ok: true, status: 'success' });
    }
    // 登录成功但没解析到 Cookie，或仍在等待/已失效：不要谎报成功
    const status = r.status === 'success' ? 'waiting' : r.status;
    const message =
      r.status === 'success' ? '登录成功，但未解析到 Cookie，请重试' : r.message;
    return NextResponse.json({ ok: true, status, message });
  }

  return NextResponse.json({ ok: false, error: '未知 action' }, { status: 400 });
}

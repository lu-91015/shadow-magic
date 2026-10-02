import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getClientIp } from '@/lib/auth';
import { unblockClip, insertAudit } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 解封被拉黑的切片（删除即拉黑，这里提供恢复入口）
export async function POST(req: NextRequest) {
  if (!(await requireAdmin(req)))
    return NextResponse.json({ ok: false }, { status: 401 });
  const body = await req.json().catch(() => null);
  const bvid = String(body?.bvid ?? '').trim();
  if (!bvid)
    return NextResponse.json({ ok: false, error: '缺少 bvid' }, { status: 400 });
  await unblockClip(bvid);
  await insertAudit('clip_unblock', bvid, {}, getClientIp(req));
  return NextResponse.json({ ok: true });
}

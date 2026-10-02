import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getClientIp, insertAudit } from '@/lib/auth';
import { updateLiveSessionMeta, getLiveSessionAdmin } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 标记某场录播歌单已人工核对：songs_override=true，后续自动流程不再改写。
export async function POST(
  req: NextRequest,
  { params }: { params: { bvid: string } },
) {
  if (!(await requireAdmin(req)))
    return NextResponse.json({ ok: false }, { status: 401 });
  const bvid = params.bvid;
  const session = await getLiveSessionAdmin(bvid);
  if (!session) return NextResponse.json({ ok: false, error: '未找到' }, { status: 404 });
  await updateLiveSessionMeta(bvid, { songsOverride: true });
  await insertAudit('live_meta', bvid, { songsOverride: true }, getClientIp(req));
  return NextResponse.json({ ok: true, bvid, songsOverride: true });
}

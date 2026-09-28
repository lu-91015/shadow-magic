import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getClientIp, requireView } from '@/lib/auth';
import { getLiveSessionAdmin, updateLiveSessionMeta, queryLiveSongsFull, getEffectiveSongs, insertAudit } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: { bvid: string } },
) {
  if (!(await requireView(req)))
    return NextResponse.json({ ok: false }, { status: 401 });
  const bvid = params.bvid;
  const session = await getLiveSessionAdmin(bvid);
  if (!session) return NextResponse.json({ ok: false, error: '未找到' }, { status: 404 });
  const songs = await queryLiveSongsFull(bvid);
  const effective = await getEffectiveSongs(bvid);
  return NextResponse.json({ ok: true, session, songs, effective });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { bvid: string } },
) {
  if (!(await requireAdmin(req)))
    return NextResponse.json({ ok: false }, { status: 401 });
  const bvid = params.bvid;
  const b = await req.json().catch(() => ({}) as any);
  const patch: any = {};
  if (b.categoryManual !== undefined) patch.categoryManual = b.categoryManual || null;
  if (b.singDuration !== undefined)
    patch.singDuration = b.singDuration === '' || b.singDuration == null ? null : Number(b.singDuration);
  if (b.gameDuration !== undefined)
    patch.gameDuration = b.gameDuration === '' || b.gameDuration == null ? null : Number(b.gameDuration);
  if (b.note !== undefined) patch.note = b.note || null;
  if (b.songsOverride !== undefined) patch.songsOverride = !!b.songsOverride;
  if (b.songStrategy !== undefined) patch.songStrategy = b.songStrategy || 'merge';
  await updateLiveSessionMeta(bvid, patch);
  await insertAudit('live_meta', bvid, patch, getClientIp(req));
  return NextResponse.json({ ok: true });
}

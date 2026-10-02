import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getClientIp } from '@/lib/auth';
import { setLiveSongExcluded, updateLiveSongTitle, deleteLiveSong, insertAudit } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(
  req: NextRequest,
  { params }: { params: { bvid: string; idx: string } },
) {
  if (!(await requireAdmin(req)))
    return NextResponse.json({ ok: false }, { status: 401 });
  const b = await req.json().catch(() => ({}) as any);
  // 手动改歌名
  if (typeof b.title === 'string') {
    const title = b.title.trim();
    if (!title)
      return NextResponse.json({ ok: false, error: '歌名为空' }, { status: 400 });
    await updateLiveSongTitle(params.bvid, Number(params.idx), title);
    await insertAudit(
      'song_rename',
      `${params.bvid}:${params.idx}`,
      { title },
      getClientIp(req),
    );
    return NextResponse.json({ ok: true });
  }
  const excluded = b.excluded === undefined ? true : !!b.excluded;
  await setLiveSongExcluded(params.bvid, Number(params.idx), excluded);
  await insertAudit('song_exclude', `${params.bvid}:${params.idx}`, { excluded }, getClientIp(req));
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { bvid: string; idx: string } },
) {
  if (!(await requireAdmin(req)))
    return NextResponse.json({ ok: false }, { status: 401 });
  await deleteLiveSong(params.bvid, Number(params.idx));
  await insertAudit('song_delete', `${params.bvid}:${params.idx}`, undefined, getClientIp(req));
  return NextResponse.json({ ok: true });
}

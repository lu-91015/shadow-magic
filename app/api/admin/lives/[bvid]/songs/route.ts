import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getClientIp, requireView } from '@/lib/auth';
import { queryLiveSongsFull, addManualSong, insertAudit } from '@/lib/db';
import { launchJob } from '@/lib/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: { bvid: string } },
) {
  if (!(await requireView(req)))
    return NextResponse.json({ ok: false }, { status: 401 });
  const songs = await queryLiveSongsFull(params.bvid);
  return NextResponse.json({ ok: true, songs });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { bvid: string } },
) {
  if (!(await requireAdmin(req)))
    return NextResponse.json({ ok: false }, { status: 401 });
  const bvid = params.bvid;
  const b = await req.json().catch(() => ({}) as any);
  if (b.action === 'scan') {
    const runId = await launchJob('songs', { bvid }, 'manual');
    await insertAudit('song_scan', bvid, undefined, getClientIp(req));
    return NextResponse.json({ ok: true, runId });
  }
  const title = String(b.title || '').trim();
  if (!title)
    return NextResponse.json({ ok: false, error: '歌名为空' }, { status: 400 });
  await addManualSong(bvid, title);
  await insertAudit('song_add', bvid, { title }, getClientIp(req));
  return NextResponse.json({ ok: true });
}

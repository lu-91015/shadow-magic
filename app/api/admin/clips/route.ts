import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getClientIp, requireView } from '@/lib/auth';
import {
  queryClipsAdmin,
  manualUpsertVideo,
  blockClip,
  insertAudit,
} from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!(await requireView(req)))
    return NextResponse.json({ ok: false }, { status: 401 });
  const q = req.nextUrl.searchParams.get('q') ?? undefined;
  const author = req.nextUrl.searchParams.get('author') ?? undefined;
  const limit = Number(req.nextUrl.searchParams.get('limit') ?? 100);
  const offset = Number(req.nextUrl.searchParams.get('offset') ?? 0);
  const noCover = req.nextUrl.searchParams.get('nocover') === '1';
  const exclude = req.nextUrl.searchParams.get('exclude') === '1';
  const { list, total } = await queryClipsAdmin({ q, author, limit, offset, noCover, exclude });
  return NextResponse.json({ ok: true, list, total });
}

export async function POST(req: NextRequest) {
  if (!(await requireAdmin(req)))
    return NextResponse.json({ ok: false }, { status: 401 });
  const b = await req.json().catch(() => ({}) as any);
  const bvid = String(b.bvid || '').trim();
  if (!/^BV\w+$/i.test(bvid))
    return NextResponse.json({ ok: false, error: 'bvid 格式不正确' }, { status: 400 });
  await manualUpsertVideo({
    bvid,
    title: String(b.title || ''),
    author: String(b.author || ''),
    pubdate: Number(b.pubdate ?? 0),
    view: Number(b.view ?? 0),
    like: Number(b.like ?? 0),
    coin: Number(b.coin ?? 0),
    share: Number(b.share ?? 0),
    favorite: Number(b.favorite ?? 0),
    reply: Number(b.reply ?? 0),
    danmaku: Number(b.danmaku ?? 0),
    arcurl: String(b.arcurl || `https://www.bilibili.com/video/${bvid}`),
    pic: b.pic || undefined,
    manual: true,
  });
  await insertAudit('clip_add', bvid, { title: b.title }, getClientIp(req));
  return NextResponse.json({ ok: true });
}

// 删除切片：写入黑名单，后续收集与展示均跳过
export async function DELETE(req: NextRequest) {
  if (!(await requireAdmin(req)))
    return NextResponse.json({ ok: false }, { status: 401 });
  const b = await req.json().catch(() => ({}) as any);
  const bvid = String(b.bvid || '').trim();
  if (!/^BV\w+$/i.test(bvid))
    return NextResponse.json({ ok: false, error: 'bvid 格式不正确' }, { status: 400 });
  await blockClip(bvid, String(b.reason || '') || null);
  await insertAudit('clip_delete', bvid, { reason: b.reason }, getClientIp(req));
  return NextResponse.json({ ok: true });
}

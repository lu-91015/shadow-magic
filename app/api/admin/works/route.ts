import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { requireAdmin, getClientIp, requireView } from '@/lib/auth';
import {
  queryWorks,
  insertWork,
  updateWork,
  insertAudit,
} from '@/lib/db';
import { apiGet, getBiliCookieSync } from '@/lib/bilibili';
import { downloadImage } from '@/lib/images';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 从 url 中提取 BV 号
function extractBvid(url: string): string | null {
  const m = url.match(/(BV[0-9A-Za-z]{10})/);
  return m ? m[1] : null;
}

// 封面落盘到 public/works/{bvid}.jpg（B站 CDN 有防盗链，热链 i*.hdslb.com 会 403 破图）
async function saveCover(bvid: string, pic: string): Promise<string | null> {
  const file = `${bvid}.jpg`;
  const ok = await downloadImage(
    pic,
    path.join(process.cwd(), 'public', 'works', file),
    { cookie: getBiliCookieSync() },
  );
  return ok ? `/works/${file}` : null;
}

// B站视频信息自动补全（标题/封面/简介/发布时间），封面优先下载到本地
async function enrichFromBilibili(url: string): Promise<{
  title?: string;
  cover?: string;
  description?: string;
  pubdate?: number;
} | null> {
  const bvid = extractBvid(url);
  if (!bvid) return null;
  try {
    const j = await apiGet<any>(
      `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`,
    );
    if (j?.code !== 0 || !j?.data) return null;
    let cover: string | undefined;
    if (j.data.pic) {
      cover =
        (await saveCover(bvid, String(j.data.pic))) ||
        String(j.data.pic).replace(/^\/\//, 'https://').replace(/^http:/, 'https:');
    }
    return {
      title: j.data.title,
      cover,
      description: (j.data.desc || '').slice(0, 500) || undefined,
      pubdate: Number(j.data.pubdate) || undefined,
    };
  } catch {
    return null;
  }
}

// 列表（管理员 + 只读访客可看）
export async function GET(req: Request) {
  if (!(await requireView(req)))
    return NextResponse.json({ ok: false }, { status: 401 });
  const list = await queryWorks();
  return NextResponse.json({ ok: true, list });
}

// 新增：填了 BV 号且未手动填标题时，自动从B站补全信息
export async function POST(req: NextRequest) {
  if (!(await requireAdmin(req)))
    return NextResponse.json({ ok: false }, { status: 401 });
  const body = await req.json().catch(() => null);
  const url = String(body?.url ?? '').trim();
  if (!url)
    return NextResponse.json({ ok: false, error: '链接不能为空' }, { status: 400 });
  let title = String(body?.title ?? '').trim();
  let cover = String(body?.cover ?? '').trim() || null;
  let description = String(body?.description ?? '').trim() || null;
  let pubdate = body?.pubdate != null ? Number(body.pubdate) : null;

  const info = await enrichFromBilibili(url);
  if (info) {
    if (!title) title = info.title ?? '';
    if (!cover) cover = info.cover ?? null;
    if (!description) description = info.description ?? null;
    if (pubdate == null) pubdate = info.pubdate ?? null;
  }
  if (!title)
    return NextResponse.json({ ok: false, error: '标题不能为空' }, { status: 400 });

  const id = await insertWork({
    title,
    url,
    cover,
    description,
    pubdate,
    sort_order: Number(body?.sort_order ?? 0),
  });
  await insertAudit('work_add', String(id), { title, url }, getClientIp(req));
  return NextResponse.json({ ok: true, id });
}

// 编辑
export async function PUT(req: NextRequest) {
  if (!(await requireAdmin(req)))
    return NextResponse.json({ ok: false }, { status: 401 });
  const body = await req.json().catch(() => null);
  const id = Number(body?.id);
  if (!id) return NextResponse.json({ ok: false, error: '缺少 id' }, { status: 400 });
  const patch: Parameters<typeof updateWork>[1] = {};
  if (body.title != null) {
    const t = String(body.title).trim();
    if (!t)
      return NextResponse.json({ ok: false, error: '标题不能为空' }, { status: 400 });
    patch.title = t;
  }
  if (body.url != null) patch.url = String(body.url).trim();
  if (body.cover != null) patch.cover = String(body.cover).trim() || null;
  if (body.description != null)
    patch.description = String(body.description).trim() || null;
  if (body.pubdate != null) patch.pubdate = Number(body.pubdate) || null;
  if (body.sort_order != null) patch.sort_order = Number(body.sort_order) || 0;
  // refetch：按 url（或原 url）重新从B站抓取信息，覆盖标题/封面/简介/发布时间
  if (body.refetch) {
    const all = await queryWorks();
    const cur = all.find((w) => w.id === id);
    if (cur) {
      const info = await enrichFromBilibili(String(body.url ?? cur.url) || cur.url);
      if (info) {
        if (info.title && body.title == null) patch.title = info.title;
        if (info.cover) patch.cover = info.cover;
        if (info.description && body.description == null) patch.description = info.description;
        if (info.pubdate && body.pubdate == null) patch.pubdate = info.pubdate;
      }
    }
  }
  await updateWork(id, patch);
  await insertAudit('work_update', String(id), patch, getClientIp(req));
  return NextResponse.json({ ok: true });
}

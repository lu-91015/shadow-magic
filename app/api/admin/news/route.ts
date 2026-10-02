import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getClientIp, requireView } from '@/lib/auth';
import { queryNews, seedNewsOnce, insertNews, updateNews, insertAudit } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request) {
  if (!(await requireView(req)))
    return NextResponse.json({ ok: false }, { status: 401 });
  await seedNewsOnce();
  const list = await queryNews();
  return NextResponse.json({ ok: true, list });
}

function validate(body: any) {
  const date = String(body?.date ?? '').trim();
  const title = String(body?.title ?? '').trim();
  const bodyText = String(body?.body ?? '').trim();
  if (!DATE_RE.test(date)) return { error: '日期格式应为 YYYY-MM-DD' } as const;
  if (!title) return { error: '标题不能为空' } as const;
  if (!bodyText) return { error: '正文不能为空' } as const;
  return { date, title, body: bodyText, tag: String(body?.tag ?? '').trim() || null } as const;
}

export async function POST(req: NextRequest) {
  if (!(await requireAdmin(req)))
    return NextResponse.json({ ok: false }, { status: 401 });
  const body = await req.json().catch(() => null);
  const v = validate(body);
  if ('error' in v)
    return NextResponse.json({ ok: false, error: v.error }, { status: 400 });
  const id = await insertNews(v);
  await insertAudit('news_add', String(id), { title: v.title }, getClientIp(req));
  return NextResponse.json({ ok: true, id });
}

export async function PUT(req: NextRequest) {
  if (!(await requireAdmin(req)))
    return NextResponse.json({ ok: false }, { status: 401 });
  const body = await req.json().catch(() => null);
  const id = Number(body?.id);
  if (!id) return NextResponse.json({ ok: false, error: '缺少 id' }, { status: 400 });
  const patch: Parameters<typeof updateNews>[1] = {};
  if (body.date != null) {
    const d = String(body.date).trim();
    if (!DATE_RE.test(d))
      return NextResponse.json({ ok: false, error: '日期格式应为 YYYY-MM-DD' }, { status: 400 });
    patch.date = d;
  }
  if (body.title != null) {
    const t = String(body.title).trim();
    if (!t) return NextResponse.json({ ok: false, error: '标题不能为空' }, { status: 400 });
    patch.title = t;
  }
  if (body.body != null) {
    const b = String(body.body).trim();
    if (!b) return NextResponse.json({ ok: false, error: '正文不能为空' }, { status: 400 });
    patch.body = b;
  }
  if (body.tag !== undefined) patch.tag = String(body.tag).trim() || null;
  if (body.enabled !== undefined) patch.enabled = !!body.enabled;
  await updateNews(id, patch);
  await insertAudit('news_update', String(id), patch, getClientIp(req));
  return NextResponse.json({ ok: true });
}

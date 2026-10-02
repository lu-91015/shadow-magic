import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getClientIp, requireView } from '@/lib/auth';
import {
  queryQuotes,
  insertQuote,
  updateQuote,
  insertAudit,
} from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 列表（管理员 + 只读访客可看）
export async function GET(req: Request) {
  if (!(await requireView(req)))
    return NextResponse.json({ ok: false }, { status: 401 });
  const list = await queryQuotes();
  return NextResponse.json({ ok: true, list });
}

// 新增
export async function POST(req: NextRequest) {
  if (!(await requireAdmin(req)))
    return NextResponse.json({ ok: false }, { status: 401 });
  const body = await req.json().catch(() => null);
  const text = String(body?.text ?? '').trim();
  if (!text)
    return NextResponse.json({ ok: false, error: '内容不能为空' }, { status: 400 });
  const id = await insertQuote(text);
  await insertAudit('quote_add', String(id), { text }, getClientIp(req));
  return NextResponse.json({ ok: true, id });
}

// 编辑（内容 / 启用开关）
export async function PUT(req: NextRequest) {
  if (!(await requireAdmin(req)))
    return NextResponse.json({ ok: false }, { status: 401 });
  const body = await req.json().catch(() => null);
  const id = Number(body?.id);
  if (!id) return NextResponse.json({ ok: false, error: '缺少 id' }, { status: 400 });
  const patch: { text?: string; enabled?: boolean } = {};
  if (body.text != null) {
    const text = String(body.text).trim();
    if (!text)
      return NextResponse.json({ ok: false, error: '内容不能为空' }, { status: 400 });
    patch.text = text;
  }
  if (body.enabled != null) patch.enabled = !!body.enabled;
  await updateQuote(id, patch);
  await insertAudit('quote_update', String(id), patch, getClientIp(req));
  return NextResponse.json({ ok: true });
}

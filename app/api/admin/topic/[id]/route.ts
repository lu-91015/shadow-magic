import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getClientIp } from '@/lib/auth';
import { setTopicPostEnabled, deleteTopicPost, insertAudit } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 开关 / 编辑（此处仅支持 enabled 切换，编辑通过 PUT /api/admin/topic 外的轻量接口）
export async function PUT(req: NextRequest) {
  if (!(await requireAdmin(req)))
    return NextResponse.json({ ok: false }, { status: 401 });
  const id = String(req.nextUrl.pathname.split('/').pop() ?? '');
  if (!id) return NextResponse.json({ ok: false, error: '缺少 id' }, { status: 400 });
  const body = await req.json().catch(() => ({}));
  if (body.enabled === undefined)
    return NextResponse.json({ ok: false, error: '缺少 enabled' }, { status: 400 });
  await setTopicPostEnabled(id, !!body.enabled);
  await insertAudit('topic_toggle', id, { enabled: !!body.enabled }, getClientIp(req));
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  if (!(await requireAdmin(req)))
    return NextResponse.json({ ok: false }, { status: 401 });
  const id = String(req.nextUrl.pathname.split('/').pop() ?? '');
  if (!id) return NextResponse.json({ ok: false, error: '缺少 id' }, { status: 400 });
  await deleteTopicPost(id);
  await insertAudit('topic_delete', id, {}, getClientIp(req));
  return NextResponse.json({ ok: true });
}

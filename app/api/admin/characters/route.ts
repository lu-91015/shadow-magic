import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { requireAdmin, getClientIp, requireView } from '@/lib/auth';
import { queryCharacters, insertCharacter, updateCharacter, insertAudit, seedCharactersOnce } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DIR = path.join(process.cwd(), 'public', 'characters');

export async function GET(req: Request) {
  if (!(await requireView(req)))
    return NextResponse.json({ ok: false }, { status: 401 });
  await seedCharactersOnce(); // 首次访问把 public/characters/ 历史立绘播种进库
  const list = await queryCharacters();
  return NextResponse.json({ ok: true, list });
}

export async function POST(req: NextRequest) {
  if (!(await requireAdmin(req)))
    return NextResponse.json({ ok: false }, { status: 401 });
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ ok: false, error: '表单解析失败' }, { status: 400 });
  const file = form.get('file');
  if (!(file instanceof Blob))
    return NextResponse.json({ ok: false, error: '缺少文件' }, { status: 400 });
  const name = String(form.get('name') ?? '');
  const caption = String(form.get('caption') ?? '');
  const sortOrder = Number(form.get('sort_order') ?? 0);
  const buf = Buffer.from(await file.arrayBuffer());
  const ext = (file as any).name?.split('.').pop() || 'png';
  const fname = `admin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(path.join(DIR, fname), buf);
  const src = `/characters/${fname}`;
  const id = await insertCharacter({
    name: name || null,
    caption: caption || null,
    src,
    sort_order: sortOrder,
  });
  await insertAudit('char_upload', String(id), { name, src }, getClientIp(req));
  return NextResponse.json({ ok: true, id, src });
}

// 编辑立绘（名称 / 备注 / 排序）
export async function PUT(req: NextRequest) {
  if (!(await requireAdmin(req)))
    return NextResponse.json({ ok: false }, { status: 401 });
  const body = await req.json().catch(() => null);
  const id = Number(body?.id);
  if (!id) return NextResponse.json({ ok: false, error: '缺少 id' }, { status: 400 });
  const patch: Parameters<typeof updateCharacter>[1] = {};
  if (body.name !== undefined) patch.name = String(body.name ?? '').trim() || null;
  if (body.caption !== undefined) patch.caption = String(body.caption ?? '').trim() || null;
  if (body.sort_order !== undefined) patch.sort_order = Number(body.sort_order) || 0;
  await updateCharacter(id, patch);
  await insertAudit('char_update', String(id), patch, getClientIp(req));
  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { requireAdmin, getClientIp, requireView } from '@/lib/auth';
import {
  queryShopItems,
  seedShopOnce,
  insertShopItem,
  updateShopItem,
  insertAudit,
} from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads', 'shop');
const IMG = /\.(png|jpe?g|webp|gif)$/i;

// 保存上传的封面图，返回本地 web 路径
async function saveCover(file: Blob, name: string): Promise<string> {
  const ext = name.split('.').pop()?.toLowerCase() || 'jpg';
  const fname = `s${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.writeFileSync(path.join(UPLOAD_DIR, fname), Buffer.from(await file.arrayBuffer()));
  return `/uploads/shop/${fname}`;
}

export async function GET(req: Request) {
  if (!(await requireView(req)))
    return NextResponse.json({ ok: false }, { status: 401 });
  await seedShopOnce();
  const list = await queryShopItems();
  return NextResponse.json({ ok: true, list });
}

// 新增商品（multipart：title/url/tag/description/coverUrl + 可选 cover 文件）
export async function POST(req: NextRequest) {
  if (!(await requireAdmin(req)))
    return NextResponse.json({ ok: false }, { status: 401 });
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ ok: false, error: '表单解析失败' }, { status: 400 });
  const title = String(form.get('title') ?? '').trim();
  const url = String(form.get('url') ?? '').trim();
  if (!title) return NextResponse.json({ ok: false, error: '标题不能为空' }, { status: 400 });
  if (!/^https?:\/\//i.test(url))
    return NextResponse.json(
      { ok: false, error: '链接需以 http(s):// 开头（支持B站/淘宝/天猫等）' },
      { status: 400 },
    );
  let cover = String(form.get('coverUrl') ?? '').trim() || null;
  const file = form.get('cover');
  if (file instanceof Blob && file.size > 0) {
    if (!IMG.test((file as any).name || ''))
      return NextResponse.json({ ok: false, error: '封面仅支持图片' }, { status: 400 });
    cover = await saveCover(file, (file as any).name);
  }
  const id = await insertShopItem({
    title,
    url,
    cover,
    description: String(form.get('description') ?? '').trim() || null,
    tag: String(form.get('tag') ?? '').trim() || null,
    sort_order: Number(form.get('sort_order') ?? 0),
  });
  await insertAudit('shop_add', String(id), { title, url }, getClientIp(req));
  return NextResponse.json({ ok: true, id });
}

// 编辑商品（multipart，字段可选；cover 文件可选=更换封面）
export async function PUT(req: NextRequest) {
  if (!(await requireAdmin(req)))
    return NextResponse.json({ ok: false }, { status: 401 });
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ ok: false, error: '表单解析失败' }, { status: 400 });
  const id = Number(form.get('id'));
  if (!id) return NextResponse.json({ ok: false, error: '缺少 id' }, { status: 400 });
  const patch: Parameters<typeof updateShopItem>[1] = {};
  if (form.get('title') != null) {
    const t = String(form.get('title')).trim();
    if (!t) return NextResponse.json({ ok: false, error: '标题不能为空' }, { status: 400 });
    patch.title = t;
  }
  if (form.get('url') != null) {
    const u = String(form.get('url')).trim();
    if (!/^https?:\/\//i.test(u))
      return NextResponse.json({ ok: false, error: '链接需以 http(s):// 开头' }, { status: 400 });
    patch.url = u;
  }
  if (form.get('description') != null)
    patch.description = String(form.get('description')).trim() || null;
  if (form.get('tag') != null) patch.tag = String(form.get('tag')).trim() || null;
  if (form.get('sort_order') != null) patch.sort_order = Number(form.get('sort_order')) || 0;
  if (form.get('enabled') != null) patch.enabled = String(form.get('enabled')) === 'true';
  if (form.get('coverUrl') != null)
    patch.cover = String(form.get('coverUrl')).trim() || null;
  const file = form.get('cover');
  if (file instanceof Blob && file.size > 0) {
    if (!IMG.test((file as any).name || ''))
      return NextResponse.json({ ok: false, error: '封面仅支持图片' }, { status: 400 });
    patch.cover = await saveCover(file, (file as any).name);
  }
  await updateShopItem(id, patch);
  await insertAudit('shop_update', String(id), { ...patch, cover: !!patch.cover }, getClientIp(req));
  return NextResponse.json({ ok: true });
}

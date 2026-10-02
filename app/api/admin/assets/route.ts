import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { requireAdmin, getClientIp, requireView } from '@/lib/auth';
import {
  queryAssets,
  countAssets,
  seedAssetsOnce,
  insertAsset,
  updateAsset,
  insertAudit,
  getAssetCategories,
} from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads', 'assets');
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|svg)$/i;
// 允许上传的素材扩展名（图片 + 指针 + 皮肤包等）
const ALLOWED = /\.(png|jpe?g|webp|gif|svg|cur|ani|zip|rar|7z|json|clf|olf|yazi|ttf|otf)$/i;

async function validCategory(cat: string): Promise<boolean> {
  return (await getAssetCategories()).some((c) => c.key === cat);
}

export async function GET(req: Request) {
  if (!(await requireView(req)))
    return NextResponse.json({ ok: false }, { status: 401 });
  await seedAssetsOnce(); // 首次访问自动播种历史素材
  const list = await queryAssets();
  return NextResponse.json({ ok: true, list, total: await countAssets() });
}

// 上传素材（multipart：file + category + title）
export async function POST(req: NextRequest) {
  if (!(await requireAdmin(req)))
    return NextResponse.json({ ok: false }, { status: 401 });
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ ok: false, error: '表单解析失败' }, { status: 400 });
  const file = form.get('file');
  if (!(file instanceof Blob))
    return NextResponse.json({ ok: false, error: '缺少文件' }, { status: 400 });
  const category = String(form.get('category') ?? 'other');
  if (!(await validCategory(category)))
    return NextResponse.json({ ok: false, error: '无效分类' }, { status: 400 });
  const origName = (file as any).name || 'asset';
  if (!ALLOWED.test(origName))
    return NextResponse.json(
      { ok: false, error: '不支持的文件类型（图片/cur/ani/zip/json/ttf 等）' },
      { status: 400 },
    );
  const title = String(form.get('title') ?? '').trim() || origName.replace(/\.[^.]+$/, '');
  const ext = origName.split('.').pop()?.toLowerCase() || 'bin';
  const fname = `a${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.writeFileSync(path.join(UPLOAD_DIR, fname), Buffer.from(await file.arrayBuffer()));
  const kind = IMAGE_EXT.test(origName) ? 'image' : 'file';
  const id = await insertAsset({
    title,
    category,
    file: `/uploads/assets/${fname}`,
    kind,
  });
  await insertAudit('asset_upload', String(id), { title, category, kind }, getClientIp(req));
  return NextResponse.json({ ok: true, id, file: `/uploads/assets/${fname}`, kind });
}

// 编辑（名称 / 分类 / 排序）
export async function PUT(req: NextRequest) {
  if (!(await requireAdmin(req)))
    return NextResponse.json({ ok: false }, { status: 401 });
  const body = await req.json().catch(() => null);
  const id = Number(body?.id);
  if (!id) return NextResponse.json({ ok: false, error: '缺少 id' }, { status: 400 });
  const patch: Parameters<typeof updateAsset>[1] = {};
  if (body.title !== undefined) patch.title = String(body.title).trim() || null;
  if (body.category !== undefined) {
    if (!(await validCategory(String(body.category))))
      return NextResponse.json({ ok: false, error: '无效分类' }, { status: 400 });
    patch.category = String(body.category);
  }
  if (body.sort_order !== undefined) patch.sort_order = Number(body.sort_order) || 0;
  await updateAsset(id, patch);
  await insertAudit('asset_update', String(id), patch, getClientIp(req));
  return NextResponse.json({ ok: true });
}

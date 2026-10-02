import { NextResponse } from 'next/server';
import { requireAdmin, requireView, getClientIp } from '@/lib/auth';
import {
  getAssetCategories,
  setAssetCategories,
  countAssets,
  insertAudit,
  BUILTIN_ASSET_CATEGORIES,
  CUSTOM_CAT_PREFIX,
} from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (!(await requireView(req)))
    return NextResponse.json({ ok: false }, { status: 401 });
  return NextResponse.json({ ok: true, list: await getAssetCategories() });
}

// 新增自定义分类 { label }，key 自动生成（c_ 前缀）
export async function POST(req: Request) {
  if (!(await requireAdmin(req)))
    return NextResponse.json({ ok: false }, { status: 401 });
  const body = await req.json().catch(() => null);
  const label = String(body?.label ?? '').trim();
  if (!label) return NextResponse.json({ ok: false, error: '请填写分类名称' }, { status: 400 });
  if (label.length > 20)
    return NextResponse.json({ ok: false, error: '分类名称过长（≤20 字）' }, { status: 400 });
  const list = await getAssetCategories();
  if (list.some((c) => c.label === label))
    return NextResponse.json({ ok: false, error: '分类已存在' }, { status: 400 });
  const key = `${CUSTOM_CAT_PREFIX}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  list.push({ key, label });
  await setAssetCategories(list);
  await insertAudit('asset_category_add', key, { label }, getClientIp(req));
  return NextResponse.json({ ok: true, list });
}

// 删除自定义分类 { key }；分类下仍有素材时拒绝（内置分类不可删）
export async function DELETE(req: Request) {
  if (!(await requireAdmin(req)))
    return NextResponse.json({ ok: false }, { status: 401 });
  const body = await req.json().catch(() => null);
  const key = String(body?.key ?? '');
  if (BUILTIN_ASSET_CATEGORIES.some((c) => c.key === key))
    return NextResponse.json({ ok: false, error: '内置分类不可删除' }, { status: 400 });
  const list = await getAssetCategories();
  if (!list.some((c) => c.key === key))
    return NextResponse.json({ ok: false, error: '分类不存在' }, { status: 404 });
  const used = await countAssets(key);
  if (used > 0)
    return NextResponse.json(
      { ok: false, error: `该分类下还有 ${used} 个素材，请先移动或删除后再删分类` },
      { status: 400 },
    );
  await setAssetCategories(list.filter((c) => c.key !== key));
  await insertAudit('asset_category_del', key, {}, getClientIp(req));
  return NextResponse.json({ ok: true, list });
}

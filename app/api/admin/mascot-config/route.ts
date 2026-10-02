import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getClientIp, requireView } from '@/lib/auth';
import { getKv, setKv, insertAudit } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 左下角小人的 Live2D 模型配置（模型文件路径/URL + 缩放）
export async function GET(req: Request) {
  if (!(await requireView(req)))
    return NextResponse.json({ ok: false }, { status: 401 });
  try {
    const raw = await getKv('mascot_model');
    const j = raw ? JSON.parse(raw) : {};
    return NextResponse.json({ ok: true, url: String(j?.url ?? ''), scale: Number(j?.scale) || 1 });
  } catch {
    return NextResponse.json({ ok: true, url: '', scale: 1 });
  }
}

export async function POST(req: NextRequest) {
  if (!(await requireAdmin(req)))
    return NextResponse.json({ ok: false }, { status: 401 });
  const body = await req.json().catch(() => null);
  const url = String(body?.url ?? '').trim();
  const scale = Math.max(0.2, Math.min(4, Number(body?.scale) || 1));
  await setKv('mascot_model', JSON.stringify({ url, scale }));
  await insertAudit('mascot_model', 'mascot_model', { url, scale }, getClientIp(req));
  return NextResponse.json({ ok: true });
}

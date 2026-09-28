import { NextRequest, NextResponse } from 'next/server';
import { pullCommentsForOid } from '@/lib/comments';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// 触发拉取单个动态的评论（用于详情页"加载/刷新评论"）
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const oid = String(body.oid ?? '').trim();
    const type = Number(body.type ?? 11) || 11;
    if (!oid) {
      return NextResponse.json({ ok: false, error: '缺少 oid' }, { status: 400 });
    }
    const count = await pullCommentsForOid(oid, type);
    return NextResponse.json({ ok: true, count });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 500 },
    );
  }
}

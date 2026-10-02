import { NextRequest, NextResponse } from 'next/server';
import { pullCommentsForOid } from '@/lib/comments';
import { existsDynamic } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// 触发拉取单个动态的评论（用于详情页"加载/刷新评论"）
// 该接口对外可用，但只允许拉取站内已收录动态的评论，避免被匿名用于刷B站接口
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const oid = String(body.oid ?? '').trim();
    const type = Number(body.type ?? 11) || 11;
    if (!oid) {
      return NextResponse.json({ ok: false, error: '缺少 oid' }, { status: 400 });
    }
    if (!(await existsDynamic(oid))) {
      return NextResponse.json(
        { ok: false, error: '该动态不在站内记录中' },
        { status: 404 },
      );
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

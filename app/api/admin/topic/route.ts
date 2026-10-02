import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getClientIp, requireView } from '@/lib/auth';
import { queryTopicPosts, insertAudit } from '@/lib/db';
import { syncTopicPosts } from '@/lib/topic';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 列表（管理员 + 只读访客可看）
export async function GET(req: Request) {
  if (!(await requireView(req)))
    return NextResponse.json({ ok: false }, { status: 401 });
  const list = await queryTopicPosts(false); // 后台看全部（含已隐藏）
  return NextResponse.json({ ok: true, list });
}

// 同步最新话题动态（写库；保留手动开关状态）
export async function POST(req: NextRequest) {
  if (!(await requireAdmin(req)))
    return NextResponse.json({ ok: false }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const limit = Number(body?.limit ?? 18) || 18;
  try {
    const count = await syncTopicPosts(limit);
    await insertAudit('topic_sync', 'topic', { count }, getClientIp(req));
    return NextResponse.json({ ok: true, count });
  } catch (e) {
    return NextResponse.json({ ok: false, error: '同步失败：' + (e as Error).message }, { status: 500 });
  }
}

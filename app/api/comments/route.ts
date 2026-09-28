import { NextRequest, NextResponse } from 'next/server';
import {
  queryComments,
  queryCommenterStats,
  queryCommentDynamics,
  getCommentCount,
} from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;

  // 各动态评论数列表（用于筛选下拉）
  if (sp.get('dyn') === '1') {
    const dynamics = await queryCommentDynamics();
    return NextResponse.json({ dynamics });
  }

  // 评论达人榜（按用户分组统计）
  if (sp.get('stats') === '1') {
    const oid = sp.get('oid') ?? undefined;
    const stats = await queryCommenterStats(oid);
    const total = await getCommentCount(oid);
    return NextResponse.json({ stats, total });
  }

  // 评论列表（可按动态 / 动态集合 / 用户 / 关键词过滤）
  const oid = sp.get('oid') ?? undefined;
  const oids = sp.get('oids')
    ? (sp.get('oids') as string).split(',').filter(Boolean)
    : undefined;
  const mid = sp.get('mid') ?? undefined;
  const q = sp.get('q') ?? undefined;
  const limit = Number(sp.get('limit') ?? 200);
  const offset = Number(sp.get('offset') ?? 0);
  const comments = await queryComments({ oid, oids, mid, q, limit, offset });
  const total = await getCommentCount(oid, oids);
  return NextResponse.json({ comments, total });
}

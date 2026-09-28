import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getClientIp, requireView } from '@/lib/auth';
import { launchJob } from '@/lib/jobs';
import { insertAudit, queryDanmakuLines } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 查看某场回放的弹幕文本行（后台展示接口），支持关键词过滤与分页。
export async function GET(
  req: NextRequest,
  { params }: { params: { bvid: string } },
) {
  if (!(await requireView(req)))
    return NextResponse.json({ ok: false }, { status: 401 });
  const bvid = params.bvid;
  const sp = req.nextUrl.searchParams;
  const q = sp.get('q') || undefined;
  const limit = Number(sp.get('limit') ?? 200);
  const offset = Number(sp.get('offset') ?? 0);
  const data = await queryDanmakuLines(bvid, { limit, offset, q });
  return NextResponse.json({ ok: true, total: data.total, rows: data.rows });
}

// 手动触发单场直播回放的弹幕收集（后台任务）。
export async function POST(
  req: NextRequest,
  { params }: { params: { bvid: string } },
) {
  if (!(await requireAdmin(req)))
    return NextResponse.json({ ok: false }, { status: 401 });
  const bvid = params.bvid;
  const runId = await launchJob('danmaku', { bvid }, 'manual');
  await insertAudit('live_danmaku', bvid, undefined, getClientIp(req));
  return NextResponse.json({ ok: true, runId });
}

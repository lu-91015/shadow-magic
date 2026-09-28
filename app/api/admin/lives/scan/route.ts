import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getClientIp } from '@/lib/auth';
import { launchJob } from '@/lib/jobs';
import { insertAudit } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 直播/歌单/弹幕 的“全量”触发：action = live | songs | danmaku（不带 bvid = 全部）。
export async function POST(req: NextRequest) {
  if (!(await requireAdmin(req)))
    return NextResponse.json({ ok: false }, { status: 401 });
  const { action } = await req.json().catch(() => ({}) as any);
  if (!['live', 'songs', 'danmaku'].includes(action))
    return NextResponse.json({ ok: false, error: '未知 action' }, { status: 400 });
  const runId = await launchJob(action, {}, 'manual');
  await insertAudit('live_scan', action, undefined, getClientIp(req));
  return NextResponse.json({ ok: true, runId });
}

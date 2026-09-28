import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getClientIp } from '@/lib/auth';
import { launchJob } from '@/lib/jobs';
import { insertAudit } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 手动触发切片封面补全（后台任务，逐条用详情接口补无封面视频）
// 可传 { bvid } 只同步单个视频封面，否则补全全部缺封面视频。
export async function POST(req: NextRequest) {
  if (!(await requireAdmin(req)))
    return NextResponse.json({ ok: false }, { status: 401 });
  let bvid: string | undefined;
  try {
    const body = await req.json().catch(() => ({}));
    bvid = body?.bvid;
  } catch {
    /* no body */
  }
  const runId = await launchJob('covers', bvid ? { bvid } : {}, 'manual');
  await insertAudit('clip_covers', bvid ?? 'all', undefined, getClientIp(req));
  return NextResponse.json({ ok: true, runId });
}

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getClientIp } from '@/lib/auth';
import { launchJob } from '@/lib/jobs';
import { insertAudit } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 触发切片收集：mode=all（标签投稿全量）/ upscan（按 UP 名补充）/ upscanall（全部已知 UP 补充）
export async function POST(req: NextRequest) {
  if (!(await requireAdmin(req)))
    return NextResponse.json({ ok: false }, { status: 401 });
  const b = await req.json().catch(() => ({}) as any);
  const mode = String(b.mode || 'all');
  if (mode === 'upscan') {
    const upname = String(b.upname || '').trim();
    if (!upname)
      return NextResponse.json({ ok: false, error: '缺少 upname' }, { status: 400 });
    const runId = await launchJob(
      'upscan',
      { upname, keyword: typeof b.keyword === 'string' ? b.keyword : undefined },
      'manual',
    );
    await insertAudit('clip_scan', 'upscan', { upname }, getClientIp(req));
    return NextResponse.json({ ok: true, runId });
  }
  if (mode === 'upscanall') {
    const runId = await launchJob('upscanall', {}, 'manual');
    await insertAudit('clip_scan', 'upscanall', undefined, getClientIp(req));
    return NextResponse.json({ ok: true, runId });
  }
  const runId = await launchJob('clips', {}, 'manual');
  await insertAudit('clip_scan', 'all', undefined, getClientIp(req));
  return NextResponse.json({ ok: true, runId });
}

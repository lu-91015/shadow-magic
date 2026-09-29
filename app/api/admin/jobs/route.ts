import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getClientIp, requireView } from '@/lib/auth';
import { queryJobs, createJob, insertAudit } from '@/lib/db';
import { JOB_TYPES } from '@/lib/jobs';
import { getJobStates, getPersistedJobStates, nextCron } from '@/lib/scheduler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (!(await requireView(req)))
    return NextResponse.json({ ok: false }, { status: 401 });
  const jobs = await queryJobs();
  // 调度器跑在 monitor 守护进程，web 进程内存里没有状态；
  // 读取其持久化快照（admin_kv），超过 10 分钟未刷新视为过期，
  // 过期/缺失时按 cron 重新计算 nextRun 兜底（重试退避信息丢失可接受）。
  const snap = await getPersistedJobStates();
  const fresh = !!snap && Date.now() - snap.t < 10 * 60_000;
  const mem = getJobStates();
  const jobsWithState = jobs.map((j) => {
    const st = fresh ? snap!.states[j.id] : mem[j.id];
    return {
      ...j,
      nextRun: st?.nextRun ?? nextCron(j.cron, new Date())?.getTime() ?? null,
      running: st?.running ?? false,
    };
  });
  return NextResponse.json({ ok: true, jobs: jobsWithState, types: JOB_TYPES });
}

export async function POST(req: NextRequest) {
  if (!(await requireAdmin(req)))
    return NextResponse.json({ ok: false }, { status: 401 });
  const body = await req.json().catch(() => ({}) as any);
  const type = String(body.type || '');
  if (!JOB_TYPES.find((t) => t.type === type))
    return NextResponse.json({ ok: false, error: '无效的任务类型' }, { status: 400 });
  const id = await createJob({
    type,
    name: String(body.name || type),
    cron: String(body.cron || '0 */6 * * *'),
    enabled: body.enabled !== false,
    payload: body.payload ?? {},
  });
  await insertAudit('job_create', String(id), { type, name: body.name }, getClientIp(req));
  return NextResponse.json({ ok: true, id });
}

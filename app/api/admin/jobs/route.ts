import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getClientIp, requireView } from '@/lib/auth';
import { queryJobs, createJob, insertAudit } from '@/lib/db';
import { JOB_TYPES } from '@/lib/jobs';
import { getJobStates } from '@/lib/scheduler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (!(await requireView(req)))
    return NextResponse.json({ ok: false }, { status: 401 });
  const jobs = await queryJobs();
  const states = getJobStates();
  const jobsWithState = jobs.map((j) => ({
    ...j,
    nextRun: states[j.id]?.nextRun ?? null,
    running: states[j.id]?.running ?? false,
  }));
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

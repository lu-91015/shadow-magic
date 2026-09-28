import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getClientIp } from '@/lib/auth';
import { getJob, updateJob, deleteJob, insertAudit } from '@/lib/db';
import { launchJob } from '@/lib/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!(await requireAdmin(req)))
    return NextResponse.json({ ok: false }, { status: 401 });
  const id = Number(params.id);
  const body = await req.json().catch(() => ({}) as any);
  const patch: any = {};
  if (body.name !== undefined) patch.name = body.name;
  if (body.cron !== undefined) patch.cron = body.cron;
  if (body.enabled !== undefined) patch.enabled = !!body.enabled;
  if (body.payload !== undefined) patch.payload = body.payload;
  await updateJob(id, patch);
  await insertAudit('job_update', String(id), patch, getClientIp(req));
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!(await requireAdmin(req)))
    return NextResponse.json({ ok: false }, { status: 401 });
  await deleteJob(Number(params.id));
  await insertAudit('job_delete', String(params.id), undefined, getClientIp(req));
  return NextResponse.json({ ok: true });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!(await requireAdmin(req)))
    return NextResponse.json({ ok: false }, { status: 401 });
  const job = await getJob(Number(params.id));
  if (!job) return NextResponse.json({ ok: false, error: '任务不存在' }, { status: 404 });
  const runId = await launchJob(job.type, job.payload ?? {}, 'manual');
  await insertAudit('job_run', String(job.id), { type: job.type }, getClientIp(req));
  return NextResponse.json({ ok: true, runId });
}

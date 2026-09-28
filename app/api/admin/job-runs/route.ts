import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, requireView } from '@/lib/auth';
import { queryJobRuns } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!(await requireView(req)))
    return NextResponse.json({ ok: false }, { status: 401 });
  const jobId = req.nextUrl.searchParams.get('jobId');
  const limit = Number(req.nextUrl.searchParams.get('limit') ?? 50);
  const runs = await queryJobRuns({
    jobId: jobId ? Number(jobId) : undefined,
    limit,
  });
  return NextResponse.json({ ok: true, runs });
}

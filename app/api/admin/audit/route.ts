import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, requireView } from '@/lib/auth';
import { queryAudit } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!(await requireView(req)))
    return NextResponse.json({ ok: false }, { status: 401 });
  const action = req.nextUrl.searchParams.get('action') || undefined;
  const limit = Number(req.nextUrl.searchParams.get('limit') ?? 200);
  const rows = await queryAudit({ action, limit });
  return NextResponse.json({ ok: true, rows });
}

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, requireView } from '@/lib/auth';
import { queryLiveSessionsAdmin } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (!(await requireView(req)))
    return NextResponse.json({ ok: false }, { status: 401 });
  const list = await queryLiveSessionsAdmin();
  return NextResponse.json({ ok: true, list });
}

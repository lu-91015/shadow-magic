import { NextResponse } from 'next/server';
import { requireAdmin, requireView } from '@/lib/auth';
import { queryRtSessions } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// 后台：每次直播的实时监控汇总记录（按开播时间倒序）
export async function GET(req: Request) {
  if (!(await requireView(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const list = await queryRtSessions(100);
  return NextResponse.json({ list });
}

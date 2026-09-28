import { NextResponse } from 'next/server';
import { requireAdmin, requireView } from '@/lib/auth';
import { queryFollowerStats, queryGuardStats } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// 后台：李豆沙 数据追踪历史（每小时粉丝数 + 每天大航海）
export async function GET(_req: Request) {
  if (!(await requireView(_req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const follower = await queryFollowerStats(200);
  const guard = await queryGuardStats(200);
  return NextResponse.json({ follower, guard });
}

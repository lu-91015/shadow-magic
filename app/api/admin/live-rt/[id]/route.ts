import { NextResponse } from 'next/server';
import { requireAdmin, requireView } from '@/lib/auth';
import { queryRtDetail } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// 后台：单场直播明细（弹幕 / 醒目留言 / 礼物 / 互动）
export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  if (!(await requireView(_req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const detail = await queryRtDetail(params.id);
  return NextResponse.json(detail);
}

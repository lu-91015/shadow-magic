import { NextRequest, NextResponse } from 'next/server';
import { querySongFrequencyWindowed } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 唱歌频率统计：?days=30|90|all
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('days') ?? '30';
  const days = raw === 'all' ? null : Math.max(1, Math.min(3650, Number(raw) || 30));
  try {
    const list = await querySongFrequencyWindowed(days);
    return NextResponse.json({ ok: true, days, list });
  } catch {
    return NextResponse.json({ ok: false, list: [] }, { status: 500 });
  }
}

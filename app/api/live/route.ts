import { NextResponse } from 'next/server';
import { getLiveStatus } from '@/lib/bilibili';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const live = await getLiveStatus();
    return NextResponse.json(live);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'fail' }, { status: 500 });
  }
}

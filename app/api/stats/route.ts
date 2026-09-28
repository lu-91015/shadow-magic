import { NextResponse } from 'next/server';
import { getFollowerStats, getTagStats } from '@/lib/bilibili';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [follower, tag] = await Promise.all([
      getFollowerStats(),
      getTagStats(),
    ]);
    return NextResponse.json({ follower, tag });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'fail' }, { status: 500 });
  }
}

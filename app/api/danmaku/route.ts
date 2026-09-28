import { NextRequest, NextResponse } from 'next/server';
import {
  queryLiveStats,
  queryDanmakuSenders,
  queryDanmakuPhrases,
  countDanmakuPhrase,
  getDanmakuCount,
  getDanmakuSenderCount,
} from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const bvid = sp.get('bvid') ?? undefined;

  if (sp.get('replays') === '1') {
    const stats = await queryLiveStats();
    const total = await getDanmakuCount();
    const senders = await getDanmakuSenderCount();
    return NextResponse.json({
      replays: stats.replays,
      total,
      totalDanmaku: stats.totalDanmaku,
      senders,
    });
  }
  if (sp.get('senders') === '1') {
    return NextResponse.json({ senders: await queryDanmakuSenders(bvid) });
  }
  if (sp.get('phrases') === '1') {
    return NextResponse.json({ phrases: await queryDanmakuPhrases(bvid) });
  }
  if (sp.has('search')) {
    const q = sp.get('search') ?? '';
    const count = q ? await countDanmakuPhrase(q, bvid) : 0;
    return NextResponse.json({ q, bvid: bvid ?? '', count });
  }
  return NextResponse.json({ error: 'unknown action' }, { status: 400 });
}

import { NextResponse } from 'next/server';
import { getRtActiveSession, getRtCounts } from '@/lib/db';
import { getLiveStatusRaw } from '@/lib/bilibili';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// 直播监控实时状态：是否开播 + 进行中会话 + 本场各类事件计数
export async function GET() {
  const session = await getRtActiveSession();
  const counts = session
    ? await getRtCounts(session.id)
    : { danmaku: 0, sc: 0, gift: 0, interact: 0, enter: 0, follow: 0 };
  // 优先以"进行中会话"判定开播（覆盖试运行房间，避免只看李豆沙的 getLiveStatusRaw）
  let live = !!session;
  let title: string | null = session?.title ?? null;
  if (!session) {
    try {
      const st = await getLiveStatusRaw();
      live = st.liveStatus === 1;
      title = st.title;
    } catch {
      /* ignore */
    }
  }
  return NextResponse.json({ live, title, session, counts });
}

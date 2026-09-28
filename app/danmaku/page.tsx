import {
  queryLiveStats,
  getDanmakuCount,
  getDanmakuSenderCount,
} from '@/lib/db';
import DanmakuExplorer from '@/components/DanmakuExplorer';

export const dynamic = 'force-dynamic';

export default async function DanmakuPage() {
  const stats = await queryLiveStats();
  const total = await getDanmakuCount();
  const senders = await getDanmakuSenderCount();
  return (
    <main className="max-w-5xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-semibold text-brand-200 mb-2">直播弹幕分析</h1>
      <p className="text-white/60 text-sm mb-6">
        来自各场直播回放的弹幕。发送人以 B站弹幕标识（hash）统计，暂无法解析为用户名；
        可统计任意弹幕文本出现次数（如「打call」）。原始弹幕已入库。
      </p>

      <DanmakuExplorer
        initialReplays={stats.replays}
        initialTotal={total}
        initialTotalDanmaku={stats.totalDanmaku}
        initialSenders={senders}
      />
    </main>
  );
}

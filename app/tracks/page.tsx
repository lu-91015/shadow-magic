import TracksExplorer from '@/components/TracksExplorer';
import {
  queryLiveReplays,
  queryLiveDaily,
  queryWorks,
  type WorkRow,
} from '@/lib/db';
import { downloadImage, imgExt } from '@/lib/images';
import { getBiliCookieSync } from '@/lib/bilibili';
import { fillReplayCovers } from '@/lib/replayCover';
import path from 'path';

export const dynamic = 'force-dynamic';

// 作品封面下载到本地，避免 hdslb 热链裂图
async function localizeCovers(works: WorkRow[]): Promise<WorkRow[]> {
  const cookie = getBiliCookieSync();
  await Promise.all(
    works.map(async (w) => {
      if (!w.cover || w.cover.startsWith('/works/')) return;
      const file = `w${w.id}${imgExt(w.cover)}`;
      const rel = `/works/${file}`;
      const ok = await downloadImage(
        w.cover,
        path.join(process.cwd(), 'public', 'works', file),
        { cookie },
      );
      if (ok) w.cover = rel;
    }),
  );
  return works;
}

export const metadata = {
  title: '熊猫活动轨迹 · 豆沙船',
};

export default async function TracksPage() {
  const [replays, days, worksRaw] = await Promise.all([
    queryLiveReplays(),
    queryLiveDaily(),
    queryWorks(),
  ]);
  const works = await localizeCovers(worksRaw);
  // 后台渐进补全回放封面（不阻塞本次渲染；每次访问补 40 张，几次后补齐）
  void fillReplayCovers(40).catch(() => {});

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-brand-200">
          🐾 熊猫活动轨迹
        </h1>
        <a
          href="/"
          className="text-sm text-white/50 transition hover:text-brand-200"
        >
          ‹ 返回首页
        </a>
      </div>
      <TracksExplorer replays={replays} days={days} works={works} />
    </main>
  );
}

// 同步“核心公开数据”：每日快照（粉丝/标签投稿数）+ 切片视频统计。
// 动态 / 直播回放 已拆为独立脚本（sync:dynamics / sync:live），按需单独抓取。
// 用法：npm run sync
import fs from 'fs';
import path from 'path';
import {
  getFollowerStats,
  getTagStats,
  fetchAllTagVideos,
  getVideoInfo,
  type TagVideo,
} from '../lib/bilibili';
import { UID } from '../lib/constants';
import {
  upsertVideo,
  insertSnapshot,
  awaitSave,
  flushStore,
} from '../lib/db';

const CONCURRENCY = 8;
const DELAY = 120;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (t: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function main() {
  console.log('核心同步开始（快照 + 切片视频）…');

  // 1) 每日快照：粉丝 / 标签投稿数
  const [follower, tag] = await Promise.all([getFollowerStats(), getTagStats()]);
  await insertSnapshot(follower.follower, follower.following, tag.use);
  console.log(`快照：粉丝 ${follower.follower} / #李豆沙 投稿 ${tag.use}`);

  // 2) 全站投稿 + 逐条数据（播放/点赞/投币/转发等）
  //    verify=true：仅收录标题含“豆沙”/“李与春”/“lihiru”的相关视频
  let videos: TagVideo[] = [];
  for (let attempt = 0; attempt < 3 && videos.length === 0; attempt++) {
    videos = await fetchAllTagVideos(50, true);
    if (videos.length === 0) {
      console.warn(`搜索被限流，第 ${attempt + 1} 次重试…`);
      await sleep(3000);
    }
  }
  console.log(`检索到 ${videos.length} 条视频，补充逐条数据…`);
  const stats = await mapPool(videos, CONCURRENCY, async (v) => {
    const s = await getVideoInfo(v.bvid).catch(() => null);
    await sleep(DELAY);
    return s;
  });
  let n = 0;
  let saved = 0;
  for (const v of videos) {
    const s = stats[n++];
    await upsertVideo(
      {
        bvid: v.bvid,
        title: s?.title || v.title,
        author: s?.author || v.author,
        pubdate: s?.pubdate || v.pubdate,
        view: s?.view || v.play,
        like: s?.like ?? 0,
        coin: s?.coin ?? 0,
        share: s?.share ?? 0,
        favorite: s?.favorite ?? 0,
        reply: s?.reply ?? 0,
        danmaku: s?.danmaku ?? 0,
        arcurl: v.arcurl,
        pic: s?.pic || v.pic || undefined,
      },
      true,
    );
    saved++;
    if (++n % 100 === 0) await awaitSave();
  }
  await awaitSave();
  console.log(`已写入 ${saved} 条视频统计（其中详情 ${stats.filter(Boolean).length} 条）`);

  await flushStore();
  console.log('核心同步完成。');
  process.exit(0);
}

main().catch((e) => {
  console.error('同步失败：', e);
  process.exit(1);
});

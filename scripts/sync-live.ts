// 仅同步直播回放时长统计（需要 BILI_SESSDATA 或 BILI_COOKIE）。
// 优先使用本地缓存 data/live_replays_raw.json；设置 LIVE_REFRESH=1 强制重新从 B站拉取。
// 用法：npm run sync:live            # 用缓存
//       LIVE_REFRESH=1 npm run sync:live   # 强制刷新缓存
import fs from 'fs';
import path from 'path';
import { getLivePlayList, type LiveSession } from '../lib/bilibili';
import { upsertLiveSession, awaitSave, flushStore } from '../lib/db';
import { LIVE_SERIES_ID, UID } from '../lib/constants';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

(async () => {
  const f = path.join(process.cwd(), '.env');
  if (fs.existsSync(f))
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }

  const HAS_AUTH = !!(process.env.BILI_SESSDATA || process.env.BILI_COOKIE);
  if (!HAS_AUTH) {
    console.warn('未设置 BILI_SESSDATA/BILI_COOKIE，无法同步直播回放。');
    process.exit(1);
  }

  const cacheFile = path.join(process.cwd(), 'data', 'live_replays_raw.json');
  const forceRefresh = process.env.LIVE_REFRESH === '1';
  let sessions: LiveSession[] = [];
  if (!forceRefresh && fs.existsSync(cacheFile)) {
    sessions = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    console.log(`使用本地缓存直播回放（${sessions.length} 场），跳过 B站请求`);
  } else {
    let page = 1;
    const MAX_PAGES = 200;
    while (page <= MAX_PAGES) {
      const pl = await getLivePlayList(LIVE_SERIES_ID, Number(UID), page, 30).catch(
        () => null,
      );
      if (!pl) {
        console.warn('直播回放请求异常，终止翻页。');
        break;
      }
      if (pl.items.length === 0) {
        if (page === 1 && fs.existsSync(cacheFile)) {
          console.warn('首页为空/风控，回退到本地缓存。');
          sessions = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        } else {
          console.warn('直播回放合集获取为空（可能接口变动/风控）。');
        }
        break;
      }
      sessions.push(...pl.items);
      if (!pl.hasMore) break;
      page++;
      await sleep(400);
    }
    if (sessions.length) {
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      fs.writeFileSync(cacheFile, JSON.stringify(sessions));
      console.log(`已缓存 ${sessions.length} 场到 ${cacheFile}`);
    }
  }

  for (const s of sessions) if (s.liveId) await upsertLiveSession(s);
  await awaitSave();
  await flushStore();
  console.log(`直播回放同步完成：${sessions.length} 场`);
  process.exit(0);
})().catch((e) => {
  console.error('直播回放同步失败：', e);
  process.exit(1);
});

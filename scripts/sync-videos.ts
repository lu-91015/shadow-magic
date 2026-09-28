// 仅同步视频（广检索词 + 标题判定），不碰动态/直播，用于补全切片数据。
// 用法：npm run sync:videos
import fs from 'fs';
import path from 'path';
import { fetchAllTagVideos, isRelevantTitle, getVideoInfo } from '../lib/bilibili';
import { upsertVideo, awaitSave, flushStore, getBlockedBvids } from '../lib/db';

(async () => {
  const f = path.join(process.cwd(), '.env');
  if (fs.existsSync(f))
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }

  const blocked = new Set(await getBlockedBvids());
  const videos = await fetchAllTagVideos(50, true);
  console.log(`检索到 ${videos.length} 条相关视频，写入中…`);
  let n = 0;
  for (const v of videos) {
    if (blocked.has(v.bvid)) continue;
    // 用免签 view 接口取真实统计（点赞/投币/转发等），失败的退化为 0
    const info = await getVideoInfo(v.bvid);
    await upsertVideo(
      {
        bvid: v.bvid,
        title: info?.title || v.title,
        author: info?.author || v.author,
        pubdate: info?.pubdate || v.pubdate,
        view: info?.view || v.play,
        like: info?.like ?? 0,
        coin: info?.coin ?? 0,
        share: info?.share ?? 0,
        favorite: info?.favorite ?? 0,
        reply: info?.reply ?? 0,
        danmaku: info?.danmaku ?? 0,
        arcurl: v.arcurl,
        pic: info?.pic || v.pic || undefined,
      },
      isRelevantTitle(v.title),
    );
    if (++n % 50 === 0) await awaitSave();
  }
  await awaitSave();
  await flushStore();
  console.log(`已写入 ${n} 条视频（标题命中即标记 has_tag）。`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

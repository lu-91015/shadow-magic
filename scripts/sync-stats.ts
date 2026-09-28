// 补齐点赞/投币/转发/播放等统计：用免签 view 接口逐条更新（不依赖被风控的 archive/stat）。
// 只处理 like=0 的行，可重复运行（已补齐的不会重复请求）。
// 用法：npm run sync:stats
import fs from 'fs';
import path from 'path';
import { getVideoInfo } from '../lib/bilibili';
import { getPool, ensureReady, flushStore } from '../lib/db';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function mapPool<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
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

(async () => {
  const f = path.join(process.cwd(), '.env');
  if (fs.existsSync(f))
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }

  await ensureReady();
  const pool = getPool();
  const { rows } = await pool.query<{ bvid: string }>(
    `SELECT bvid FROM video_stat WHERE "like" = 0 ORDER BY "view" DESC`,
  );
  console.log(`待补统计（like=0）：${rows.length} 条，开始…`);

  let done = 0;
  let failed = 0;
  let invalid = 0;
  await mapPool(rows, 2, async (r) => {
    const info = await getVideoInfo(r.bvid);
    if (info) {
      await pool.query(
        `UPDATE video_stat SET
           "view"=GREATEST("view", $2),
           "like"=GREATEST("like", $3),
           -- view 接口对 coin/share 常返回 0（B站隐藏），仅当新值>0 才覆盖，避免清零已有真实值
           coin=COALESCE(NULLIF($4,0), coin),
           share=COALESCE(NULLIF($5,0), share),
           favorite=COALESCE(NULLIF($6,0), favorite),
           reply=COALESCE(NULLIF($7,0), reply),
           danmaku=COALESCE(NULLIF($8,0), danmaku)
         WHERE bvid = $1`,
        [r.bvid, info.view, info.like, info.coin, info.share, info.favorite, info.reply, info.danmaku],
      );
      done++;
      if (done % 100 === 0) console.log(`  已补 ${done} 条…`);
    } else {
      invalid++;
    }
    await sleep(700);
  });

  await flushStore();
  console.log(`统计补全完成：成功 ${done} / 失败(限流) ${failed} / 无效稿件 ${invalid}，剩余待补 ${Math.max(rows.length - done - invalid, 0)} 条`);
  process.exit(0);
})().catch((e) => {
  console.error('统计同步失败：', e);
  process.exit(1);
});

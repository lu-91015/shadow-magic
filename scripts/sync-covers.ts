// 补齐切片封面：直接查库找出 pic 为空的视频，逐条用免签详情接口 x/web-interface/view 补图。
// 不依赖会被风控限流的搜索接口；可重复运行（每次只补还缺的）。
// 用法：npm run sync:covers
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
    `SELECT bvid FROM video_stat WHERE COALESCE(pic, '') = '' ORDER BY "view" DESC`,
  );
  console.log(`缺封面的视频：${rows.length} 条，开始补图…`);

  let done = 0;
  let failed = 0;
  let missing = 0;
  await mapPool(rows, 4, async (r) => {
    const info = await getVideoInfo(r.bvid);
    if (info && info.pic) {
      await pool.query(
        `UPDATE video_stat SET pic = $2,
           title = CASE WHEN COALESCE(title,'') = '' THEN $3 ELSE title END,
           author = CASE WHEN COALESCE(author,'') = '' THEN $4 ELSE author END,
           arcurl = CASE WHEN COALESCE(arcurl,'') = '' THEN $5 ELSE arcurl END
         WHERE bvid = $1`,
        [r.bvid, info.pic, info.title, info.author, `https://www.bilibili.com/video/${r.bvid}`],
      );
      done++;
      if (done % 100 === 0) console.log(`  已补 ${done} 张…`);
    } else if (info === null) {
      missing++;
    } else {
      failed++;
    }
    await sleep(120);
  });

  await flushStore();
  console.log(`封面补全完成：成功 ${done} / 失败(限流) ${failed} / 无效稿件 ${missing}，剩余缺图 ${Math.max(rows.length - done - missing, 0)} 条`);
  process.exit(0);
})().catch((e) => {
  console.error('封面同步失败：', e);
  process.exit(1);
});

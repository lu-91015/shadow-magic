// 按 UP主（切片man）主页补全：取库内每位作者的 UID，拉取其空间、按关键词 李豆沙/礼豆沙 检索全部稿件，
// 与库内已有 bvid 比对，缺的入库（空间接口直接返回 播放/点赞/投币/转发，一次拿全）。
// 用于补齐搜索接口漏掉的视频（搜索有数量与相关性上限）。
// 用法：npm run sync:authors
import fs from 'fs';
import path from 'path';
import { apiGet, getVideoInfo, signWbi } from '../lib/bilibili';
import { CLIP_APPROVED_NAMES } from '../lib/constants';
import { getPool, ensureReady, upsertVideo, flushStore } from '../lib/db';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function isRelevant(title: string): boolean {
  const t = title.toLowerCase();
  return CLIP_APPROVED_NAMES.some((n) => t.includes(n.toLowerCase()));
}

interface SpaceItem {
  bvid: string;
  title: string;
  author: string;
  created: number;
  play: number;
  pic: string;
}

async function searchSpace(mid: number, kw: string, pn: number): Promise<SpaceItem[]> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const params = await signWbi({
        search_type: 'video',
        keyword: kw,
        mid: String(mid),
        page: String(pn),
      });
      const qs = new URLSearchParams(params as Record<string, string>).toString();
      const data = await apiGet<{ code?: number; data?: { result?: Array<Record<string, any>> } }>(
        `https://api.bilibili.com/x/web-interface/wbi/search/type?${qs}`,
      );
      if (data?.code === 0) {
        const list = (data.data?.result ?? []) as SpaceItem[];
        return list.map((it) => ({
          bvid: it.bvid,
          title: String(it.title ?? '').replace(/<[^>]+>/g, ''),
          author: it.author ?? '',
          created: Number((it as any).created ?? (it as any).pubdate ?? 0),
          play: Number(it.play ?? 0),
          pic: (it.pic ?? '').split('@')[0],
        }));
      }
      // -412 风控：退避后重试
      if (data?.code === -412) {
        await sleep(1500 * (attempt + 1));
        continue;
      }
      return [];
    } catch {
      /* 重试 */
    }
    await sleep(800 * (attempt + 1));
  }
  return [];
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

  // 已有 bvid 集合（去重写入，且支持重跑）
  const { rows: all } = await pool.query<{ bvid: string }>(`SELECT bvid FROM video_stat`);
  const existing = new Set(all.map((r) => r.bvid));

  // 每位作者取一个样例 bvid，用来拿 UID（mid）
  const { rows: authors } = await pool.query<{ author: string; sample: string }>(
    `SELECT author, (ARRAY_AGG(bvid ORDER BY "view" DESC))[1] AS sample
     FROM video_stat WHERE COALESCE(author,'') <> ''
     GROUP BY author`,
  );
  console.log(`作者数：${authors.length}，开始按主页补全…`);

  let found = 0;
  let inserted = 0;
  let processed = 0;
  const midCache = new Map<string, number>();

  for (const a of authors) {
    let mid = midCache.get(a.author) ?? 0;
    if (!mid) {
      const info = await getVideoInfo(a.sample);
      mid = info?.mid ?? 0;
      midCache.set(a.author, mid);
      if (!mid) {
        console.log(`  跳过（无 mid）：${a.author}`);
        await sleep(200);
        continue;
      }
    }
    let authorFound = 0;
    for (const kw of CLIP_APPROVED_NAMES) {
      let pn = 1;
      let guard = 0;
      while (guard++ < 50) {
        const items = await searchSpace(mid, kw, pn);
        if (!items.length) break;
        for (const it of items) {
          if (!it.bvid) continue;
          if (existing.has(it.bvid)) continue;
          if (!isRelevant(it.title)) continue;
          found++;
          authorFound++;
          // 直接用搜索数据入库（搜索含 播放/封面）；点赞/投币/转发留 0，后续 sync:stats 补全
          await upsertVideo(
            {
              bvid: it.bvid,
              title: it.title,
              author: it.author || a.author,
              pubdate: Number(it.created ?? 0),
              view: Number(it.play ?? 0),
              like: 0,
              coin: 0,
              share: 0,
              favorite: 0,
              reply: 0,
              danmaku: 0,
              arcurl: `https://www.bilibili.com/video/${it.bvid}`,
              pic: (it.pic || '').split('@')[0] || undefined,
            },
            true,
          );
          existing.add(it.bvid);
          inserted++;
          await sleep(120);
        }
        if (items.length < 20) break;
        pn++;
        await sleep(300);
      }
      await sleep(300);
    }
    processed++;
    console.log(`  [${processed}/${authors.length}] ${a.author} → +${authorFound}`);
    if (found > 0 && found % 10 === 0) console.log(`  累计发现 ${found} 条，入库 ${inserted}…`);
  }

  await flushStore();
  console.log(`按主页补全完成：发现未收录 ${found} 条，实际入库 ${inserted} 条`);
  process.exit(0);
})().catch((e) => {
  console.error('按主页补全失败：', e);
  process.exit(1);
});

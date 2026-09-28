// 拉取每条直播回放的弹幕并入库（list.so），同时把弹幕数写回 live_session.danmaku。
// 支持：
//   npm run sync:danmaku                 # 全量拉取（较重，约 939 场，可能触发风控，可断点重跑）
//   BVID=BV1xxxx npm run sync:danmaku    # 只拉指定回放
//   LIMIT=20 npm run sync:danmaku        # 只拉前 N 场
import fs from 'fs';
import path from 'path';
const f = path.join(process.cwd(), '.env');
if (fs.existsSync(f))
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }

import {
  queryLiveStats,
  bulkInsertDanmaku,
  updateLiveSessionDanmaku,
  getDanmakuCount,
} from '../lib/db';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const BVID = process.env.BVID ?? '';
const LIMIT = Number(process.env.LIMIT ?? 0);
const CONCURRENCY = 4;
const DELAY = 300;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
function unescapeXml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

async function fetchJson(url: string) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': UA, Referer: 'https://www.bilibili.com/', Cookie: process.env.BILI_COOKIE ?? '', Accept: 'application/json' },
        signal: AbortSignal.timeout(20000),
      });
      return (await r.json()) as any;
    } catch {
      if (attempt < 3) await sleep(1000 * (attempt + 1));
    }
  }
  return null;
}

async function fetchView(bvid: string): Promise<{ cid: string; danmaku: number } | null> {
  const j = await fetchJson(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`);
  if (j?.code !== 0) return null;
  return { cid: String(j.data?.cid ?? ''), danmaku: Number(j.data?.stat?.danmaku ?? 0) };
}

async function fetchDanmaku(cid: string, bvid: string) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(`https://api.bilibili.com/x/v1/dm/list.so?oid=${cid}`, {
        headers: { 'User-Agent': UA, Referer: 'https://www.bilibili.com/', Cookie: process.env.BILI_COOKIE ?? '', Accept: '*/*' },
        signal: AbortSignal.timeout(30000),
      });
      if (r.status === 412 || r.status === -412) {
        console.warn(`  ${bvid} 弹幕接口被风控拦截(412)`);
        return null;
      }
      if (!r.ok) {
        console.warn(`  ${bvid} list.so HTTP ${r.status}`);
        return null;
      }
      const xml = await r.text();
      const rows: Parameters<typeof bulkInsertDanmaku>[0] = [];
      const re = /<d p="([^"]+)">([^<]*)<\/d>/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(xml))) {
        const p = m[1].split(',');
        if (p.length < 8) continue;
        rows.push({
          dmid: p[7],
          bvid,
          cid,
          sender: p[6] || '',
          text: unescapeXml(m[2]),
          vtime: Number(p[0]) || 0,
          sendtime: Number(p[4]) || 0,
          raw: m[1],
        });
      }
      return rows;
    } catch {
      if (attempt < 3) await sleep(1000 * (attempt + 1));
    }
  }
  return null;
}

async function pullOne(
  bvid: string,
  known: number,
): Promise<{ ok: boolean; count: number; reason?: string }> {
  const view = await fetchView(bvid);
  if (!view || !view.cid) {
    console.warn(`  ${bvid} view 获取失败，跳过`);
    return { ok: false, count: 0 };
  }
  const count = view.danmaku;
  // 已有且数量足够则跳过下载（断点续拉）
  const have = await getDanmakuCount(bvid);
  await updateLiveSessionDanmaku(bvid, count);
  if (count > 0 && have >= count) {
    console.log(`  ${bvid}: 已有 ${have}/${count} 条，跳过`);
    return { ok: true, count: have };
  }
  if (count === 0) {
    console.log(`  ${bvid}: 无弹幕`);
    return { ok: true, count: 0 };
  }
  const rows = await fetchDanmaku(view.cid, bvid);
  if (!rows) {
    console.warn(`  ${bvid} 弹幕下载失败（可能 B站风控 412，稍后重试）`);
    return { ok: false, count: 0, reason: '弹幕下载失败(可能B站风控412，稍后重试)' };
  }
  await bulkInsertDanmaku(rows);
  console.log(`  ${bvid}: ${rows.length} 条弹幕（总 ${count}）`);
  return { ok: true, count: rows.length };
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

async function main() {
  const stats = await queryLiveStats();
  let replays = stats.replays;
  if (BVID) replays = replays.filter((r) => r.id === BVID);
  else if (LIMIT > 0) replays = replays.slice(0, LIMIT);
  console.log(`开始拉取 ${replays.length} 场回放的弹幕…`);
  await mapPool(replays, CONCURRENCY, async (r) => {
    await pullOne(r.id, r.danmaku);
    await sleep(DELAY);
  });
  console.log('弹幕拉取完成（可重跑补全）。');
}
const invokedDirectly =
  !!process.argv[1] && process.argv[1].replace(/\\/g, '/').includes('sync-danmaku');
if (invokedDirectly) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

// 供后台定时任务 / 管理接口复用：收集单场直播回放的弹幕。
export async function collectDanmakuForBvid(
  bvid: string,
): Promise<{ ok: boolean; count: number; reason?: string }> {
  return pullOne(bvid, 0);
}

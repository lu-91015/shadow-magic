// 拉取李豆沙各动态的评论（含子回复）并原样入库（raw JSONB），用于"谁回复的评论/评论次数"分析。
// 用法：
//   npm run sync:comments                 # 拉取全部动态评论（较重，可能触发风控，建议分批）
//   DYN_OID=1157213040286892036 npm run sync:comments   # 只拉指定动态
//   LIMIT_DYN=20 npm run sync:comments    # 只拉最近 N 条动态
import fs from 'fs';
import path from 'path';
const f = path.join(process.cwd(), '.env');
if (fs.existsSync(f))
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }

import { ensureReady, getPool, queryDynamics } from '../lib/db';
import { pullCommentsForOid } from '../lib/comments';

const MAX_PAGES = Number(process.env.MAX_REPLY_PAGES ?? 50); // 单动态最多翻页数（约 50*20=1000 条）
const LIMIT_DYN = Number(process.env.LIMIT_DYN ?? 0); // 仅拉最近 N 条动态（0=全部）
const DYN_OID = process.env.DYN_OID ?? '';
const FORCE = process.env.FORCE === '1'; // 强制重拉全部（默认续跑：跳过已有评论的动态）
const CONCURRENCY = 1; // 串行拉取，避免对 B站接口过于频繁
const DELAY = 2000; // 动态间延迟(ms)

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
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return out;
}

async function main() {
  await ensureReady();
  const data = await queryDynamics();
  // 评论 oid 用 commentId（≠ 动态 id）；fallback 到动态 id，但旧数据需先 npm run sync 刷新。
  type Task = { oid: string; type: number };
  let tasks: Task[] = data.items.map((d) => ({
    oid: d.commentId ?? d.id,
    type: d.commentType ?? 11,
  }));
  if (DYN_OID) tasks = [{ oid: DYN_OID, type: 11 }];
  else if (LIMIT_DYN > 0) tasks = tasks.slice(0, LIMIT_DYN);

  // 续跑：跳过库中已有评论的动态（评论数可能为 0 的动态拉了也是 0，跳过无害）
  if (!FORCE && !DYN_OID) {
    const { rows } = await getPool().query<{ oid: string }>(
      'SELECT DISTINCT oid FROM dyn_comment',
    );
    const done = new Set(rows.map((r) => String(r.oid)));
    const before = tasks.length;
    tasks = tasks.filter((t) => !done.has(t.oid));
    console.log(`续跑：跳过已有评论的动态 ${before - tasks.length} 条，剩余 ${tasks.length} 条待拉取`);
  }

  console.log(`开始拉取 ${tasks.length} 条动态的评论…`);

  const totals = await mapPool(tasks, CONCURRENCY, async (t) => {
    const n = await pullCommentsForOid(t.oid, t.type, MAX_PAGES);
    if (n > 0) console.log(`  oid ${t.oid}: ${n} 条评论`);
    await sleep(DELAY);
    return n;
  });
  const sum = totals.reduce((a, b) => a + b, 0);
  console.log(`评论拉取完成，本批新增/更新 ${sum} 条`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

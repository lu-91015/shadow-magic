// 仅同步动态（需要 BILI_SESSDATA 或 BILI_COOKIE）。
// 用法：npm run sync:dynamics
import fs from 'fs';
import path from 'path';
import { getDynamics, type DynItem } from '../lib/bilibili';
import { upsertDynamic, awaitSave, flushStore } from '../lib/db';
import { UID } from '../lib/constants';
import { localizeDynImages } from '../lib/dynamics';

const HAS_AUTH = !!(process.env.BILI_SESSDATA || process.env.BILI_COOKIE);
const MAX_DYN = Number(process.env.MAX_DYNAMICS ?? 0); // 0 = 不限制

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

  if (!HAS_AUTH) {
    console.warn('未设置 BILI_SESSDATA/BILI_COOKIE，无法同步动态。');
    process.exit(1);
  }
  let offset = '';
  let hasMore = true;
  let count = 0;
  let page = 1;
  while (hasMore && (MAX_DYN === 0 || count < MAX_DYN)) {
    const res = await getDynamics(UID, process.env.BILI_SESSDATA ?? '', offset, page);
    for (const d of res.items as DynItem[]) {
      const d2 = await localizeDynImages(d);
      await upsertDynamic(d2);
    }
    count += res.items.length;
    offset = res.offset;
    hasMore = res.hasMore;
    page++;
    console.log(`已同步 ${count} 条动态…`);
    await sleep(200);
  }
  await awaitSave();
  await flushStore();
  console.log(`动态同步完成：${count} 条`);
  process.exit(0);
})().catch((e) => {
  console.error('动态同步失败：', e);
  process.exit(1);
});

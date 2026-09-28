// 一次性回填：把 PG 中已存动态里的远程图片下载到本地 public/dynamics/，
// 并改写 DynItem 图片路径后重新入库（避免页面长期热链 B站 CDN）。
// 用法：npx tsx scripts/backfill-dyn-images.ts
import fs from 'fs';
import path from 'path';
const f = path.join(process.cwd(), '.env');
if (fs.existsSync(f))
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
import { queryDynamics, upsertDynamic } from '../lib/db';
import { localizeDynImages } from '../lib/dynamics';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const data = await queryDynamics();
  console.log(`读取到 ${data.items.length} 条动态，开始回填图片…`);
  let done = 0;
  for (const d of data.items) {
    const localized = await localizeDynImages(d);
    await upsertDynamic(localized);
    done++;
    if (done % 10 === 0) console.log(`  已处理 ${done}/${data.items.length}`);
    await sleep(50);
  }
  console.log(`回填完成：${done} 条`);
}
main().catch((e) => { console.error(e); process.exit(1); });

// 探测性报告（只读，不写库）：用广检索词把“豆沙”相关标题全部抓回，
// 提取其中的 “X豆沙” 名号变体，按出现次数排序，供人工判断哪些 CP 名需要保留。
// 用法：npm run report:names
import fs from 'fs';
import path from 'path';
import { fetchAllTagVideos, CLIP_KEYWORDS } from '../lib/bilibili';

(async () => {
  const f = path.join(process.cwd(), '.env');
  if (fs.existsSync(f))
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }

  console.log(`广检索词：${CLIP_KEYWORDS.join(' / ')}`);
  const videos = await fetchAllTagVideos(50, false);
  console.log(`共检索到候选视频 ${videos.length} 条（已跨词去重）\n`);

  const tokenCount = new Map<string, number>();
  let bare = 0; // 标题里只有“豆沙”没有前导名号的
  for (const v of videos) {
    const title = (v.title || '').toLowerCase();
    if (!title.includes('豆沙')) continue; // 仅统计豆沙系（李与春/lihiru 单独列出）
    const m = title.match(/.{1,4}豆沙/g);
    if (!m || m.length === 0) {
      bare++;
      continue;
    }
    for (const tok of m) {
      tokenCount.set(tok, (tokenCount.get(tok) ?? 0) + 1);
    }
  }

  const ranked = [...tokenCount.entries()].sort((a, b) => b[1] - a[1]);
  console.log('=== “X豆沙” 名号变体（按出现次数）===');
  for (const [tok, c] of ranked) {
    console.log(`  ${tok.padEnd(8)} ${c}`);
  }
  console.log(`\n裸“豆沙”（无前导名号）: ${bare}`);

  // 非豆沙系已知 CP 名
  for (const kw of CLIP_KEYWORDS) {
    if (kw === '豆沙') continue;
    const n = videos.filter((v) => (v.title || '').toLowerCase().includes(kw.toLowerCase())).length;
    console.log(`含 “${kw}” 的标题: ${n}`);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

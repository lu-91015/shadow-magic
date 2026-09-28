// 仅写入每日快照：粉丝数 / #李豆沙 标签投稿数（轻量，免登录）。
// 用法：npm run sync:snapshot
import fs from 'fs';
import path from 'path';
import { getFollowerStats, getTagStats } from '../lib/bilibili';
import { insertSnapshot, flushStore } from '../lib/db';

(async () => {
  const f = path.join(process.cwd(), '.env');
  if (fs.existsSync(f))
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }

  const [follower, tag] = await Promise.all([getFollowerStats(), getTagStats()]);
  await insertSnapshot(follower.follower, follower.following, tag.use);
  await flushStore();
  console.log(`快照完成：粉丝 ${follower.follower} / #李豆沙 投稿 ${tag.use}`);
  process.exit(0);
})().catch((e) => {
  console.error('快照同步失败：', e);
  process.exit(1);
});

// 重算 video_stat.has_tag：标题中含“李豆沙”或“礼豆沙”（CP 名）即标记为相关切片。
// 与抓取/同步判定口径一致。纯 SQL 即时完成，无需逐条请求接口。
// 用法：npm run verify:tags
import fs from 'fs';
import path from 'path';
import { getPool, ensureReady } from '../lib/db';
import { CLIP_KEYWORDS } from '../lib/bilibili';

(async () => {
  const f = path.join(process.cwd(), '.env');
  if (fs.existsSync(f))
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }

  await ensureReady();
  const pool = getPool();
  const esc = (s: string) => s.replace(/'/g, "''");
  const conds = CLIP_KEYWORDS.map((k) => `title ILIKE '%${esc(k)}%'`).join(' OR ');
  const res = await pool.query<{ rel: string; total: string }>(
    `SELECT
       COUNT(*) FILTER (WHERE ${conds})::text AS rel,
       COUNT(*)::text AS total
     FROM video_stat`,
  );
  await pool.query(
    `UPDATE video_stat SET has_tag = (CASE WHEN ${conds} THEN 1 ELSE 0 END), tag_checked = 1`,
  );
  const { rel, total } = res.rows[0];
  console.log(
    `重算完成：标题含 ${CLIP_KEYWORDS.map((k) => `“${k}”`).join(' 或 ')} 的相关切片 ${rel} / 共 ${total} 条。`,
  );
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

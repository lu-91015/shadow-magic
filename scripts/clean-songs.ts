// 歌单清洗（存量）：对照 data/known-songs.json 清理 OCR 识别的垃圾项。
// - 命中已知歌曲：title 纠正为标准歌名（顺带修复 OCR 错别字）
// - 垃圾行（弹幕用户名/聊天句/B站UI/编号碎片）：excluded=true（不删行，保留原始数据可回溯）
// - 不在歌单但像歌名的行：保留（李豆沙会唱歌单外的歌）
// - 整场误识（弹幕面板被当成歌单，0 命中且多数行像聊天）：整场 excluded=true
//
// 用法：
//   npm run sync:songs-clean            # 全部场次
//   BVID=BV1xxx npm run sync:songs-clean # 只清洗指定场次（验证用）
//   DRY=1 npm run sync:songs-clean      # 只看报告不改库
import { ensureReady, getPool } from '../lib/db';
import {
  cleanSongTitles,
  isGarbageLine,
  isMisreadPanel,
  matchKnown,
  normalize,
} from '../lib/known-songs';

const envFile = `${process.cwd()}/.env`;
// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
if (require('fs').existsSync(envFile))
  for (const line of require('fs').readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }

const BVID = process.env.BVID || '';
const DRY = process.env.DRY === '1';

async function main() {
  await ensureReady();
  const p = getPool();
  const { rows } = await p.query<{ bvid: string; idx: number; title: string; source: string | null; excluded: boolean }>(
    `SELECT bvid, idx, title, source, COALESCE(excluded,false) AS excluded FROM live_song
     ${BVID ? 'WHERE bvid = $1' : ''} ORDER BY bvid, idx`,
    BVID ? [BVID] : [],
  );
  console.log(`待清洗 live_song 行数：${rows.length}`);

  // 按场分组（只清洗自动识别行；手动行不动）
  const byBvid = new Map<string, { idx: number; title: string; source: string | null; excluded: boolean }[]>();
  for (const r of rows) {
    if (!byBvid.has(r.bvid)) byBvid.set(r.bvid, []);
    byBvid.get(r.bvid)!.push(r);
  }

  let sessions = 0;
  let fixedTitle = 0;
  let markedGarbage = 0;
  let keptUnknown = 0;
  let wipedSessions = 0;
  let alreadyExcluded = 0;
  const samples: string[] = [];

  for (const [bvid, items] of byBvid) {
    sessions++;
    const autoItems = items.filter((i) => (i.source ?? 'auto') === 'auto');
    if (autoItems.length === 0) continue;

    // 整场误识判定：对全部 auto 行的原文做判定
    const misread = isMisreadPanel(autoItems.map((i) => i.title));

    if (misread) {
      wipedSessions++;
      samples.push(`${bvid}: 整场弹幕面板误识（${autoItems.length} 行全部排除）`);
      if (!DRY) {
        await p.query(
          `UPDATE live_song SET excluded = true WHERE bvid = $1 AND idx = ANY($2::int[])`,
          [bvid, autoItems.map((i) => i.idx)],
        );
      }
      continue;
    }

    const clean = cleanSongTitles(autoItems.map((i) => i.title));
    void clean; // 逐行判定用 matchKnown/isGarbageLine；clean 保留供调试
    const seenCanon = new Set<string>(); // 本场已占用的标准歌名（去重 OCR 碎片纠正）
    for (const it of autoItems) {
      const m = matchKnown(it.title);
      if (m) {
        const canon = normalize(m.song.song);
        if (seenCanon.has(canon)) {
          // OCR 片段重复命中同一首歌：排除重复行
          if (it.excluded) alreadyExcluded++;
          else {
            markedGarbage++;
            if (samples.length < 40)
              samples.push(`${bvid}#${it.idx}: ✗（重复）${it.title} → ${m.song.song}`);
            if (!DRY) {
              await p.query(`UPDATE live_song SET excluded = true WHERE bvid = $1 AND idx = $2`, [
                bvid,
                it.idx,
              ]);
            }
          }
          continue;
        }
        seenCanon.add(canon);
        // 已知歌：纠正歌名（OCR 错字修复），保留原排除状态
        if (normalize(it.title) === canon) continue;
        fixedTitle++;
        if (samples.length < 40) samples.push(`${bvid}#${it.idx}: ${it.title} → ${m.song.song}`);
        if (!DRY) {
          await p.query(`UPDATE live_song SET title = $2 WHERE bvid = $1 AND idx = $3`, [
            bvid,
            m.song.song,
            it.idx,
          ]);
        }
      } else if (isGarbageLine(it.title)) {
        // 垃圾行：标记排除
        if (it.excluded) {
          alreadyExcluded++;
        } else {
          markedGarbage++;
          if (samples.length < 40) samples.push(`${bvid}#${it.idx}: ✗ ${it.title}`);
          if (!DRY) {
            await p.query(`UPDATE live_song SET excluded = true WHERE bvid = $1 AND idx = $2`, [
              bvid,
              it.idx,
            ]);
          }
        }
      } else {
        keptUnknown++;
      }
    }
  }

  console.log(`场次 ${sessions}，误识整场排除 ${wipedSessions}，歌名纠正 ${fixedTitle}，垃圾排除 ${markedGarbage}（已排除 ${alreadyExcluded}），保留未知歌名 ${keptUnknown}`);
  console.log('---- 样例 ----');
  for (const s of samples) console.log(' ', s);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

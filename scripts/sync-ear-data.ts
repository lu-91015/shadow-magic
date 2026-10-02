// 本地 ↔ 服务器 听歌识曲结果双向合并（查缺补漏）。
// 两边各自跑过 songs:ear 后，用本脚本把「对方识别出、自己没有的歌」补进本方，
// 以 (bvid, 归一歌名) 去重，避免重复。
//
// 用法：
//   REMOTE_DATABASE_URL=postgres://postgres@***REDACTED-IP***:5432/lidousha npm run sync:ear-merge
//   （默认远端地址即上面的 ***REDACTED-IP***；也可走 SSH 隧道 5433）
import pg from 'pg';
import { normalize } from '../lib/known-songs';

const envFile = `${process.cwd()}/.env`;
if (require('fs').existsSync(envFile))
  for (const line of require('fs').readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }

const LOCAL = process.env.DATABASE_URL!;
const REMOTE =
  process.env.REMOTE_DATABASE_URL ||
  'postgres://postgres@***REDACTED-IP***:5432/lidousha';
const DRY = process.env.DRY === '1';

interface Row {
  bvid: string;
  idx: number;
  title: string;
  source: string | null;
  excluded: boolean;
  raw_text: string | null;
  created_at: string | null;
}

async function fetchRows(c: pg.Pool): Promise<Map<string, Row[]>> {
  const { rows } = await c.query<Row>(
    `SELECT bvid, idx, title, COALESCE(source,'auto') AS source,
            COALESCE(excluded,false) AS excluded, raw_text, created_at
     FROM live_song`,
  );
  const m = new Map<string, Row[]>();
  for (const r of rows) {
    if (!m.has(r.bvid)) m.set(r.bvid, []);
    m.get(r.bvid)!.push(r);
  }
  return m;
}

function pickBest(rows: Row[]): Map<string, Row> {
  // 同一 bvid 内按归一歌名去重：优先保留未排除、再优先 ear/已知来源
  const best = new Map<string, Row>();
  for (const r of rows) {
    const k = normalize(r.title);
    if (!k) continue;
    const cur = best.get(k);
    if (!cur) {
      best.set(k, r);
      continue;
    }
    const score = (x: Row) => (x.excluded ? 0 : 1) + (x.source === 'ear' ? 0.5 : 0) + (x.source === 'manual' ? 0.3 : 0);
    if (score(r) > score(cur)) best.set(k, r);
  }
  return best;
}

async function topIdx(c: pg.Pool, bvid: string): Promise<number> {
  const { rows } = await c.query<{ max: string }>(
    'SELECT COALESCE(MAX(idx),-1)::int AS max FROM live_song WHERE bvid=$1',
    [bvid],
  );
  return Number(rows[0].max);
}

async function main() {
  const lc = new pg.Pool({ connectionString: LOCAL });
  const rc = new pg.Pool({ connectionString: REMOTE });
  const local = await fetchRows(lc);
  const remote = await fetchRows(rc);
  const bvids = new Set<string>([...local.keys(), ...remote.keys()]);
  let addedToLocal = 0;
  let addedToRemote = 0;
  for (const bvid of bvids) {
    const lb = pickBest(local.get(bvid) ?? []);
    const rb = pickBest(remote.get(bvid) ?? []);
    // 需要补到本地（远端有、本地无）
    const toLocal = [...rb.keys()].filter((k) => !lb.has(k));
    // 需要补到远端（本地有、远端无）
    const toRemote = [...lb.keys()].filter((k) => !rb.has(k));
    for (const k of toLocal) {
      const r = rb.get(k)!;
      const idx = await topIdx(lc, bvid);
      addedToLocal++;
      if (!DRY)
        await lc.query(
          `INSERT INTO live_song (bvid, idx, title, source, excluded, raw_text, created_at)
           VALUES ($1,$2,$3,'ear',$4,$5,$6) ON CONFLICT (bvid, idx) DO NOTHING`,
          [bvid, idx + 1, r.title, r.excluded, r.raw_text, r.created_at ?? Date.now()],
        );
    }
    for (const k of toRemote) {
      const r = lb.get(k)!;
      const idx = await topIdx(rc, bvid);
      addedToRemote++;
      if (!DRY)
        await rc.query(
          `INSERT INTO live_song (bvid, idx, title, source, excluded, raw_text, created_at)
           VALUES ($1,$2,$3,'ear',$4,$5,$6) ON CONFLICT (bvid, idx) DO NOTHING`,
          [bvid, idx + 1, r.title, r.excluded, r.raw_text, r.created_at ?? Date.now()],
        );
    }
  }
  console.log(`${DRY ? '[DRY] ' : ''}合并完成：补到本地 ${addedToLocal} 首，补到远端 ${addedToRemote} 首`);
  await lc.end();
  await rc.end();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

// 听歌识曲（精确模式）：弹幕定位唱歌段落 → ffmpeg 抽 30s 音频 → 识别 → 写入 live_song(source='ear')。
// 比 OCR 准：识别的是「实际唱出的歌」（含歌单外的歌）。
//
// 精确策略：
//  - 30s 片段（而非 12s），提高 Shazam 命中率；
//  - 每个候选段落做多次采样（t / +30s / +60s），取「多数共识」才肯认，避免偶发误识；
//  - 定位信号：弹幕密度 + 打 call / 「/李豆沙/」类 call 弹幕 + 求歌名关键词，加权；
//  - 每场抓更多段落（默认 18，一般直播 >10 首歌），宁可慢也要尽量覆盖；
//  - 与「同场已识别歌曲（含 OCR）」交叉核对：OCR 与听歌识曲都命中 = 高置信确认。
//
// 多种识别工具：默认 Shazam；若设置 AUDD_TOKEN 则追加 audd.io 作为第二工具，二者一致才算高置信。
//
// 用法：
//   npm run songs:ear                 # 处理近期未跑过识曲的歌回（LIMIT 控制场次数）
//   BVID=BV1xxx npm run songs:ear     # 指定场次
//   SEGS=20 MIN_GAP=90 npm run songs:ear   # 调段落数与最小间隔
//   OFFSET_BASE=15 npm run songs:ear  # 采样基准偏移（本地/服务器错开，便于查缺补漏）
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { ensureReady, getPool } from '../lib/db';
import { getVideoCid, getVideoPlayUrl } from '../lib/bilibili';
import { matchKnown, normalize, isLikelySongTitle } from '../lib/known-songs';
import { FFMPEG, FFMPEG_HEADERS, PYTHON } from './sync-songs';

const envFile = path.join(process.cwd(), '.env');
if (fs.existsSync(envFile))
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }

const BVID = process.env.BVID || '';
const LIMIT = Number(process.env.LIMIT ?? 60);
const SEGS = Number(process.env.SEGS ?? 18); // 每场最多识别段落数（>10 首歌留余量）
const MIN_GAP = Number(process.env.MIN_GAP ?? 90); // 相邻段落最小间隔（秒）
const CLIP_SEC = Number(process.env.CLIP_SEC ?? 30); // 每段音频时长（秒）
const OFFSET_BASE = Number(process.env.OFFSET_BASE ?? 0); // 采样基准偏移（本地/服务器错开）
const WINDOW = 30; // 弹幕密度统计窗口（秒）
const GRID_SEC = Number(process.env.GRID_SEC ?? 480); // 兜底网格采样间隔（秒）：保证整场均匀覆盖，命中安静的唱歌段
const MAX_SEG = Number(process.env.MAX_SEG ?? 60); // 单场最多识别段落上限
const AUDIO_ID = path.join(process.cwd(), 'scripts', 'audio_id.py');
const LOCAL_FFMPEG_DIR = path.join(process.cwd(), 'tools', 'ffmpeg', 'bin');
// pydub（shazamio 依赖）需要 ffmpeg 在 PATH：取 FFMPEG 所在目录；若只是裸命令（如 'ffmpeg'），用 /usr/local/bin
const FFMPEG_DIR = fs.existsSync(FFMPEG) ? path.dirname(FFMPEG) : '/usr/local/bin';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// 定位信号：弹幕密度 + 打 call / 求歌名关键词 + 「/李豆沙/」类 call 弹幕
const CALL_RE =
  /什么歌|歌名|唱的|翻唱|cover|好听|开口|天籁|跪了|唱功|歌歌|求歌|这歌|神仙|唱得|起鸡皮|打[callCALL]|点歌|好听|绝了|上头|循环|单曲循环/i;
// 打 call 弹幕：B站 call 特效弹幕形如 "/李豆沙/" 或 "/xxx/"，或含「打call」
const SLASH_CALL_RE = /\/[^\/\s]{1,30}\//;

interface Seg {
  t: number; // 视频时间（秒）
  score: number;
}

// 定位唱歌段落：
//  1) 兜底网格采样：整场按 GRID_SEC 均匀铺点，保证「游戏+安静唱歌」类也能覆盖到（不依赖弹幕信号）；
//  2) 弹幕加分：高弹幕密度 / 打 call / 求歌 窗口作为额外候选叠加（与网格点去重）。
// 这样即使弹幕几乎没有「打call/求歌」信号，也能靠网格均匀命中每首歌。
function detectSegments(dan: { vtime: number; text: string | null }[], duration: number): Seg[] {
  // 弹幕加权
  const buckets = new Map<number, { count: number; weight: number }>();
  for (const d of dan) {
    if (!Number.isFinite(d.vtime) || d.vtime < 0) continue;
    const b = Math.floor(d.vtime / WINDOW);
    const cur = buckets.get(b) ?? { count: 0, weight: 0 };
    cur.count++;
    if (d.text) {
      if (CALL_RE.test(d.text)) cur.weight += 3;
      if (SLASH_CALL_RE.test(d.text)) cur.weight += 6; // call 特效弹幕强信号
    }
    buckets.set(b, cur);
  }
  const scored: Seg[] = [];
  for (const [b, v] of buckets) {
    const t = b * WINDOW + OFFSET_BASE;
    if (t < 90 || t > duration - CLIP_SEC - 30) continue; // 跳过开头/结尾
    scored.push({ t, score: v.count + v.weight });
  }
  scored.sort((a, b) => b.score - a.score);

  const usable = duration - 300;
  if (usable <= 0) return [];
  // 网格点数量：至少 SEGS，长视频按 GRID_SEC 间距铺满，封顶 MAX_SEG
  const targetCount = Math.min(MAX_SEG, Math.max(SEGS, Math.floor(usable / GRID_SEC)));
  const step = usable / targetCount;
  const picked: Seg[] = [];
  const tryAdd = (t: number) => {
    t = Math.round(t);
    if (t < 90 || t > duration - CLIP_SEC - 30) return;
    if (picked.every((p) => Math.abs(p.t - t) >= MIN_GAP)) picked.push({ t, score: 1 });
  };
  for (let i = 0; i < targetCount; i++) tryAdd(150 + i * step); // 均匀网格兜底
  for (const s of scored) {
    if (picked.length >= MAX_SEG) break;
    tryAdd(s.t); // 弹幕高分窗口叠加
  }
  return picked.sort((a, b) => a.t - b.t);
}

function runFfmpegExtract(url: string, t: number, out: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ps = spawn(
      FFMPEG,
      [
        '-ss', String(t),
        '-t', String(CLIP_SEC),
        '-headers', FFMPEG_HEADERS,
        '-i', url,
        '-vn',
        '-ac', '1',
        '-ar', '44100',
        '-y',
        out,
      ],
      { windowsHide: true },
    );
    let err = '';
    ps.stderr.on('data', (d) => (err += d.toString()));
    ps.on('error', (e) => reject(e));
    ps.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}: ${err.slice(-200)}`)),
    );
  });
}

interface EarResult {
  ok: boolean;
  title?: string;
  artist?: string;
  provider?: string;
  error?: string;
}

// 调用 audio_id.py：provider 可空（默认 shazam）；audd 需 AUDD_TOKEN
function runAudioId(wav: string, provider?: string): Promise<EarResult> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    env.PATH = `${LOCAL_FFMPEG_DIR};${FFMPEG_DIR};${env.PATH ?? ''}`;
    const args = provider ? [AUDIO_ID, wav, provider] : [AUDIO_ID, wav];
    const ps = spawn(PYTHON, args, { windowsHide: true, env });
    let out = '';
    let err = '';
    ps.stdout.on('data', (d) => (out += d.toString()));
    ps.stderr.on('data', (d) => (err += d.toString()));
    ps.on('error', (e) => reject(e));
    ps.on('close', (code) => {
      const idx = out.indexOf('SHAZAM_JSON:');
      if (code !== 0 || idx < 0)
        return reject(new Error(`audio_id exit ${code}: ${(err || out).slice(-200)}`));
      try {
        resolve(JSON.parse(out.slice(idx + 'SHAZAM_JSON:'.length)));
      } catch (e) {
        reject(new Error(`JSON 解析失败：${(e as Error).message}`));
      }
    });
  });
}

async function ensureEarTable() {
  await getPool().query(`CREATE TABLE IF NOT EXISTS song_ear_done (
    bvid TEXT PRIMARY KEY,
    hits INTEGER NOT NULL DEFAULT 0,
    created_at BIGINT
  )`);
}

// 带重试的音频抽取：B站 CDN 偶发 5XX，失败后重新取播放地址再试
async function extractWithRetry(
  getUrl: () => Promise<string | null>,
  t: number,
  wav: string,
): Promise<boolean> {
  let url = await getUrl().catch(() => null);
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!url) url = await getUrl().catch(() => null);
    if (!url) {
      await sleep(1000);
      continue;
    }
    try {
      await runFfmpegExtract(url, t, wav);
      return true;
    } catch (e) {
      console.log(`    ${t}s 音频抽取失败（第${attempt + 1}次）：${(e as Error).message.slice(0, 60)}`);
      await sleep(1500);
      url = null; // 强制下次重新取地址（token 可能失效）
    }
  }
  return false;
}

// 对一段候选窗口做多次采样 + 多工具识别，返回共识结果（多数一致才肯认）
async function recognizeSegment(
  getUrl: () => Promise<string | null>,
  seg: Seg,
  duration: number,
  tmp: string,
  auddEnabled: boolean,
): Promise<{ title: string; artist: string; t: number; tools: string } | null> {
  const offsets = [0, 30].filter((o) => seg.t + o <= duration - CLIP_SEC - 5);
  const matched: { t: number; res: EarResult }[] = [];
  for (let i = 0; i < offsets.length; i++) {
    const t = seg.t + offsets[i];
    const wav = path.join(tmp, `seg${Math.floor(t)}.wav`);
    const ok = await extractWithRetry(getUrl, t, wav);
    if (!ok) continue;
    // 主工具 shazam（网络抖动时重试）
    let res: EarResult | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        res = await runAudioId(wav);
        break;
      } catch (e) {
        console.log(`    ${t}s 识别异常（第${attempt + 1}次）：${(e as Error).message.slice(0, 50)}`);
        await sleep(2000);
      }
    }
    if (!res) continue;
    if (res.ok && res.title) {
      matched.push({ t, res });
      // 命中后追加一次同窗口采样做共识确认（不无限采样）
      if (i < offsets.length - 1 && matched.length < 2) continue;
      break;
    }
    console.log(`    ${t}s：未识别（${res.error ?? 'no_match'}）`);
    if (i === 0) continue; // 第一采没命中，继续试下一采
    break;
  }
  if (matched.length === 0) return null;

  // 多工具交叉验证（可选）：在首个命中点再用 audd 复核
  let tools = 'shazam';
  if (auddEnabled && matched[0]) {
    try {
      const a = await runAudioId(path.join(tmp, `seg${Math.floor(matched[0].t)}.wav`), 'audd');
      if (a.ok && a.title) {
        const same = normalize(a.title) === normalize(matched[0].res.title!);
        tools = same ? 'shazam+audd' : 'shazam(audd不一致)';
      }
    } catch {
      /* audd 失败不阻塞 */
    }
  }

  // 共识：所有命中标题必须一致（归一后），否则视为歧义跳过（保精确）
  const normTitles = matched.map((m) => normalize(m.res.title!));
  const allSame = normTitles.every((x) => x === normTitles[0]);
  if (!allSame) {
    console.log(`    ${seg.t}s：多采样结果不一致（${matched.map((m) => m.res.title).join(' / ')}），歧义跳过`);
    return null;
  }
  const first = matched[0];
  if (!isLikelySongTitle(first.res.title!)) {
    console.log(`    ${seg.t}s：${first.res.title}（不像歌名，跳过）`);
    return null;
  }
  return { title: first.res.title!, artist: first.res.artist || '', t: first.t, tools };
}

async function processBvid(bvid: string): Promise<number> {
  const p = getPool();
  const sq = await p.query<{ duration_sec: string; title: string | null }>(
    'SELECT duration_sec, title FROM live_session WHERE id = $1',
    [bvid],
  );
  const duration = Number(sq.rows[0]?.duration_sec ?? 0);
  console.log(`→ ${bvid} ${sq.rows[0]?.title ?? ''} (${duration}s)`);
  if (duration < 120) {
    console.log('    时长过短，跳过');
    return 0;
  }
  const dq = await p.query<{ vtime: number; text: string | null }>(
    'SELECT vtime, text FROM live_danmaku WHERE bvid = $1',
    [bvid],
  );
  const dan = dq.rows;
  if (dan.length < 5) {
    console.log(`    弹幕为空（${dan.length}），无法定位，跳过`);
    return 0;
  }
  const segs = detectSegments(dan, duration);
  if (segs.length === 0) {
    console.log('    未定位到唱歌段落');
    return 0;
  }
  console.log(
    `    定位到 ${segs.length} 个候选段落：${segs
      .map((s) => `${Math.floor(s.t / 60)}′${String(Math.floor(s.t % 60)).padStart(2, '0')}″(${s.score})`)
      .join(' ')}`,
  );
  const cid = await getVideoCid(bvid);
  if (!cid) {
    console.log('    cid 获取失败，跳过');
    return 0;
  }
  const getUrl = () => getVideoPlayUrl(bvid, cid);
  if (!(await getUrl())) {
    console.log('    播放地址获取失败，跳过');
    return 0;
  }
  // 已有歌曲（OCR+手动+ear），用于去重与交叉核对
  const exist = await p.query<{ title: string }>('SELECT title FROM live_song WHERE bvid = $1', [bvid]);
  const existing = new Set(exist.rows.map((r) => (r.title || '').normalize('NFKC').toLowerCase()));
  const auddEnabled = !!process.env.AUDD_TOKEN;

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dousha-ear-'));
  let hits = 0;
  try {
    let idxRow = await p.query<{ max: string }>(
      'SELECT COALESCE(MAX(idx),-1)::int AS max FROM live_song WHERE bvid=$1',
      [bvid],
    );
    let nextIdx = Number(idxRow.rows[0].max) + 1;
    for (const seg of segs) {
      const rec = await recognizeSegment(getUrl, seg, duration, tmp, auddEnabled);
      if (!rec) continue;
      await sleep(1500); // 间隔降低 Shazam 限流风险
      const key = rec.title.normalize('NFKC').toLowerCase();
      if (existing.has(key)) {
        console.log(`    ${rec.t}s：${rec.title}（已存在，跳过）`);
        continue;
      }
      existing.add(key);
      // 若命中已知歌单，用标准歌名
      const km = matchKnown(rec.title);
      const title = km ? km.song.song : rec.title;
      const confirm = km ? ' ✓歌单' : '';
      await p.query(
        `INSERT INTO live_song (bvid, idx, title, raw_text, created_at, source)
         VALUES ($1,$2,$3,$4,$5,'ear')
         ON CONFLICT (bvid, idx) DO NOTHING`,
        [bvid, nextIdx, title, `ear@${rec.t}s ${rec.artist} [${rec.tools}]`.trim(), Date.now()],
      );
      nextIdx++;
      hits++;
      console.log(`    ${rec.t}s：♪ ${title} — ${rec.artist} (${rec.tools})${confirm}`);
      await sleep(500);
    }
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
  await p.query(
    `INSERT INTO song_ear_done (bvid, hits, created_at) VALUES ($1,$2,$3)
     ON CONFLICT (bvid) DO UPDATE SET hits = EXCLUDED.hits, created_at = EXCLUDED.created_at`,
    [bvid, hits, Date.now()],
  );
  console.log(`    完成：新识别 ${hits} 首`);
  return hits;
}

// 供 jobs.ts 调用的入口：处理若干场未跑过识曲的回放
export async function runEarAll(limit: number): Promise<string> {
  await ensureReady();
  await ensureEarTable();
  const { rows } = await getPool().query<{ id: string }>(
    `SELECT s.id FROM live_session s
     LEFT JOIN song_ear_done d ON d.bvid = s.id
     WHERE d.bvid IS NULL AND s.duration_sec >= 120
     ORDER BY s.start_time DESC LIMIT $1`,
    [limit],
  );
  let total = 0;
  for (const r of rows) total += await processBvid(r.id).catch((e) => {
    console.warn(`    异常：${(e as Error).message}`);
    return 0;
  });
  return `听歌识曲完成：${rows.length} 场，新增 ${total} 首`;
}

export async function runEarBvid(bvid: string): Promise<number> {
  await ensureReady();
  await ensureEarTable();
  return processBvid(bvid);
}

async function main() {
  if (BVID) {
    const n = await runEarBvid(BVID);
    console.log(`识别 ${n} 首`);
    process.exit(0);
  }
  const msg = await runEarAll(LIMIT);
  console.log(msg);
  process.exit(0);
}

const invokedDirectly =
  !!process.argv[1] && process.argv[1].replace(/\\/g, '/').includes('song-by-ear');
if (invokedDirectly) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

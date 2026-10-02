// 听歌识曲：通过弹幕打 call 位置定位唱歌段落 → ffmpeg 抽音频 → Shazam 识别 → 写入 live_song(source='ear')。
// 比 OCR 准：OCR 只能识别「歌单面板」，本脚本识别的是实际唱出的歌（含歌单外的歌）。
//
// 用法：
//   npm run songs:ear                      # 处理近期未处理的歌回场次（LIMIT 控制）
//   BVID=BV1xxx npm run songs:ear          # 只处理指定场次
//   SEGS=6 npm run songs:ear               # 每场最多识别 6 个段落（默认 4）
//
// 依赖：tools/ffmpeg/bin/ffmpeg.exe；.venv 中的 shazamio（pip install shazamio）
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { ensureReady, getPool } from '../lib/db';
import { getVideoCid, getVideoPlayUrl } from '../lib/bilibili';
import { matchKnown } from '../lib/known-songs';
import { FFMPEG, FFMPEG_HEADERS, PYTHON } from './sync-songs';

const envFile = path.join(process.cwd(), '.env');
if (fs.existsSync(envFile))
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }

const BVID = process.env.BVID || '';
const LIMIT = Number(process.env.LIMIT ?? 8);
const SEGS = Number(process.env.SEGS ?? 4);
const WINDOW = 30; // 弹幕密度统计窗口（秒）
const CLIP_SEC = 12; // 每段抽取的音频时长
const MIN_GAP = 240; // 两个识别段落的最小间隔（秒）
const AUDIO_ID = path.join(process.cwd(), 'scripts', 'audio_id.py');
const LOCAL_FFMPEG_DIR = path.join(process.cwd(), 'tools', 'ffmpeg', 'bin');

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// 歌曲相关弹幕关键词（打 call / 求歌名）
const CALL_RE = /什么歌|歌名|唱的|翻唱|cover|好听|开口|天籁|跪了|唱功|歌歌|求歌|这歌|神仙|唱得|起鸡皮/i;

interface Seg {
  t: number; // 视频时间（秒）
  score: number;
}

// 从弹幕分布定位唱歌段落：30s 窗口计数 + 关键词加权，取得分最高的互不重叠段
function detectSegments(
  dan: { vtime: number; text: string | null }[],
  duration: number,
): Seg[] {
  const buckets = new Map<number, { count: number; weight: number }>();
  for (const d of dan) {
    if (!Number.isFinite(d.vtime) || d.vtime < 0) continue;
    const b = Math.floor(d.vtime / WINDOW);
    const cur = buckets.get(b) ?? { count: 0, weight: 0 };
    cur.count++;
    if (d.text && CALL_RE.test(d.text)) cur.weight += 3;
    buckets.set(b, cur);
  }
  const scored: Seg[] = [];
  for (const [b, v] of buckets) {
    const t = b * WINDOW;
    if (t < 60 || t > duration - 90) continue; // 跳过开头/结尾
    scored.push({ t, score: v.count + v.weight });
  }
  scored.sort((a, b) => b.score - a.score);
  const picked: Seg[] = [];
  for (const s of scored) {
    if (picked.length >= SEGS) break;
    if (picked.every((p) => Math.abs(p.t - s.t) >= MIN_GAP)) picked.push(s);
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
  error?: string;
}

function runAudioId(wav: string): Promise<EarResult> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    // pydub（shazamio 依赖）需要 ffmpeg 在 PATH 中
    env.PATH = `${LOCAL_FFMPEG_DIR};${env.PATH ?? ''}`;
    const ps = spawn(PYTHON, [AUDIO_ID, wav], { windowsHide: true, env });
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
  if (dan.length < 30) {
    console.log(`    弹幕过少（${dan.length}），跳过`);
    return 0;
  }
  const segs = detectSegments(dan, duration);
  if (segs.length === 0) {
    console.log('    未定位到唱歌段落');
    return 0;
  }
  console.log(`    定位到 ${segs.length} 个候选段落：${segs.map((s) => `${Math.floor(s.t / 60)}′${String(Math.floor(s.t % 60)).padStart(2, '0')}″(${s.score})`).join(' ')}`);
  const cid = await getVideoCid(bvid);
  if (!cid) {
    console.log('    cid 获取失败，跳过');
    return 0;
  }
  const url = await getVideoPlayUrl(bvid, cid);
  if (!url) {
    console.log('    播放地址获取失败，跳过');
    return 0;
  }
  // 已有歌曲（OCR+手动+ear），用于去重
  const exist = await p.query<{ title: string }>('SELECT title FROM live_song WHERE bvid = $1', [bvid]);
  const existing = new Set(exist.rows.map((r) => (r.title || '').normalize('NFKC').toLowerCase()));

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dousha-ear-'));
  let hits = 0;
  try {
    let idxRow = await p.query<{ max: string }>(
      'SELECT COALESCE(MAX(idx),-1)::int AS max FROM live_song WHERE bvid=$1',
      [bvid],
    );
    let nextIdx = Number(idxRow.rows[0].max) + 1;
    for (const seg of segs) {
      // 多点探测：弹幕密集窗口不一定踩准唱歌时刻，t / +50s / +100s 各试一次，命中即停
      let matched: { res: EarResult; t: number } | null = null;
      for (const off of [0, 50, 100]) {
        const t = seg.t + off;
        if (t > duration - 30) break;
        const wav = path.join(tmp, `seg${Math.floor(t)}.wav`);
        try {
          await runFfmpegExtract(url, t, wav);
        } catch (e) {
          console.log(`    ${t}s 音频抽取失败：${(e as Error).message}`);
          continue;
        }
        let res: EarResult;
        try {
          res = await runAudioId(wav);
        } catch (e) {
          console.log(`    ${t}s 识别异常：${(e as Error).message}`);
          continue;
        }
        if (res.ok && res.title) {
          matched = { res, t };
          break;
        }
        console.log(`    ${t}s：未识别（${res.error ?? 'no_match'}）`);
      }
      if (!matched || !matched.res.title) continue;
      const { res, t } = matched;
      const rtitle = res.title as string;
      // 已有同名歌则跳过（大小写/全半角归一后比较）
      const key = rtitle.normalize('NFKC').toLowerCase();
      if (existing.has(key)) {
        console.log(`    ${t}s：${rtitle}（已存在，跳过）`);
        continue;
      }
      existing.add(key);
      // 若命中已知歌单，用标准歌名
      const km = matchKnown(rtitle);
      const title = km ? km.song.song : rtitle;
      await p.query(
        `INSERT INTO live_song (bvid, idx, title, raw_text, created_at, source)
         VALUES ($1,$2,$3,$4,$5,'ear')
         ON CONFLICT (bvid, idx) DO NOTHING`,
        [bvid, nextIdx, title, `shazam@${t}s ${res.artist}`.trim(), Date.now()],
      );
      nextIdx++;
      hits++;
      console.log(`    ${t}s：♪ ${title} — ${res.artist}`);
      await sleep(800);
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

async function main() {
  await ensureReady();
  await ensureEarTable();
  if (BVID) {
    await processBvid(BVID);
    process.exit(0);
  }
  // 自动挑选：近期有弹幕、已完成 OCR、且未跑过识曲的歌回场次
  const { rows } = await getPool().query<{ id: string }>(
    `SELECT s.id FROM live_session s
     LEFT JOIN song_ear_done d ON d.bvid = s.id
     WHERE d.bvid IS NULL AND s.duration_sec >= 120
     ORDER BY s.start_time DESC LIMIT $1`,
    [LIMIT],
  );
  console.log(`待识曲场次：${rows.length}`);
  for (const r of rows) {
    await processBvid(r.id).catch((e) => console.warn(`    异常：${(e as Error).message}`));
  }
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

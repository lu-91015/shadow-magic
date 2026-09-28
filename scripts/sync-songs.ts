// 歌回歌单识别：抽取每场直播回放尾段整帧 → 本地 OCR（PaddleOCR 中文，整帧自动检测文字位置）
// 增量可续跑：只处理 songs_checked_at 为空的回放；LIMIT 控制批次；已处理自动跳过。
//
// 用法：
//   npm run sync:songs                 # 处理全部未识别回放
//   LIMIT=20 npm run sync:songs        # 只处理前 20 场（验证用）
//   FORCE=1 npm run sync:songs         # 强制重跑（忽略已识别标记）
//
// 依赖：tools/ffmpeg/bin/ffmpeg.exe（或 PATH 中的 ffmpeg）；.venv 中的 PaddleOCR（中文 ch）
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { getVideoCid, getVideoPlayUrl } from '../lib/bilibili';
import {
  ensureReady,
  getPool,
  queryLiveStats,
  querySongStreams,
  upsertLiveSongs,
  markSongsChecked,
} from '../lib/db';

// ---------- 环境 ----------
const envFile = path.join(process.cwd(), '.env');
if (fs.existsSync(envFile))
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }

const LIMIT = Number(process.env.LIMIT ?? 0);
const FORCE = process.env.FORCE === '1';
const LOCAL_FFMPEG = path.join(process.cwd(), 'tools', 'ffmpeg', 'bin', 'ffmpeg.exe');
const FFMPEG = fs.existsSync(LOCAL_FFMPEG)
  ? LOCAL_FFMPEG
  : process.env.FFMPEG_BIN || 'ffmpeg';
// PaddleOCR 运行在 .venv（Python 3.11）中；ocr_songlist.py 负责整帧检测+识别
const VENV_PY = path.join(process.cwd(), '.venv', 'Scripts', 'python.exe');
const PYTHON = fs.existsSync(VENV_PY) ? VENV_PY : process.env.PYTHON_BIN || 'python3';
const OCR_SCRIPT = path.join(process.cwd(), 'scripts', 'ocr_songlist.py');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
// B站 upos CDN 会拦截 ffmpeg 默认 UA（Lavf），需带浏览器 UA + Referer，否则 403
const FFMPEG_HEADERS = `Referer: https://www.bilibili.com/\r\nUser-Agent: ${UA}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dousha-song-'));

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const ps = spawn(FFMPEG, args, { windowsHide: true });
    let err = '';
    ps.stderr.on('data', (d) => (err += d.toString()));
    ps.on('error', (e) => reject(e));
    ps.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}: ${err.slice(-300)}`)),
    );
  });
}

// 抽取回放尾段若干整帧（不裁剪——歌单位置每场可能不同，交由 PaddleOCR 自行检测）
// 用 -sseof 从片尾向前取帧，避免依赖可能不准的 duration_sec（存档回放常比直播时长短，导致 -ss 越过片尾）
async function extractFrames(url: string): Promise<string[]> {
  // 采样点（距片尾秒数）：结束前 30/25/20/15/10/5 分钟等整档锚定，覆盖歌单常出现的尾段区间；
  // 另保留临近片尾的 2 分钟/20 秒，兜底最末的结束画面。多帧结果在 pickSongs 内跨帧去重合并。
  const backs = [1800, 1500, 1200, 900, 600, 300, 120, 20];
  const paths: string[] = [];
  for (let i = 0; i < backs.length; i++) {
    const frame = path.join(TMP, `f${i}.png`);
    try {
      await runFfmpeg([
        '-sseof', String(-backs[i]),
        '-headers', FFMPEG_HEADERS,
        '-i', url,
        '-frames:v', '1',
        frame,
      ]);
      if (fs.existsSync(frame)) paths.push(frame);
    } catch (e) {
      console.warn(`    帧 ${i} 抽取失败：${(e as Error).message}`);
    }
  }
  return paths;
}

// 调用 PaddleOCR 脚本：一次进程处理多张帧（模型只加载一次）
// 返回结构：每张图一个 detection 列表，每个 detection 含 text / score / box
async function runOcr(
  framePaths: string[],
): Promise<Array<Array<{ text: string; score: number; box: number[][] }>>> {
  return new Promise((resolve, reject) => {
    const ps = spawn(PYTHON, [OCR_SCRIPT, ...framePaths], { windowsHide: true });
    let out = '';
    let err = '';
    ps.stdout.on('data', (d) => (out += d.toString()));
    ps.stderr.on('data', (d) => (err += d.toString()));
    ps.on('error', (e) => reject(e));
    ps.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ocr exit ${code}: ${err.slice(-300)}`));
      const idx = out.indexOf('OCR_RESULT_JSON:');
      if (idx < 0) return reject(new Error(`未找到 OCR 结果：${out.slice(-200)}`));
      const jsonStr = out.slice(idx + 'OCR_RESULT_JSON:'.length);
      try {
        resolve(JSON.parse(jsonStr));
      } catch (e) {
        reject(new Error(`OCR JSON 解析失败：${(e as Error).message}`));
      }
    });
  });
}

// 解析 OCR 文本为歌单：按行、去噪、过滤非歌名行
function parseSongs(text: string): string[] {
  const lines = text
    .split(/[\r\n]+/)
    .map((l) => l.replace(/[^\p{L}\p{N}\s·\-（）()/]/gu, '').trim())
    // 去掉行首序号前缀：OCR 常把序号和歌名黏在一起（如 "1地球大爆炸""12歌名""3残酷な天使"）
    // 规则：行首连续数字 + 可选空格，后面紧跟文字（\p{L}）即视为序号，整段剥掉
    .map((l) => l.replace(/^\d+\s*(?=\p{L})/u, '').trim())
    .filter((l) => l.length >= 2 && l.length <= 40);
  // 去掉纯数字序号（如 "1." "12"）
  const songs = lines.filter((l) => !/^[\d]+[.。]?$/.test(l));
  // 去重（保留顺序）
  const seen = new Set<string>();
  return songs.filter((s) => (seen.has(s) ? false : (seen.add(s), true)));
}

type Det = { text: string; score: number; box: number[][] };

function _bbox(d: Det) {
  const xs = d.box.map((p) => p[0]);
  const ys = d.box.map((p) => p[1]);
  return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
}
// 两个检测框的重叠比（以较小框为基准），>0.5 视为同一行被识别成多条
function _iou(a: Det, b: Det): number {
  const A = _bbox(a);
  const B = _bbox(b);
  const ix = Math.max(0, Math.min(A.x2, B.x2) - Math.max(A.x1, B.x1));
  const iy = Math.max(0, Math.min(A.y2, B.y2) - Math.max(A.y1, B.y1));
  const inter = ix * iy;
  if (inter <= 0) return 0;
  const areaA = (A.x2 - A.x1) * (A.y2 - A.y1);
  const areaB = (B.x2 - B.x1) * (B.y2 - B.y1);
  return inter / Math.max(1e-6, Math.min(areaA, areaB));
}

// 隔离「歌单」：弹幕在左、歌单在右——直接从画面中间分割，取右半边作为歌单候选区。
// 不依赖识别 SONG LIST 等表头文字（常被识别成 Channel LIST / 缺失），更稳。
function pickSongs(dets: Det[]): string[] {
  const minScore = 0.5;
  const cand = dets.filter(
    (d) => d.score >= minScore && Array.isArray(d.box) && d.box.length === 4,
  );
  // 过滤面板装饰 / 品牌 / 弹幕ID 等噪声
  const STOP_RE =
    /bilibili|歌单|chan|channel|chanel|annel|bili|list|弹幕|弾幕|点歌|spectator|插队|关注|点赞|投币|cn\s*\d+|[一-龥]{2,}\d{3,5}\s*$/i;
  const items = cand.filter((d) => !STOP_RE.test(d.text));
  if (items.length === 0) return [];

  const maxX = Math.max(1, ...items.map((d) => Math.max(...d.box.map((p) => p[0]))));
  const midX = maxX / 2;
  const centerOf = (d: Det) =>
    (Math.min(...d.box.map((p) => p[0])) + Math.max(...d.box.map((p) => p[0]))) / 2;
  // 弹幕在左、歌单在右：严格取右半边（x > 中线）作为歌单候选区
  const group = items.filter((d) => centerOf(d) > midX);

  // 同一行被识别成多条时，按重叠聚类，每簇保留更高分/更长的一条；最后按 y 排序还原顺序
  const sorted = [...group].sort(
    (a, b) => Math.min(...a.box.map((p) => p[1])) - Math.min(...b.box.map((p) => p[1])),
  );
  const clusters: Det[][] = [];
  for (const d of sorted) {
    const c = clusters.find((cl) => _iou(cl[0], d) > 0.5);
    if (c) c.push(d);
    else clusters.push([d]);
  }
  const reps = clusters
    .map((cl) => cl.sort((a, b) => b.text.length - a.text.length || b.score - a.score)[0])
    .sort((a, b) => Math.min(...a.box.map((p) => p[1])) - Math.min(...b.box.map((p) => p[1])));

  // 歌单本体：若有序号行，取其纵向区间 + 同列（序号列左右 8%）保留；
  // 区间内/同列的「无序号歌名」也一并保留——并非每首歌都带数字序号。
  const numbered = reps.filter((d) => /^\d/.test(d.text));
  let finalReps = reps;
  if (numbered.length >= 2) {
    const ys = numbered.map((d) => Math.min(...d.box.map((p) => p[1])));
    const ymin = Math.min(...ys) - 15;
    const ymax = Math.max(...ys) + 15;
    const xs = numbered.map((d) => centerOf(d)).sort((a, b) => a - b);
    const medX = xs[Math.floor(xs.length / 2)];
    finalReps = reps.filter((d) => {
      const y = Math.min(...d.box.map((p) => p[1]));
      const cx = centerOf(d);
      return (y >= ymin && y <= ymax) || Math.abs(cx - medX) < maxX * 0.08;
    });
  }

  // 歌单判定：有序号行≥2，或（无序号但）疑似歌名行≥4——避免把右侧零散聊天误判为歌单。
  // 注：为保证歌曲覆盖率，暂不剔除噪声行；后续用人工歌单比对即可直接去噪。
  const numFinal = finalReps.filter((d) => /^\d/.test(d.text)).length;
  const isSongList = finalReps.length >= 2 && (numFinal >= 2 || finalReps.length >= 4);
  return parseSongs(isSongList ? finalReps.map((d) => d.text).join('\n') : '');
}

async function main() {
  if (!fs.existsSync(FFMPEG) && FFMPEG === 'ffmpeg') {
    console.warn('未找到 ffmpeg，请安装到 tools/ffmpeg/bin/ffmpeg.exe 或加入 PATH。');
    process.exit(1);
  }
  await ensureReady();

  // 待处理回放：未标记识别 或 FORCE
  const all = await querySongStreams();
  let todo = all.filter((r) => FORCE || r.checkedAt == null);
  if (LIMIT > 0) todo = todo.slice(0, LIMIT);
  console.log(`待识别回放 ${todo.length} 场（共 ${all.length} 场，已识别 ${all.length - todo.length} 场）`);

  if (todo.length === 0) {
    console.log('无需处理。');
    process.exit(0);
  }

  console.log('准备 PaddleOCR（首次会下载检测/识别模型，可能较慢）…');

  let ok = 0;
  let empty = 0;
  for (const r of todo) {
    const res = await scanBvid(r.bvid).catch((e) => {
      console.warn(`    处理异常：${(e as Error).message}`);
      return { ok: false, songs: 0 };
    });
    if (res.ok) ok++;
    else empty++;
  }

  try {
    fs.rmSync(TMP, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  console.log(`完成：识别到歌单 ${ok} 场，空结果 ${empty} 场。`);
  process.exit(0);
}

// 单场回放歌单识别（供脚本循环与后台定时任务复用）。
export async function scanBvid(bvid: string): Promise<{ ok: boolean; songs: number }> {
  const dq = await getPool().query<{ duration_sec: string; title: string | null }>(
    'SELECT duration_sec, title FROM live_session WHERE id = $1',
    [bvid],
  );
  const duration = Number(dq.rows[0]?.duration_sec ?? 0);
  console.log(`→ ${bvid} ${dq.rows[0]?.title ?? ''} (${duration}s)`);
  const cid = await getVideoCid(bvid);
  if (!cid) {
    console.warn('    cid 获取失败，跳过');
    await markSongsChecked(bvid);
    return { ok: false, songs: 0 };
  }
  const url = await getVideoPlayUrl(bvid, cid);
  if (!url) {
    console.warn('    播放地址获取失败，跳过');
    await markSongsChecked(bvid);
    return { ok: false, songs: 0 };
  }
  const frames = await extractFrames(url);
  if (frames.length === 0) {
    console.warn('    无可用帧，跳过');
    await markSongsChecked(bvid);
    return { ok: false, songs: 0 };
  }
  let dets: Array<{ text: string; score: number; box: number[][] }> = [];
  try {
    const perImg = await runOcr(frames);
    for (const arr of perImg) for (const d of arr) dets.push(d);
  } catch (e) {
    console.warn(`    OCR 失败：${(e as Error).message}`);
    await markSongsChecked(bvid);
    return { ok: false, songs: 0 };
  } finally {
    for (const f of frames) {
      try {
        fs.unlinkSync(f);
      } catch {
        /* ignore */
      }
    }
  }
  const raw = dets
    .filter((d) => d.score >= 0.6)
    .map((d) => d.text)
    .join('\n');
  const songs = pickSongs(dets);
  await upsertLiveSongs(bvid, songs, raw.trim());
  await markSongsChecked(bvid);
  if (songs.length) {
    console.log(
      `    识别到 ${songs.length} 首：${songs.slice(0, 6).join(' / ')}${songs.length > 6 ? ' …' : ''}`,
    );
    return { ok: true, songs: songs.length };
  }
  console.log('    未识别到歌名（已记录原始文本）');
  return { ok: false, songs: 0 };
}

// 仅当本文件被直接执行（npm run sync:songs）时才跑 main；作为库被导入时不自启。
const invokedDirectly =
  !!process.argv[1] && process.argv[1].replace(/\\/g, '/').includes('sync-songs');
if (invokedDirectly) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

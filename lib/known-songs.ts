// 已知歌单（data/known-songs.json，李豆沙会唱的歌）+ OCR 歌名清洗逻辑。
// 供 scripts/clean-songs.ts（存量清理）与 scripts/sync-songs.ts（OCR 后实时清洗）共用。
import fs from 'fs';
import path from 'path';

export interface KnownSong {
  song: string;
  singer: string;
  types: string[];
  notice?: string;
}

let _cache: { byNorm: Map<string, KnownSong>; list: { n: string; s: KnownSong }[] } | null = null;

function loadKnown(): { byNorm: Map<string, KnownSong>; list: { n: string; s: KnownSong }[] } {
  if (_cache) return _cache;
  const file = path.join(process.cwd(), 'data', 'known-songs.json');
  const raw: KnownSong[] = JSON.parse(fs.readFileSync(file, 'utf8'));
  // 过滤 KeepAlive 测试条目
  const songs = raw.filter((x) => x && x.song && !/KeepAlive/i.test(x.song));
  const byNorm = new Map<string, KnownSong>();
  const list: { n: string; s: KnownSong }[] = [];
  for (const s of songs) {
    const n = normalize(s.song);
    if (!n) continue;
    if (!byNorm.has(n)) byNorm.set(n, s);
    list.push({ n, s });
  }
  _cache = { byNorm, list };
  return _cache;
}

// 归一化：NFKC 全半角、小写、去所有空白/标点/符号；只留文字与数字
export function normalize(s: string): string {
  return (s || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

// 行首序号剥离：OCR 常见 "1歌名" "12.歌名"
function stripIndex(s: string): string {
  return s.replace(/^\d+\s*[.、.．]?\s*/, '').trim();
}

function levSim(a: string, b: string): number {
  if (!a || !b) return 0;
  if (Math.abs(a.length - b.length) > 6) return 0;
  const m = a.length;
  const n = b.length;
  let prev = new Array(n + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return 1 - prev[n] / Math.max(m, n);
}

// 歌名行 vs "歌手 - 歌名" 结构：按分隔符拆开分别匹配
function splitCandidates(line: string): string[] {
  const parts = line.split(/\s*[-–—/／]\s*/).filter(Boolean);
  return parts.length > 1 ? [line, ...parts] : [line];
}

export interface KnownMatch {
  song: KnownSong;
  score: number; // 1=精确 0.9=包含 0.8+=模糊
}

// 匹配一行文本是否为已知歌曲（精确 > 包含 > 编辑距离）
export function matchKnown(line: string): KnownMatch | null {
  const { byNorm, list } = loadKnown();
  let best: KnownMatch | null = null;
  const consider = (m: KnownMatch) => {
    if (!best || m.score > best.score) best = m;
  };
  for (const cand of splitCandidates(stripIndex(line))) {
    const n = normalize(cand);
    if (!n) continue;
    const exact = byNorm.get(n);
    if (exact) {
      consider({ song: exact, score: 1 });
      continue;
    }
    if (n.length >= 3) {
      for (const { n: kn, s } of list) {
        if (kn.length >= 3 && (n.includes(kn) || kn.includes(n))) {
          consider({ song: s, score: 0.9 });
        }
      }
    }
    for (const { n: kn, s } of list) {
      const sim = levSim(n, kn);
      if (sim >= 0.82) consider({ song: s, score: sim });
    }
  }
  return best;
}

// ---------- 垃圾判定 ----------
// B站 UI / 面板文字 / 弹幕特征
const NOISE_RE =
  /bilibili|comment|spectator|studio|osplive|keepalive|欢迎来到|直播间|弹幕|弾幕|点歌|插队|关注|点赞|投币|天选| combust|笑死|主包|主播|开团|托管|报酬|模拟器|灵敏度|视角|检定|遥控器|公屏|礼物|舰长|提督|总督|上舰|二哥|鉴定|要唱的歌|唱过的歌|已唱|待唱|点播|歌单列表/i;
const USER_RE = /[^\d\s]{2,}\d{3,5}$/u; // 弹幕用户名典型形态：文字+3~5位数字结尾
const BV_RE = /BV[0-9A-Za-z]{8,}/;
const CONVO_RE =
  /[什么怎么为什么不是吧吗呢啊|可以|应该|真的|来了|确实|兄弟|哥们|还好|不要|没有|有人|这个那个|笑|呜呜|草|急了|寄]/;

export function digitsRatio(s: string): number {
  if (!s) return 1;
  const d = (s.match(/\d/g) || []).length;
  return d / s.length;
}

export function isGarbageLine(line: string): boolean {
  const t = (line || '').trim();
  if (t.length < 2) return true; // ー リ 等碎片
  if (BV_RE.test(t)) return true;
  if (NOISE_RE.test(t)) return true;
  if (USER_RE.test(t) && digitsRatio(t) >= 0.15) return true; // 用户名+编号
  const n = normalize(t);
  if (!n) return true;
  if (digitsRatio(n) > 0.5) return true; // 纯编号
  // 全假名/片假碎片 ≤2 字符（ー リ ロ 等）
  if (/^[\u30A0-\u30FF\u3040-\u309Fー]+$/.test(n) && n.length <= 2) return true;
  return false;
}

// 聊天句特征（长中文对话、无歌名特征）——用于整场「弹幕面板误识」判定
export function isConvoLike(line: string): boolean {
  return CONVO_RE.test(line) || /[。！？，、]/.test(line) || line.length >= 12;
}

// 判断是否「像歌名」（任务2：不在已知歌单里的歌也要保留）
export function isLikelySongTitle(line: string): boolean {
  if (isGarbageLine(line)) return false;
  const t = line.trim();
  if (t.length > 40) return false;
  const n = normalize(t);
  if (!/[\p{L}]/u.test(n)) return false;
  if (digitsRatio(n) > 0.4) return false;
  return true;
}

export interface CleanResult {
  songs: { title: string; known: boolean }[];
  excluded: string[]; // 被判垃圾的原始行
  knownCount: number;
}

// 清洗一场的 OCR 歌名列表（单场级别：不知全场上下文，保守处理）
export function cleanSongTitles(lines: string[]): CleanResult {
  const songs: { title: string; known: boolean }[] = [];
  const excluded: string[] = [];
  let knownCount = 0;
  const seen = new Set<string>();
  for (const raw of lines) {
    const line = (raw || '').trim();
    if (!line) continue;
    const m = matchKnown(line);
    if (m) {
      knownCount++;
      const key = normalize(m.song.song);
      if (!seen.has(key)) {
        seen.add(key);
        songs.push({ title: m.song.song, known: true });
      }
      continue;
    }
    if (isGarbageLine(line)) {
      excluded.push(line);
      continue;
    }
    // 未知但像歌名 → 保留（李豆沙会唱歌单外的歌）
    if (isLikelySongTitle(line)) {
      const key = normalize(line);
      if (!seen.has(key)) {
        seen.add(key);
        songs.push({ title: line, known: false });
      }
    } else {
      excluded.push(line);
    }
  }
  return { songs, excluded, knownCount };
}

// 整场判定：已知歌曲命中 0 且多数行像聊天/垃圾 → 判定为弹幕面板误识，整场作废
export function isMisreadPanel(lines: string[]): boolean {
  if (lines.length === 0) return false;
  let garbage = 0;
  let convo = 0;
  let known = 0;
  for (const l of lines) {
    if (matchKnown(l)) known++;
    else if (isGarbageLine(l)) garbage++;
    else if (isConvoLike(l)) convo++;
  }
  if (known > 0) return false;
  return (garbage + convo) / lines.length >= 0.5;
}

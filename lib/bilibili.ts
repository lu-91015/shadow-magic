import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { downloadImage, imgExt } from './images';
import { UID, ROOM_ID, TAG_NAME, AVATAR_URL } from './constants';
// 供 jobs.ts 等复用（保持原导出契约）
export { UID, TAG_NAME, AVATAR_URL };
import { getKv, setKv } from './db';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// ---------- 运行时 Cookie（后台可动态设置，DB 优先，env 兜底） ----------
let _rtCookie: string | null = null;
let _rtSess: string | null = null;

export function getBiliCookieSync(): string {
  return _rtCookie ?? process.env.BILI_COOKIE ?? '';
}
export function getBiliSessSync(): string {
  return _rtSess ?? process.env.BILI_SESSDATA ?? '';
}
// 从 Cookie 中取登录 uid（弹幕 WS 鉴权必须用真实 uid，否则 B站直接断开）
export function getBiliUidSync(): number {
  const m = (getBiliCookieSync() || '').match(/DedeUserID=(\d+)/);
  return m ? Number(m[1]) : 0;
}
export async function setBiliCookie(
  cookie?: string,
  sess?: string,
): Promise<void> {
  if (cookie != null) {
    _rtCookie = cookie;
    process.env.BILI_COOKIE = cookie;
    await setKv('BILI_COOKIE', cookie);
  }
  if (sess != null) {
    _rtSess = sess;
    process.env.BILI_SESSDATA = sess;
    await setKv('BILI_SESSDATA', sess);
  }
}
export async function loadBiliCookieFromDb(): Promise<void> {
  try {
    const c = await getKv('BILI_COOKIE');
    const s = await getKv('BILI_SESSDATA');
    // 仅当 DB 中的 cookie 看起来完整时才覆盖 .env 的值；
    // 否则保留 .env 中完整的登录态（避免 DB 里残留的残缺/过期 cookie
    // 导致 feed/space 等需登录接口被风控返回空，表现为“同步成功但 0 新增”）。
    // 正常完整 cookie 长度远超 1000，残缺值通常只有几百字符。
    if (c && c.length > 1000) {
      _rtCookie = c;
      process.env.BILI_COOKIE = c;
    } else if (c) {
      console.warn(
        '[bili] DB 中的 BILI_COOKIE 疑似不完整（长度 ' +
          c.length +
          '），保留 .env 的完整值',
      );
    }
    if (s && s.length >= 20) {
      _rtSess = s;
      process.env.BILI_SESSDATA = s;
    }
  } catch {
    /* 忽略：库未就绪时跳过 */
  }
}

// ---------- B站扫码登录（二维码） ----------
export async function biliQrGenerate(): Promise<{
  url: string;
  qrcodeKey: string;
}> {
  const data = await biliGet<{
    code?: number;
    message?: string;
    data?: { url: string; qrcode_key: string };
  }>('https://passport.bilibili.com/x/passport-login/web/qrcode/generate');
  if (data?.code !== 0 || !data.data)
    throw new Error('生成二维码失败：' + (data?.message ?? '未知错误'));
  const key = data.data.qrcode_key;
  // 新版本接口可能返回空的 url，此时用 qrcode_key 自行拼出扫码跳转地址（App 可识别）。
  const url =
    data.data.url && data.data.url.trim()
      ? data.data.url
      : `https://passport.bilibili.com/x/passport-login/web/qrcode/redirect?qrcode_key=${encodeURIComponent(key)}`;
  return { url, qrcodeKey: key };
}

export type QrPollResult = {
  status: 'waiting' | 'scanned' | 'expired' | 'success';
  message?: string;
  cookieStr?: string;
  sess?: string;
};

export async function biliQrPoll(qrcodeKey: string): Promise<QrPollResult> {
  try {
    const res = await fetch(
      'https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=' +
        encodeURIComponent(qrcodeKey),
      {
        method: 'GET',
        headers: {
          'User-Agent': UA,
          Referer: 'https://www.bilibili.com/',
          Origin: 'https://www.bilibili.com',
        },
        signal: AbortSignal.timeout(15000),
      },
    );
    const d: any = await res.json();
    const code = d?.data?.code;
    if (code === 0) {
      const loginUrl: string = d?.data?.url || '';
      console.log('[bili-qr-poll] success. loginUrl=', loginUrl);
      console.log('[bili-qr-poll] raw data=', JSON.stringify(d?.data));
      // 优先：主动请求跳转地址，读取下发的 Set-Cookie（B站真正下发鉴权 Cookie 的方式）
      const fromHeader = loginUrl ? await fetchSetCookies(loginUrl) : null;
      // 兜底：从 loginUrl 的查询参数里解析
      const fromUrl = parseCookiesFromUrl(loginUrl);
      const cookieStr = (fromHeader?.cookieStr || fromUrl.cookieStr || '').trim();
      const sess = fromHeader?.sess || fromUrl.sess;
      console.log(
        '[bili-qr-poll] cookieStr=',
        cookieStr ? cookieStr.slice(0, 60) + '...' : '(empty)',
        'sess=',
        sess ? sess.slice(0, 12) + '...' : '(empty)',
      );
      return { status: 'success', cookieStr, sess };
    }
    if (code === 86038) return { status: 'expired', message: d?.message };
    if (code === 86090) return { status: 'scanned', message: d?.message };
    return { status: 'waiting', message: d?.message };
  } catch (e: any) {
    return { status: 'waiting', message: e?.message ?? '轮询异常' };
  }
}

// 请求跳转地址，从响应头 Set-Cookie 中提取鉴权 Cookie（name=value 形式）。
async function fetchSetCookies(
  url: string,
): Promise<{ cookieStr: string; sess?: string } | null> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      headers: { 'User-Agent': UA, Referer: 'https://www.bilibili.com/' },
      signal: AbortSignal.timeout(15000),
    });
    const setCookies: string[] =
      typeof (res.headers as any).getSetCookie === 'function'
        ? (res.headers as any).getSetCookie()
        : [res.headers.get('set-cookie') || ''];
    const parts: string[] = [];
    let sess: string | undefined;
    for (const sc of setCookies) {
      const pair = sc.split(';')[0].trim(); // name=value
      if (!pair || !pair.includes('=')) continue;
      parts.push(pair);
      const name = pair.split('=')[0];
      if (name === 'SESSDATA') sess = pair.slice('SESSDATA='.length);
    }
    if (!parts.length) return null;
    return { cookieStr: parts.join('; '), sess };
  } catch (e: any) {
    console.log('[bili-qr-poll] fetchSetCookies failed:', e?.message);
    return null;
  }
}

function parseCookiesFromUrl(url: string): { cookieStr: string; sess?: string } {
  try {
    const u = new URL(url);
    const names = [
      'SESSDATA',
      'bili_jct',
      'DedeUserID',
      'DedeUserID__ckMd5',
      'sid',
    ];
    const parts: string[] = [];
    let sess: string | undefined;
    for (const n of names) {
      const v = u.searchParams.get(n);
      if (v) {
        parts.push(`${n}=${v}`);
        if (n === 'SESSDATA') sess = v;
      }
    }
    return { cookieStr: parts.join('; '), sess };
  } catch {
    return { cookieStr: '' };
  }
}

// ---------- 表情包（自定义 emoji）本地化 ----------
// B站动态里的 [李豆沙_贡丸] 这类表情是 rich_text_nodes 里的 EMOJI 节点，
// 带有 icon_url。把它下载到 public/emojis/，渲染时替换为内联 <img>。
const EMOJI_DIR = path.join(process.cwd(), 'public', 'emojis');
try {
  fs.mkdirSync(EMOJI_DIR, { recursive: true });
} catch {
  /* 忽略 */
}

export function emojiLocalName(url: string): string {
  let b = url.split('?')[0].split('/').pop() || '';
  if (!/\.(png|webp|gif|jpe?g)$/i.test(b)) b += '.png';
  return b;
}

export async function localizeEmoji(
  url: string,
  cookie = process.env.BILI_COOKIE ?? '',
): Promise<string> {
  const file = emojiLocalName(url);
  const target = path.join(EMOJI_DIR, file);
  const rel = `/emojis/${file}`;
  if (fs.existsSync(target)) return rel;
  const ok = await downloadImage(url, target, { cookie });
  return ok ? rel : url;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 把 rich_text_nodes 组合成 HTML：文字直接转义，emoji 替换为内联图片，
// 带 jump_url 的节点（@、话题、链接）包成 <a>。没有节点时降级为纯文本。
export async function buildContentHtml(
  nodes: any[] | undefined,
  fallbackText: string,
  cookie = process.env.BILI_COOKIE ?? '',
): Promise<string> {
  if (!nodes || nodes.length === 0) return escapeHtml(fallbackText);
  let html = '';
  for (const n of nodes) {
    const type: string = n.type ?? '';
    const text: string = n.text ?? '';
    if (type === 'RICH_TEXT_NODE_TYPE_TEXT') {
      html += escapeHtml(text);
    } else if (type === 'RICH_TEXT_NODE_TYPE_EMOJI') {
      const e = n.emoji ?? {};
      const url: string = e.icon_url || e.webp_url || e.gif_url || '';
      if (url) {
        const local = await localizeEmoji(url, cookie);
        const alt = escapeHtml(e.text || text || '');
        html += `<img class="dyn-emoji" src="${local}" alt="${alt}" title="${alt}"/>`;
      } else {
        html += escapeHtml(text);
      }
    } else if (n.jump_url) {
      const href = escapeHtml(n.jump_url.startsWith('//') ? 'https:' + n.jump_url : n.jump_url);
      html += `<a class="dyn-link" href="${href}" target="_blank" rel="noreferrer">${escapeHtml(text)}</a>`;
    } else {
      html += escapeHtml(text);
    }
  }
  return html;
}

// 评论正文里的表情包：B站评论用 content.emote 映射（键为 [名称] 字面量，
// 值为 { url, text }）。把 message 中的 [名称] 替换为内联 <img>。
export async function buildEmoteHtml(
  message: string,
  emote: Record<string, any> | undefined,
  cookie = process.env.BILI_COOKIE ?? '',
): Promise<string> {
  let html = escapeHtml(message ?? '');
  if (!emote) return html;
  for (const [token, info] of Object.entries(emote)) {
    const url: string = info?.url ?? '';
    if (!url) continue;
    const local = await localizeEmoji(url, cookie);
    const alt = escapeHtml(info?.text || token);
    const img = `<img class="dyn-emoji" src="${local}" alt="${alt}" title="${alt}"/>`;
    html = html.split(token).join(img);
  }
  return html;
}

// ---------- 内存缓存（带 TTL） ----------
interface CacheEntry {
  value: unknown;
  expire: number;
}
const cache = new Map<string, CacheEntry>();

async function cached<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expire > Date.now()) return hit.value as T;
  const value = await fetcher();
  cache.set(key, { value, expire: Date.now() + ttlMs });
  return value;
}

async function biliGet<T = any>(url: string): Promise<T> {
  const headers: Record<string, string> = {
    'User-Agent': UA,
    Referer: 'https://www.bilibili.com/',
    Accept: 'application/json',
  };
  const cookie = getBiliCookieSync();
  if (cookie) headers['Cookie'] = cookie;
  const res = await fetch(url, {
    headers,
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  });
  return (await res.json()) as T;
}

// 导出的通用 GET（与 biliGet 同请求头），供脚本直接调空间/标签等接口
export async function apiGet<T = any>(url: string): Promise<T | null> {
  return biliGet<T>(url);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------- 直播状态（免签，实测可用） ----------
export interface LiveStatus {
  liveStatus: number; // 1=直播中 0=未开播
  title: string | null;
  roomId: string | null;
  online: number | null;
  cover: string | null;
  url: string | null;
  liveTime: number | null;
  uid?: number;
}

// 按主播 uid 查开播状态（官方稳定接口，无需鉴权、无 -352 风控）
async function statusByUid(uid: number | string): Promise<LiveStatus | null> {
  try {
    const q = new URLSearchParams({ 'uids[]': String(uid) });
    const j = await fetch(
      `https://api.live.bilibili.com/room/v1/room/get_status_info_by_uids?${q.toString()}`,
      { headers: { 'User-Agent': UA, Referer: 'https://live.bilibili.com/' } },
    ).then((x) => x.json());
    const d = j?.data?.[String(uid)];
    if (j?.code === 0 && d) {
      return {
        liveStatus: d.live_status ?? 0,
        title: d.title ?? null,
        roomId: d.room_id ? String(d.room_id) : null,
        online: d.online ?? null,
        cover: null,
        url: d.url ?? null,
        liveTime: d.live_time ?? null,
        uid: Number(uid),
      };
    }
  } catch {
    /* ignore */
  }
  return null;
}

export async function getLiveStatus(): Promise<LiveStatus> {
  return cached('live', 30_000, async () => {
    const s = await statusByUid(UID);
    if (s) return s;
    return { liveStatus: 0, title: null, roomId: null, online: null, cover: null, url: null, liveTime: null };
  });
}

// 实时开播探测（绕过缓存，监控守护进程用）
export async function getLiveStatusRaw(): Promise<LiveStatus> {
  const s = await statusByUid(UID);
  if (s) return s;
  return { liveStatus: 0, title: null, roomId: null, online: null, cover: null, url: null, liveTime: null };
}

// 按房间号查开播状态（用于非李豆沙房间的试运行，如指定 MONITOR_ROOM_ID）。
// 优先用官方稳定接口 get_status_info_by_uids（按主播 uid 批量查询，无需鉴权、无 -352 风控），
// 该接口直接给出权威的 live_status(0未开播/1直播中/2轮播)、online、room_id、title；
// 仅当拿不到 uid 或接口失败时回退到直播间 HTML 解析作为兜底。
export async function getLiveStatusByRoom(roomId: string): Promise<LiveStatus> {
  const hdr = { 'User-Agent': UA, Referer: 'https://live.bilibili.com/' };
  let htmlStatus = -1;
  let htmlRoomId = roomId;
  let htmlUid: string | null = null;
  let htmlTitle: string | null = null;
  let htmlOnline: string | null = null;
  try {
    const r = await fetch(`https://live.bilibili.com/${roomId}`, {
      headers: hdr,
      signal: AbortSignal.timeout(15000),
    });
    const t = await r.text();
    const grab = (re: RegExp): string | null => {
      const m = t.match(re);
      return m ? m[1] : null;
    };
    const ls = grab(/"live_status"\s*:\s*(\d+)/);
    htmlRoomId = grab(/"room_id"\s*:\s*(\d+)/) ?? roomId;
    htmlUid = grab(/"uid"\s*:\s*(\d+)/);
    htmlTitle = grab(/"title"\s*:\s*"([^"]*)"/);
    htmlOnline = grab(/"online"\s*:\s*(\d+)/);
    htmlStatus = ls ? Number(ls) : -1;
  } catch {
    /* 忽略，走下方兜底 */
  }

  // 官方稳定接口复核（按 uid）
  if (htmlUid) {
    try {
      const q = new URLSearchParams({ 'uids[]': htmlUid });
      const j = await fetch(
        `https://api.live.bilibili.com/room/v1/room/get_status_info_by_uids?${q.toString()}`,
        { headers: hdr, signal: AbortSignal.timeout(15000) },
      ).then((x) => x.json());
      const d = j?.data?.[htmlUid];
      if (j?.code === 0 && d) {
        const decodeEsc = (s: string | null) =>
          s ? s.replace(/\\u([\dA-Fa-f]{4})/g, (_, c) => String.fromCharCode(parseInt(c, 16))) : null;
        return {
          liveStatus: d.live_status ?? htmlStatus,
          title: d.title ?? decodeEsc(htmlTitle),
          roomId: String(d.room_id ?? htmlRoomId),
          online: d.online ?? (htmlOnline ? Number(htmlOnline) : null),
          cover: null,
          url: `https://live.bilibili.com/${htmlRoomId}`,
          liveTime: d.live_time ?? null,
          uid: Number(htmlUid),
        };
      }
    } catch {
      /* 忽略，回退 HTML */
    }
  }

  // 兜底：HTML 解析状态（可能为 -1 表示探测失败）
  const decodeEsc = (s: string | null) =>
    s ? s.replace(/\\u([\dA-Fa-f]{4})/g, (_, c) => String.fromCharCode(parseInt(c, 16))) : null;
  return {
    liveStatus: htmlStatus,
    title: decodeEsc(htmlTitle),
    roomId: htmlRoomId,
    online: htmlOnline ? Number(htmlOnline) : null,
    cover: null,
    url: `https://live.bilibili.com/${htmlRoomId}`,
    liveTime: null,
    uid: htmlUid ? Number(htmlUid) : undefined,
  };
}

// 获取并缓存 buvid（B站风控要求的匿名标识），供弹幕接口等使用
let _buvid: string | null = null;
export async function ensureBuvidCookie(): Promise<string> {
  if (_buvid) return _buvid;
  try {
    const data = await biliGet<{
      code?: number;
      data?: { b_3?: string; b_4?: string; b_lsid?: string };
    }>('https://api.bilibili.com/x/frontend/finger/spi');
    if (data?.code === 0 && data.data) {
      const { b_3, b_4, b_lsid } = data.data;
      _buvid = `buvid3=${b_3 ?? ''}; buvid4=${b_4 ?? ''}${
        b_lsid ? `; b_lsid=${b_lsid}` : ''
      }`;
      return _buvid;
    }
  } catch {
    /* 忽略 */
  }
  return '';
}

// 含 buvid 的完整 Cookie（base + buvid）。注意：buvid 必须与取弹幕 token 时一致，
// 否则 B站会以 token 与 buvid 不匹配为由断开 WS（1006）。
export async function getBiliCookieWithBuvid(): Promise<string> {
  const buvid = await ensureBuvidCookie();
  const base = getBiliCookieSync();
  return base ? `${base}; ${buvid}` : buvid;
}

// 拿直播弹幕 WebSocket 的连接信息（token + 主机）。
// 需要 WBI 签名 + buvid cookie，否则 B站返回 -352 风控拦截。
export async function getDanmuInfo(
  roomId: string,
  cookie?: string,
): Promise<{ token: string; host: string; wssPort: number }> {
  const fallback = {
    token: '',
    host: 'broadcastlv.chat.bilibili.com',
    wssPort: 443,
  };
  try {
    const useCookie = cookie ?? (await getBiliCookieWithBuvid());
    const params = await signWbi({ id: roomId });
    const qs = new URLSearchParams(params).toString();
    const url = `https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo?${qs}`;
    const r = await fetch(url, {
      headers: {
        'User-Agent': UA,
        Referer: 'https://live.bilibili.com/',
        Cookie: useCookie,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(15000),
    });
    const data = (await r.json()) as {
      code?: number;
      data?: {
        token?: string;
        host_list?: Array<{ host?: string; wss_port?: number }>;
      };
    };
    if (data?.code === 0 && data.data) {
      const hl = data.data.host_list ?? [];
      const pick = hl.find((h) => h.wss_port) ?? hl[0] ?? {};
      return {
        token: data.data.token ?? '',
        host: pick.host ?? fallback.host,
        wssPort: pick.wss_port ?? fallback.wssPort,
      };
    }
  } catch {
    /* 回退默认主机 */
  }
  return fallback;
}

// ---------- 粉丝 / 关注（免签，实测可用） ----------
export interface FollowerStats {
  follower: number | null;
  following: number | null;
}

export async function getFollowerStats(): Promise<FollowerStats> {
  return cached('follower', 5 * 60_000, async () => {
    const data = await biliGet<{
      data?: { follower: number; following: number };
    }>(`https://api.bilibili.com/x/relation/stat?vmid=${UID}`);
    return {
      follower: data?.data?.follower ?? null,
      following: data?.data?.following ?? null,
    };
  });
}

// ---------- 大航海（舰长/提督/总督）分级数量 ----------
// B站 guard_level 约定：1=总督(最高) 2=提督 3=舰长(最低)。
// 需要 ruid + roomid + WBI 签名，逐页聚合。
export interface GuardCounts {
  captain: number; // 舰长
  admiral: number; // 提督
  governor: number; // 总督
  total: number;
}

export async function getGuardCounts(): Promise<GuardCounts> {
  const cookie = await getBiliCookieWithBuvid();
  const counts: GuardCounts = { captain: 0, admiral: 0, governor: 0, total: 0 };
  let page = 1;
  const maxPages = 50;
  while (page <= maxPages) {
    const params = await signWbi({
      roomid: ROOM_ID,
      ruid: UID,
      page: String(page),
      page_size: '29',
      web_location: '444.8',
    });
    const qs = new URLSearchParams(params).toString();
    const r = await fetch(
      `https://api.live.bilibili.com/xlive/app-room/v1/guardTab/topList?${qs}`,
      {
        headers: {
          'User-Agent': UA,
          Referer: 'https://live.bilibili.com/',
          Cookie: cookie,
        },
      },
    );
    const j = (await r.json()) as any;
    if (j?.code !== 0) break;
    const list: any[] = j?.data?.list || [];
    for (const it of list) {
      const lv = Number(it.guard_level ?? 0);
      if (lv === 1) counts.governor++; // 总督
      else if (lv === 2) counts.admiral++; // 提督
      else if (lv === 3) counts.captain++; // 舰长
    }
    const info = j?.data?.info || {};
    if (!list.length || (info.page && info.page <= page)) break;
    page++;
  }
  counts.total = counts.captain + counts.admiral + counts.governor;
  return counts;
}

// ---------- #李豆沙 标签（免签，实测可用） ----------
export interface TagStats {
  tagId: string | null;
  use: number | null; // 引用/投稿数
  atten: number | null;
  ctime: number | null; // 标签创建时间
}

export async function getTagStats(): Promise<TagStats> {
  return cached('tag', 10 * 60_000, async () => {
    const data = await biliGet<{
      data?: {
        tag_id: number;
        count?: { use: number; atten: number };
        ctime: number;
      };
    }>(`https://api.bilibili.com/x/tag/info?tag_name=${encodeURIComponent(TAG_NAME)}`);
    const d = data?.data;
    return {
      tagId: d?.tag_id ? String(d.tag_id) : null,
      use: d?.count?.use ?? null,
      atten: d?.count?.atten ?? null,
      ctime: d?.ctime ?? null,
    };
  });
}

// ---------- 搜索 #李豆沙 视频（免签，无需 WBI） ----------
export interface TagVideo {
  title: string;
  author: string;
  pubdate: number; // 秒级时间戳
  play: number;
  bvid: string;
  arcurl: string;
  pic?: string; // 封面（搜索接口自带，如 //i0.hdslb.com/bfs/archive/xxx.jpg）
}

export async function fetchAllTagVideos(
  maxPages = 50,
  verify = false,
  range?: { begin?: number; end?: number },
): Promise<TagVideo[]> {
  // 同时检索“李豆沙”与“礼豆沙”（CP 名），合并去重后按标题判定收录
  const seen = new Set<string>();
  const out: TagVideo[] = [];
  for (const kw of CLIP_KEYWORDS) {
    let page = 1;
    let lastPage = maxPages;
    let consecutiveEmpty = 0;
    while (page <= lastPage) {
      let list: Array<Record<string, any>> = [];
      let ok = false;
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const searchParams: Record<string, string> = {
            search_type: 'video',
            keyword: kw,
            page: String(page),
          };
          // 时间区间过滤（秒级）：仅返回该窗口内的投稿，配合增量起点使用
          if (range?.begin) searchParams.pubtime_begin_s = String(range.begin);
          if (range?.end) searchParams.pubtime_end_s = String(range.end);
          const params = await signWbi(searchParams);
          const qs = new URLSearchParams(params).toString();
          const data = await biliGet<{
            code?: number;
            data?: { result?: Array<Record<string, any>>; numPages?: number };
          }>(`https://api.bilibili.com/x/web-interface/wbi/search/type?${qs}`);
          if (data?.code === 0 && Array.isArray(data.data?.result)) {
            list = data.data.result;
            if (data.data.numPages) {
              lastPage = Math.min(maxPages, data.data.numPages);
            }
            ok = true;
            break;
          }
        } catch {
          /* 重试 */
        }
        await sleep(700 * (attempt + 1));
      }
      if (!ok || !list.length) {
        consecutiveEmpty += 1;
        if (consecutiveEmpty >= 5) break;
        page++;
        await sleep(800);
        continue;
      }
      consecutiveEmpty = 0;
      for (const v of list) {
        const bvid = v.bvid ?? '';
        if (!bvid || seen.has(bvid)) continue;
        const title = stripHtml(v.title ?? '');
        if (verify && !isRelevantTitle(title)) continue;
        seen.add(bvid);
        out.push({
          title,
          author: v.author ?? '',
          pubdate: Number(v.pubdate ?? 0),
          play: Number(v.play ?? 0),
          bvid,
          arcurl: v.arcurl ?? '',
          pic: v.pic ?? '',
        });
      }
      page++;
      await sleep(300);
    }
  }
  return out;
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, '');
}

// 切片检索词：裸词“豆沙”（覆盖所有 X豆沙 变体，便于发现新 CP 名）+ 已知罕见 CP 名
export const CLIP_KEYWORDS = ['豆沙', '李与春', 'lihiru'];
export function isRelevantTitle(title: string): boolean {
  const t = title.toLowerCase();
  return CLIP_KEYWORDS.some((k) => t.includes(k.toLowerCase()));
}

// 按 UP 名搜索其投稿，筛选标题命中「豆沙」相关词的切片（用于后台“补充切片”扫描）。
// 返回与 fetchAllTagVideos 相同的 TagVideo[]。
// 把用户输入（UP 名 / 空间链接 / 纯 UID）解析成 B站 mid。
// 空间列表接口（x/space/wbi/arc/search）必须按 mid 查，才能保证拿到该 UP 的全部投稿。
async function resolveUpMid(query: string): Promise<string | null> {
  const q = (query || '').trim();
  if (!q) return null;
  // 1) 纯数字 UID
  if (/^\d+$/.test(q)) return q;
  // 2) 空间链接 space.bilibili.com/<mid>
  const m = q.match(/space\.bilibili\.com\/(\d+)/);
  if (m) return m[1];
  // 3) 按 UP 名搜索用户，精确名优先，否则取首个
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const params = await signWbi({
        search_type: 'bili_user',
        keyword: q,
        page: '1',
      });
      const qs = new URLSearchParams(params).toString();
      const data = await biliGet<{
        code?: number;
        data?: { result?: Array<{ mid?: number; uname?: string }> };
      }>(`https://api.bilibili.com/x/web-interface/wbi/search/type?${qs}`);
      const users = data?.data?.result ?? [];
      if (users.length) {
        const exact = users.find(
          (u) => u.uname && u.uname.trim() === q.trim(),
        );
        const pick = exact || users[0];
        if (pick?.mid) return String(pick.mid);
      }
      break;
    } catch {
      await sleep(500 * (attempt + 1));
    }
  }
  return null;
}

// 按 UP（名 / 空间链接 / UID）补充切片：用空间投稿列表接口翻页拿全量投稿，
// 再筛标题命中「豆沙」相关词的切片。相比通用搜索，空间列表才是该 UP 的完整投稿。
export async function searchVideosByAuthor(
  query: string,
  maxPages = 100,
  keyword?: string,
): Promise<{ videos: TagVideo[]; total: number }> {
  const mid = await resolveUpMid(query);
  if (!mid) {
    console.log('[upscan] 无法解析 UP mid，输入=', query);
    return { videos: [], total: 0 };
  }
  console.log('[upscan] mid=', mid);
  // 标题筛选词：
  //  - keyword 未传或为空串 → 沿用李豆沙默认词（CLIP_KEYWORDS，即“豆沙”相关词）
  //  - keyword 为非空串 → 按逗号/空格分隔的自定义词筛选
  const terms =
    keyword === undefined || keyword.trim() === ''
      ? CLIP_KEYWORDS
      : keyword.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean);
  const out: TagVideo[] = [];
  const seen = new Set<string>();
  const ps = 50;
  let pn = 1;
  let totalUploads = 0;
  let lastCode: number | undefined;
  while (pn <= maxPages) {
    let list: Array<Record<string, any>> = [];
    let ok = false;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const params = await signWbi({
          mid,
          pn: String(pn),
          ps: String(ps),
        });
        const qs = new URLSearchParams(params).toString();
        const data = await biliGet<{
          code?: number;
          message?: string;
          data?: {
            list?: { vlist?: Array<Record<string, any>> };
            page?: { count?: number };
          };
        }>(`https://api.bilibili.com/x/space/wbi/arc/search?${qs}`);
        if (data?.code === 0 && data.data) {
          list = data.data.list?.vlist ?? [];
          if (pn === 1 && data.data.page?.count != null)
            totalUploads = Number(data.data.page.count);
          ok = true;
          break;
        }
        lastCode = data?.code;
        console.log('[upscan] arc 失败 code=', data?.code, data?.message);
      } catch {
        /* 重试 */
      }
      await sleep(700 * (attempt + 1));
    }
    if (!ok) {
      if (lastCode === -412 || lastCode === -799) {
        throw new Error(
          `B站接口被风控拦截(code=${lastCode})，请稍后重试（通常几分钟~几小时自动恢复）`,
        );
      }
      // 其它持久性失败（如 -101 未登录/cookie 失效、-404、限流等）：
      // 抛出以便上层感知，而不是静默返回 0 条导致误判。
      throw new Error(
        `B站接口异常(code=${lastCode ?? '网络错误'})，无法获取该 UP 投稿`,
      );
    }
    if (!list.length) break;
    for (const v of list) {
      const bvid = v.bvid ?? '';
      if (!bvid || seen.has(bvid)) continue;
      const title = stripHtml(v.title ?? '');
      const pass =
        terms.length === 0
          ? true
          : terms.some((k) => title.toLowerCase().includes(k.toLowerCase()));
      if (!pass) continue;
      seen.add(bvid);
      out.push({
        title,
        author: v.author ?? '',
        pubdate: Number(v.created ?? 0),
        play: Number(v.play ?? 0),
        bvid,
        arcurl:
          v.arcurl ?? (bvid ? `https://www.bilibili.com/video/${bvid}` : ''),
        pic: v.pic ?? '',
      });
    }
    if (pn * ps >= totalUploads) break; // 已翻完所有投稿
    pn++;
    await sleep(300);
  }
  console.log(`[upscan] 完成：mid=${mid} 空间投稿 ${totalUploads} 条，命中切片 ${out.length} 条`);
  return { videos: out, total: totalUploads };
}

// 单视频基础信息（含封面 pic + 统计，免签公开接口 x/web-interface/view），用于补封面与统计
export interface VideoInfo {
  pic: string;
  title: string;
  author: string;
  mid: number;
  pubdate: number;
  view: number;
  like: number;
  coin: number;
  share: number;
  favorite: number;
  reply: number;
  danmaku: number;
}

export async function getVideoInfo(bvid: string): Promise<VideoInfo | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const data = await biliGet<{
        code?: number;
        data?: {
          pic?: string;
          title?: string;
          pubdate?: number;
          owner?: { name?: string; mid?: number };
          stat?: {
            view?: number;
            like?: number;
            coin?: number;
            share?: number;
            favorite?: number;
            reply?: number;
            danmaku?: number;
          };
        };
      }>(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`);
      if (data?.code === 0 && data.data) {
        const s = data.data.stat ?? {};
        return {
          pic: data.data.pic ?? '',
          title: stripHtml(data.data.title ?? ''),
          author: data.data.owner?.name ?? '',
          mid: Number(data.data.owner?.mid ?? 0),
          pubdate: Number(data.data.pubdate ?? 0),
          view: Number(s.view ?? 0),
          like: Number(s.like ?? 0),
          coin: Number(s.coin ?? 0),
          share: Number(s.share ?? 0),
          favorite: Number(s.favorite ?? 0),
          reply: Number(s.reply ?? 0),
          danmaku: Number(s.danmaku ?? 0),
        };
      }
      // 不存在 / 稿件不可见：不再重试
      if (data?.code === -404 || data?.code === 62002 || data?.code === 16004) return null;
    } catch {
      /* 重试 */
    }
    await sleep(500 * (attempt + 1));
  }
  return null;
}

// ---------- 李豆沙全部动态（需 WBI + SESSDATA Cookie） ----------
export interface DynItem {
  id: string;
  name: string;
  face: string;
  pubTime: number;
  timeText: string;
  text: string;
  textHtml?: string; // 含表情包 <img> 的富文本（用于动态正文渲染）
  images: string[];
  video?: { cover: string; title: string; bvid: string };
  forward?: { name: string; text: string; textHtml?: string; images: string[] };
  stat: { like: string; forward: string; comment: string };
  commentId?: string; // 评论 oid（basic.comment_id_str），用于评论接口，≠ 动态 id
  commentType?: number; // 评论类型（basic.comment_type，动态一般为 11）
}

export interface DynPage {
  items: DynItem[];
  offset: string;
  hasMore: boolean;
}

// feed/all（带 host_mid）可拉取该用户的完整动态历史（含 2021 年），
// 而 feed/space 在新版接口下会截断到最近 ~1000 条。两者返回结构一致。
const DYN_FEATURES =
  'itemOpusStyle,listOnlyfans,opusBigCover,onlyfansVote,decorationCard,onlyfansAssetsV2,forwardListHidden,ugcDelete,onlyfansQaCard,commentsNewVersion,avatarAutoTheme,sunflowerStyle,cardsEnhance,eva3CardOpus,eva3CardVideo,eva3CardComment,eva3CardVote,eva3CardUser';
const DYN_LOCALE = JSON.stringify({
  c_locale: { language: 'zh', script: 'Hans' },
  always_translate: false,
});
const DYN_DEVICE = JSON.stringify({
  platform: 'web',
  device: 'pc',
  spmid: '0.0',
  mobi_app: 'web_cn',
});

export async function getDynamics(
  hostMid: string,
  sessdata: string,
  offset = '',
  page = 1,
): Promise<DynPage> {
  // 优先用完整 Cookie（env / 运行时设置）；仅当完全没有完整 Cookie 时，
  // 才用传入的 SESSDATA 拼装。避免 BILI_SESSDATA 占位值（非空但无效）
  // 抢占有效 BILI_COOKIE，导致接口返回 -412（request was banned）。
  const cookie = getBiliCookieSync() || (sessdata ? `SESSDATA=${sessdata}` : '');
  // 动态接口必须用 feed/space + WBI 签名（README 已记录）。
  // feed/all 在部分环境会被风控降级（返回空）或被 features 隐藏转发类动态，
  // 导致“增量同步拿不到最新动态”。feed/space 同时返回转发类与置顶动态。
  // 翻页用 offset（而非 page），offset='' 即第一页。
  const params = await signWbi({
    host_mid: hostMid,
    offset,
    platform: 'web',
    features: DYN_FEATURES,
    web_location: '0.0',
  });
  const qs = new URLSearchParams(params).toString();
  const url = `https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/space?${qs}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Referer: `https://space.bilibili.com/${hostMid}/dynamic`,
      Cookie: cookie,
      Accept: 'application/json',
      'x-bili-locale-json': DYN_LOCALE,
      'x-bili-device-req-json': DYN_DEVICE,
    } as Record<string, string>,
    cache: 'no-store',
    signal: AbortSignal.timeout(20000),
  });
  const data = await res.json();
  const items = (await Promise.all(
    (data?.data?.items ?? []).map((it: any) =>
      normalizeDynamicItem(it, cookie),
    ),
  )).filter((x: DynItem | null): x is DynItem => x !== null);
  // feed/space 的游标在 data.offset；page 仅作兼容保留。
  void page;
  return {
    items,
    offset: data?.data?.offset ?? '',
    hasMore: Boolean(data?.data?.has_more),
  };
}

async function normalizeDynamicItem(
  raw: any,
  cookie = process.env.BILI_COOKIE ?? '',
): Promise<DynItem | null> {
  try {
    const mods = raw?.modules ?? {};
    const author = mods.module_author ?? {};
    const dyn = mods.module_dynamic ?? {};
    const basic = author.basic ?? raw?.basic ?? {};
    const desc = dyn.desc ?? {};
    const major = dyn.major ?? {};
    const stat = mods.module_stat ?? {};

    let images: string[] = [];
    let video: DynItem['video'];
    if (major.type === 'MAJOR_TYPE_DRAW') {
      images = (major.draw?.items ?? [])
        .map((it: any) => it.src)
        .filter(Boolean);
    } else if (major.type === 'MAJOR_TYPE_ARCHIVE') {
      video = {
        cover: major.archive?.cover ?? '',
        title: major.archive?.title ?? '',
        bvid: major.archive?.bvid ?? '',
      };
    } else if (major.type === 'MAJOR_TYPE_OPUS' || major.opus) {
      // 图文/专栏：正文在 major.opus，pics 为配图
      images = (major.opus?.pics ?? [])
        .map((p: any) => p.url ?? p.src)
        .filter(Boolean);
    } else if (major.type === 'MAJOR_TYPE_LIVE_RCMD') {
      // 直播/直播回放动态：标题与封面在 live_play_info
      const live = major.live_play_info ?? {};
      video = {
        cover: live.cover ?? '',
        title: live.title ?? '',
        bvid: live.room_id ? `live/${live.room_id}` : '',
      };
    }
    // 正文兜底：图文/专栏动态正文在 major.opus.summary.text
    const opusText = (
      major.opus?.summary?.text ??
      major.opus?.text ??
      ''
    ).trim();
    const text =
      (desc.text ?? '').trim() || opusText || (major.opus?.title ?? '').trim();

    let forward: DynItem['forward'];
    const ref = dyn.additional?.reference;
    if (ref) {
      const rdesc = ref.modules?.module_dynamic?.desc ?? {};
      const rmajor = ref.modules?.module_dynamic?.major ?? {};
      const ropusText = (
        rmajor.opus?.summary?.text ??
        rmajor.opus?.text ??
        ''
      ).trim();
      forward = {
        name: ref.modules?.module_author?.name ?? '',
        text:
          (rdesc.text ?? '').trim() ||
          ropusText ||
          (rmajor.opus?.title ?? '').trim(),
        textHtml: await buildContentHtml(
          rdesc.rich_text_nodes ?? rmajor.opus?.summary?.rich_text_nodes,
          (rdesc.text ?? '').trim() || ropusText || (rmajor.opus?.title ?? '').trim(),
          cookie,
        ),
        images: [
          ...(rmajor.draw?.items ?? []).map((it: any) => it.src),
          ...(rmajor.opus?.pics ?? []).map((p: any) => p.url ?? p.src),
        ].filter(Boolean),
      };
    }

    // 正文富文本：优先用 rich_text_nodes（含表情包），否则降级纯文本
    const contentNodes =
      desc.rich_text_nodes ?? major.opus?.summary?.rich_text_nodes;
    const textHtml = await buildContentHtml(contentNodes, text, cookie);

    return {
      id: raw.id_str ?? String(raw.id ?? ''),
      name: author.name ?? '',
      face: author.face || AVATAR_URL,
      // pub_time 是展示串（如"8月2日"），真实时间戳在 pub_ts（秒）
      pubTime: Number(author.pub_ts) || 0,
      timeText: author.time_text || author.pub_time || '',
      text,
      textHtml,
      images,
      video,
      forward,
      // module_stat 的 like/forward/comment 是 { count } 对象，取 count
      stat: {
        like: String(stat.like?.count ?? 0),
        forward: String(stat.forward?.count ?? 0),
        comment: String(stat.comment?.count ?? 0),
      },
      commentId: basic.comment_id_str ? String(basic.comment_id_str) : undefined,
      commentType: basic.comment_type ? Number(basic.comment_type) : undefined,
    };
  } catch {
    return null;
  }
}

// ---------- WBI 签名（用于本人投稿列表 / 视频数据 / 动态） ----------
const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61,
  26, 17, 0, 1, 57, 56, 11, 36, 20, 34, 44, 22, 54, 21, 60, 51, 59, 6, 25, 52,
  4, 30, 62, 63,
];

let wbiKeys: { img: string; sub: string } | null = null;

async function getWbiKeys(): Promise<{ img: string; sub: string }> {
  if (wbiKeys) return wbiKeys;
  const data = await biliGet<{
    data?: { wbi_img?: { img_url: string; sub_url: string } };
  }>('https://api.bilibili.com/x/web-interface/nav');
  const wbi = data?.data?.wbi_img ?? { img_url: '', sub_url: '' };
  wbiKeys = { img: wbi.img_url, sub: wbi.sub_url };
  return wbiKeys;
}

function getMixinKey(orig: string): string {
  return MIXIN_KEY_ENC_TAB.map((n) => orig[n]).join('').slice(0, 32);
}

export async function signWbi(
  params: Record<string, string>,
): Promise<Record<string, string>> {
  const { img, sub } = await getWbiKeys();
  const imgKey = (img.split('/').pop() ?? '').split('.')[0];
  const subKey = (sub.split('/').pop() ?? '').split('.')[0];
  const mixin = getMixinKey(imgKey + subKey);
  const wts = Math.floor(Date.now() / 1000).toString();
  const signed: Record<string, string> = { ...params, wts };
  const sorted = Object.keys(signed)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(signed[k])}`)
    .join('&');
  const w_rid = crypto.createHash('md5').update(sorted + mixin).digest('hex');
  return { ...signed, w_rid };
}

// ---------- 动态评论（需 WBI，type=11 为动态） ----------
export interface BiliComment {
  rpid: string; // 评论 id
  oid: string; // 动态 id
  mid: string; // 评论者 uid
  uname: string; // 评论者昵称
  message: string; // 评论内容
  messageHtml?: string; // 含表情包 <img> 的富文本（评论正文渲染）
  ctime: number; // 发布时间戳（秒）
  like: number; // 点赞数
  parent: string; // 父评论 rpid，0 表示一级评论
  isSub: boolean; // 是否是对评论的回复（子回复）
  avatar: string; // 评论者头像（B站 face 地址）
  raw: any; // 原始请求对象（入库）
}

export interface CommentPageResult {
  comments: BiliComment[];
  nextPagination: string | null; // 下一页 pagination_str，null 表示已到末页
  isEnd: boolean;
  // 本页顶层评论中"有子回复"的（rpid + 子回复数），供调用方按需补全子回复
  rootsWithReplies: { rpid: string; count: number }[];
}

// 拉取单页动态评论。评论 API 为 x/v2/reply/wbi/main，需要 WBI 签名。
// 传 root 时表示拉取某条顶层评论下的子回复（分页），此时返回的都是子回复。
export async function getDynamicCommentsPage(
  oid: string,
  paginationStr = '{"offset":""}',
  type = 11,
  mode = 3,
  root?: string | number,
): Promise<CommentPageResult> {
  const params: Record<string, string> = {
    oid,
    type: String(type),
    mode: String(mode),
    pagination_str: paginationStr,
    plat: '1',
    web_location: '1315875',
    'x-bili-locale-json': JSON.stringify({
      c_locale: { language: 'zh', script: 'Hans' },
      always_translate: false,
    }),
  };
  if (root !== undefined && root !== null && root !== '') {
    params.root = String(root);
  }
  const signed = await signWbi(params);
  const qs = new URLSearchParams(signed).toString();
  const data = await biliGet<{
    code?: number;
    data?: {
      replies?: any[];
      cursor?: {
        is_end?: boolean;
        pagination_str?: string;
        pagination_reply?: { next_offset?: number };
        session_id?: string;
      };
    };
  }>(`https://api.bilibili.com/x/v2/reply/wbi/main?${qs}`);
  if (data?.code !== 0) {
    throw new Error(`评论获取失败 code=${data?.code}`);
  }
  const cookie = process.env.BILI_COOKIE ?? '';
  const replies = data.data?.replies ?? [];
  const comments: BiliComment[] = [];
  const rootsWithReplies: { rpid: string; count: number }[] = [];
  for (const r of replies) {
    const rpid = String(r.rpid ?? '');
    const parentNum = Number(r.parent ?? 0);
    // root 查询会把顶层评论(parent=0)一并混入 replies，必须跳过，否则会把顶层
    // 评论污染成 isSub=true 的游离节点；只保留真正的子回复(parent!=0)。
    if (root && parentNum === 0) continue;
    // 普通查询里 parent=0 的是顶层评论
    const isTop = !root && parentNum === 0;
    const isSub = Boolean(root) || !isTop;
    const parent = String(parentNum);
    const c = await normalizeComment(r, oid, parent, isSub, cookie);
    if (c) comments.push(c);
    if (isTop) {
      const cnt = Number(r.count ?? 0);
      const inlineCnt = r.replies?.length ?? 0;
      // 只要有子回复（按 count 或内联预览判断）就登记，稍后统一补全子回复
      if (cnt > 0 || inlineCnt > 0)
        rootsWithReplies.push({ rpid, count: cnt > 0 ? cnt : inlineCnt });
    }
    // 内联子回复（部分接口会附带）是 r 的直接回复，parent 应为 r 自身的 rpid
    for (const sub of r.replies ?? []) {
      const sc = await normalizeComment(sub, oid, rpid, true, cookie);
      if (sc) comments.push(sc);
    }
  }
  const cursor = data.data?.cursor;
  // 注意：cursor 里没有 pagination_str，真正的下一页游标在 pagination_reply.next_offset
  const pr = cursor?.pagination_reply;
  const nextOffset = pr?.next_offset;
  const nextPagination =
    cursor?.is_end || !nextOffset
      ? null
      : JSON.stringify({
          offset: nextOffset,
          session_id: cursor?.session_id ?? '',
        });
  return {
    comments,
    nextPagination,
    isEnd: Boolean(cursor?.is_end),
    rootsWithReplies,
  };
}

// 拉取某条顶层评论下的全部子回复（含多级嵌套）。
// 注意：x/v2/reply/wbi/main 的 root 参数实际上无效（只返回全局顶层），
// 真正能拉全子回复的是非签名的 x/v2/reply/reply 接口（按 pn 分页）。
export async function getDynamicSubReplies(
  oid: string,
  type: number,
  rootRpid: string,
  pn = 1,
  ps = 20,
): Promise<{ comments: BiliComment[]; total: number; isEnd: boolean }> {
  const params = {
    oid,
    type: String(type),
    root: String(rootRpid),
    pn: String(pn),
    ps: String(ps),
  };
  const qs = new URLSearchParams(params).toString();
  const url = `https://api.bilibili.com/x/v2/reply/reply?${qs}`;
  const cookie = process.env.BILI_COOKIE ?? '';
  const data = await biliGet<{
    code?: number;
    data?: { page?: { count?: number }; replies?: any[] };
  }>(url);
  if (data?.code !== 0) return { comments: [], total: 0, isEnd: true };
  const replies = data.data?.replies ?? [];
  const comments: BiliComment[] = [];
  for (const r of replies) {
    const rpid = String(r.rpid ?? '');
    const parent = String(r.parent ?? '0');
    const c = await normalizeComment(r, oid, parent, true, cookie);
    if (c) comments.push(c);
  }
  const total = Number(data.data?.page?.count ?? 0);
  const isEnd = replies.length === 0 || pn * ps >= total;
  return { comments, total, isEnd };
}

async function normalizeComment(
  r: any,
  oid: string,
  parent: string,
  isSub: boolean,
  cookie = process.env.BILI_COOKIE ?? '',
): Promise<BiliComment | null> {
  try {
    const message = (r.content?.message ?? r.message ?? '').trim();
    // 评论正文里的表情包（[xxx]）在 content.emote 映射中（键为 [名称] 字面量）。
    let messageHtml = '';
    try {
      messageHtml = await buildEmoteHtml(
        message,
        r.content?.emote ?? {},
        cookie,
      );
    } catch {
      messageHtml = '';
    }
    return {
      rpid: String(r.rpid ?? ''),
      oid,
      mid: String(r.member?.mid ?? ''),
      uname: (r.member?.uname ?? '').trim(),
      message,
      messageHtml,
      ctime: Number(r.ctime ?? 0),
      like: Number(r.like ?? 0),
      parent: isSub ? parent : String(r.parent ?? '0'),
      isSub,
      avatar: (r.member?.avatar || '').replace(/^http:/, 'https:'),
      raw: r,
    };
  } catch {
    return null;
  }
}

// 本人投稿列表（需 WBI，供后续"本人年度投稿"功能扩展）
export async function getChannelVideos(pn = 1, ps = 30): Promise<any[]> {
  const params = await signWbi({ mid: UID, pn: String(pn), ps: String(ps) });
  const qs = new URLSearchParams(params).toString();
  const data = await biliGet<{
    data?: { list?: { vlist?: any[] } };
  }>(`https://api.bilibili.com/x/space/wbi/arc/search?${qs}`);
  return data?.data?.list?.vlist ?? [];
}

// ---------- 直播回放列表（用于直播/唱歌/游戏时长统计） ----------
export type LiveCategory = 'sing' | 'game' | 'other';
export interface LiveSession {
  liveId: string;
  title: string;
  startTime: number;
  endTime: number;
  durationSec: number;
  category: LiveCategory;
}

// 直播回放列表来源：B站"系列/合集"接口（x/series/archives）。
// 官方 xlive 直播回放在当前版本已 404/失效，故改用 UP 主整理的"直播回放"合集。
// 每个回放视频自带 duration（秒），可直接求和得到直播时长；分类按标题关键词估算。
export const SERIES_ARCHIVES_API = 'https://api.bilibili.com/x/series/archives';

// ---------- 回放视频播放地址（用于抽取尾帧识别歌单） ----------
// 先取 cid，再走 WBI 签名的 playurl，优先返回合并音视频的 progressive（durl），
// 便于 ffmpeg 单输入直接截取末尾画面。
export async function getVideoCid(bvid: string): Promise<string | null> {
  const j = await biliGet<{ code?: number; data?: { cid?: number } }>(
    `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`,
  );
  if (j?.code !== 0) return null;
  return j.data?.cid ? String(j.data.cid) : null;
}

export async function getVideoPlayUrl(
  bvid: string,
  cid: string,
): Promise<string | null> {
  // 优先用普通 playurl 端点（带 Cookie/Referer 即可，不易被 WBI 风控 -412 拦截）；
  // WBI 版 playurl 常被风控，仅作兜底。
  const tryPlain = async () => {
    const qs = new URLSearchParams({
      bvid,
      cid,
      qn: '80',
      fnval: '0',
      fourk: '1',
    }).toString();
    const j = await apiGet<{
      code?: number;
      data?: { durl?: { url: string }[]; dash?: any };
    }>(`https://api.bilibili.com/x/player/playurl?${qs}`);
    return j;
  };
  const tryWbi = async () => {
    const params = await signWbi({ bvid, cid, qn: '80', fnval: '0', fourk: '1' });
    const qs = new URLSearchParams(params).toString();
    return apiGet<{
      code?: number;
      data?: { durl?: { url: string }[]; dash?: any };
    }>(`https://api.bilibili.com/x/player/wbi/playurl?${qs}`);
  };
  const tryParse = (j: any): string | null => {
    if (j?.code !== 0) return null;
    const durl = j.data?.durl;
    if (durl && durl.length > 0) return durl[0].url;
    const v: any[] = j.data?.dash?.video ?? [];
    return v.length ? v[0].baseUrl ?? v[0].url ?? null : null;
  };
  let j = await tryPlain();
  let url = tryParse(j);
  if (!url) {
    j = await tryWbi();
    url = tryParse(j);
  }
  return url;
}

function cookieHeader(): string {
  return (
    getBiliCookieSync() ||
    (getBiliSessSync() ? `SESSDATA=${getBiliSessSync()}` : '')
  );
}

// 按直播回放标题关键词粗略归类（唱歌 / 游戏 / 其他），为估算值，非精确。
// 优先级：游戏关键词（更具体）优先于唱歌；其余归为其他（闲聊/杂谈等）。
export function classifyLive(title: string): LiveCategory {
  const t = title || '';
  const game =
    /(游戏|实况|恐怖游戏|原神|星铁|绝区零|塞尔达|王国之泪|守望|apex|valorant|瓦罗兰特|mc|蛋仔|第五人格|黑神话|糖豆人|通关|速通|副本|boss|爆炸小队|战场|开黑|上分|联机|联动|大联动)/i;
  const sing =
    /(歌|唱|麦|歌会|演唱会|翻唱|清唱|合唱|听歌|点歌|歌单|ktv|公演|生日会|红白|术力口|歌杂|情歌|偶像歌)/i;
  if (game.test(t)) return 'game';
  if (sing.test(t)) return 'sing';
  return 'other';
}

export async function getLivePlayList(
  seriesId: number,
  mid: number,
  page = 1,
  pageSize = 30,
): Promise<{ items: LiveSession[]; hasMore: boolean }> {
  // 该接口对风控敏感，会间歇性返回 -400/-412，故加重试退避。
  const RETRIES = 5;
  let lastCode: number | string = 'n/a';
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    const qs = new URLSearchParams({
      series_id: String(seriesId),
      mid: String(mid),
      pn: String(page),
      ps: String(pageSize),
    }).toString();
    const res = await fetch(`${SERIES_ARCHIVES_API}?${qs}`, {
      headers: {
        'User-Agent': UA,
        Referer: 'https://www.bilibili.com/',
        Cookie: cookieHeader(),
        Accept: 'application/json',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(20000),
    });
    const data = (await res.json()) as any;
    lastCode = data?.code ?? res.status;
    if (data?.code === 0) {
      const list: any[] = data?.data?.archives ?? [];
      const total: number = data?.data?.page?.total ?? list.length;
      const items: LiveSession[] = list.map((a) => {
        const pub = Number(a.pubdate ?? 0);
        const dur = Number(a.duration ?? 0);
        return {
          liveId: String(a.bvid ?? ''),
          title: a.title ?? '',
          startTime: pub,
          endTime: pub + dur,
          durationSec: dur,
          category: classifyLive(a.title ?? ''),
        };
      });
      const hasMore = page * pageSize < total;
      return { items, hasMore };
    }
    // 非 0：风控/限流，退避后重试
    if (attempt < RETRIES) {
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  console.warn(`getLivePlayList 页 ${page} 重试耗尽，最后 code=${lastCode}`);
  return { items: [], hasMore: false };
}

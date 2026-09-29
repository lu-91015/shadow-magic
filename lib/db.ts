import pg from 'pg';
import fs from 'fs';
import path from 'path';
import type { DynItem, LiveSession, LiveCategory } from './bilibili';
import { AVATAR_URL } from './constants';

// ---------- 本地 .env 加载（tsx 脚本不会自动加载，Next 已加载时此函数自动跳过） ----------
(function loadEnv() {
  try {
    const f = path.join(process.cwd(), '.env');
    if (!fs.existsSync(f)) return;
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {
    /* 忽略 */
  }
})();

if (!process.env.POSTGRES_URL && process.env.DATABASE_URL) {
  process.env.POSTGRES_URL = process.env.DATABASE_URL;
}

// ---------- 连接池 ----------
let _pool: pg.Pool | null = null;
export function getPool(): pg.Pool {
  if (!_pool) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL 未设置（请填到 .env）');
    _pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  }
  return _pool;
}

// ---------- 建表（幂等） ----------
let _schema: Promise<void> | null = null;
export function ensureReady(): Promise<void> {
  if (!_schema) {
    _schema = (async () => {
      const p = getPool();
      await p.query(`
        CREATE TABLE IF NOT EXISTS video_stat (
          bvid TEXT PRIMARY KEY,
          title TEXT,
          author TEXT,
          pubdate BIGINT,
          "view" BIGINT,
          "like" BIGINT,
          coin BIGINT,
          share BIGINT,
          favorite BIGINT,
          reply BIGINT,
          danmaku BIGINT,
          arcurl TEXT,
          pic TEXT,
          tag_checked INTEGER NOT NULL DEFAULT 0,
          has_tag INTEGER NOT NULL DEFAULT 0
        )`);
      await p.query(`
        CREATE TABLE IF NOT EXISTS dyn (
          id TEXT PRIMARY KEY,
          content TEXT,
          pic TEXT,
          pubdate BIGINT,
          url TEXT,
          raw TEXT
        )`);
      await p.query(`
        CREATE TABLE IF NOT EXISTS playlist_song (
          id TEXT PRIMARY KEY,
          title TEXT,
          category TEXT,
          url TEXT,
          raw TEXT
        )`);
      await p.query(`
        CREATE TABLE IF NOT EXISTS snapshot (
          id SERIAL PRIMARY KEY,
          taken_at BIGINT,
          follower INTEGER,
          following INTEGER,
          tag_count INTEGER
        )`);
      await p.query(`
        CREATE TABLE IF NOT EXISTS live_session (
          id TEXT PRIMARY KEY,
          title TEXT,
          category TEXT,
          start_time BIGINT,
          end_time BIGINT,
          duration_sec INTEGER
        )`);
      await p.query(
        `ALTER TABLE live_session ADD COLUMN IF NOT EXISTS danmaku INTEGER`,
      );
      await p.query(`
        CREATE TABLE IF NOT EXISTS live_song (
          bvid TEXT NOT NULL,
          idx INTEGER NOT NULL,
          title TEXT NOT NULL,
          raw_text TEXT,
          created_at BIGINT,
          PRIMARY KEY (bvid, idx)
        )`);
      await p.query(
        `ALTER TABLE live_session ADD COLUMN IF NOT EXISTS songs_checked_at BIGINT`,
      );
      await p.query(`
        CREATE TABLE IF NOT EXISTS live_danmaku (
          dmid BIGINT PRIMARY KEY,
          bvid TEXT NOT NULL,
          cid BIGINT,
          sender TEXT,
          text TEXT,
          vtime DOUBLE PRECISION,
          sendtime BIGINT,
          raw TEXT
        )`);
      await p.query(
        `CREATE INDEX IF NOT EXISTS idx_live_danmaku_bvid ON live_danmaku(bvid)`,
      );
      await p.query(
        `CREATE INDEX IF NOT EXISTS idx_live_danmaku_sender ON live_danmaku(sender)`,
      );

      // ---------- 直播实时监控（常驻守护进程采集） ----------
      await p.query(`
        CREATE TABLE IF NOT EXISTS live_rt_session (
          id TEXT PRIMARY KEY,
          room_id TEXT,
          title TEXT,
          start_time BIGINT,
          end_time BIGINT,
          online_peak INTEGER,
          danmaku_count INTEGER,
          sc_count INTEGER,
          gift_count INTEGER,
          interact_count INTEGER,
          gift_coin BIGINT,
          duration_sec BIGINT
        )`);
      // 旧库兼容：补充每次直播的汇总列（守护进程下播时写入）
      await p.query(
        `ALTER TABLE live_rt_session ADD COLUMN IF NOT EXISTS danmaku_count INTEGER`,
      );
      await p.query(
        `ALTER TABLE live_rt_session ADD COLUMN IF NOT EXISTS sc_count INTEGER`,
      );
      await p.query(
        `ALTER TABLE live_rt_session ADD COLUMN IF NOT EXISTS gift_count INTEGER`,
      );
      await p.query(
        `ALTER TABLE live_rt_session ADD COLUMN IF NOT EXISTS interact_count INTEGER`,
      );
      await p.query(
        `ALTER TABLE live_rt_session ADD COLUMN IF NOT EXISTS gift_coin BIGINT`,
      );
      await p.query(
        `ALTER TABLE live_rt_session ADD COLUMN IF NOT EXISTS duration_sec BIGINT`,
      );
      await p.query(`
        CREATE TABLE IF NOT EXISTS live_rt_danmaku (
          id BIGSERIAL PRIMARY KEY,
          session_id TEXT,
          room_id TEXT,
          uid BIGINT,
          uname TEXT,
          text TEXT,
          color INTEGER,
          ts BIGINT,
          received_at BIGINT,
          raw JSONB
        )`);
      await p.query(
        `CREATE INDEX IF NOT EXISTS idx_live_rt_danmaku_sid ON live_rt_danmaku(session_id)`,
      );
      await p.query(`
        CREATE TABLE IF NOT EXISTS live_rt_sc (
          id BIGSERIAL PRIMARY KEY,
          session_id TEXT,
          room_id TEXT,
          sc_id BIGINT,
          uid BIGINT,
          uname TEXT,
          message TEXT,
          rmb INTEGER,
          price INTEGER,
          ts BIGINT,
          received_at BIGINT,
          raw JSONB
        )`);
      await p.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_live_rt_sc_id ON live_rt_sc(sc_id)`,
      );
      await p.query(
        `CREATE INDEX IF NOT EXISTS idx_live_rt_sc_sid ON live_rt_sc(session_id)`,
      );
      await p.query(`
        CREATE TABLE IF NOT EXISTS live_rt_gift (
          id BIGSERIAL PRIMARY KEY,
          session_id TEXT,
          room_id TEXT,
          uid BIGINT,
          uname TEXT,
          gift_id BIGINT,
          gift_name TEXT,
          num INTEGER,
          coin_type TEXT,
          total_coin BIGINT,
          action TEXT,
          combo_id TEXT,
          ts BIGINT,
          received_at BIGINT,
          raw JSONB
        )`);
      await p.query(
        `CREATE INDEX IF NOT EXISTS idx_live_rt_gift_sid ON live_rt_gift(session_id)`,
      );
      await p.query(`
        CREATE TABLE IF NOT EXISTS live_rt_interact (
          id BIGSERIAL PRIMARY KEY,
          session_id TEXT,
          room_id TEXT,
          uid BIGINT,
          uname TEXT,
          type TEXT,
          ts BIGINT,
          received_at BIGINT
        )`);
      await p.query(
        `CREATE INDEX IF NOT EXISTS idx_live_rt_interact_sid ON live_rt_interact(session_id)`,
      );
      // 同接（在线人数）时间序列：每 30s 采样一次，用于绘制同接曲线
      await p.query(`
        CREATE TABLE IF NOT EXISTS live_rt_online (
          id BIGSERIAL PRIMARY KEY,
          session_id TEXT,
          ts BIGINT,
          online INTEGER,
          received_at BIGINT
        )`);
      await p.query(
        `CREATE INDEX IF NOT EXISTS idx_live_rt_online_sid ON live_rt_online(session_id)`,
      );

      // ---------- 李豆沙 数据追踪（粉丝 / 大航海） ----------
      // 每小时粉丝数快照（hour = 整点时间戳，主键避免重复写入）
      await p.query(`
        CREATE TABLE IF NOT EXISTS stat_follower (
          hour BIGINT PRIMARY KEY,
          follower INTEGER,
          following INTEGER,
          captured_at BIGINT
        )`);
      // 每天大航海（舰长/提督/总督）快照（day = YYYY-MM-DD，主键；同一天多次采集覆盖）
      await p.query(`
        CREATE TABLE IF NOT EXISTS stat_guard (
          day TEXT PRIMARY KEY,
          captain INTEGER,
          admiral INTEGER,
          governor INTEGER,
          total INTEGER,
          captured_at BIGINT
        )`);

      await p.query(`
        CREATE TABLE IF NOT EXISTS dyn_comment (
          rpid BIGINT PRIMARY KEY,
          oid TEXT NOT NULL,
          mid TEXT,
          uname TEXT,
          message TEXT,
          message_html TEXT,
          ctime BIGINT,
          like_count INTEGER,
          parent BIGINT,
          is_sub BOOLEAN,
          avatar TEXT,
          raw JSONB,
          created_at TIMESTAMPTZ DEFAULT now()
        )`);
      // 旧库兼容：补列
      await p.query(
        `ALTER TABLE dyn_comment ADD COLUMN IF NOT EXISTS message_html TEXT`,
      );
      await p.query(
        `ALTER TABLE dyn_comment ADD COLUMN IF NOT EXISTS avatar TEXT`,
      );
      await p.query(
        `CREATE INDEX IF NOT EXISTS idx_dyn_comment_oid ON dyn_comment(oid)`,
      );
      await p.query(
        `CREATE INDEX IF NOT EXISTS idx_dyn_comment_mid ON dyn_comment(mid)`,
      );
      // 切片墙：视频封面列（搜索接口自带，旧库补列）
      await p.query(
        `ALTER TABLE video_stat ADD COLUMN IF NOT EXISTS pic TEXT`,
      );
      await p.query(
        `ALTER TABLE video_stat ADD COLUMN IF NOT EXISTS tag_checked INTEGER NOT NULL DEFAULT 0`,
      );
      await p.query(
        `ALTER TABLE video_stat ADD COLUMN IF NOT EXISTS has_tag INTEGER NOT NULL DEFAULT 0`,
      );

      // ---------- 后台管理扩展 ----------
      // 键值存储（存 B站 cookie / 设置）
      await p.query(`
        CREATE TABLE IF NOT EXISTS admin_kv (
          key TEXT PRIMARY KEY,
          value TEXT,
          updated_at BIGINT
        )`);
      // 定时任务
      await p.query(`
        CREATE TABLE IF NOT EXISTS job (
          id SERIAL PRIMARY KEY,
          type TEXT NOT NULL,
          name TEXT NOT NULL,
          cron TEXT NOT NULL,
          enabled BOOLEAN NOT NULL DEFAULT true,
          payload JSONB,
          created_at BIGINT,
          updated_at BIGINT
        )`);
      // 默认种子：李豆沙 数据追踪（每小时记录粉丝数 + 大航海），若不存在则创建
      await p.query(
        `INSERT INTO job (type, name, cron, enabled, created_at, updated_at)
         SELECT 'trackStats', '李豆沙数据追踪(粉丝/大航海)', '0 * * * *', true, EXTRACT(EPOCH FROM now())::bigint, EXTRACT(EPOCH FROM now())::bigint
         WHERE NOT EXISTS (SELECT 1 FROM job WHERE type='trackStats')`,
      );
      // 任务运行记录（状态 / 日志 / 报错 / 重试）
      await p.query(`
        CREATE TABLE IF NOT EXISTS job_run (
          id SERIAL PRIMARY KEY,
          job_id INTEGER,
          type TEXT,
          status TEXT,
          triggered_by TEXT,
          started_at BIGINT,
          finished_at BIGINT,
          error TEXT,
          log TEXT
        )`);
      await p.query(
        `CREATE INDEX IF NOT EXISTS idx_job_run_job ON job_run(job_id)`,
      );
      // 立绘（后台上传）
      await p.query(`
        CREATE TABLE IF NOT EXISTS character (
          id SERIAL PRIMARY KEY,
          name TEXT,
          src TEXT NOT NULL,
          caption TEXT,
          sort_order INTEGER DEFAULT 0,
          created_at BIGINT
        )`);
      // live_session 人工标记列
      await p.query(
        `ALTER TABLE live_session ADD COLUMN IF NOT EXISTS category_manual TEXT`,
      );
      await p.query(
        `ALTER TABLE live_session ADD COLUMN IF NOT EXISTS sing_duration INTEGER`,
      );
      await p.query(
        `ALTER TABLE live_session ADD COLUMN IF NOT EXISTS game_duration INTEGER`,
      );
      await p.query(
        `ALTER TABLE live_session ADD COLUMN IF NOT EXISTS note TEXT`,
      );
      await p.query(
        `ALTER TABLE live_session ADD COLUMN IF NOT EXISTS songs_override BOOLEAN DEFAULT false`,
      );
      await p.query(
        `ALTER TABLE live_session ADD COLUMN IF NOT EXISTS song_strategy TEXT DEFAULT 'merge'`,
      );
      // live_song 来源 / 排除（手动纠正、去垃圾）
      await p.query(
        `ALTER TABLE live_song ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'auto'`,
      );
      await p.query(
        `ALTER TABLE live_song ADD COLUMN IF NOT EXISTS excluded BOOLEAN DEFAULT false`,
      );
      // video_stat 手动补充标记
      await p.query(
        `ALTER TABLE video_stat ADD COLUMN IF NOT EXISTS manual INTEGER NOT NULL DEFAULT 0`,
      );
      // 操作审计日志
      await p.query(`CREATE TABLE IF NOT EXISTS admin_audit (
        id SERIAL PRIMARY KEY,
        actor TEXT,
        action TEXT,
        target TEXT,
        detail JSONB,
        ip TEXT,
        created_at BIGINT
      )`);
      // 切片黑名单：被删除/拉黑的切片记录于此，收集与展示均跳过，避免下次同步再次收集
      await p.query(`CREATE TABLE IF NOT EXISTS clip_block (
        bvid TEXT PRIMARY KEY,
        reason TEXT,
        actor TEXT,
        created_at BIGINT
      )`);
      // UP 黑名单：被拉黑的 UP 主，下次收集（upscan / upscanall）会整体跳过，
      // 且其已有切片会被删除（拉黑切片），不再展示与收集。
      await p.query(`CREATE TABLE IF NOT EXISTS blocked_up (
        author TEXT PRIMARY KEY,
        reason TEXT,
        actor TEXT,
        created_at BIGINT
      )`);
    })().catch((e) => {
      _schema = null;
      throw e;
    });
  }
  return _schema;
}

// ---------- 类型（与消费方保持一致） ----------
export interface VideoRow {
  bvid: string;
  title: string;
  author: string;
  pubdate: number;
  view: number;
  like: number;
  coin: number;
  share: number;
  favorite: number;
  reply: number;
  danmaku: number;
  arcurl: string;
  pic?: string;
}

export interface YearBucket {
  year: number;
  count: number;
  view: number;
  like: number;
  coin: number;
  share: number;
  favorite: number;
  reply: number;
  danmaku: number;
}

export interface YearlyTotals {
  count: number;
  view: number;
  like: number;
  coin: number;
  share: number;
  favorite: number;
  reply: number;
  danmaku: number;
  firstYear: number | null;
  lastYear: number | null;
}

export interface YearlyData {
  byYear: Record<string, YearBucket>;
  totals: YearlyTotals;
  total: number;
  updatedAt: number;
}

export interface Song {
  id: string;
  title: string;
  artist?: string;
  category: string;
  url: string;
  tags?: string[];
  raw?: any;
}

export interface PlaylistData {
  songs: Song[];
  categories: Record<string, Song[]>;
}

export interface DynamicsData {
  items: DynItem[];
  count: number;
  updatedAt: number;
}

export interface LiveStatsData {
  updatedAt: number;
  totalSec: number;
  totalCount: number;
  totalDanmaku: number;
  byCategory: Record<LiveCategory, { sec: number; count: number }>;
  byYear: Record<string, { sec: number; count: number }>;
  replays: {
    id: string;
    title: string;
    category: string;
    durationSec: number;
    danmaku: number;
  }[];
}

// ---------- 视频统计 ----------
export async function queryYearly(): Promise<YearlyData> {
  await ensureReady();
  const { rows } = await getPool().query<VideoRow>(
    'SELECT bvid, title, author, pubdate, "view", "like", coin, share, favorite, reply, danmaku, arcurl FROM video_stat',
  );
  const byYear: Record<string, YearBucket> = {};
  const totals: YearlyTotals = {
    count: 0,
    view: 0,
    like: 0,
    coin: 0,
    share: 0,
    favorite: 0,
    reply: 0,
    danmaku: 0,
    firstYear: null,
    lastYear: null,
  };
  for (const v of rows) {
    const year = new Date(Number(v.pubdate) * 1000).getFullYear();
    if (!byYear[year]) {
      byYear[year] = {
        year,
        count: 0,
        view: 0,
        like: 0,
        coin: 0,
        share: 0,
        favorite: 0,
        reply: 0,
        danmaku: 0,
      };
    }
    const b = byYear[year];
    b.count += 1;
    b.view += Number(v.view) || 0;
    b.like += Number(v.like) || 0;
    b.coin += Number(v.coin) || 0;
    b.share += Number(v.share) || 0;
    b.favorite += Number(v.favorite) || 0;
    b.reply += Number(v.reply) || 0;
    b.danmaku += Number(v.danmaku) || 0;
    totals.count += 1;
    totals.view += Number(v.view) || 0;
    totals.like += Number(v.like) || 0;
    totals.coin += Number(v.coin) || 0;
    totals.share += Number(v.share) || 0;
    totals.favorite += Number(v.favorite) || 0;
    totals.reply += Number(v.reply) || 0;
    totals.danmaku += Number(v.danmaku) || 0;
    if (totals.firstYear === null || year < totals.firstYear) totals.firstYear = year;
    if (totals.lastYear === null || year > totals.lastYear) totals.lastYear = year;
  }
  const snap = await getPool().query<{ t: string | null }>(
    'SELECT MAX(taken_at) AS t FROM snapshot',
  );
  const updatedAt = snap.rows[0]?.t ? Number(snap.rows[0].t) : Date.now();
  return { byYear, totals, total: totals.count, updatedAt };
}

export async function upsertVideo(
  v: VideoRow,
  hasTag = false,
): Promise<boolean> {
  await ensureReady();
  const res = await getPool().query(
    `INSERT INTO video_stat (bvid, title, author, pubdate, "view", "like", coin, share, favorite, reply, danmaku, arcurl, pic, has_tag, tag_checked)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,1)
     ON CONFLICT (bvid) DO UPDATE SET
       title=EXCLUDED.title, author=EXCLUDED.author, pubdate=EXCLUDED.pubdate,
       "view"=EXCLUDED."view",
       "like"=COALESCE(EXCLUDED."like", video_stat."like"),
       coin=COALESCE(EXCLUDED.coin, video_stat.coin),
       share=COALESCE(EXCLUDED.share, video_stat.share),
       favorite=COALESCE(EXCLUDED.favorite, video_stat.favorite),
       reply=COALESCE(EXCLUDED.reply, video_stat.reply),
       danmaku=COALESCE(EXCLUDED.danmaku, video_stat.danmaku),
       arcurl=EXCLUDED.arcurl,
       pic=COALESCE(EXCLUDED.pic, video_stat.pic),
       has_tag=EXCLUDED.has_tag, tag_checked=1 RETURNING (xmax = 0) AS inserted`,
    [
      v.bvid,
      v.title,
      v.author,
      v.pubdate,
      v.view,
      v.like,
      v.coin,
      v.share,
      v.favorite,
      v.reply,
      v.danmaku,
      v.arcurl,
      v.pic ?? null,
      hasTag ? 1 : 0,
    ],
  );
  return (res.rows[0]?.inserted ?? false) as boolean;
}

// 仅补封面/基础信息：不覆盖已有统计数据（用于 sync-covers 脚本）
export async function upsertVideoPic(v: {
  bvid: string;
  title: string;
  author: string;
  pubdate: number;
  arcurl: string;
  pic: string;
}): Promise<void> {
  await ensureReady();
  await getPool().query(
    `INSERT INTO video_stat (bvid, title, author, pubdate, "view", "like", coin, share, favorite, reply, danmaku, arcurl, pic)
     VALUES ($1,$2,$3,$4,0,0,0,0,0,0,0,$5,$6)
     ON CONFLICT (bvid) DO UPDATE SET
       title=EXCLUDED.title, author=EXCLUDED.author, pubdate=EXCLUDED.pubdate,
       arcurl=EXCLUDED.arcurl, pic=COALESCE(EXCLUDED.pic, video_stat.pic)`,
    [v.bvid, v.title, v.author, v.pubdate, v.arcurl, v.pic],
  );
}

// ---------- 切片墙 ----------
export interface ClipRow {
  bvid: string;
  title: string;
  author: string;
  pubdate: number;
  view: number;
  like: number;
  coin: number;
  arcurl: string;
  pic: string | null;
}

export interface ClipAuthorRow {
  author: string;
  count: number;
  view: number;
  like: number;
  coin: number;
  firstAt: number;
  lastAt: number;
}

// 仅返回标题命中“已确认保留”名号白名单的相关切片
import { CLIP_APPROVED_NAMES } from './constants';
const CLIP_TITLE_FILTER = CLIP_APPROVED_NAMES.map(
  (n) => `title ILIKE '%${n.replace(/'/g, "''")}%'`,
).join(' OR ');

export async function queryClips(): Promise<ClipRow[]> {
  await ensureReady();
  const { rows } = await getPool().query<ClipRow>(
    `SELECT bvid, title, author, pubdate, "view" AS view, "like" AS like, coin, arcurl, pic
     FROM video_stat WHERE ${CLIP_TITLE_FILTER} AND bvid NOT IN (SELECT bvid FROM clip_block) ORDER BY "view" DESC`,
  );
  return rows;
}

export async function queryClipAuthors(): Promise<ClipAuthorRow[]> {
  await ensureReady();
  const { rows } = await getPool().query<ClipAuthorRow>(
    `SELECT author, COUNT(*)::int AS count,
            SUM("view")::bigint AS view, SUM("like")::bigint AS like, SUM(coin)::bigint AS coin,
            MIN(pubdate) AS "firstAt", MAX(pubdate) AS "lastAt"
     FROM video_stat
     WHERE (${CLIP_TITLE_FILTER}) AND bvid NOT IN (SELECT bvid FROM clip_block) AND COALESCE(author, '') <> ''
     GROUP BY author ORDER BY count DESC, view DESC`,
  );
  return rows;
}

// ---------- 切片黑名单（删除即拉黑） ----------
export async function blockClip(
  bvid: string,
  reason?: string | null,
  actor = 'admin',
): Promise<void> {
  await ensureReady();
  await getPool().query(
    `INSERT INTO clip_block (bvid, reason, actor, created_at)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (bvid) DO UPDATE SET reason=EXCLUDED.reason, actor=EXCLUDED.actor, created_at=EXCLUDED.created_at`,
    [bvid, reason ?? null, actor, Date.now()],
  );
}

export async function unblockClip(bvid: string): Promise<void> {
  await ensureReady();
  await getPool().query('DELETE FROM clip_block WHERE bvid=$1', [bvid]);
}

export async function getBlockedBvids(): Promise<string[]> {
  await ensureReady();
  const { rows } = await getPool().query<{ bvid: string }>(
    'SELECT bvid FROM clip_block',
  );
  return rows.map((r) => r.bvid);
}

// ---------- UP 黑名单（拉黑 UP 主） ----------
// 拉黑一个 UP：记录到 blocked_up，并删除其全部已有切片（拉黑切片）。
// 由于 author 在 video_stat 中精确匹配，删除即视为“拉黑切片”；
// 后续收集（upscan / upscanall）也会跳过该 author。
export async function blockUp(
  author: string,
  reason?: string | null,
  actor = 'admin',
): Promise<number> {
  await ensureReady();
  const a = (author || '').trim();
  if (!a) return 0;
  const client = await getPool();
  await client.query(
    `INSERT INTO blocked_up (author, reason, actor, created_at)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (author) DO UPDATE SET reason=EXCLUDED.reason, actor=EXCLUDED.actor, created_at=EXCLUDED.created_at`,
    [a, reason ?? null, actor, Date.now()],
  );
  const res = await client.query<{ n: number }>(
    `DELETE FROM video_stat WHERE author=$1`,
    [a],
  );
  return res.rowCount ?? 0;
}

export async function unblockUp(author: string): Promise<void> {
  await ensureReady();
  await getPool().query('DELETE FROM blocked_up WHERE author=$1', [
    (author || '').trim(),
  ]);
}

export async function getBlockedUps(): Promise<
  { author: string; reason: string | null; created_at: number | null }[]
> {
  await ensureReady();
  const { rows } = await getPool().query<{
    author: string;
    reason: string | null;
    created_at: number | null;
  }>(`SELECT author, reason, created_at FROM blocked_up ORDER BY author`);
  return rows.map((r) => ({
    author: r.author,
    reason: r.reason,
    created_at: r.created_at ? Number(r.created_at) : null,
  }));
}

// 当前库里出现过的全部 UP（用于“按所有 UP 补充切片”的全量扫描）
export async function getDistinctAuthors(): Promise<string[]> {
  await ensureReady();
  const { rows } = await getPool().query<{ author: string }>(
    `SELECT DISTINCT author FROM video_stat WHERE COALESCE(author, '') <> '' ORDER BY author`,
  );
  return rows.map((r) => r.author);
}

// 后台“切片收集”列表：仅展示豆沙相关切片（标题命中白名单 或 手动添加），并排除已拉黑项
// 返回 list 与未截断的真实总数 total（表头计数用 total，避免被 LIMIT 截断而显示成 200）
export async function queryClipsAdmin(opts: {
  q?: string;
  author?: string;
  limit?: number;
  offset?: number;
  noCover?: boolean;
  exclude?: boolean;
} = {}): Promise<{ list: VideoAdminRow[]; total: number }> {
  await ensureReady();
  const conds: string[] = [
    `(${CLIP_TITLE_FILTER} OR manual = 1)`,
    'bvid NOT IN (SELECT bvid FROM clip_block)',
  ];
  const params: unknown[] = [];
  if (opts.q) {
    params.push(`%${opts.q}%`);
    const like = `title ILIKE $${params.length} OR author ILIKE $${params.length} OR bvid ILIKE $${params.length}`;
    conds.push(opts.exclude ? `NOT (${like})` : `(${like})`);
  }
  if (opts.author) {
    params.push(opts.author);
    conds.push(`author = $${params.length}`);
  }
  if (opts.noCover) {
    conds.push(`COALESCE(pic, '') = ''`);
  }
  const where = 'WHERE ' + conds.join(' AND ');
  const limit = Math.min(opts.limit ?? 1000, 5000);
  const offset = opts.offset ?? 0;
  const { rows } = await getPool().query<VideoAdminRow>(
    `SELECT bvid, title, author, pubdate, "view" AS view, "like" AS like, coin, share, favorite, reply, danmaku, arcurl, pic, manual, has_tag
     FROM video_stat ${where} ORDER BY "view" DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );
  const { rows: c } = await getPool().query<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM video_stat ${where}`,
    params,
  );
  return { list: rows, total: c[0]?.c ?? 0 };
}

// 单条视频标签核验结果写回
export async function updateVideoTag(bvid: string, hasTag: boolean): Promise<void> {
  await ensureReady();
  await getPool().query(
    `UPDATE video_stat SET has_tag = $2, tag_checked = 1 WHERE bvid = $1`,
    [bvid, hasTag ? 1 : 0],
  );
}

// 补/改单条视频封面
export async function updateVideoPic(bvid: string, pic: string): Promise<void> {
  await ensureReady();
  await getPool().query('UPDATE video_stat SET pic = $2 WHERE bvid = $1', [
    bvid,
    pic,
  ]);
}

// ---------- 动态 ----------
export async function queryDynamics(): Promise<DynamicsData> {
  await ensureReady();
  const { rows } = await getPool().query<{ raw: string; pubdate: string }>(
    'SELECT raw, pubdate FROM dyn ORDER BY pubdate DESC',
  );
  const items: DynItem[] = rows.map((r) => {
    const d = JSON.parse(r.raw) as DynItem;
    // 头像统一用本地文件：B站 CDN 热链有 referer 限制，历史入库的远程地址已失效
    d.face = AVATAR_URL;
    return d;
  });
  return { items, count: rows.length, updatedAt: Date.now() };
}

export async function getDynamicsCount(): Promise<number> {
  await ensureReady();
  const { rows } = await getPool().query<{ c: number }>(
    'SELECT COUNT(*)::int AS c FROM dyn',
  );
  return rows[0]?.c ?? 0;
}

export async function upsertDynamic(d: DynItem): Promise<void> {
  await ensureReady();
  const raw = JSON.stringify(d);
  const pic = d.images?.[0] ?? null;
  const url = `https://space.bilibili.com/${process.env.BILI_UID ?? ''}/dynamic/${d.id}`;
  await getPool().query(
    `INSERT INTO dyn (id, content, pic, pubdate, url, raw)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (id) DO UPDATE SET content=EXCLUDED.content, pic=EXCLUDED.pic, pubdate=EXCLUDED.pubdate, url=EXCLUDED.url, raw=EXCLUDED.raw`,
    [d.id, d.text, pic, Number(d.pubTime) || 0, url, raw],
  );
}

// 判断某条动态是否已入库（增量同步翻页终止条件用）
export async function existsDynamic(id: string): Promise<boolean> {
  await ensureReady();
  const { rows } = await getPool().query<{ c: number }>(
    'SELECT 1 AS c FROM dyn WHERE id=$1',
    [id],
  );
  return rows.length > 0;
}

// 读取已入库动态的原始 DynItem（用于增量同步时补更缺标题的直播回放类动态）
export async function getDynamicRaw(id: string): Promise<DynItem | null> {
  await ensureReady();
  const { rows } = await getPool().query<{ raw: string }>(
    'SELECT raw FROM dyn WHERE id=$1',
    [id],
  );
  if (!rows[0]?.raw) return null;
  try {
    return JSON.parse(rows[0].raw) as DynItem;
  } catch {
    return null;
  }
}

// ---------- 歌单 ----------
export async function queryPlaylist(): Promise<PlaylistData> {
  await ensureReady();
  const { rows } = await getPool().query<{ raw: string }>(
    'SELECT raw FROM playlist_song',
  );
  const songs: Song[] = rows.map((r) => JSON.parse(r.raw) as Song);
  const categories: Record<string, Song[]> = {};
  for (const s of songs) {
    (categories[s.category] ||= []).push(s);
  }
  return { songs, categories };
}

export async function replacePlaylist(songs: Song[]): Promise<void> {
  await ensureReady();
  const p = getPool();
  await p.query('DELETE FROM playlist_song');
  for (const s of songs) {
    await p.query(
      `INSERT INTO playlist_song (id, title, category, url, raw)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, category=EXCLUDED.category, url=EXCLUDED.url, raw=EXCLUDED.raw`,
      [s.id, s.title, s.category, s.url, JSON.stringify(s)],
    );
  }
}

// ---------- 每日快照 ----------
export async function insertSnapshot(
  follower: number | null,
  following: number | null,
  tagCount: number | null,
): Promise<void> {
  await ensureReady();
  await getPool().query(
    'INSERT INTO snapshot (taken_at, follower, following, tag_count) VALUES ($1,$2,$3,$4)',
    [Date.now(), follower ?? null, following ?? null, tagCount ?? null],
  );
}

// ---------- 直播回放 ----------
export async function clearLiveSessions(): Promise<void> {
  await ensureReady();
  await getPool().query('DELETE FROM live_session');
}

export async function upsertLiveSession(s: LiveSession): Promise<void> {
  await ensureReady();
  await getPool().query(
    `INSERT INTO live_session (id, title, category, start_time, end_time, duration_sec)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, category=EXCLUDED.category, start_time=EXCLUDED.start_time, end_time=EXCLUDED.end_time, duration_sec=EXCLUDED.duration_sec`,
    [s.liveId, s.title, s.category, s.startTime, s.endTime, s.durationSec],
  );
}

export async function queryLiveStats(): Promise<LiveStatsData> {
  await ensureReady();
  const { rows } = await getPool().query<{
    id: string;
    title: string;
    category: string;
    category_manual: string | null;
    start_time: string;
    end_time: string;
    duration_sec: number;
    danmaku: number | null;
  }>('SELECT id, title, category, category_manual, start_time, end_time, duration_sec, danmaku FROM live_session');
  let totalSec = 0;
  let totalCount = 0;
  let totalDanmaku = 0;
  const byCategory: Record<LiveCategory, { sec: number; count: number }> = {
    sing: { sec: 0, count: 0 },
    game: { sec: 0, count: 0 },
    other: { sec: 0, count: 0 },
  };
  const byYear: Record<string, { sec: number; count: number }> = {};
  const replays: LiveStatsData['replays'] = [];
  for (const r of rows) {
    const cat = ((r.category_manual as LiveCategory) || (r.category as LiveCategory) || 'other');
    const dur = Number(r.duration_sec) || 0;
    const dm = Number(r.danmaku ?? 0);
    totalSec += dur;
    totalCount += 1;
    totalDanmaku += dm;
    byCategory[cat].sec += dur;
    byCategory[cat].count += 1;
    const y = new Date(Number(r.start_time) * 1000).getFullYear();
    if (!byYear[y]) byYear[y] = { sec: 0, count: 0 };
    byYear[y].sec += dur;
    byYear[y].count += 1;
    replays.push({
      id: r.id,
      title: r.title,
      category: cat,
      durationSec: dur,
      danmaku: dm,
    });
  }
  replays.sort((a, b) => b.danmaku - a.danmaku || a.title.localeCompare(b.title));
  return {
    updatedAt: Date.now(),
    totalSec,
    totalCount,
    totalDanmaku,
    byCategory,
    byYear,
    replays,
  };
}

// 最近一场直播回放（按 start_time 倒序）
export async function queryLatestLiveSession(): Promise<{
  id: string;
  title: string | null;
  category: string | null;
  start_time: number;
  duration_sec: number;
} | null> {
  await ensureReady();
  const { rows } = await getPool().query<{
    id: string;
    title: string | null;
    category: string | null;
    start_time: string;
    duration_sec: number;
  }>(
    'SELECT id, title, category, start_time, duration_sec FROM live_session ORDER BY start_time DESC LIMIT 1',
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    title: r.title,
    category: r.category,
    start_time: Number(r.start_time),
    duration_sec: Number(r.duration_sec),
  };
}

// 更新某场回放的弹幕数（来自 view 接口 stat.danmaku）
export async function updateLiveSessionDanmaku(
  bvid: string,
  danmaku: number,
): Promise<void> {
  await ensureReady();
  await getPool().query(
    'UPDATE live_session SET danmaku = $2 WHERE id = $1',
    [bvid, danmaku],
  );
}

// ---------- 兼容旧调用（PG 为即时写入，无需文件缓冲） ----------
export async function flushStore(): Promise<void> {
  /* no-op for postgres */
}
export async function awaitSave(): Promise<void> {
  /* no-op for postgres */
}

// ---------- 歌回歌单（尾帧 OCR 识别） ----------
export interface LiveSongRow {
  bvid: string;
  idx: number;
  title: string;
  raw_text: string | null;
  created_at: number | null;
}

// 标记某场回放已完成歌单识别（无论是否识别到）
export async function markSongsChecked(bvid: string): Promise<void> {
  await ensureReady();
  await getPool().query(
    'UPDATE live_session SET songs_checked_at = $2 WHERE id = $1',
    [bvid, Date.now()],
  );
}

// 写入一场回放的歌单（先清后写，保证幂等）
export async function upsertLiveSongs(
  bvid: string,
  songs: string[],
  rawText: string,
): Promise<void> {
  await ensureReady();
  const p = getPool();
  await p.query('DELETE FROM live_song WHERE bvid = $1', [bvid]);
  for (let i = 0; i < songs.length; i++) {
    await p.query(
      `INSERT INTO live_song (bvid, idx, title, raw_text, created_at)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (bvid, idx) DO UPDATE SET title=EXCLUDED.title, raw_text=EXCLUDED.raw_text`,
      [bvid, i, songs[i], rawText, Date.now()],
    );
  }
}

export async function queryLiveSongs(bvid: string): Promise<LiveSongRow[]> {
  await ensureReady();
  const { rows } = await getPool().query<LiveSongRow>(
    'SELECT * FROM live_song WHERE bvid = $1 ORDER BY idx',
    [bvid],
  );
  return rows;
}

// 全部已识别回放 + 每场歌数（用于统计页与增量续跑）
export async function querySongStreams(): Promise<
  { bvid: string; title: string | null; songCount: number; checkedAt: number | null }[]
> {
  await ensureReady();
  const { rows } = await getPool().query<{
    bvid: string;
    title: string | null;
    songcount: string;
    checkedat: string | null;
  }>(
    `SELECT s.id AS bvid, s.title AS title,
            COALESCE(c.cnt,0)::int AS songcount, s.songs_checked_at AS checkedat
     FROM live_session s
     LEFT JOIN (SELECT bvid, COUNT(*) AS cnt FROM live_song GROUP BY bvid) c
       ON c.bvid = s.id
     ORDER BY s.start_time DESC`,
  );
  return rows.map((r) => ({
    bvid: r.bvid,
    title: r.title,
    songCount: Number(r.songcount),
    checkedAt: r.checkedat ? Number(r.checkedat) : null,
  }));
}

// 全站歌曲出现频次（用于热门歌曲榜）
export async function querySongFrequency(): Promise<
  { title: string; count: number }[]
> {
  await ensureReady();
  const { rows } = await getPool().query<{ title: string; count: string }>(
    `SELECT title, COUNT(*)::int AS count FROM live_song GROUP BY title ORDER BY count DESC, title`,
  );
  return rows.map((r) => ({ title: r.title, count: Number(r.count) }));
}

// ---------- 动态评论 ----------
import type { BiliComment } from './bilibili';

export interface CommentRow {
  rpid: string;
  oid: string;
  mid: string;
  uname: string;
  avatar?: string; // 评论者头像
  message: string;
  messageHtml?: string;
  ctime: number;
  like_count: number;
  parent: string;
  is_sub: boolean;
  created_at: string;
}

export interface CommenterStat {
  mid: string;
  uname: string;
  count: number; // 该用户评论数
  likes: number; // 该用户评论获赞合计
  lastCtime: number; // 最近评论时间
}

// PostgreSQL UTF-8 不接受 NUL(0x00) 字节，会导致 22021 编码错误，入库前清洗
function pgText(s: string | null | undefined): string | null {
  if (s == null) return null;
  return s.replace(/\0/g, '');
}

export async function upsertComment(c: BiliComment): Promise<void> {
  await ensureReady();
  await getPool().query(
    `      INSERT INTO dyn_comment (rpid, oid, mid, uname, message, message_html, ctime, like_count, parent, is_sub, avatar, raw)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (rpid) DO UPDATE SET
       oid=EXCLUDED.oid, mid=EXCLUDED.mid, uname=EXCLUDED.uname, message=EXCLUDED.message,
       message_html=EXCLUDED.message_html,
       ctime=EXCLUDED.ctime, like_count=EXCLUDED.like_count, parent=EXCLUDED.parent,
       is_sub=EXCLUDED.is_sub, avatar=EXCLUDED.avatar, raw=EXCLUDED.raw`,
    [
      BigInt(c.rpid),
      c.oid,
      pgText(c.mid) ?? '',
      pgText(c.uname) ?? '',
      pgText(c.message) ?? '',
      pgText(c.messageHtml),
      c.ctime,
      c.like,
      BigInt(c.parent || '0'),
      c.isSub,
      pgText(c.avatar),
      pgText(JSON.stringify(c.raw ?? c)),
    ],
  );
}

// 评论数统计（按用户分组），支持按动态过滤；用于"谁回复的评论、评论次数"分析。
export async function queryCommenterStats(oid?: string): Promise<CommenterStat[]> {
  await ensureReady();
  const { rows } = await getPool().query<{
    mid: string;
    uname: string;
    count: string;
    likes: string;
    last_ctime: string;
  }>(
    `SELECT mid, uname, COUNT(*)::int AS count,
            COALESCE(SUM(like_count),0)::int AS likes,
            MAX(ctime)::int AS last_ctime
     FROM dyn_comment
     ${oid ? 'WHERE oid = $1' : ''}
     GROUP BY mid, uname
     ORDER BY count DESC, likes DESC`,
    oid ? [oid] : [],
  );
  return rows.map((r) => ({
    mid: r.mid,
    uname: r.uname,
    count: Number(r.count),
    likes: Number(r.likes),
    lastCtime: Number(r.last_ctime),
  }));
}

// 评论列表查询（按动态 / 动态集合 / 用户 / 关键词过滤，倒序分页），供页面检索。
export async function queryComments(opts: {
  oid?: string;
  oids?: string[];
  mid?: string;
  q?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<CommentRow[]> {
  await ensureReady();
  const conds: string[] = [];
  const params: unknown[] = [];
  if (opts.oid) {
    params.push(opts.oid);
    conds.push(`oid = $${params.length}`);
  } else if (opts.oids && opts.oids.length) {
    params.push(opts.oids);
    conds.push(`oid = ANY($${params.length})`);
  }
  if (opts.mid) {
    params.push(opts.mid);
    conds.push(`mid = $${params.length}`);
  }
  if (opts.q) {
    params.push(`%${opts.q}%`);
    conds.push(`message ILIKE $${params.length}`);
  }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const limit = Math.min(opts.limit ?? 200, 500);
  const offset = opts.offset ?? 0;
  params.push(limit, offset);
  const { rows } = await getPool().query<{
    rpid: string;
    oid: string;
    mid: string;
    uname: string;
    avatar: string | null;
    message: string;
    message_html: string;
    ctime: string;
    like_count: number;
    parent: string;
    is_sub: boolean;
    created_at: string;
  }>(
    `    SELECT rpid, oid, mid, uname, avatar, message, message_html, ctime, like_count, parent, is_sub, created_at
     FROM dyn_comment ${where}
     ORDER BY ctime DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return rows.map((r) => ({
    rpid: String(r.rpid),
    oid: r.oid,
    mid: r.mid,
    uname: r.uname,
    avatar: r.avatar ?? undefined,
    message: r.message,
    messageHtml: r.message_html,
    ctime: Number(r.ctime),
    like_count: Number(r.like_count),
    parent: String(r.parent),
    is_sub: r.is_sub,
    created_at: r.created_at,
  }));
}

// 各动态评论数（动态 id -> 评论数），用于页面下拉筛选。
export async function queryCommentDynamics(): Promise<
  { oid: string; count: number }[]
> {
  await ensureReady();
  const { rows } = await getPool().query<{ oid: string; count: string }>(
    `SELECT oid, COUNT(*)::int AS count FROM dyn_comment GROUP BY oid ORDER BY count DESC`,
  );
  return rows.map((r) => ({ oid: r.oid, count: Number(r.count) }));
}

export async function getCommentCount(
  oid?: string,
  oids?: string[],
): Promise<number> {
  await ensureReady();
  let sql = 'SELECT COUNT(*)::int AS c FROM dyn_comment';
  const params: unknown[] = [];
  if (oid) {
    params.push(oid);
    sql += ' WHERE oid=$1';
  } else if (oids && oids.length) {
    params.push(oids);
    sql += ' WHERE oid = ANY($1)';
  }
  const { rows } = await getPool().query<{ c: number }>(sql, params);
  return rows[0]?.c ?? 0;
}

// ---------- 直播弹幕 ----------
export interface DanmakuRow {
  dmid: string;
  bvid: string;
  sender: string;
  text: string;
  vtime: number;
  sendtime: number;
}

// 批量写入弹幕（按 dmid 去重，可重复运行补全）
export async function bulkInsertDanmaku(
  rows: {
    dmid: string;
    bvid: string;
    cid?: string;
    sender: string;
    text: string;
    vtime: number;
    sendtime: number;
    raw?: string;
  }[],
): Promise<void> {
  if (!rows.length) return;
  await ensureReady();
  const p = getPool();
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const vals: unknown[] = [];
    const placeholders: string[] = [];
    slice.forEach((r, idx) => {
      const base = idx * 8;
      placeholders.push(
        `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8})`,
      );
      vals.push(
        BigInt(r.dmid),
        r.bvid,
        r.cid ? BigInt(r.cid) : null,
        r.sender,
        r.text,
        r.vtime,
        r.sendtime,
        r.raw ?? null,
      );
    });
    await p.query(
      `INSERT INTO live_danmaku (dmid, bvid, cid, sender, text, vtime, sendtime, raw)
       VALUES ${placeholders.join(',')}
       ON CONFLICT (dmid) DO NOTHING`,
      vals,
    );
  }
}

// 弹幕发送人排行（按发送条数），支持按单场回放过滤
export async function queryDanmakuSenders(bvid?: string): Promise<
  { sender: string; count: number }[]
> {
  await ensureReady();
  const { rows } = await getPool().query<{ sender: string; count: string }>(
    `SELECT sender, COUNT(*)::int AS count FROM live_danmaku
     ${bvid ? 'WHERE bvid=$1' : ''}
     GROUP BY sender ORDER BY count DESC LIMIT 50`,
    bvid ? [bvid] : [],
  );
  return rows.map((r) => ({ sender: r.sender, count: Number(r.count) }));
}

// 高频弹幕文本排行（按出现次数），支持按单场回放过滤
export async function queryDanmakuPhrases(bvid?: string): Promise<
  { text: string; count: number }[]
> {
  await ensureReady();
  const { rows } = await getPool().query<{ text: string; count: string }>(
    `SELECT text, COUNT(*)::int AS count FROM live_danmaku
     WHERE text <> ''
     ${bvid ? 'AND bvid=$1' : ''}
     GROUP BY text ORDER BY count DESC LIMIT 50`,
    bvid ? [bvid] : [],
  );
  return rows.map((r) => ({ text: r.text, count: Number(r.count) }));
}

// 统计包含某关键词的弹幕条数（如"打call"），支持按单场回放过滤
export async function countDanmakuPhrase(
  q: string,
  bvid?: string,
): Promise<number> {
  await ensureReady();
  const { rows } = await getPool().query<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM live_danmaku WHERE text ILIKE $1
     ${bvid ? 'AND bvid=$2' : ''}`,
    bvid ? [`%${q}%`, bvid] : [`%${q}%`],
  );
  return rows[0]?.c ?? 0;
}

export async function getDanmakuCount(bvid?: string): Promise<number> {
  await ensureReady();
  const { rows } = await getPool().query<{ c: number }>(
    bvid
      ? 'SELECT COUNT(*)::int AS c FROM live_danmaku WHERE bvid=$1'
      : 'SELECT COUNT(*)::int AS c FROM live_danmaku',
    bvid ? [bvid] : [],
  );
  return rows[0]?.c ?? 0;
}

// 取某场回放的弹幕文本行（按时间排序），支持关键词过滤与分页，用于后台展示。
export async function queryDanmakuLines(
  bvid: string,
  opts: { limit?: number; offset?: number; q?: string } = {},
): Promise<{ total: number; rows: DanmakuRow[] }> {
  await ensureReady();
  const limit = Math.min(opts.limit ?? 200, 1000);
  const offset = opts.offset ?? 0;
  const q = opts.q?.trim();
  const conds = ['bvid=$1'];
  const params: unknown[] = [bvid];
  if (q) {
    conds.push('text ILIKE $2');
    params.push(`%${q}%`);
  }
  const where = conds.join(' AND ');
  const { rows: t } = await getPool().query<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM live_danmaku WHERE ${where}`,
    params,
  );
  const { rows } = await getPool().query<DanmakuRow>(
    `SELECT dmid, bvid, sender, text, vtime, sendtime
     FROM live_danmaku WHERE ${where}
     ORDER BY vtime ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );
  return { total: t[0]?.c ?? 0, rows };
}

export async function getDanmakuSenderCount(): Promise<number> {
  await ensureReady();
  const { rows } = await getPool().query<{ c: number }>(
    'SELECT COUNT(DISTINCT sender)::int AS c FROM live_danmaku',
  );
  return rows[0]?.c ?? 0;
}

// ---------- 直播实时监控：写入 / 查询 ----------
export interface RtSession {
  id: string;
  room_id: string;
  title: string | null;
  start_time: number;
  end_time: number | null;
  online_peak: number | null;
}

export async function upsertRtSession(s: RtSession): Promise<void> {
  await ensureReady();
  await getPool().query(
    `INSERT INTO live_rt_session (id, room_id, title, start_time, end_time, online_peak)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, end_time=EXCLUDED.end_time, online_peak=EXCLUDED.online_peak`,
    [s.id, s.room_id, s.title, s.start_time, s.end_time, s.online_peak],
  );
}

// 直播中周期性回写人气峰值，便于后台实时展示
export async function updateRtSessionPeak(id: string, peak: number): Promise<void> {
  await ensureReady();
  await getPool().query(
    `UPDATE live_rt_session SET online_peak = GREATEST(online_peak, $2) WHERE id=$1`,
    [id, peak],
  );
}

// 下播收尾：写入结束时间、人气峰值，并汇总本场事件计数与礼物币、时长
export async function finishRtSession(
  id: string,
  endTs: number,
  onlinePeak: number,
  counts: {
    danmaku: number;
    sc: number;
    gift: number;
    interact: number;
    giftCoin: number;
  },
): Promise<void> {
  await ensureReady();
  await getPool().query(
    `UPDATE live_rt_session
     SET end_time=$2,
         online_peak=$3,
         danmaku_count=$4,
         sc_count=$5,
         gift_count=$6,
         interact_count=$7,
         gift_coin=$8,
         duration_sec = CASE WHEN start_time IS NOT NULL THEN $2 - start_time ELSE NULL END
     WHERE id=$1`,
    [
      id,
      endTs,
      onlinePeak,
      counts.danmaku,
      counts.sc,
      counts.gift,
      counts.interact,
      counts.giftCoin,
    ],
  );
}

// 每次直播的汇总记录（按开播时间倒序），用于后台"直播实时监控记录"
export async function queryRtSessions(limit = 100): Promise<any[]> {
  await ensureReady();
  const { rows } = await getPool().query<{
    id: string;
    room_id: string | null;
    title: string | null;
    start_time: string | null;
    end_time: string | null;
    online_peak: number | null;
    danmaku_count: number | null;
    sc_count: number | null;
    gift_count: number | null;
    interact_count: number | null;
    enter_count: number | null;
    follow_count: number | null;
    gift_coin: string | null;
    duration_sec: string | null;
  }>(
    `SELECT id, room_id, title, start_time, end_time, online_peak, duration_sec,
            COALESCE(danmaku_count, (SELECT COUNT(*) FROM live_rt_danmaku WHERE session_id=live_rt_session.id), 0) AS danmaku_count,
            COALESCE(sc_count, (SELECT COUNT(*) FROM live_rt_sc WHERE session_id=live_rt_session.id), 0) AS sc_count,
            COALESCE(gift_count, (SELECT COUNT(*) FROM live_rt_gift WHERE session_id=live_rt_session.id), 0) AS gift_count,
            COALESCE(interact_count, (SELECT COUNT(*) FROM live_rt_interact WHERE session_id=live_rt_session.id), 0) AS interact_count,
            (SELECT COUNT(*) FROM live_rt_interact WHERE session_id=live_rt_session.id AND type='enter') AS enter_count,
            (SELECT COUNT(*) FROM live_rt_interact WHERE session_id=live_rt_session.id AND type='follow') AS follow_count,
            COALESCE(gift_coin, (SELECT COALESCE(SUM(total_coin),0) FROM live_rt_gift WHERE session_id=live_rt_session.id), 0) AS gift_coin
     FROM live_rt_session
     ORDER BY start_time DESC
     LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({
    id: r.id,
    roomId: r.room_id,
    title: r.title,
    start: r.start_time ? Number(r.start_time) : null,
    end: r.end_time ? Number(r.end_time) : null,
    onlinePeak: r.online_peak ? Number(r.online_peak) : 0,
    danmaku: r.danmaku_count ? Number(r.danmaku_count) : 0,
    sc: r.sc_count ? Number(r.sc_count) : 0,
    gift: r.gift_count ? Number(r.gift_count) : 0,
    interact: r.interact_count ? Number(r.interact_count) : 0,
    enter: r.enter_count ? Number(r.enter_count) : 0,
    follow: r.follow_count ? Number(r.follow_count) : 0,
    giftCoin: r.gift_coin ? Number(r.gift_coin) : 0,
    durationSec: r.duration_sec ? Number(r.duration_sec) : null,
  }));
}

// 单场直播明细（弹幕 / 醒目留言 / 礼物 / 互动 / 同接曲线），用于后台"查看明细"
export async function queryRtDetail(sessionId: string, danmakuLimit = 5000): Promise<{
  danmaku: { uid: number; uname: string; text: string; color: number | null; ts: number }[];
  sc: { uid: number; uname: string; message: string; rmb: number; price: number; ts: number }[];
  gift: {
    uid: number;
    uname: string;
    gift_name: string;
    num: number;
    coin_type: string;
    total_coin: number;
    action: string;
    ts: number;
  }[];
  interact: { uid: number; uname: string; type: string; ts: number }[];
  online: { ts: number; online: number }[];
  danmakuTotal: number;
}> {
  await ensureReady();
  const pool = getPool();
  const [{ rows: dm }, { rows: sc }, { rows: gf }, { rows: it }, { rows: dmCount }] =
    await Promise.all([
      pool.query<{ uid: string; uname: string; text: string; color: number | null; ts: string }>(
        `SELECT uid, uname, text, color, ts FROM live_rt_danmaku
         WHERE session_id=$1 ORDER BY ts ASC LIMIT $2`,
        [sessionId, danmakuLimit],
      ),
      pool.query<{ uid: string; uname: string; message: string; rmb: number; price: number; ts: string }>(
        `SELECT uid, uname, message, rmb, price, ts FROM live_rt_sc
         WHERE session_id=$1 ORDER BY ts ASC`,
        [sessionId],
      ),
      pool.query<{
        uid: string;
        uname: string;
        gift_name: string;
        num: number;
        coin_type: string;
        total_coin: number;
        action: string;
        ts: string;
      }>(
        `SELECT uid, uname, gift_name, num, coin_type, total_coin, action, ts
         FROM live_rt_gift WHERE session_id=$1 ORDER BY ts ASC`,
        [sessionId],
      ),
      pool.query<{ uid: string; uname: string; type: string; ts: string }>(
        `SELECT uid, uname, type, ts FROM live_rt_interact
         WHERE session_id=$1 ORDER BY ts ASC`,
        [sessionId],
      ),
      pool.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM live_rt_danmaku WHERE session_id=$1`,
        [sessionId],
      ),
    ]);
  const toNum = (v: string) => (v == null ? 0 : Number(v));
  return {
    danmaku: dm.map((r) => ({ uid: Number(r.uid), uname: r.uname, text: r.text, color: r.color, ts: toNum(r.ts) })),
    sc: sc.map((r) => ({
      uid: Number(r.uid),
      uname: r.uname,
      message: r.message,
      // BIGINT/NUMERIC 列 node-pg 返回字符串，统一转 number，避免上层 reduce 拼接
      rmb: Number(r.rmb),
      price: Number(r.price),
      ts: toNum(r.ts),
    })),
    gift: gf.map((r) => ({
      uid: Number(r.uid),
      uname: r.uname,
      gift_name: r.gift_name,
      num: Number(r.num),
      coin_type: r.coin_type,
      total_coin: Number(r.total_coin),
      action: r.action,
      ts: toNum(r.ts),
    })),
    interact: it.map((r) => ({ uid: Number(r.uid), uname: r.uname, type: r.type, ts: toNum(r.ts) })),
    online: await queryRtOnline(sessionId),
    danmakuTotal: dmCount[0] ? toNum(dmCount[0].c) : 0,
  };
}

// ---------- 李豆沙 数据追踪：写入 / 查询 ----------
// hour 传整点时间戳（秒），同小时多次写入覆盖。
export async function upsertFollowerStat(
  hour: number,
  follower: number | null,
  following: number | null,
): Promise<void> {
  await ensureReady();
  await getPool().query(
    `INSERT INTO stat_follower (hour, follower, following, captured_at)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (hour) DO UPDATE SET follower=EXCLUDED.follower, following=EXCLUDED.following, captured_at=EXCLUDED.captured_at`,
    [hour, follower, following, Math.floor(Date.now() / 1000)],
  );
}

// 返回最近一条粉丝快照（用于补写缺口时沿用上一个已知值）
export async function getLastFollowerStat(): Promise<{
  hour: number;
  follower: number | null;
  following: number | null;
} | null> {
  await ensureReady();
  const { rows } = await getPool().query(
    `SELECT hour, follower, following FROM stat_follower ORDER BY hour DESC LIMIT 1`,
  );
  return rows[0]
    ? { hour: Number(rows[0].hour), follower: rows[0].follower, following: rows[0].following }
    : null;
}

// day 传 YYYY-MM-DD，同一天多次采集覆盖（保留当天最后一次）。
export async function upsertGuardStat(
  day: string,
  captain: number,
  admiral: number,
  governor: number,
  total: number,
): Promise<void> {
  await ensureReady();
  await getPool().query(
    `INSERT INTO stat_guard (day, captain, admiral, governor, total, captured_at)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (day) DO UPDATE SET captain=EXCLUDED.captain, admiral=EXCLUDED.admiral, governor=EXCLUDED.governor, total=EXCLUDED.total, captured_at=EXCLUDED.captured_at`,
    [day, captain, admiral, governor, total, Math.floor(Date.now() / 1000)],
  );
}

export async function queryFollowerStats(limit = 200): Promise<
  { hour: number; follower: number | null; following: number | null }[]
> {
  await ensureReady();
  const { rows } = await getPool().query<{
    hour: string;
    follower: number | null;
    following: number | null;
  }>(
    `SELECT hour, follower, following FROM stat_follower ORDER BY hour DESC LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({
    hour: Number(r.hour),
    follower: r.follower,
    following: r.following,
  }));
}

export async function queryGuardStats(limit = 200): Promise<
  { day: string; captain: number; admiral: number; governor: number; total: number }[]
> {
  await ensureReady();
  const { rows } = await getPool().query<{
    day: string;
    captain: number;
    admiral: number;
    governor: number;
    total: number;
  }>(
    `SELECT day, captain, admiral, governor, total FROM stat_guard ORDER BY day DESC LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({
    day: r.day,
    captain: Number(r.captain),
    admiral: Number(r.admiral),
    governor: Number(r.governor),
    total: Number(r.total),
  }));
}

// 时间戳规范化兜底：B站弹幕/礼物字段混用毫秒与秒（如 DANMU_MSG info[0][4] 为毫秒、
// SEND_GIFT_V2 field10 为毫秒），上游若漏除 1000 会写入"公元 5 万年"的脏时间。
// 1e12 秒 = 公元 33668 年，故 ts > 1e12 必为毫秒，统一转秒。
function normTs(ts: number): number {
  return ts > 1e12 ? Math.floor(ts / 1000) : ts;
}

export async function insertRtDanmaku(r: {
  session_id: string;
  room_id: string;
  uid: number;
  uname: string;
  text: string;
  color: number;
  ts: number;
  raw?: unknown;
}): Promise<void> {
  await ensureReady();
  await getPool().query(
    `INSERT INTO live_rt_danmaku (session_id, room_id, uid, uname, text, color, ts, received_at, raw)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      r.session_id,
      r.room_id,
      r.uid,
      r.uname,
      r.text,
      r.color,
      normTs(r.ts),
      Math.floor(Date.now() / 1000),
      r.raw != null ? JSON.stringify(r.raw) : null,
    ],
  );
}

export async function insertRtSc(r: {
  session_id: string;
  room_id: string;
  sc_id: number;
  uid: number;
  uname: string;
  message: string;
  rmb: number;
  price: number;
  ts: number;
  raw?: unknown;
}): Promise<void> {
  await ensureReady();
  await getPool().query(
    `INSERT INTO live_rt_sc (session_id, room_id, sc_id, uid, uname, message, rmb, price, ts, received_at, raw)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (sc_id) DO NOTHING`,
    [
      r.session_id,
      r.room_id,
      r.sc_id,
      r.uid,
      r.uname,
      r.message,
      r.rmb,
      r.price,
      normTs(r.ts),
      Math.floor(Date.now() / 1000),
      r.raw != null ? JSON.stringify(r.raw) : null,
    ],
  );
}

export async function insertRtGift(r: {
  session_id: string;
  room_id: string;
  uid: number;
  uname: string;
  gift_id: number;
  gift_name: string;
  num: number;
  coin_type: string;
  total_coin: number;
  action: string;
  combo_id: string;
  ts: number;
  raw?: unknown;
}): Promise<void> {
  await ensureReady();
  await getPool().query(
    `INSERT INTO live_rt_gift (session_id, room_id, uid, uname, gift_id, gift_name, num, coin_type, total_coin, action, combo_id, ts, received_at, raw)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      r.session_id,
      r.room_id,
      r.uid,
      r.uname,
      r.gift_id,
      r.gift_name,
      r.num,
      r.coin_type,
      r.total_coin,
      r.action,
      r.combo_id,
      normTs(r.ts),
      Math.floor(Date.now() / 1000),
      r.raw != null ? JSON.stringify(r.raw) : null,
    ],
  );
}

export async function insertRtInteract(r: {
  session_id: string;
  room_id: string;
  uid: number;
  uname: string;
  type: string;
  ts: number;
}): Promise<void> {
  await ensureReady();
  await getPool().query(
    `INSERT INTO live_rt_interact (session_id, room_id, uid, uname, type, ts, received_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      r.session_id,
      r.room_id,
      r.uid,
      r.uname,
      r.type,
      normTs(r.ts),
      Math.floor(Date.now() / 1000),
    ],
  );
}

// 当前进行中的实时监控会话（end_time 为空），可按房间过滤
export async function getRtActiveSession(roomId?: string): Promise<RtSession | null> {
  await ensureReady();
  const { rows } = await getPool().query<RtSession>(
    `SELECT * FROM live_rt_session WHERE end_time IS NULL ${
      roomId ? 'AND room_id = $1' : ''
    } ORDER BY start_time DESC LIMIT 1`,
    roomId ? [roomId] : [],
  );
  return rows[0] ?? null;
}

// 写入一次同接（在线人数）采样点
export async function insertRtOnline(
  sessionId: string,
  ts: number,
  online: number,
): Promise<void> {
  await ensureReady();
  await getPool().query(
    `INSERT INTO live_rt_online (session_id, ts, online, received_at)
     VALUES ($1,$2,$3,$4)`,
    [sessionId, ts, online, Date.now()],
  );
}

// 读取某会话的同接时间序列（按时间升序）
export async function queryRtOnline(sessionId: string): Promise<{ ts: number; online: number }[]> {
  await ensureReady();
  const { rows } = await getPool().query<{ ts: string; online: number }>(
    `SELECT ts, online FROM live_rt_online WHERE session_id=$1 ORDER BY ts ASC`,
    [sessionId],
  );
  return rows.map((r) => ({ ts: Number(r.ts), online: Number(r.online) }));
}

// 某会话的各类型实时事件计数（含礼物币总额）
export async function getRtCounts(sessionId: string): Promise<{
  danmaku: number;
  sc: number;
  gift: number;
  interact: number;
  enter: number;
  follow: number;
  giftCoin: number;
}> {
  await ensureReady();
  const p = getPool();
  const q = (tbl: string) =>
    p.query<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM ${tbl} WHERE session_id=$1`,
      [sessionId],
    );
  const [d, s, g, i, gc] = await Promise.all([
    q('live_rt_danmaku'),
    q('live_rt_sc'),
    q('live_rt_gift'),
    // 互动按 type 拆分：进入(enter)/关注(follow)单独计，其余归入总数
    p.query<{ c: number; enter: number; follow: number }>(
      `SELECT COUNT(*)::int AS c,
              COUNT(*) FILTER (WHERE type='enter')::int AS enter,
              COUNT(*) FILTER (WHERE type='follow')::int AS follow
       FROM live_rt_interact WHERE session_id=$1`,
      [sessionId],
    ),
    p.query<{ s: string | null }>(
      `SELECT COALESCE(SUM(total_coin),0)::text AS s FROM live_rt_gift WHERE session_id=$1`,
      [sessionId],
    ),
  ]);
  return {
    danmaku: d.rows[0]?.c ?? 0,
    sc: s.rows[0]?.c ?? 0,
    gift: g.rows[0]?.c ?? 0,
    interact: i.rows[0]?.c ?? 0,
    enter: i.rows[0]?.enter ?? 0,
    follow: i.rows[0]?.follow ?? 0,
    giftCoin: Number(gc.rows[0]?.s ?? 0),
  };
}

// 按房间号删除全部实时监控场次及明细（用于测试数据清理）
export async function deleteRtByRoom(roomId: string): Promise<number> {
  await ensureReady();
  const pool = getPool();
  await pool.query('DELETE FROM live_rt_danmaku WHERE room_id=$1', [roomId]);
  await pool.query('DELETE FROM live_rt_sc WHERE room_id=$1', [roomId]);
  await pool.query('DELETE FROM live_rt_gift WHERE room_id=$1', [roomId]);
  await pool.query('DELETE FROM live_rt_interact WHERE room_id=$1', [roomId]);
  const { rowCount } = await pool.query(
    'DELETE FROM live_rt_session WHERE room_id=$1',
    [roomId],
  );
  return rowCount ?? 0;
}

// ---------- 后台：键值存储（cookie / 设置） ----------
export async function getKv(key: string): Promise<string | null> {
  await ensureReady();
  const { rows } = await getPool().query<{ value: string }>(
    'SELECT value FROM admin_kv WHERE key = $1',
    [key],
  );
  return rows[0]?.value ?? null;
}

export async function setKv(key: string, value: string): Promise<void> {
  await ensureReady();
  await getPool().query(
    `INSERT INTO admin_kv (key, value, updated_at) VALUES ($1,$2,$3)
     ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=EXCLUDED.updated_at`,
    [key, value, Date.now()],
  );
}

// ---------- 后台：定时任务 ----------
export interface JobRow {
  id: number;
  type: string;
  name: string;
  cron: string;
  enabled: boolean;
  payload: any;
  created_at: number;
  updated_at: number;
  lastStatus?: string | null;
  lastFinishedAt?: number | null;
}

export async function queryJobs(): Promise<JobRow[]> {
  await ensureReady();
  const { rows } = await getPool().query<{
    id: number;
    type: string;
    name: string;
    cron: string;
    enabled: boolean;
    payload: any;
    created_at: string;
    updated_at: string;
    last_status: string | null;
    last_finished: string | null;
  }>(
    `SELECT j.*,
       (SELECT status FROM job_run WHERE job_run.job_id = j.id ORDER BY id DESC LIMIT 1) AS last_status,
       (SELECT finished_at FROM job_run WHERE job_run.job_id = j.id ORDER BY id DESC LIMIT 1) AS last_finished
     FROM job j ORDER BY j.id`,
  );
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    name: r.name,
    cron: r.cron,
    enabled: r.enabled,
    payload: r.payload,
    created_at: Number(r.created_at),
    updated_at: Number(r.updated_at),
    lastStatus: r.last_status,
    lastFinishedAt: r.last_finished ? Number(r.last_finished) : null,
  }));
}

export async function getJob(id: number): Promise<JobRow | null> {
  await ensureReady();
  const { rows } = await getPool().query<any>('SELECT * FROM job WHERE id=$1', [id]);
  if (!rows.length) return null;
  const r = rows[0];
  return {
    id: r.id,
    type: r.type,
    name: r.name,
    cron: r.cron,
    enabled: r.enabled,
    payload: r.payload,
    created_at: Number(r.created_at),
    updated_at: Number(r.updated_at),
  };
}

export async function createJob(j: {
  type: string;
  name: string;
  cron: string;
  enabled?: boolean;
  payload?: any;
}): Promise<number> {
  await ensureReady();
  const { rows } = await getPool().query<{ id: number }>(
    `INSERT INTO job (type, name, cron, enabled, payload, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$6) RETURNING id`,
    [
      j.type,
      j.name,
      j.cron,
      j.enabled ?? true,
      JSON.stringify(j.payload ?? {}),
      Date.now(),
    ],
  );
  return rows[0].id;
}

export async function updateJob(
  id: number,
  patch: Partial<{ name: string; cron: string; enabled: boolean; payload: any }>,
): Promise<void> {
  await ensureReady();
  const sets: string[] = [];
  const params: unknown[] = [id];
  if (patch.name !== undefined) sets.push(`name=$${params.push(patch.name)}`);
  if (patch.cron !== undefined) sets.push(`cron=$${params.push(patch.cron)}`);
  if (patch.enabled !== undefined)
    sets.push(`enabled=$${params.push(patch.enabled)}`);
  if (patch.payload !== undefined)
    sets.push(`payload=$${params.push(JSON.stringify(patch.payload))}`);
  sets.push(`updated_at=${params.push(Date.now())}`);
  await getPool().query(`UPDATE job SET ${sets.join(',')} WHERE id=$1`, params);
}

export async function deleteJob(id: number): Promise<void> {
  await ensureReady();
  await getPool().query('DELETE FROM job WHERE id=$1', [id]);
}

export interface JobRunRow {
  id: number;
  job_id: number | null;
  type: string | null;
  status: string;
  triggered_by: string | null;
  started_at: number;
  finished_at: number | null;
  error: string | null;
  log: string | null;
}

export async function createJobRun(params: {
  job_id: number | null;
  type: string;
  triggered_by: string;
}): Promise<number> {
  await ensureReady();
  const { rows } = await getPool().query<{ id: number }>(
    `INSERT INTO job_run (job_id, type, status, triggered_by, started_at)
     VALUES ($1,$2,'running',$3,$4) RETURNING id`,
    [params.job_id, params.type, params.triggered_by, Date.now()],
  );
  return rows[0].id;
}

export async function finishJobRun(
  id: number,
  status: 'success' | 'failed' | 'cancelled',
  error?: string,
  log?: string,
): Promise<void> {
  await ensureReady();
  // 追加最终状态行，而不是覆盖过程中 appendJobLog 累积的日志。
  await getPool().query(
    `UPDATE job_run SET status=$2, error=$3, log=COALESCE(log,'') || COALESCE($4,''), finished_at=$5 WHERE id=$1`,
    [id, status, error ?? null, log ?? null, Date.now()],
  );
}

export async function appendJobLog(id: number, chunk: string): Promise<void> {
  await ensureReady();
  await getPool().query(
    `UPDATE job_run SET log = COALESCE(log,'') || $2 WHERE id=$1`,
    [id, chunk],
  );
}

export async function queryJobRuns(opts: {
  jobId?: number;
  limit?: number;
} = {}): Promise<JobRunRow[]> {
  await ensureReady();
  const params: unknown[] = [];
  let where = '';
  if (opts.jobId) {
    params.push(opts.jobId);
    where = `WHERE job_id=$1`;
  }
  params.push(Math.min(opts.limit ?? 50, 200));
  const { rows } = await getPool().query<{
    id: number;
    job_id: number | null;
    type: string | null;
    status: string;
    triggered_by: string | null;
    started_at: string;
    finished_at: string | null;
    error: string | null;
    log: string | null;
  }>(
    `SELECT * FROM job_run ${where} ORDER BY id DESC LIMIT $${params.length}`,
    params,
  );
  return rows.map((r) => ({
    id: r.id,
    job_id: r.job_id,
    type: r.type,
    status: r.status,
    triggered_by: r.triggered_by,
    started_at: Number(r.started_at),
    finished_at: r.finished_at ? Number(r.finished_at) : null,
    error: r.error,
    log: r.log,
  }));
}

// ---------- 后台：立绘 ----------
export interface CharacterRow {
  id: number;
  name: string | null;
  src: string;
  caption: string | null;
  sort_order: number;
  created_at: number;
}

export async function queryCharacters(): Promise<CharacterRow[]> {
  await ensureReady();
  const { rows } = await getPool().query<{
    id: number;
    name: string | null;
    src: string;
    caption: string | null;
    sort_order: number;
    created_at: string;
  }>('SELECT * FROM character ORDER BY sort_order, id');
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    src: r.src,
    caption: r.caption,
    sort_order: r.sort_order,
    created_at: Number(r.created_at),
  }));
}

export async function insertCharacter(c: {
  name?: string | null;
  src: string;
  caption?: string | null;
  sort_order?: number;
}): Promise<number> {
  await ensureReady();
  const { rows } = await getPool().query<{ id: number }>(
    `INSERT INTO character (name, src, caption, sort_order, created_at)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [c.name ?? null, c.src, c.caption ?? null, c.sort_order ?? 0, Date.now()],
  );
  return rows[0].id;
}

export async function deleteCharacter(id: number): Promise<void> {
  await ensureReady();
  await getPool().query('DELETE FROM character WHERE id=$1', [id]);
}

// ---------- 后台：直播回放人工标记 ----------
export async function updateLiveSessionMeta(
  bvid: string,
  patch: {
    categoryManual?: string | null;
    singDuration?: number | null;
    gameDuration?: number | null;
    note?: string | null;
    songsOverride?: boolean | null;
    songStrategy?: string | null;
  },
): Promise<void> {
  await ensureReady();
  const sets: string[] = [];
  const params: unknown[] = [bvid];
  if (patch.categoryManual !== undefined)
    sets.push(`category_manual=$${params.push(patch.categoryManual)}`);
  if (patch.singDuration !== undefined)
    sets.push(`sing_duration=$${params.push(patch.singDuration)}`);
  if (patch.gameDuration !== undefined)
    sets.push(`game_duration=$${params.push(patch.gameDuration)}`);
  if (patch.note !== undefined) sets.push(`note=$${params.push(patch.note)}`);
  if (patch.songsOverride !== undefined)
    sets.push(`songs_override=$${params.push(patch.songsOverride)}`);
  if (patch.songStrategy !== undefined)
    sets.push(`song_strategy=$${params.push(patch.songStrategy)}`);
  if (!sets.length) return;
  await getPool().query(
    `UPDATE live_session SET ${sets.join(',')} WHERE id=$1`,
    params,
  );
}

// ---------- 后台：直播回放管理查询 ----------
export interface LiveAdminRow {
  bvid: string;
  title: string | null;
  category: string | null;
  categoryManual: string | null;
  startTime: number;
  endTime: number;
  durationSec: number;
  danmaku: number | null;
  singDuration: number | null;
  gameDuration: number | null;
  note: string | null;
  songsOverride: boolean;
  songStrategy: string;
  songCount: number;
  checked: boolean;
  // 与实时监控(live_rt_session)按开播时间就近对齐后的指标（未被监控的场次为 null）
  rtOnlinePeak: number | null;
  rtSc: number | null;
  rtGift: number | null;
  rtGiftCoin: number | null;
  rtInteract: number | null;
}

export async function queryLiveSessionsAdmin(): Promise<LiveAdminRow[]> {
  await ensureReady();
  const { rows } = await getPool().query<{
    id: string;
    title: string | null;
    category: string | null;
    category_manual: string | null;
    start_time: string;
    end_time: string;
    duration_sec: number;
    danmaku: number | null;
    sing_duration: number | null;
    game_duration: number | null;
    note: string | null;
    songs_override: boolean;
    song_strategy: string;
    songcount: string;
    checkedat: string | null;
    dmcollected: string;
    rt_online_peak: number | null;
    rt_sc: number | null;
    rt_gift: number | null;
    rt_gift_coin: string | null;
    rt_interact: number | null;
  }>(
    `SELECT s.id, s.title, s.category, s.category_manual, s.start_time, s.end_time,
            s.duration_sec, s.danmaku, s.sing_duration, s.game_duration, s.note, s.songs_override, s.song_strategy,
            COALESCE(c.cnt,0)::int AS songcount, s.songs_checked_at AS checkedat,
            COALESCE(d.cnt,0)::int AS dmcollected,
            rt.online_peak AS rt_online_peak, rt.sc_count AS rt_sc, rt.gift_count AS rt_gift,
            rt.gift_coin AS rt_gift_coin, rt.interact_count AS rt_interact
     FROM live_session s
     LEFT JOIN (SELECT bvid, COUNT(*) AS cnt FROM live_song GROUP BY bvid) c ON c.bvid = s.id
     LEFT JOIN (SELECT bvid, COUNT(*) AS cnt FROM live_danmaku GROUP BY bvid) d ON d.bvid = s.id
     LEFT JOIN LATERAL (
       SELECT online_peak, sc_count, gift_count, gift_coin, interact_count
       FROM live_rt_session
       WHERE abs(start_time - s.start_time) < 21600   -- 开播时间相差 < 6h 视为同一场
       ORDER BY abs(start_time - s.start_time) ASC
       LIMIT 1
     ) rt ON true
     ORDER BY s.start_time DESC`,
  );
  return rows.map((r) => ({
    bvid: r.id,
    title: r.title,
    category: r.category,
    categoryManual: r.category_manual,
    startTime: Number(r.start_time),
    endTime: Number(r.end_time),
    durationSec: Number(r.duration_sec),
    danmaku: r.danmaku,
    singDuration: r.sing_duration,
    gameDuration: r.game_duration,
    note: r.note,
    songsOverride: r.songs_override,
    songStrategy: r.song_strategy || 'merge',
    songCount: Number(r.songcount),
    checked: r.checkedat != null,
    dmCollected: Number(r.dmcollected),
    rtOnlinePeak: r.rt_online_peak != null ? Number(r.rt_online_peak) : null,
    rtSc: r.rt_sc != null ? Number(r.rt_sc) : null,
    rtGift: r.rt_gift != null ? Number(r.rt_gift) : null,
    rtGiftCoin: r.rt_gift_coin != null ? Number(r.rt_gift_coin) : null,
    rtInteract: r.rt_interact != null ? Number(r.rt_interact) : null,
  }));
}

export async function getLiveSessionAdmin(
  bvid: string,
): Promise<LiveAdminRow | null> {
  const rows = await queryLiveSessionsAdmin();
  return rows.find((r) => r.bvid === bvid) ?? null;
}

// ---------- 后台：歌单纠正 ----------
export async function setLiveSongExcluded(
  bvid: string,
  idx: number,
  excluded: boolean,
): Promise<void> {
  await ensureReady();
  await getPool().query(
    'UPDATE live_song SET excluded=$3 WHERE bvid=$1 AND idx=$2',
    [bvid, idx, excluded],
  );
}

export async function addManualSong(bvid: string, title: string): Promise<void> {
  await ensureReady();
  const p = getPool();
  const { rows } = await p.query<{ max: string }>(
    'SELECT COALESCE(MAX(idx),-1)::int AS max FROM live_song WHERE bvid=$1',
    [bvid],
  );
  const idx = Number(rows[0].max) + 1;
  await p.query(
    `INSERT INTO live_song (bvid, idx, title, raw_text, created_at, source)
     VALUES ($1,$2,$3,'', $4, 'manual')
     ON CONFLICT (bvid, idx) DO UPDATE SET title=EXCLUDED.title, source='manual'`,
    [bvid, idx, title, Date.now()],
  );
}

export async function deleteLiveSong(bvid: string, idx: number): Promise<void> {
  await ensureReady();
  await getPool().query('DELETE FROM live_song WHERE bvid=$1 AND idx=$2', [
    bvid,
    idx,
  ]);
}

// 扩展：歌单查询返回来源与排除标记
export interface LiveSongFull extends LiveSongRow {
  source: string;
  excluded: boolean;
}

export async function queryLiveSongsFull(bvid: string): Promise<LiveSongFull[]> {
  await ensureReady();
  const { rows } = await getPool().query<LiveSongFull>(
    'SELECT *, COALESCE(source,\'auto\') AS source, COALESCE(excluded,false) AS excluded FROM live_song WHERE bvid=$1 ORDER BY idx',
    [bvid],
  );
  return rows;
}

// ---------- 后台：切片管理 ----------
export interface VideoAdminRow extends ClipRow {
  like: number;
  coin: number;
  share: number;
  favorite: number;
  reply: number;
  danmaku: number;
  pubdate: number;
  arcurl: string;
  manual: number;
  has_tag: number;
}

export async function queryVideosAdmin(opts: {
  q?: string;
  author?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<VideoAdminRow[]> {
  await ensureReady();
  const conds: string[] = [];
  const params: unknown[] = [];
  if (opts.q) {
    params.push(`%${opts.q}%`);
    conds.push(`title ILIKE $${params.length}`);
  }
  if (opts.author) {
    params.push(opts.author);
    conds.push(`author = $${params.length}`);
  }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const limit = Math.min(opts.limit ?? 100, 500);
  const offset = opts.offset ?? 0;
  params.push(limit, offset);
  const { rows } = await getPool().query<VideoAdminRow>(
    `SELECT bvid, title, author, pubdate, "view" AS view, "like" AS like, coin, share, favorite, reply, danmaku, arcurl, pic, manual, has_tag
     FROM video_stat ${where}
     ORDER BY "view" DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return rows;
}

export async function manualUpsertVideo(v: VideoRow & { manual?: boolean }): Promise<boolean> {
  await ensureReady();
  const res = await getPool().query(
    `INSERT INTO video_stat (bvid, title, author, pubdate, "view", "like", coin, share, favorite, reply, danmaku, arcurl, pic, manual, has_tag, tag_checked)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,1,1)
     ON CONFLICT (bvid) DO UPDATE SET
       title=COALESCE(EXCLUDED.title, video_stat.title),
       author=COALESCE(EXCLUDED.author, video_stat.author),
       pubdate=COALESCE(EXCLUDED.pubdate, video_stat.pubdate),
       "view"=COALESCE(EXCLUDED."view", video_stat."view"),
       "like"=COALESCE(EXCLUDED."like", video_stat."like"),
       coin=COALESCE(EXCLUDED.coin, video_stat.coin),
       share=COALESCE(EXCLUDED.share, video_stat.share),
       favorite=COALESCE(EXCLUDED.favorite, video_stat.favorite),
       reply=COALESCE(EXCLUDED.reply, video_stat.reply),
       danmaku=COALESCE(EXCLUDED.danmaku, video_stat.danmaku),
       arcurl=COALESCE(EXCLUDED.arcurl, video_stat.arcurl),
       pic=COALESCE(EXCLUDED.pic, video_stat.pic),
       manual=EXCLUDED.manual, has_tag=1, tag_checked=1`,
    [
      v.bvid,
      v.title,
      v.author,
      v.pubdate,
      v.view,
      v.like,
      v.coin,
      v.share,
      v.favorite,
      v.reply,
      v.danmaku,
      v.arcurl,
      v.pic ?? null,
      v.manual ? 1 : 0,
    ],
  );
  return (res.rows[0]?.inserted ?? false) as boolean;
}

export async function getClipCountByAuthor(author: string): Promise<number> {
  await ensureReady();
  const { rows } = await getPool().query<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM video_stat WHERE author=$1`,
    [author],
  );
  return rows[0]?.c ?? 0;
}

// 库内最新投稿时间（秒级）。用于“切片收集（标签投稿）”增量：只收录比它更新的视频。
export async function getLatestClipPubdate(): Promise<number> {
  await ensureReady();
  const { rows } = await getPool().query<{ m: number | null }>(
    `SELECT MAX(pubdate) AS m FROM video_stat`,
  );
  const v = rows[0]?.m;
  return v ? Number(v) : 0;
}

export async function getVideo(bvid: string): Promise<VideoAdminRow | null> {
  await ensureReady();
  const { rows } = await getPool().query<VideoAdminRow>(
    `SELECT bvid, title, author, pubdate, "view" AS view, "like" AS like, coin, share, favorite, reply, danmaku, arcurl, pic, manual, has_tag
     FROM video_stat WHERE bvid=$1`,
    [bvid],
  );
  return rows[0] ?? null;
}

// ---------- 后台：歌单合并/去重策略 ----------
// strategy: 'auto'  仅自动识别（尊重 excluded 去垃圾）
//           'merge' 自动(非排除) + 手动，按标准化标题去重，手动优先（默认）
//           'manual' 仅手动
export async function getEffectiveSongs(bvid: string): Promise<LiveSongFull[]> {
  const all = await queryLiveSongsFull(bvid);
  const { rows } = await getPool().query<{ song_strategy: string }>(
    `SELECT COALESCE(song_strategy,'merge') AS song_strategy FROM live_session WHERE id=$1`,
    [bvid],
  );
  const strategy = rows[0]?.song_strategy || 'merge';

  if (strategy === 'manual') return all.filter((s) => s.source === 'manual');
  const auto = all.filter((s) => s.source === 'auto' && !s.excluded);
  const manual = all.filter((s) => s.source === 'manual');
  if (strategy === 'auto') return auto;

  // merge：手动优先，标准化标题去重（忽略大小写/空白/标点）
  const norm = (t: string) =>
    t.trim().toLowerCase().replace(/[\s\p{P}]+/gu, '');
  const seen = new Set<string>();
  const out: LiveSongFull[] = [];
  for (const s of manual) {
    out.push(s);
    seen.add(norm(s.title));
  }
  for (const s of auto) {
    if (!seen.has(norm(s.title))) out.push(s);
  }
  return out;
}

// ---------- 后台：操作审计日志 ----------
export interface AuditRow {
  id: number;
  actor: string | null;
  action: string;
  target: string | null;
  detail: any;
  ip: string | null;
  created_at: number;
}

export async function insertAudit(
  action: string,
  target?: string,
  detail?: any,
  ip?: string,
  actor = 'admin',
): Promise<void> {
  await ensureReady();
  await getPool().query(
    'INSERT INTO admin_audit (actor, action, target, detail, ip, created_at) VALUES ($1,$2,$3,$4,$5,$6)',
    [
      actor,
      action,
      target ?? null,
      detail != null ? JSON.stringify(detail) : null,
      ip ?? null,
      Date.now(),
    ],
  );
}

export async function queryAudit(opts: {
  limit?: number;
  action?: string;
} = {}): Promise<AuditRow[]> {
  await ensureReady();
  const params: unknown[] = [];
  let where = '';
  if (opts.action) {
    params.push(opts.action);
    where = `WHERE action=$${params.length}`;
  }
  params.push(Math.min(opts.limit ?? 100, 500));
  const { rows } = await getPool().query<{
    id: number;
    actor: string | null;
    action: string;
    target: string | null;
    detail: any;
    ip: string | null;
    created_at: string;
  }>(
    `SELECT * FROM admin_audit ${where} ORDER BY id DESC LIMIT $${params.length}`,
    params,
  );
  return rows.map((r) => ({
    id: r.id,
    actor: r.actor,
    action: r.action,
    target: r.target,
    detail: r.detail,
    ip: r.ip,
    created_at: Number(r.created_at),
  }));
}


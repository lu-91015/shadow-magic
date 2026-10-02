import pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL!;
const bvid = process.env.BVID!;
const pool = new pg.Pool({ connectionString: DATABASE_URL });

const SONG_REQUEST_RE = /(点歌|求歌|来[一首单]|唱[一首个]|下一[首张曲]|想听|再[来唱一]|歌名|什么歌|这首|哪首|接歌|对唱|合唱|点一首|要听|唱首|来首)/;
const CALL_RE = /(打[ ]?[cC]all|打call|好听|爱了|守护|应援|生日快乐|么么|爱你|绝了|上头|循环)/;
const SLASH_CALL_RE = /\/([^\/]{1,12})\//;

(async () => {
  const durRes = await pool.query(
    `SELECT duration_sec, title FROM live_session WHERE id=$1`, [bvid]);
  const duration = Number(durRes.rows[0]?.duration_sec || 0);
  console.log('title=', durRes.rows[0]?.title, 'duration=', duration);

  const r = await pool.query(
    `SELECT vtime, text FROM live_danmaku WHERE bvid=$1 AND text IS NOT NULL ORDER BY vtime`,
    [bvid]);
  const rows = r.rows as { vtime: number; text: string }[];
  console.log('danmaku count=', rows.length);

  const BIN = 60;
  const bins = Math.ceil(duration / BIN) || 1;
  const cnt = new Array(bins).fill(0);
  const req = new Array(bins).fill(0);
  const call = new Array(bins).fill(0);
  const slash = new Array(bins).fill(0);
  for (const row of rows) {
    const b = Math.floor(Number(row.vtime) / BIN);
    if (b < 0 || b >= bins) continue;
    cnt[b]++;
    const c = row.text || '';
    if (SONG_REQUEST_RE.test(c)) req[b]++;
    if (CALL_RE.test(c)) call[b]++;
    if (SLASH_CALL_RE.test(c)) slash[b]++;
  }
  console.log('bin(min) | count | req | call | slash');
  for (let i = 0; i < bins; i++) {
    if (cnt[i] > 0 || req[i] || call[i] || slash[i])
      console.log(
        `${String(i * BIN).padStart(5)} | ${String(cnt[i]).padStart(4)} | ${String(req[i]).padStart(3)} | ${String(call[i]).padStart(4)} | ${String(slash[i]).padStart(4)}`);
  }

  const sn = await pool.query(
    `SELECT idx, title, source, raw_text, created_at FROM live_song WHERE bvid=$1 ORDER BY created_at`,
    [bvid]);
  console.log('--- existing live_song ---');
  for (const x of sn.rows) console.log(x.source, '|', x.title, '|', x.raw_text);
  const done = await pool.query(`SELECT hits, created_at FROM song_ear_done WHERE bvid=$1`, [bvid]);
  console.log('ear_done=', done.rows[0] || '未跑');

  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });

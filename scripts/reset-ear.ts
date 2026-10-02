import pg from 'pg';
const p = new pg.Pool({ connectionString: process.env.DATABASE_URL! });
const bvid = process.env.BVID!;
(async () => {
  await p.query('DELETE FROM song_ear_done WHERE bvid=$1', [bvid]);
  console.log('reset done for', bvid);
  await p.end();
})().catch((e) => { console.error(e.message); process.exit(1); });

import pg from 'pg';
const p = new pg.Pool({ connectionString: process.env.DATABASE_URL! });
(async () => {
  const r = await p.query('DELETE FROM song_ear_done');
  console.log('reset all song_ear_done, deleted=', r.rowCount);
  await p.end();
})().catch((e) => { console.error(e.message); process.exit(1); });

const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: 'postgres://postgres@localhost:5432/lidousha', connectionTimeoutMillis: 10000 });
  const t0 = Date.now();
  try {
    await c.connect();
    console.log('connected in', Date.now() - t0, 'ms');
    const r = await c.query('SELECT 1 AS ok');
    console.log('query ok', JSON.stringify(r.rows[0]));
    const ins = await c.query("INSERT INTO admin_kv (key,value,updated_at) VALUES ('__probe__','1',1) ON CONFLICT (key) DO NOTHING");
    console.log('insert affected', ins.rowCount);
    await c.query("DELETE FROM admin_kv WHERE key='__probe__'");
    await c.end();
    console.log('done');
  } catch (e) {
    console.error('ERR', e.message);
    process.exitCode = 1;
  }
})();

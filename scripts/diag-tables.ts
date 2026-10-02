import pg from 'pg';
const DATABASE_URL = process.env.DATABASE_URL!;
const pool = new pg.Pool({ connectionString: DATABASE_URL });
(async () => {
  const dbs = await pool.query(
    `SELECT datname FROM pg_database WHERE datistemplate=false ORDER BY datname`);
  console.log('DATABASES:', dbs.rows.map((r: any) => r.datname).join(', '));
  const t = await pool.query(
    `SELECT table_schema, table_name FROM information_schema.tables
     WHERE table_schema NOT IN ('pg_catalog','information_schema') ORDER BY 1,2`);
  console.log('TABLES in current DB:');
  for (const r of t.rows) console.log(`  ${r.table_schema}.${r.table_name}`);
  await pool.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });

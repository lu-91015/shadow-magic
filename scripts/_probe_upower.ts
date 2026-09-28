import '../lib/db';
import { Pool } from 'pg';

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const cols = await pool.query(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_name='dyn_comment' ORDER BY ordinal_position`,
  );
  console.log('dyn_comment 列:');
  for (const c of cols.rows) console.log(' ', c.column_name, c.data_type);
  for (const expr of ['message', 'content', 'raw']) {
    const r = await pool.query(
      `SELECT COUNT(*)::int c FROM dyn_comment WHERE ${expr}::text LIKE '%UPOWER%'`,
    );
    console.log(`列 ${expr} 含 UPOWER: ${r.rows[0].c}`);
  }
  await pool.end();
}
main();

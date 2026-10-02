// 通用对账工具：基于主键把缺失行补到对端（只 INSERT，不删不覆盖）
// 用法:
//   DATABASE_URL=... node _recon.js pks            -> 输出 {表:{pk:[列],keys:[[值...]]}}
//   DATABASE_URL=... node _recon.js dump 表 JSON   -> 从 stdin 读 {pk,keys}，输出 [{列:值}]
//   DATABASE_URL=... node _recon.js insert 表 JSON -> 从 stdin 读 [{列:值}]，ON CONFLICT DO NOTHING
//   DATABASE_URL=... node _recon.js seqs            -> 把所有 serial/identity 主键序列对齐到 max+1
const { Client } = require('pg');
const fs = require('fs');
const BLACKLIST = new Set(['job_run', 'audit_log', 'schema_migrations', 'pgmigrations', 'knex_migrations', 'knex_migrations_lock']);

function url() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = fs.readFileSync('/opt/lidousha/.env', 'utf8');
  const m = env.match(/DATABASE_URL=(.+)/);
  return m[1].trim();
}
async function tables(c) {
  const r = await c.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`);
  return r.rows.map(x => x.table_name).filter(t => !BLACKLIST.has(t));
}
async function pkCols(c, t) {
  const r = await c.query(
    `SELECT a.attname AS col FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey)
     WHERE i.indrelid=$1::regclass AND i.indisprimary`, [t]);
  return r.rows.map(x => x.col);
}
async function cols(c, t) {
  const r = await c.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`, [t]);
  return r.rows.map(x => x.column_name);
}
async function identityCols(c, t) {
  const r = await c.query(
    `SELECT a.attname AS col FROM pg_attribute a WHERE a.attrelid=$1::regclass AND (a.attidentity<>'' OR a.attgenerated<>'')`, [t]);
  return new Set(r.rows.map(x => x.col));
}

(async () => {
  const action = process.argv[2];
  const table = process.argv[3];
  try { require('fs').appendFileSync('/tmp/_dbg.log', 'ACTION ' + action + ' ' + table + '\n'); } catch (e) {}
  // 结果输出：默认写 stdout；若设了 OUT 环境变量则写文件，避免 Windows 下子进程管道挂起
  const emit = (s) => { if (process.env.OUT) require('fs').writeFileSync(process.env.OUT, s); else process.stdout.write(s); };
  const c = new Client({ connectionString: url(), connectionTimeoutMillis: 20000, query_timeout: 120000 });
  await c.connect();
  if (action === 'sdiff') {
    // 入参：{tables:{表:{mode:'pk'|'nat', cols:[...], keys:[[...]]}}}（本地键集合）
    // 返回：每表 {ml:服务器有而本地缺, ms:本地有而服务器缺}（仅差异，避免全量回传）
    const req = JSON.parse(fs.readFileSync(process.env.REQFILE, 'utf8'));
    const res = {};
    for (const [t, info] of Object.entries(req.tables)) {
      const cols = info.mode === 'nat' ? info.cols : await pkCols(c, t);
      if (!cols.length) { res[t] = { ml: [], ms: [] }; continue; }
      const r = await c.query(`SELECT ${cols.map(x => `"${x}"`).join(',')} FROM "${t}"`);
      const srv = new Set(r.rows.map(row => JSON.stringify(cols.map(col => row[col]))));
      const loc = new Set(info.keys.map(k => JSON.stringify(k)));
      const ml = [...srv].filter(x => !loc.has(x)).map(x => JSON.parse(x));
      const ms = [...loc].filter(x => !srv.has(x)).map(x => JSON.parse(x));
      res[t] = { ml, ms };
    }
    emit(JSON.stringify(res));
  } else   if (action === 'pks') {
    // 自增主键监控表用内容键对账（见 _recon.py SERIAL），这里跳过它们的 id 主键列表（巨大且无用）
    // live_danmaku 有 249 万行，主键 dmid 是外部稳定ID，整表键集约 100MB+，SSH 对账不现实；
    // 该表改用 pg_dump/pg_restore 在 _recon.py 之外单独补齐。
    const SKIP = new Set(['live_rt_danmaku', 'live_rt_gift', 'live_rt_sc', 'live_rt_interact', 'live_rt_online', 'admin_audit', 'live_danmaku']);
    const out = {};
    for (const t of await tables(c)) {
      if (SKIP.has(t)) continue;
      const pk = await pkCols(c, t);
      if (!pk.length) { out[t] = { pk: [], keys: [] }; continue; }
      const r = await c.query(`SELECT ${pk.map((x, i) => `"${x}"`).join(',')} FROM "${t}"`);
      out[t] = { pk, keys: r.rows.map(row => pk.map(col => row[col])) };
    }
    emit(JSON.stringify(out));
  } else if (action === 'dump') {
    const req = JSON.parse(fs.readFileSync(process.env.REQFILE, 'utf8'));
    const pk = req.pk, keys = req.keys;
    const col = await cols(c, table);
    const rows = [];
    const B = 5000; // 分批避免单次 VALUES 过大导致 SQL 超限
    for (let s = 0; s < keys.length; s += B) {
      const slice = keys.slice(s, s + B);
      const vc = pk.map((_, i) => `c${i}`).join(',');
      const ph = slice.map((k, i) => `(${pk.map((_, j) => `$${i * pk.length + j + 1}`).join(',')})`).join(',');
      const params = [];
      slice.forEach(k => pk.forEach((p, j) => params.push(k[j])));
      // 列侧转 ::text，再用 IS NOT DISTINCT FROM：NULL 对 NULL 返回 TRUE（正确处理可空分量），
      // 同时文本比对规避 bigint/text 类型比较报错。
      const where = pk.map((p, idx) => `"${p}"::text IS NOT DISTINCT FROM v.c${idx}`).join(' AND ');
      const r = await c.query(
        `SELECT ${col.map(x => `"${x}"`).join(',')} FROM "${table}"
         WHERE EXISTS (SELECT 1 FROM (VALUES ${ph}) AS v(${vc}) WHERE ${where})`, params);
      rows.push(...r.rows);
    }
    emit(JSON.stringify(rows));
  } else if (action === 'insert') {
    const rows = JSON.parse(fs.readFileSync(process.env.REQFILE, 'utf8'));
    if (!rows.length) { emit('0'); await c.end(); return; }
    const col = await cols(c, table);
    const pk = await pkCols(c, table);
    const idCols = await identityCols(c, table);
    const override = [...idCols].filter(x => col.includes(x)).length ? ' OVERRIDING SYSTEM VALUE' : '';
    const ncol = col.length;
    console.error('DEBUG insert', table, 'col=', JSON.stringify(col), 'pk=', JSON.stringify(pk), 'idCols=', JSON.stringify(idCols), 'nrows=', rows.length, 'row0=', JSON.stringify(rows[0] || null));
    let done = 0;
    for (let i = 0; i < rows.length; i += 200) {
      const batch = rows.slice(i, i + 200);
      const vals = [];
      const params = [];
      batch.forEach((row, bi) => {
        const ph = col.map((cc, ci) => `$${bi * ncol + ci + 1}`).join(',');
        vals.push(`(${ph})`);
        col.forEach(cc => params.push(row[cc]));
      });
      const sql = `INSERT INTO "${table}" (${col.map(x => `"${x}"`).join(',')})${override} VALUES ${vals.join(',')} ON CONFLICT (${pk.map(p => `"${p}"`).join(',')}) DO NOTHING`;
      try {
        await c.query(sql, params);
      } catch (e) {
        console.error('INSERT_ERR', table, 'paramsLen=' + params.length, 'msg=' + e.message);
        throw e;
      }
      done += batch.length;
    }
    emit(String(done));
  } else if (action === 'nkeys') {
    // 按内容自然键取集合（用于自增主键表的去重对齐）
    const nat = JSON.parse(process.argv[4]);
    const r = await c.query(`SELECT ${nat.map(x => `"${x}"`).join(',')} FROM "${table}"`);
    emit(JSON.stringify(r.rows.map(row => nat.map(col => row[col]))));
  } else if (action === 'ndump') {
    const nat = JSON.parse(process.argv[4]);
    const req = JSON.parse(fs.readFileSync(process.env.REQFILE, 'utf8'));
    const keys = req.keys;
    const col = await cols(c, table);
    const rows = [];
    const B = 5000;
    for (let s = 0; s < keys.length; s += B) {
      const slice = keys.slice(s, s + B);
      const vc = nat.map((_, i) => `c${i}`).join(',');
      const ph = slice.map((k, i) => `(${nat.map((_, j) => `$${i * nat.length + j + 1}`).join(',')})`).join(',');
      const params = [];
      slice.forEach(k => nat.forEach((p, j) => params.push(k[j])));
      // 自然键可能含 NULL（如 admin_audit 的 target/ip）；列侧 ::text 后用 IS NOT DISTINCT FROM，
      // 使 NULL 对 NULL 返回 TRUE，同时文本比对规避 bigint/text 类型比较报错。
      const where = nat.map((p, idx) => `"${p}"::text IS NOT DISTINCT FROM v.c${idx}`).join(' AND ');
      const r = await c.query(
        `SELECT ${col.map(x => `"${x}"`).join(',')} FROM "${table}"
         WHERE EXISTS (SELECT 1 FROM (VALUES ${ph}) AS v(${vc}) WHERE ${where})`, params);
      rows.push(...r.rows);
    }
    emit(JSON.stringify(rows));
  } else if (action === 'ninsert') {
    // 按内容自然键插入（自增主键表）。diff 已保证这些行在目标端确实缺失，
    // 故无需 WHERE NOT EXISTS，直接用标准批量 INSERT ... VALUES ON CONFLICT DO NOTHING。
    const nat = JSON.parse(process.argv[4]);
    const rows = JSON.parse(fs.readFileSync(process.env.REQFILE, 'utf8'));
    if (!rows.length) { emit('0'); await c.end(); return; }
    let col = await cols(c, table);
    // 自增主键（id）在两端各自分配，插入时丢弃，交给目标端自增，避免主键冲突
    if (col.includes('id')) col = col.filter(x => x !== 'id');
    const ncol = col.length;
    let done = 0;
    for (let i = 0; i < rows.length; i += 200) {
      const batch = rows.slice(i, i + 200);
      const vals = []; const params = [];
      batch.forEach((row, bi) => {
        const ph = col.map((cc, ci) => `$${bi * ncol + ci + 1}`).join(',');
        vals.push(`(${ph})`);
        col.forEach(cc => params.push(row[cc]));
      });
      const sql = `INSERT INTO "${table}" (${col.map(x => `"${x}"`).join(',')}) VALUES ${vals.join(',')} ON CONFLICT DO NOTHING`;
      try {
        const r = await c.query(sql, params);
        done += r.rowCount || 0;
      } catch (e) {
        console.error('NINSERT_ERR', table, 'paramsLen=' + params.length, 'msg=' + e.message);
        throw e;
      }
    }
    emit(String(done));
  } else if (action === 'seqs') {
    let n = 0;
    for (const t of await tables(c)) {
      const pk = await pkCols(c, t);
      if (pk.length !== 1) continue;
      // pg_get_serial_sequence 同时覆盖 IDENTITY 列与 nextval 默认序列列（如 id bigint default nextval）
      const seq = await c.query(`SELECT pg_get_serial_sequence($1,$2) AS s`, [t, pk[0]]);
      const sname = seq.rows[0] && seq.rows[0].s;
      if (!sname) continue;
      try {
        await c.query(`SELECT setval($1, (SELECT COALESCE(MAX("${pk[0]}"),1) FROM "${t}"))`, [sname]);
        n++;
      } catch (e) { /* 无序列则忽略 */ }
    }
    emit('seqs=' + n);
  }
  await c.end();
})().then(() => process.exit(0)).catch(e => { console.error('ERR', e && e.message); process.exit(1); });

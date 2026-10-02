const {Client}=require('pg'); const fs=require('fs');
const rows=JSON.parse(fs.readFileSync('c:/tmp/_miss_rows.json','utf8'));
(async()=>{
  const c=new Client({connectionString:process.env.LU}); await c.connect();
  const col=(await c.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position",['dyn_comment'])).rows.map(x=>x.column_name);
  const pk=(await c.query("SELECT a.attname AS col FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey) WHERE i.indrelid='dyn_comment'::regclass AND i.indisprimary")).rows.map(x=>x.col);
  for(let ri=0; ri<rows.length; ri++){
    const row=rows[ri]; const params=[];
    col.forEach(cc=>params.push(row[cc]));
    const sql=`INSERT INTO "dyn_comment" (`+col.map(x=>`"${x}"`).join(',')+`) VALUES (`+col.map((_,ci)=>`$${ci+1}`).join(',')+`) ON CONFLICT (`+pk.map(p=>`"${p}"`).join(',')+`) DO NOTHING`;
    try { await c.query(sql, params); console.error('row '+ri+' OK'); }
    catch(e){ console.error('row '+ri+' ERR: '+e.message); console.error('row '+ri+' value: '+JSON.stringify(row).slice(0,400)); }
  }
  await c.end();
})().catch(e=>{console.error('FATAL '+e.message);process.exit(1)});

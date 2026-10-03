// 一次性脚本：写入各触发场景的默认台词（已存在则跳过）
import pg from 'pg';

const URL = process.env.DATABASE_URL || 'postgres://postgres@localhost:5432/lidousha';

const LINES = [
  // 进入站点
  ['enter', '你好，我是李豆沙~', 10],
  ['enter', '你来啦！今天也要开心哦', 5],
  // 点击小人
  ['tap', 'Kimo熊，抱抱！', 8],
  ['tap', '不要摸我，不是你妈妈，快滚！', 6],
  ['tap', '再摸的话……要收费的哦（认真）', 4],
  ['tap', '呜哇，手拿开啦！', 3],
  // 熊猫衣柜
  ['page:/wardrobe', '这是我的衣柜哦~', 10],
  ['page:/wardrobe', '这件衣服好看吧，我也这么觉得！', 5],
  // 悬停按钮
  ['hover:wardrobe', '要看看我的衣柜吗？里面有好多漂亮衣服哦 [李豆沙_展示]', 10],
  // 熊猫活动轨迹
  ['page:/tracks', '熊猫的脚印都记在这里啦，来看看我跑去哪儿了~', 10],
  ['page:/tracks', '这是我的活动轨迹，找找有没有你的身影', 5],
  // 后台：游客 / 管理员
  ['admin_guest', '嘘——游客模式，只能看看不能乱动哦', 10],
  ['admin_admin', '欢迎回来，主人~ 数据都在这儿了', 10],
];

const c = new pg.Client({ connectionString: URL });
await c.connect();
await c.query(`ALTER TABLE mascot_line ADD COLUMN IF NOT EXISTS scene TEXT`);
let added = 0;
for (const [scene, text, weight] of LINES) {
  const { rowCount } = await c.query(
    'SELECT 1 FROM mascot_line WHERE text = $1 AND scene = $2 LIMIT 1',
    [text, scene],
  );
  if (rowCount) continue;
  await c.query(
    `INSERT INTO mascot_line (text, weight, scene, enabled, created_at) VALUES ($1,$2,$3,true,$4)`,
    [text, weight, scene, Date.now()],
  );
  added++;
}
await c.query(`UPDATE mascot_line SET scene = 'idle' WHERE scene IS NULL`);
const { rows } = await c.query('SELECT scene, count(*)::int AS n FROM mascot_line GROUP BY scene ORDER BY 1');
console.log('新增台词', added, '条；现有分布：', rows);
await c.end();

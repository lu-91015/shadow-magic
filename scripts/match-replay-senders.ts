// 回填直播回放弹幕的发送者身份（sender 哈希 → uid / 昵称）。
// 核心逻辑在 lib/match-senders.ts（与后台定时任务/手动任务共用）。
// 运行：npm run match:senders   （可重复执行，幂等）
import { matchReplaySenders } from '../lib/match-senders';

matchReplaySenders((m) => console.log(m))
  .then((r) => {
    console.log(
      `汇总：${r.sessions} 场对齐，命中 ${r.hitMain}+${r.hitUnique}，回填 ${r.resolved} 个身份 / ${r.updated} 条弹幕，剩余未识别 ${r.left} 条`,
    );
    process.exit(0);
  })
  .catch((e) => {
    console.error('回填失败：', e);
    process.exit(1);
  });

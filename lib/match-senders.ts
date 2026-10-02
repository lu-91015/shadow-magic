// 回填直播回放弹幕的发送者身份（sender 哈希 → uid / 昵称）。
// 原理：live_rt_session（实时监控）存有每场弹幕的 uid+uname+text+ts，
// live_session（回放）存有 sender=midHash 的弹幕文本+视频内时间 vtime。
// 按「开播时间就近对齐（<6h）」把回放场次对到实时场次后：
//   主策略：回放时间轴 ≈ 开播时间 + vtime（实测 95% 以上偏差 <5s），
//           相同文本中取时间最近者投票；
//   兜底：  同场内该文本在两侧都唯一出现时直接配对。
// sender 哈希跨场次恒定，全局汇总取多数票（≥60%）后回写 live_danmaku。
// 注意：回放 XML 的 sendtime 已被B站打码（全场仅几十个值），不可用。
//
// 供 scripts/match-replay-senders.ts（CLI）与 lib/jobs.ts（定时任务）复用。
import { ensureReady, getPool } from './db';

// 主策略时间容差（秒）：实测 <2s 占 73%、<5s 占 99%，取 8s 兜住网络波动
const TIME_TOL = 8;
// 兜底策略：双侧唯一文本的最大时间偏差（秒），防跨场误配
const UNIQUE_TOL = 1800;
// 两个候选 uid 票数过于接近时不回填（宁缺毋滥，保持哈希）
const WIN_RATIO = 0.6;

type RtRow = { uid: number; uname: string; text: string; ts: number };

export interface MatchSendersResult {
  sessions: number; // 参与对齐的回放场次
  hitMain: number; // 主策略命中
  hitUnique: number; // 双侧唯一兜底命中
  resolved: number; // 仲裁通过的 sender 哈希数
  updated: number; // 回写弹幕条数
  left: number; // 剩余未识别条数
}

export async function matchReplaySenders(
  log: (m: string) => void = () => {},
): Promise<MatchSendersResult> {
  await ensureReady();
  const pool = getPool();

  // 1. 场次对齐：live_session(bvid) ↔ live_rt_session（带开播时间）
  const { rows: sessions } = await pool.query<{
    id: string;
    rt_id: string;
    rt_start: string;
  }>(`
    SELECT s.id, rt.id AS rt_id, rt.start_time AS rt_start
    FROM live_session s
    JOIN LATERAL (
      SELECT id, start_time FROM live_rt_session
      WHERE abs(start_time - s.start_time) < 21600
      ORDER BY abs(start_time - s.start_time) ASC LIMIT 1
    ) rt ON true
    ORDER BY s.start_time DESC`);
  log(`场次对齐：${sessions.length} 场回放有实时监控数据`);

  // 2. 全局投票：sender(哈希) → uid → 票数 & 昵称
  const votes = new Map<string, Map<number, { n: number; uname: string }>>();
  let hitMain = 0;
  let hitUnique = 0;

  const vote = (sender: string, uid: number, uname: string) => {
    const m = votes.get(sender) ?? new Map();
    const v = m.get(uid) ?? { n: 0, uname };
    v.n++;
    v.uname = uname; // 取最新昵称
    m.set(uid, v);
    votes.set(sender, m);
  };

  for (const { id: bvid, rt_id: sessionId, rt_start } of sessions) {
    const rtStart = Number(rt_start);
    const { rows: rt } = await pool.query<RtRow>(
      `SELECT uid, uname, text, ts FROM live_rt_danmaku WHERE session_id=$1`,
      [sessionId],
    );
    const { rows: replay } = await pool.query<{
      sender: string;
      text: string;
      vtime: number;
    }>(
      `SELECT sender, text, vtime FROM live_danmaku
       WHERE bvid=$1 AND sender <> '' AND sender_uid IS NULL`,
      [bvid],
    );
    if (!rt.length || !replay.length) continue;

    // 实时侧按文本分组
    const byText = new Map<string, RtRow[]>();
    for (const r of rt) {
      if (!r.text) continue;
      const arr = byText.get(r.text) ?? [];
      arr.push(r);
      byText.set(r.text, arr);
    }
    // 回放侧文本出现次数（供兜底策略判唯一）
    const rpCount = new Map<string, number>();
    for (const d of replay) rpCount.set(d.text, (rpCount.get(d.text) ?? 0) + 1);

    for (const d of replay) {
      const cands = byText.get(d.text);
      if (!cands?.length) continue;
      if (cands.length === 1 && rpCount.get(d.text) === 1) {
        // 兜底：双侧唯一，时间差合理即配对（应对视频剪辑导致的时间轴漂移）
        if (Math.abs(cands[0].ts - (rtStart + d.vtime)) <= UNIQUE_TOL) {
          vote(d.sender, cands[0].uid, cands[0].uname);
          hitUnique++;
        }
        continue;
      }
      // 主策略：预期绝对时间 = 开播时间 + 视频内时间，取最近候选
      const expect = rtStart + d.vtime;
      let best: RtRow | null = null;
      let bestDiff = Infinity;
      for (const c of cands) {
        const diff = Math.abs(c.ts - expect);
        if (diff < bestDiff) {
          bestDiff = diff;
          best = c;
        }
      }
      if (best && bestDiff <= TIME_TOL) {
        vote(d.sender, best.uid, best.uname);
        hitMain++;
      }
    }
  }
  log(`匹配命中：主策略 ${hitMain} 条 + 双侧唯一兜底 ${hitUnique} 条`);

  // 3. 仲裁：多数票胜出，票数占比不足的不回填
  const resolved: { sender: string; uid: number; uname: string; n: number }[] = [];
  for (const [sender, m] of votes) {
    const total = [...m.values()].reduce((s, v) => s + v.n, 0);
    const sorted = [...m.entries()].sort((a, b) => b[1].n - a[1].n);
    const [uid, top] = sorted[0];
    if (total > 0 && top.n / total >= WIN_RATIO) {
      resolved.push({ sender, uid, uname: top.uname, n: top.n });
    }
  }
  log(`身份仲裁：${resolved.length} 个 sender 哈希可回填（阈值 ${WIN_RATIO}）`);

  // 4. 回写（幂等：只填空，不覆盖已有）
  let updated = 0;
  for (const r of resolved) {
    const q = await pool.query(
      `UPDATE live_danmaku SET sender_uid=$2, sender_name=$3
       WHERE sender=$1 AND sender_uid IS NULL`,
      [r.sender, r.uid, r.uname],
    );
    updated += q.rowCount ?? 0;
  }

  const { rows: left } = await pool.query<{ c: string }>(
    `SELECT COUNT(*)::text c FROM live_danmaku WHERE sender <> '' AND sender_uid IS NULL`,
  );
  const leftCount = Number(left[0]?.c ?? 0);
  log(`回写完成：${updated} 条弹幕补上昵称`);
  log(`剩余未识别：${leftCount} 条（对应场次无实时监控或无法唯一匹配）`);

  return {
    sessions: sessions.length,
    hitMain,
    hitUnique,
    resolved: resolved.length,
    updated,
    left: leftCount,
  };
}

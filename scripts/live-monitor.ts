/**
 * 李豆沙直播实时监控守护进程
 * --------------------------------------------------
 * 常驻运行：轮询开播状态，开播后用 WebSocket 实时采集
 *   弹幕(DANMU_MSG) / 醒目留言(SC) / 礼物(SEND_GIFT) / 互动(INTERACT_WORD)
 * 并落库到 live_rt_* 表。一场直播 = 一个 live_rt_session，下播自动收尾。
 *
 * 运行： npm run live-monitor   （建议用 pm2 / nohup 常驻）
 */
import zlib from 'zlib';
import WebSocket from 'ws';
import {
  ensureReady,
  upsertRtSession,
  finishRtSession,
  updateRtSessionPeak,
  getRtCounts,
  getRtActiveSession,
  getRtActiveSessions,
  insertRtDanmaku,
  insertRtSc,
  insertRtGift,
  insertRtInteract,
  insertRtOnline,
  setKv,
} from '../lib/db';
import {
  getLiveStatusRaw,
  getLiveStatusByRoom,
  getDanmuInfo,
  getBiliCookieWithBuvid,
  getBiliUidSync,
  loadBiliCookieFromDb,
} from '../lib/bilibili';
import { startScheduler } from '../lib/scheduler';
import { UID, ROOM_ID } from '../lib/constants';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const now = () => Math.floor(Date.now() / 1000);
const log = (...a: any[]) =>
  console.log(`[live-mon][${new Date().toISOString()}]`, ...a);

// 礼物统一入库结构（SEND_GIFT / COMBO_SEND 共用）
function giftRow(json: any, d: any, roomId: string, sessionId: string) {
  return {
    session_id: sessionId,
    room_id: roomId,
    uid: Number(d.uid ?? 0),
    uname: d.uname ?? '',
    gift_id: Number(d.giftId ?? d.gift_id ?? 0),
    gift_name: d.giftName ?? d.gift_name ?? '',
    num: Number(d.num ?? d.combo_num ?? 1),
    coin_type: d.coin_type ?? '',
    total_coin: Number(d.total_coin ?? d.combo_total_coin ?? 0),
    action: d.action ?? '',
    combo_id: d.batch_combo_id ?? d.combo_id ?? '',
    ts: Number(d.timestamp ?? now()),
    raw: json,
  };
}
const unknownGiftCmds = new Set<string>();
let loggedGiftV2 = false; // 仅打印一次 SEND_GIFT_V2 样例用于核对字段

function encodePacket(op: number, body: Buffer): Buffer {
  const h = Buffer.alloc(16);
  h.writeUInt32BE(16 + body.length, 0);
  h.writeUInt16BE(16, 4);
  h.writeUInt16BE(1, 6);
  h.writeUInt32BE(op, 8);
  h.writeUInt32BE(1, 12);
  return Buffer.concat([h, body]);
}

function parsePackets(buf: Buffer): { op: number; body: Buffer }[] {
  const out: { op: number; body: Buffer }[] = [];
  let off = 0;
  while (off + 16 <= buf.length) {
    const plen = buf.readUInt32BE(off);
    if (plen < 16 || off + plen > buf.length) break;
    const pver = buf.readUInt16BE(off + 6);
    const op = buf.readUInt32BE(off + 8);
    const body = buf.subarray(off + 16, off + plen);
    off += plen;
    if (pver === 2 || pver === 3) {
      try {
        const dec =
          pver === 3 ? zlib.brotliDecompressSync(body) : zlib.inflateSync(body);
        out.push(...parsePackets(dec));
      } catch {
        continue;
      }
    } else out.push({ op, body });
  }
  return out;
}

// 极简 protobuf 字段解码（用于 INTERACT_WORD_V2 的 data.pb）
// 返回 field_no -> [varint(number) | bytes(Buffer)]
function decodePbFields(buf: Buffer): Map<number, Array<number | Buffer>> {
  const out = new Map<number, Array<number | Buffer>>();
  let off = 0;
  while (off < buf.length) {
    let key = 0;
    let shift = 0;
    let b: number;
    do {
      b = buf[off++];
      key += (b & 0x7f) * Math.pow(2, shift);
      shift += 7;
    } while (b & 0x80 && off < buf.length);
    const field = key >>> 3;
    const wt = key & 7;
    let val: number | Buffer;
    if (wt === 0) {
      let v = 0;
      let s = 0;
      while (true) {
        const x = buf[off++];
        v += (x & 0x7f) * Math.pow(2, s);
        if (!(x & 0x80)) break;
        s += 7;
      }
      val = v;
    } else if (wt === 2) {
      let len = 0;
      let s = 0;
      let x: number;
      do {
        x = buf[off++];
        len += (x & 0x7f) * Math.pow(2, s);
        s += 7;
      } while (x & 0x80 && off < buf.length);
      val = buf.subarray(off, off + len);
      off += len;
    } else if (wt === 5) {
      val = buf.subarray(off, off + 4);
      off += 4;
    } else if (wt === 1) {
      val = buf.subarray(off, off + 8);
      off += 8;
    } else break;
    if (!out.has(field)) out.set(field, []);
    out.get(field)!.push(val);
  }
  return out;
}

async function runSession(
  roomId: string,
  title: string,
  opts: {
    getStatus: () => Promise<{ liveStatus: number; online?: number | null }>;
    online?: number | null;
  },
): Promise<void> {
  // 若同房间已有未结束的会话（如进程重启/探测抖动），直接复用，避免重复建会话；
  // 若存在多个（历史遗留的重复会话），保留最新一个复用，其余按各自事件数补收尾
  const actives = await getRtActiveSessions(roomId).catch(() => []);
  const prev = actives[0] ?? null;
  for (const dup of actives.slice(1)) {
    const c = await getRtCounts(dup.id).catch(() => ({
      danmaku: 0,
      sc: 0,
      gift: 0,
      interact: 0,
      enter: 0,
      follow: 0,
      giftCoin: 0,
    }));
    await finishRtSession(dup.id, now(), dup.online_peak ?? 0, c).catch(() => {});
    log(`清理重复会话 ${dup.id} 弹幕=${c.danmaku}`);
  }
  const sessionId = prev ? prev.id : `rt_${roomId}_${Date.now()}`;
  await upsertRtSession({
    id: sessionId,
    room_id: roomId,
    title,
    start_time: prev ? prev.start_time : now(),
    end_time: null,
    online_peak: prev?.online_peak ?? 0,
  });
  log(`▶ ${prev ? '恢复会话' : '开始会话'} ${sessionId} 标题=${title}`);

  const cookie = await getBiliCookieWithBuvid();
  const uid = getBiliUidSync(); // 必须用真实登录 uid，否则 B站直接断开(1006)
  const info = await getDanmuInfo(roomId, cookie).catch(() => null);
  const host = info?.host ?? 'broadcastlv.chat.bilibili.com';
  const wssPort = info?.wssPort ?? 443;
  const token = info?.token ?? '';
  const url = `wss://${host}:${wssPort}/sub`;
  log(`连接 ${url} uid=${uid} token?=${!!token}`);

  let currentPeak = 0; // 只累计真实"房间观众"数，不混入人气值
  let wsOnline: number | null = null; // WS ONLINE_RANK_COUNT 的真实观众数
  let wsOnlineTs = 0;
  let loggedOnline = false;
  let ended = false;
  let reconnectAttempts = 0;
  const giftBatches = new Set<string>(); // 已由 SEND_GIFT 落库的连击批次
  const comboTimers = new Map<string, NodeJS.Timeout>(); // 批次 -> 待落库定时器
  const lastCombo = new Map<string, any>(); // 批次 -> 最近一次 COMBO_SEND 的消息
  let ws: any = null;
  let hbTimer: NodeJS.Timeout | null = null;
  let pollTimer: NodeJS.Timeout | null = null;
  let resolveDone: () => void;
  const done = new Promise<void>((res) => (resolveDone = res));

  function handlePackets(buf: Buffer) {
    for (const p of parsePackets(buf)) {
      if (p.op === 3) {
        // 心跳返回的是人气值（~5万级别），不是真实房间观众数，不再计入峰值
        continue;
      }
      if (p.op !== 5) continue;
      let json: any;
      try {
        json = JSON.parse(p.body.toString('utf8'));
      } catch {
        continue;
      }
      const cmd: string = json.cmd ?? '';
      const d = json.data ?? json;
      try {
        if (cmd.startsWith('DANMU_MSG')) {
          const info = json.info;
          void insertRtDanmaku({
            session_id: sessionId,
            room_id: roomId,
            uid: Number(info[2]?.[0] ?? 0),
            uname: info[2]?.[1] ?? '',
            text: info[1] ?? '',
            color: Number(info[0]?.[3] ?? 0),
            ts: Math.floor((info[0]?.[4] ?? Date.now()) / 1000),
            raw: json,
          }).catch((e) => log('danmaku insert err', e?.message));
        } else if (cmd === 'ONLINE_RANK_COUNT') {
          // 真实"房间观众"数（页面顶部 房间观众(N)），区别于人气值
          const cnt = Number(d?.count ?? 0);
          if (cnt > 0) {
            wsOnline = cnt;
            wsOnlineTs = Date.now();
            if (cnt > currentPeak) currentPeak = cnt;
            if (!loggedOnline) {
              loggedOnline = true;
              log(`房间观众(真实在线)=${cnt}`);
            }
          }
        } else if (
          cmd === 'SUPER_CHAT_MESSAGE' ||
          cmd === 'SUPER_CHAT_MESSAGE_DETAIL'
        ) {
          void insertRtSc({
            session_id: sessionId,
            room_id: roomId,
            sc_id: Number(d.id ?? 0),
            uid: Number(d.uid ?? 0),
            uname: d.user_info?.uname ?? '',
            message: d.message ?? '',
            rmb: Number(d.rmb ?? d.price ?? 0),
            price: Number(d.price ?? 0),
            ts: Number(d.ts ?? d.timestamp ?? d.start_time ?? now()),
            raw: json,
          }).catch((e) => log('sc insert err', e?.message));
        } else if (cmd === 'SEND_GIFT_V2') {
          // B站新礼物协议：礼物信息编码在 data.pb（protobuf）里，字段与 V1 扁平结构不同。
          // 顶层 field1=赠送者uid field2=赠送者名 field10=嵌套礼物消息:
          //   field1礼物id field2礼物名 field3数量 field5单价 field6/36总价 field8币种
          //   field9连击/批次id field10时间戳 field18动作(投喂/赠送)
          if (!loggedGiftV2) {
            loggedGiftV2 = true;
            try {
              require('fs').writeFileSync('logs/giftv2_sample.json', JSON.stringify(json, null, 2));
            } catch {
              /* ignore */
            }
          }
          const pb = (d?.pb ?? json?.data?.pb) as string | undefined;
          if (pb) {
            try {
              const top = decodePbFields(Buffer.from(String(pb), 'base64'));
              const toStr = (v: any) =>
                typeof v === 'string' ? v : v instanceof Buffer ? v.toString('utf8') : '';
              const senderUid = Number(top.get(1)?.[0] ?? 0);
              const senderName = toStr(top.get(2)?.[0]);
              const giftBuf = top.get(10)?.[0];
              const g = giftBuf instanceof Buffer ? decodePbFields(giftBuf) : null;
              const giftId = Number(g?.get(1)?.[0] ?? 0);
              const giftName = toStr(g?.get(2)?.[0]);
              const num = Number(g?.get(3)?.[0] ?? 1);
              const totalCoin = Number(
                g?.get(6)?.[0] ?? g?.get(36)?.[0] ?? num * Number(g?.get(5)?.[0] ?? 0),
              );
              const coinType = toStr(g?.get(8)?.[0]) || 'gold';
              // 连击批次 id：优先 field12(batch:gift:combo_id:...)，回落 field9，再回落 uid+礼物+时间窗
              const comboId = toStr(g?.get(12)?.[0]) || toStr(g?.get(9)?.[0]);
              const ts = Number(g?.get(10)?.[0] ?? d.timestamp ?? now());
              const batch = comboId || `${senderUid}_${giftId}_${Math.floor(ts / 10000)}`;
              if (giftBatches.has(batch)) break; // 该连击/礼物已落库
              const action = toStr(g?.get(18)?.[0]);
              lastCombo.set(batch, { senderUid, senderName, giftId, giftName, num, totalCoin, coinType, ts, action, raw: json });
              const t = comboTimers.get(batch);
              if (t) {
                clearTimeout(t);
                comboTimers.delete(batch);
              }
              // 连击可能分多条到达，延迟 6s 用最终(累计)数值落库一次，避免重复计数
              comboTimers.set(
                batch,
                setTimeout(() => {
                  comboTimers.delete(batch);
                  if (giftBatches.has(batch)) return;
                  giftBatches.add(batch);
                  const c = lastCombo.get(batch);
                  lastCombo.delete(batch);
                  if (c) {
                    void insertRtGift({
                      session_id: sessionId,
                      room_id: roomId,
                      uid: c.senderUid,
                      uname: c.senderName,
                      gift_id: c.giftId,
                      gift_name: c.giftName,
                      num: c.num,
                      coin_type: c.coinType,
                      total_coin: c.totalCoin,
                      action: c.action,
                      combo_id: batch,
                      ts: c.ts,
                      raw: c.raw,
                    }).catch((e) => log('gift insert err', e?.message));
                  }
                }, 6000),
              );
            } catch (e: any) {
              log('SEND_GIFT_V2 解析失败', e?.message);
            }
          }
        } else if (cmd === 'SEND_GIFT' || cmd === 'COMBO_SEND') {
          // 连击礼物：SEND_GIFT=连击结束(权威总量)，COMBO_SEND=连击中(逐次,gift_num恒0)。
          // 以 batch_combo_id 去重：SEND_GIFT 已落库则忽略 COMBO_SEND；否则延迟6s用最终连击数落库一次。
          const batch = String(d.batch_combo_id ?? d.combo_id ?? '');
          if (cmd === 'SEND_GIFT') {
            if (batch) {
              giftBatches.add(batch);
              const t = comboTimers.get(batch);
              if (t) {
                clearTimeout(t);
                comboTimers.delete(batch);
              }
              lastCombo.delete(batch);
            }
            void insertRtGift(giftRow(json, d, roomId, sessionId)).catch((e) =>
              log('gift insert err', e?.message),
            );
          } else {
            const bid = batch || `${d.uid}_${d.giftId ?? d.gift_id}_${Math.floor(now() / 10000)}`;
            if (giftBatches.has(bid)) break; // SEND_GIFT 已记录该连击
            lastCombo.set(bid, json);
            if (!comboTimers.has(bid)) {
              comboTimers.set(
                bid,
                setTimeout(() => {
                  comboTimers.delete(bid);
                  if (giftBatches.has(bid)) return; // 延迟期内 SEND_GIFT 已落库
                  const j = lastCombo.get(bid);
                  lastCombo.delete(bid);
                  if (j) {
                    void insertRtGift(giftRow(j, j.data ?? j, roomId, sessionId)).catch((e) =>
                      log('gift insert err', e?.message),
                    );
                  }
                }, 6000),
              );
            }
          }
        } else if (cmd === 'USER_TOAST_MSG' || cmd === 'USER_TOAST_MSG_V2') {
          // 舰长/提督/总督开通/续费（与 GUARD_BUY 重复，只取这一个）。
          // V1 扁平字段：uid/username/price/num/gift_id/guard_level/role_name
          // V2 嵌套字段：sender_uinfo.uid/base.name、pay_info.price/num、gift_info.gift_id、
          //              guard_info.guard_level/role_name/op_type(2=续费)
          const gl = d.guard_level ?? d.guard_info?.guard_level;
          if (!gl) break;
          const role = gl === 3 ? '舰长' : gl === 2 ? '提督' : '总督';
          const op = d.guard_info?.op_type ?? d.op_type;
          const prefix = op === 2 ? '续费' : '开通';
          const price = Number(d.price ?? d.pay_info?.price ?? 0);
          const gnum = Number(d.num ?? d.pay_info?.num ?? 1);
          void insertRtGift({
            session_id: sessionId,
            room_id: roomId,
            uid: Number(d.uid ?? d.sender_uinfo?.uid ?? 0),
            uname: d.username ?? d.sender_uinfo?.base?.name ?? '',
            gift_id: Number(d.gift_id ?? d.gift_info?.gift_id ?? 0),
            gift_name: String(d.gift_name ?? d.guard_info?.role_name ?? d.role_name ?? '舰队'),
            num: gnum,
            coin_type: 'gold',
            total_coin: price * gnum,
            action: `${prefix}${role}`,
            combo_id: '',
            ts: now(),
            raw: json,
          }).catch((e) => log('gift insert err', e?.message));
        } else if (/GIFT|GUARD|COMBO|TOAST/.test(cmd)) {
          if (!unknownGiftCmds.has(cmd)) {
            unknownGiftCmds.add(cmd);
            log('未处理的礼物类cmd，需评估是否采集:', cmd);
          }
        } else if (cmd.startsWith('INTERACT_WORD')) {
          // INTERACT_WORD_V2 的 data.pb 是 protobuf：
          // field1=uid field2=uname field5=msg_type field7=timestamp
          let uidN = 0;
          let unameS = '';
          let mt = 0;
          let tsN = now();
          if (cmd === 'INTERACT_WORD_V2' && d.pb) {
            const pb = decodePbFields(Buffer.from(String(d.pb), 'base64'));
            uidN = Number(pb.get(1)?.[0] ?? 0);
            const ub = pb.get(2)?.[0];
            unameS = typeof ub === 'object' ? (ub as Buffer).toString('utf8') : '';
            mt = Number(pb.get(5)?.[0] ?? 0);
            tsN = Number(pb.get(7)?.[0] ?? now());
          } else {
            uidN = Number(d.uid ?? 0);
            unameS = d.uname ?? '';
            mt = Number(d.msg_type ?? 0);
            tsN = Number(d.timestamp ?? now());
          }
          const type =
            mt === 1
              ? 'enter'
              : mt === 2
                ? 'follow'
                : mt === 3
                  ? 'share'
                  : mt === 4
                    ? 'special'
                    : mt === 5
                      ? 'mutual'
                      : 'interact';
          void insertRtInteract({
            session_id: sessionId,
            room_id: roomId,
            uid: uidN,
            uname: unameS,
            type,
            ts: tsN,
          }).catch((e) => log('interact insert err', e?.message));
        }
      } catch (e: any) {
        log('handle cmd err', cmd, e?.message);
      }
    }
  }

  async function finalize() {
    if (ended) return;
    ended = true;
    if (hbTimer) clearInterval(hbTimer);
    if (pollTimer) clearInterval(pollTimer);
    for (const t of comboTimers.values()) clearTimeout(t);
    comboTimers.clear();
    lastCombo.clear();
    try {
      ws?.close();
    } catch {
      /* ignore */
    }
    const counts = await getRtCounts(sessionId).catch(() => ({
      danmaku: 0,
      sc: 0,
      gift: 0,
      interact: 0,
      enter: 0,
      follow: 0,
      giftCoin: 0,
    }));
    await finishRtSession(sessionId, now(), currentPeak, counts);
    log(
      `■ 会话结束 ${sessionId} 人气峰值=${currentPeak} 弹幕=${counts.danmaku} SC=${counts.sc} 礼物=${counts.gift} 互动=${counts.interact}(进${counts.enter}/关${counts.follow}) 礼物币=${counts.giftCoin}`,
    );
    resolveDone();
  }

  function connect() {
    ws = new WebSocket(url, {
      headers: {
        Origin: 'https://live.bilibili.com',
        Referer: 'https://live.bilibili.com/',
        'User-Agent': UA,
        Cookie: cookie,
      },
      perMessageDeflate: false,
    });
    ws.on('open', () => {
      reconnectAttempts = 0;
      ws.send(
        encodePacket(
          7,
          Buffer.from(
            JSON.stringify({
              uid,
              roomid: Number(roomId),
              protover: 2,
              platform: 'web',
              type: 2,
              key: token,
            }),
          ),
        ),
      );
      hbTimer = setInterval(() => {
        try {
          ws.send(encodePacket(2, Buffer.alloc(0)));
        } catch {
          /* ignore */
        }
      }, 30_000);
      log('WS 已连接并发送认证');
    });
    // 原始包落盘：把 WS 收到的每个 frame 原样保存为 base64 NDJSON（按会话/小时分片），
    // 便于后续离线重放解析，避免因当前解析逻辑不完善而永久丢失数据。
    // 可用环境变量 RAW_WS_DUMP=0 关闭。
    const fsMod = require('fs');
    const pathMod = require('path');
    const rawDir = pathMod.join('logs', 'raw_ws');
    fsMod.mkdirSync(rawDir, { recursive: true });
    let rawFileHour = 0;
    let rawPath = '';
    const dumpRaw = (buf: Buffer) => {
      if (process.env.RAW_WS_DUMP === '0') return;
      const h = Math.floor(Date.now() / 3_600_000);
      if (h !== rawFileHour) {
        const d = new Date();
        const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}${String(d.getHours()).padStart(2, '0')}`;
        rawPath = pathMod.join(rawDir, `${sessionId}_${stamp}.ndjson`);
        rawFileHour = h;
      }
      try {
        fsMod.appendFileSync(
          rawPath,
          JSON.stringify({ t: Date.now(), r: roomId, b: buf.toString('base64') }) + '\n',
        );
      } catch {
        /* ignore */
      }
    };
    ws.on('message', (data: Buffer) => {
      dumpRaw(data);
      handlePackets(data);
    });
    ws.on('error', (e: any) => log('WS error', e?.message ?? e));
    ws.on('close', () => {
      if (hbTimer) clearInterval(hbTimer);
      if (ended) return;
      if (reconnectAttempts < 8) {
        reconnectAttempts++;
        log(`WS 断开，${reconnectAttempts * 2}s 后重连 (尝试 ${reconnectAttempts})`);
        setTimeout(connect, reconnectAttempts * 2000);
      } else {
        log('WS 多次重连失败，结束会话');
        void finalize();
      }
    });
  }

  pollTimer = setInterval(async () => {
    try {
      const st = await opts.getStatus();
      // 优先用 WS ONLINE_RANK_COUNT 的真实观众数（2分钟内有效），拿不到再回退人气值
      const sample =
        wsOnline != null && Date.now() - wsOnlineTs < 120_000
          ? wsOnline
          : st?.online ?? null;
      if (sample) {
        if (sample > currentPeak) currentPeak = sample;
        // 记录同接（在线人数）时间序列，每 30s 采样一次，用于绘制同接曲线
        void insertRtOnline(sessionId, now(), sample).catch(() => {});
      }
      if (currentPeak > 0) {
        void updateRtSessionPeak(sessionId, currentPeak).catch(() => {});
      }
      if (st && st.liveStatus === -1) {
        log('状态探测失败（-1），保持会话继续采集');
      } else if (!st || st.liveStatus !== 1) {
        // 0=未开播 2=轮播，均视为已下播
        log(`检测到非直播状态（liveStatus=${st?.liveStatus}），结束会话`);
        void finalize();
      }
    } catch {
      /* ignore */
    }
  }, 30_000);

  connect();
  await done;
}

// 数据追踪/同步等定时任务统一由内置调度器（lib/scheduler）按 job 表 cron 触发，
// 每次运行都会写 job_run 记录与日志，可在后台「运行记录」中查看（每 8 秒刷新，点击展开日志）。
async function main() {
  await loadBiliCookieFromDb();
  await ensureReady();
  const MONITOR_ROOM_ID = process.env.MONITOR_ROOM_ID?.trim() || '';
  const target = MONITOR_ROOM_ID || ROOM_ID;
  log(`守护进程启动，监控房间=${target}${MONITOR_ROOM_ID ? ' (MONITOR_ROOM_ID 覆盖)' : ` UID=${UID}`}`);
  if (!MONITOR_ROOM_ID) {
    // 仅主监控（李豆沙）作为后端常驻调度器，触发 job 表中的定时任务（含数据追踪/同步等）。
    void startScheduler();
  }
  // 守护进程心跳：用独立定时器持续刷新，避免主循环阻塞在 runSession（直播中）时
  // 心跳 KV 停止更新，导致后台误报“未运行”。
  const hbKey = MONITOR_ROOM_ID ? 'monitor_heartbeat_test' : 'monitor_heartbeat';
  const writeHb = () =>
    setKv(hbKey, JSON.stringify({ ts: Date.now(), roomId: target, pid: process.pid })).catch(() => {});
  writeHb();
  setInterval(writeHb, 20_000);
  while (true) {
    try {
      const st = MONITOR_ROOM_ID
        ? await getLiveStatusByRoom(MONITOR_ROOM_ID)
        : await getLiveStatusRaw();
      const getStatus = MONITOR_ROOM_ID
        ? () => getLiveStatusByRoom(MONITOR_ROOM_ID)
        : () => getLiveStatusRaw();
      if (st.liveStatus === 1 && st.roomId) {
        log(`检测到开播： ${st.title ?? ''}`);
        await runSession(st.roomId, st.title ?? '', { getStatus, online: st.online });
        await sleep(5_000);
      } else if (st.liveStatus !== -1) {
        // 非直播状态（0=未开播 2=轮播）：若存在遗留的未结束会话（如进程重启前），补收尾
        const stale = await getRtActiveSession(target).catch(() => null);
        if (stale) {
          const counts = await getRtCounts(stale.id).catch(() => ({
            danmaku: 0,
            sc: 0,
            gift: 0,
            interact: 0,
            enter: 0,
            follow: 0,
            giftCoin: 0,
          }));
          await finishRtSession(stale.id, now(), stale.online_peak ?? 0, counts);
          log(`■ 收尾遗留会话 ${stale.id}`);
        }
        log('未开播，等待…');
        await sleep(20_000);
      } else {
        log('状态探测失败，等待…');
        await sleep(20_000);
      }
    } catch (e: any) {
      log('轮询异常', e?.message);
      await sleep(20_000);
    }
  }
}

main().catch((e) => {
  console.error('[live-mon] fatal', e);
  process.exit(1);
});

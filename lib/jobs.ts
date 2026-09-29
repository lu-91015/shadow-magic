// 后台定时任务的处理器：每个 type 对应一段采集/识别逻辑。
// 所有 handler 复用 lib/* 与 scripts/sync-songs 的既有实现，避免重复造轮子。
import {
  fetchAllTagVideos,
  getVideoInfo,
  searchVideosByAuthor,
  getDynamics,
  getLivePlayList,
  getBiliSessSync,
  getFollowerStats,
  getGuardCounts,
  UID,
} from './bilibili';
import {
  upsertVideo,
  manualUpsertVideo,
  upsertDynamic,
  existsDynamic,
  getDynamicRaw,
  upsertLiveSession,
  queryDynamics,
  querySongStreams,
  createJobRun,
  finishJobRun,
  appendJobLog,
  getBlockedBvids,
  getDistinctAuthors,
  getPool,
  updateVideoPic,
  queryLiveStats,
  getClipCountByAuthor,
  getBlockedUps,
  getLatestClipPubdate,
  upsertFollowerStat,
  getLastFollowerStat,
  upsertGuardStat,
} from './db';
import { pullCommentsForOid } from './comments';
import { localizeDynImages } from './dynamics';
import { scanBvid } from '../scripts/sync-songs';
import { collectDanmakuForBvid } from '../scripts/sync-danmaku';
import { LIVE_SERIES_ID } from './constants';
import { notifyFailure } from './notify';

export type JobLogger = (msg: string) => void;

export const JOB_TYPES: { type: string; label: string; needPayload: boolean }[] = [
  { type: 'clips', label: '切片收集（标签投稿）', needPayload: false },
  { type: 'upscan', label: 'UP 切片补充扫描', needPayload: true },
  { type: 'upscanall', label: '全部 UP 切片补充扫描', needPayload: false },
  { type: 'covers', label: '切片封面补全', needPayload: false },
  { type: 'dynamics', label: '动态同步', needPayload: false },
  { type: 'comments', label: '评论同步', needPayload: false },
  { type: 'live', label: '直播回放同步', needPayload: false },
  { type: 'songs', label: '录播歌单识别（OCR）', needPayload: false },
  { type: 'danmaku', label: '直播弹幕收集', needPayload: false },
  { type: 'trackStats', label: '李豆沙数据追踪（粉丝/大航海）', needPayload: false },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 取消标志：存到 globalThis，跨模块热更新保持同一份引用，
// 这样即使任务在旧模块闭包中运行，新代码设置的取消也能被它读到。
const g = globalThis as any;
const cancelSet: Set<number> = (g.__cancelRuns ??= new Set<number>());
export function cancelRun(id: number): void {
  cancelSet.add(id);
}
export function isRunCancelled(id?: number): boolean {
  return id != null && cancelSet.has(id);
}

async function enrichAndSave(
  v: { bvid: string; title: string; author: string; pubdate: number; play: number; arcurl: string; pic?: string },
  manual: boolean,
  log: JobLogger,
): Promise<boolean> {
  const info = await getVideoInfo(v.bvid).catch(() => null);
  const row = {
    bvid: v.bvid,
    title: info?.title || v.title,
    author: info?.author || v.author,
    pubdate: info?.pubdate || v.pubdate,
    view: info?.view ?? v.play,
    like: info?.like ?? 0,
    coin: info?.coin ?? 0,
    share: info?.share ?? 0,
    favorite: info?.favorite ?? 0,
    reply: info?.reply ?? 0,
    danmaku: info?.danmaku ?? 0,
    arcurl: v.arcurl,
    pic: info?.pic || v.pic || undefined,
    manual,
  };
  const inserted = manual
    ? await manualUpsertVideo(row)
    : await upsertVideo(row, true);
  return inserted;
}

export async function runJob(
  type: string,
  payload: any,
  log: JobLogger,
  runId?: number,
): Promise<string> {
  switch (type) {
    case 'clips': {
      const blocked = new Set(await getBlockedBvids());
      // 增量起点：库内最新投稿时间。只收录比它更新的视频，避免每次全量回扫旧投稿。
      const cutoff = await getLatestClipPubdate();
      const now = Math.floor(Date.now() / 1000);
      // 让搜索接口只在增量窗口内返回（begin=库内最新+1 ~ end=现在），进一步减少无效拉取
      const range =
        cutoff > 0 ? { begin: cutoff + 1, end: now } : { end: now };
      const videos = await fetchAllTagVideos(50, true, range);
      let saved = 0;
      let skipped = 0;
      for (const v of videos) {
        if (isRunCancelled(runId)) {
          log('已取消，停止切片同步');
          break;
        }
        if (blocked.has(v.bvid)) continue;
        // 兜底：万一接口未严格按时间过滤，仍跳过不晚于库内最新投稿的视频
        if (cutoff && v.pubdate && v.pubdate <= cutoff) {
          skipped++;
          continue;
        }
        if (await enrichAndSave(v, false, log)) saved++;
        if (saved % 50 === 0) log(`已处理 ${saved}/${videos.length}`);
        await sleep(120);
      }
      const since = cutoff
        ? new Date(cutoff * 1000).toLocaleString('zh-CN')
        : '（库内无记录，首跑全量）';
      return `切片同步完成：${saved} 条新增，跳过 ${skipped} 条旧投稿（增量窗口 ${since} ~ ${new Date(now * 1000).toLocaleString('zh-CN')}）`;
    }
    case 'upscan': {
      const upname = (payload?.upname || '').trim();
      if (!upname) throw new Error('缺少 upname');
      const blocked = new Set(await getBlockedBvids());
      const blockedUps = new Set(
        (await getBlockedUps())
          .map((a) => a.author)
          .filter((a): a is string => typeof a === 'string')
          .map((a) => a.toLowerCase()),
      );
      const { videos, total } = await searchVideosByAuthor(upname, 100, payload.keyword);
      let inserted = 0;
      let authorName = videos.length ? videos[0].author : '';
      if (
        (authorName && blockedUps.has(authorName.toLowerCase())) ||
        blockedUps.has(upname.toLowerCase())
      ) {
        log(`${upname} | 该 UP 已被拉黑，跳过收集`);
        return `补充切片（${upname}）：该 UP 已拉黑，未收集`;
      }
      for (const v of videos) {
        if (isRunCancelled(runId)) {
          log('已取消，停止补充');
          break;
        }
        if (!authorName) authorName = v.author;
        if (blocked.has(v.bvid)) continue;
        if (await enrichAndSave(v, true, log)) inserted++;
        await sleep(120);
      }
      const dbCount = authorName ? await getClipCountByAuthor(authorName) : 0;
      log(`${upname} | 空间投稿 ${total} | 豆沙命中 ${videos.length} | 入库 ${inserted} | 库内现有 ${dbCount}`);
      return `补充切片（${upname}）：新增 ${inserted} 条，当前库内共 ${dbCount} 条`;
    }
    case 'upscanall': {
      const authors = await getDistinctAuthors();
      const blocked = new Set(await getBlockedBvids());
      const blockedUps = new Set(
        (await getBlockedUps())
          .map((a) => a.author)
          .filter((a): a is string => typeof a === 'string')
          .map((a) => a.toLowerCase()),
      );
      let total = 0;
      let scanned = 0;
      let skipped = 0;
      for (const author of authors) {
        if (isRunCancelled(runId)) {
          log('已取消，停止补充');
          break;
        }
        if (blockedUps.has(author.toLowerCase())) {
          skipped++;
          continue; // 已拉黑的 UP 整体跳过
        }
        scanned++;
        let videos: any[] = [];
        let upTotal = 0;
        try {
          const r = await searchVideosByAuthor(author, 100);
          videos = r.videos;
          upTotal = r.total;
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          log(`[${scanned}/${authors.length}] ${author} | 查询失败：${msg}`);
          // 风控 / cookie 失效等全局性问题：立即停止整个扫描，避免继续硬刷加重限流
          if (msg.includes('风控') || msg.includes('code=-101')) {
            log('检测到 B站风控或登录失效，停止补充以等待恢复（通常几分钟~几小时后自动解封，或更换 cookie）');
            break;
          }
        }
        let inserted = 0;
        for (const v of videos) {
          if (isRunCancelled(runId)) break;
          if (blocked.has(v.bvid)) continue;
          if (await enrichAndSave(v, true, log)) inserted++;
          await sleep(120);
        }
        const dbCount = await getClipCountByAuthor(author);
        log(`[${scanned}/${authors.length}] ${author} | 空间投稿 ${upTotal} | 豆沙命中 ${videos.length} | 入库 ${inserted} | 库内现有 ${dbCount}`);
        total += inserted;
        await sleep(500);
      }
      const skipNote = skipped > 0 ? `，跳过 ${skipped} 个已拉黑 UP` : '';
      return `全部 UP 补充切片：扫描 ${scanned} 个 UP，新增 ${total} 条${skipNote}`;
    }
    case 'covers': {
      const bvid = (payload?.bvid || '').trim();
      let rows: { bvid: string }[];
      if (bvid) {
        rows = [{ bvid }];
      } else {
        const { rows: r } = await getPool().query<{ bvid: string }>(
          `SELECT bvid FROM video_stat WHERE COALESCE(pic, '') = '' ORDER BY "view" DESC`,
        );
        rows = r;
      }
      let done = 0;
      let failed = 0;
      for (const { bvid } of rows) {
        const info = await getVideoInfo(bvid).catch(() => null);
        if (info?.pic) {
          await updateVideoPic(bvid, info.pic);
          done++;
        } else {
          failed++;
        }
        if (!bvid && done % 20 === 0) log(`已补全 ${done}/${rows.length}`);
        await sleep(120);
      }
      if (bvid) return `封面同步完成（${bvid}）：${done} 条`;
      return `封面补全完成：成功 ${done} / 失败(限流) ${failed}，剩余缺图 ${Math.max(rows.length - done - failed, 0)} 条`;
    }
    case 'dynamics': {
      const sess = getBiliSessSync();
      // 增量翻页：feed/space 第一页可能含置顶动态（时间较早），
      // 不能用“首条已存在即停”，而用“整页全部已存在即停”来终止，
      // 直到 has_more=false 或达到安全页数上限（避免翻太多触发风控）。
      // 这样既能拿到最新动态，也能覆盖被 feed/all 隐藏的转发类动态。
      let offset = '';
      let hasMore = true;
      let pages = 0;
      const MAX_PAGES = 8; // 覆盖最近若干天，足够增量
      let count = 0;
      let skipped = 0;
      while (hasMore && pages < MAX_PAGES) {
        const res = await getDynamics(UID, sess, offset, 1);
        const items = (res.items as any[]) ?? [];
        if (items.length === 0) break;
        let pageAllExist = true;
        for (const d of items) {
          const existed = await existsDynamic(d.id);
          if (!existed) {
            const d2 = await localizeDynImages(d);
            await upsertDynamic(d2);
            count++;
            pageAllExist = false;
          } else {
            skipped++;
            // 增量只插不更，但直播回放等动态首次入库时标题/bvid 可能尚未生成，
            // 之后接口补齐也不会再更新 → 首页“最新动态”显示“暂无”。
            // 因此：已存在记录缺标题、而本次抓取有标题时，补更（保留已本地化的图片）。
            const raw = await getDynamicRaw(d.id);
            if (raw && !raw.video?.title && d.video?.title && d.video.title.trim()) {
              const oldCover = raw.video?.cover ?? '';
              const merged = {
                ...raw,
                text: d.text || raw.text,
                video: {
                  ...(raw.video ?? { cover: '', title: '', bvid: '' }),
                  title: d.video.title,
                  bvid: d.video.bvid || raw.video?.bvid || '',
                  cover: oldCover.startsWith('/dynamics/')
                    ? oldCover
                    : d.video.cover || oldCover,
                },
              };
              await upsertDynamic(merged as any);
              count++;
              pageAllExist = false;
            }
          }
        }
        pages++;
        if (pageAllExist) break;
        offset = res.offset;
        hasMore = res.hasMore;
        await sleep(300);
      }
      log(`已同步 ${count} 条动态（新增），跳过 ${skipped} 条已存在，翻页 ${pages} 页`);
      return `动态同步完成：新增 ${count} 条，跳过 ${skipped} 条已存在`;
    }
    case 'comments': {
      const dyn = await queryDynamics();
      // 减小参与评论拉取的“动态数量”以降低总请求数（避免 412 风控），
      // 而不是减少每条动态的评论页数（每条动态仍按原逻辑拉取）。
      // 通过 payload.commentsDays 控制时间窗，缺省 7 天；0 表示不限制（全量）。
      const days = Number(payload?.commentsDays ?? 7) || 0;
      const cutoff = days > 0 ? Math.floor(Date.now() / 1000) - days * 86400 : 0;
      // queryDynamics 已按 pubdate DESC 返回，这里按 pubTime 过滤近期动态
      const targets = cutoff
        ? dyn.items.filter((d: any) => (d.pubTime ?? 0) >= cutoff)
        : dyn.items;
      let total = 0;
      for (const d of targets) {
        const n = await pullCommentsForOid(
          (d as any).commentId ?? d.id,
          (d as any).commentType ?? 11,
          50,
        ).catch(() => 0);
        total += n;
        await sleep(2000);
      }
      const scope = cutoff
        ? `最近 ${days} 天（${targets.length}/${dyn.items.length} 条动态）`
        : `全部 ${dyn.items.length} 条动态`;
      return `评论同步完成：新增 ${total} 条（${scope}）`;
    }
    case 'live': {
      const sessions: any[] = [];
      let page = 1;
      while (page <= 200) {
        const pl = await getLivePlayList(LIVE_SERIES_ID, Number(UID), page, 30).catch(
          () => null,
        );
        if (!pl || pl.items.length === 0) break;
        sessions.push(...pl.items);
        if (!pl.hasMore) break;
        page++;
        await sleep(400);
      }
      for (const s of sessions) if (s.liveId) await upsertLiveSession(s);
      return `直播回放同步完成：${sessions.length} 场`;
    }
    case 'songs': {
      if (payload?.bvid) {
        const r = await scanBvid(payload.bvid);
        return `识别 ${payload.bvid}：${r.songs} 首`;
      }
      const all = await querySongStreams();
      const todo = all.filter((r) => r.checkedAt == null);
      let ok = 0;
      for (const r of todo) {
        const res = await scanBvid(r.bvid).catch(() => ({ ok: false, songs: 0 }));
        if (res.ok) ok++;
        log(`已处理 ${r.bvid}`);
        await sleep(500);
      }
      return `歌单识别完成：${ok}/${todo.length} 场`;
    }
    case 'danmaku': {
      const bvid = (payload?.bvid || '').trim();
      if (bvid) {
        const r = await collectDanmakuForBvid(bvid);
        // 失败时抛错，使任务标记为“失败”而非静默“成功”
        if (!r.ok) {
          throw new Error(`弹幕收集（${bvid}）失败：${r.reason ?? '未知原因'}`);
        }
        return `弹幕收集（${bvid}）：${r.count} 条`;
      }
      const stats = await queryLiveStats();
      let done = 0;
      let failed = 0;
      const fails: string[] = [];
      for (const r of stats.replays) {
        const res = await collectDanmakuForBvid(r.id).catch((e: any) => ({
          ok: false,
          count: 0,
          reason: e?.message ?? '异常',
        }));
        if (res.ok) {
          done++;
        } else {
          failed++;
          fails.push(`${r.id}(${res.reason ?? '失败'})`);
        }
        log(`已处理 ${r.id}：${res.ok ? res.count + ' 条' : '失败'}`);
        await sleep(300);
      }
      const summary = `弹幕收集完成：${done} 成功 / ${failed} 失败，共 ${stats.replays.length} 场`;
      // 存在失败则抛错，让任务状态反映真实结果（定时任务会自动退避重试）
      if (failed > 0) {
        throw new Error(`${summary}${fails.length ? '；失败：' + fails.join('，') : ''}`);
      }
      return summary;
    }
    case 'trackStats': {
      const now = Math.floor(Date.now() / 1000);
      const curHour = now - (now % 3600); // 当前整点时间戳
      const dayStr = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD（本地时区）
      // 1) 每小时粉丝数（following 一并记录）
      //    若进程在整点离线导致错过若干小时，恢复时把缺口整点用“上一个已知值”补写，保证每小时都有行。
      const fs = await getFollowerStats().catch(() => null);
      if (fs && fs.follower != null) {
        const last = await getLastFollowerStat().catch(() => null);
        if (last && last.hour < curHour) {
          let carry = { follower: last.follower, following: last.following };
          for (let h = last.hour + 3600; h < curHour; h += 3600) {
            await upsertFollowerStat(h, carry.follower, carry.following);
            log(`补写缺口 小时桶 ${h} 粉丝=${carry.follower} 关注=${carry.following}`);
          }
        }
        await upsertFollowerStat(curHour, fs.follower, fs.following);
        log(`粉丝数=${fs.follower} 关注=${fs.following}（小时桶 ${curHour}）`);
      } else {
        log('粉丝数获取失败，跳过本小时记录');
      }
      // 2) 每天大航海（舰长/提督/总督）—— 同一天覆盖
      const gc = await getGuardCounts().catch(() => null);
      if (gc) {
        await upsertGuardStat(dayStr, gc.captain, gc.admiral, gc.governor, gc.total);
        log(
          `大航海 总督=${gc.governor} 提督=${gc.admiral} 舰长=${gc.captain} 合计=${gc.total}（${dayStr}）`,
        );
      } else {
        log('大航海获取失败，跳过本日记录');
      }
      if (!fs && !gc) throw new Error('粉丝与大航海均获取失败');
      return `数据追踪完成：粉丝=${fs?.follower ?? '失败'} 大航海 总督/提督/舰长=${gc?.governor ?? '?'}/${gc?.admiral ?? '?'}/${gc?.captain ?? '?'}`;
    }
    default:
      throw new Error(`未知任务类型：${type}`);
  }
}

// 手动「运行一次」：创建运行记录后异步执行，立即返回 runId（前端轮询 job-runs 看进度）。
export async function launchJob(
  type: string,
  payload: any,
  triggeredBy = 'manual',
): Promise<number> {
  const runId = await createJobRun({ job_id: null, type, triggered_by: triggeredBy });
  const log = (m: string) => {
    void appendJobLog(runId, m + '\n');
  };
  (async () => {
    try {
      const summary = await runJob(type, payload ?? {}, log, runId);
      if (isRunCancelled(runId)) {
        await finishJobRun(runId, 'cancelled', undefined, '已取消');
      } else {
        await finishJobRun(runId, 'success', undefined, '完成：' + summary);
      }
    } catch (e) {
      const err = (e as Error).message;
      await finishJobRun(runId, 'failed', err, '失败：' + err);
      void notifyFailure(
        `手动任务失败：${type}`,
        `类型 ${type} 的手动运行 #${runId} 失败。\n错误：${err}\n时间：${new Date().toLocaleString()}`,
      );
    } finally {
      cancelSet.delete(runId);
    }
  })();
  return runId;
}

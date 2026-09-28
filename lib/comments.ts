// 按动态评论 oid 拉取评论（含子回复）并入库。供脚本与 API 共用。
import { getDynamicCommentsPage, getDynamicSubReplies } from './bilibili';
import { upsertComment } from './db';

const DELAY = 1500; // 翻页间隔(ms)，放宽避免触发风控
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function pullCommentsForOid(
  oid: string,
  type = 11,
  maxPages = 50,
): Promise<number> {
  let pagination = '{"offset":""}';
  let pages = 0;
  let total = 0;
  // 收集"有子回复"的顶层评论，顶层翻完后再统一补全其子回复
  const rootsWithReplies: { rpid: string; count: number }[] = [];
  while (pages < maxPages) {
    let res;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        res = await getDynamicCommentsPage(oid, pagination, type);
        break;
      } catch (e) {
        if (attempt < 2) {
          console.warn(`  oid ${oid} 第 ${attempt + 1} 次重试…`);
          await sleep(1000 * (attempt + 1));
        } else {
          console.warn(`  oid ${oid} 评论拉取失败: ${(e as Error).message}`);
          return total;
        }
      }
    }
    if (!res) return total;
    for (const c of res.comments) {
      try {
        await upsertComment(c);
      } catch (e) {
        // 坏一条只跳过，不中断整个任务
        console.warn(`    评论 ${c.rpid} 入库失败，跳过: ${(e as Error).message}`);
      }
    }
    total += res.comments.length;
    for (const r of res.rootsWithReplies) rootsWithReplies.push(r);
    pages++;
    if (res.isEnd || !res.nextPagination) break;
    pagination = res.nextPagination;
    await sleep(DELAY);
  }

  // 补全每个有子回复的顶层评论的子回复（reply 端点分页拉全）
  for (const r of rootsWithReplies) {
    total += await pullSubReplies(oid, r.rpid, type);
    await sleep(DELAY);
  }
  return total;
}

// 拉取某条顶层评论下的全部子回复（x/v2/reply/reply 分页），逐条入库，返回入库条数。
async function pullSubReplies(
  oid: string,
  rootRpid: string,
  type: number,
): Promise<number> {
  const PS = 20;
  let pn = 1;
  let n = 0;
  for (;;) {
    let res;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        res = await getDynamicSubReplies(oid, type, rootRpid, pn, PS);
        break;
      } catch (e) {
        if (attempt < 2) {
          await sleep(1000 * (attempt + 1));
        } else {
          console.warn(
            `  oid ${oid} root ${rootRpid} 子回复拉取失败: ${(e as Error).message}`,
          );
          return n;
        }
      }
    }
    if (!res) return n;
    for (const c of res.comments) {
      try {
        await upsertComment(c);
      } catch (e) {
        console.warn(`    子回复 ${c.rpid} 入库失败，跳过: ${(e as Error).message}`);
      }
    }
    n += res.comments.length;
    if (res.isEnd || res.comments.length === 0) break;
    pn++;
    if (pn > 50) break; // 安全上限，避免极端情况死循环
    await sleep(DELAY);
  }
  return n;
}

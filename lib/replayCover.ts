import { apiGet, getBiliCookieSync } from './bilibili';
import { downloadImage } from './images';
import { getPool, ensureReady } from './db';
import path from 'path';

// 回放封面补全：live_session.id 即回放 BV 号，
// 通过 view 接口取封面图并下载到 public/replays/{bvid}.jpg。
// NULL = 未尝试；'' = 已尝试但拿不到（失效回放等），避免重复请求。

let _filling = false;

// 把一批缺封面的回放补上封面（带并发与休眠，防风控）
export async function fillReplayCovers(limit = 40): Promise<number> {
  if (_filling) return 0;
  _filling = true;
  try {
    await ensureReady();
    const { rows } = await getPool().query<{ id: string }>(
      `SELECT id FROM live_session WHERE cover IS NULL ORDER BY start_time DESC LIMIT $1`,
      [limit],
    );
    let ok = 0;
    for (const r of rows) {
      const done = await fetchOneCover(r.id);
      if (done) ok++;
      await new Promise((res) => setTimeout(res, 150)); // 轻微限速
    }
    return ok;
  } catch {
    return 0;
  } finally {
    _filling = false;
  }
}

async function fetchOneCover(bvid: string): Promise<boolean> {
  try {
    const j = await apiGet<any>(
      `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`,
    );
    const pic: string | undefined = j?.code === 0 ? j?.data?.pic : undefined;
    if (pic) {
      const file = `${bvid}.jpg`;
      const ok = await downloadImage(
        pic,
        path.join(process.cwd(), 'public', 'replays', file),
        { cookie: getBiliCookieSync() },
      );
      await setCover(bvid, ok ? `/replays/${file}` : pic);
      return true;
    }
    // 接口无数据（失效回放）：记空串表示已尝试
    await setCover(bvid, '');
    return false;
  } catch {
    // 网络异常：不写标记，下次再试
    return false;
  }
}

async function setCover(bvid: string, cover: string): Promise<void> {
  await getPool().query('UPDATE live_session SET cover=$2 WHERE id=$1', [bvid, cover]);
}

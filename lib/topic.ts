import path from 'path';
import { apiGet, getBiliCookieSync } from './bilibili';
import { downloadImage, imgExt } from './images';
import { queryTopicPosts, upsertTopicPost, countTopicPosts, TopicPostRow } from './db';

// 话题 #大熊猫豆漫#（topic_id=93294）的动态流，用于首页第二幕「豆漫墙」
export const TOPIC_ID = 93294;
export const TOPIC_URL =
  'https://www.bilibili.com/v/topic/detail?topic_id=93294&topic_name=%E5%A4%A7%E7%86%8A%E7%8C%AB%E8%B1%86%E6%BC%AB';

// 与 DB 行一致的对外结构（首页 TopicWall 使用）
export interface TopicPost {
  id: string;
  kind: 'video' | 'draw' | 'article' | 'text';
  author: string;
  /** 短日期，如 2024.04.08 */
  pubTime: string;
  text: string;
  image?: string;
  url: string;
}

interface TopicFeedList {
  has_more?: boolean;
  offset?: string;
  items?: Array<Record<string, any>>;
}

// 简单内存缓存，避免每次渲染都打B站接口
let _cache: { at: number; posts: TopicPost[] } | null = null;
const TTL = 10 * 60 * 1000;

function fmtPub(s?: string): string {
  if (!s) return '';
  return s.replace('年', '.').replace('月', '.').replace('日', '');
}

function rowToPost(r: TopicPostRow): TopicPost {
  return {
    id: r.id,
    kind: (r.kind as TopicPost['kind']) || 'text',
    author: r.author ?? '',
    pubTime: r.pub_time ?? '',
    text: r.text ?? '',
    image: r.image ?? undefined,
    url: r.url ?? `https://t.bilibili.com/${r.id}`,
  };
}

// 拉取 B站话题流并写库（upsert，保留手动开关）。返回新增/更新的条数。
export async function syncTopicPosts(limit = 18): Promise<number> {
  const fetched: TopicPost[] = [];
  let offset = '';
  for (let page = 0; page < 3 && fetched.length < limit; page++) {
    try {
      const j = await apiGet<any>(
        `https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/topic?topic_id=${TOPIC_ID}&offset=${encodeURIComponent(offset)}`,
      );
      const list: TopicFeedList | undefined = j?.data?.topic_card_list;
      const items = list?.items ?? [];
      for (const it of items) {
        if (fetched.length >= limit) break;
        const c = it?.dynamic_card_item;
        if (!c || c.visible === false) continue;
        const a = c.modules?.module_author ?? {};
        const d = c.modules?.module_dynamic ?? {};
        const major = d.major ?? {};
        const id = String(c.id_str ?? '');
        if (!id) continue;

        let kind: TopicPost['kind'] = 'text';
        let text: string = d.desc?.text ?? '';
        let image: string | undefined;
        let url = `https://t.bilibili.com/${id}`;

        if (c.type === 'DYNAMIC_TYPE_AV' && major.archive) {
          kind = 'video';
          text = major.archive.title || text;
          image = major.archive.cover || undefined;
          if (major.archive.bvid) {
            url = `https://www.bilibili.com/video/${major.archive.bvid}`;
          }
        } else if (c.type === 'DYNAMIC_TYPE_DRAW' && major.draw) {
          kind = 'draw';
          image = major.draw.items?.[0]?.src || undefined;
        } else if (c.type === 'DYNAMIC_TYPE_ARTICLE' && major.article) {
          kind = 'article';
          text = major.article.title || text;
          image = major.article.covers?.[0] || undefined;
        }

        text = (text || '').trim();
        if (!text && !image) continue;
        fetched.push({
          id,
          kind,
          author: a.name ?? '',
          pubTime: fmtPub(a.pub_time),
          text,
          image,
          url,
        });
      }
      if (!list?.has_more || !list?.offset) break;
      offset = list.offset;
    } catch {
      break;
    }
  }

  // 图片落盘到 public/topic/{id}/
  await localizeImages(fetched);

  let n = 0;
  for (const p of fetched) {
    await upsertTopicPost({
      id: p.id,
      kind: p.kind,
      author: p.author,
      pub_time: p.pubTime,
      text: p.text,
      image: p.image,
      url: p.url,
    });
    n++;
  }
  _cache = null; // 清缓存，下次读库取最新
  return n;
}

// 首页读取：优先读库（已入库、可后台管理）；库空时回退实时拉取（并尝试写库）
export async function getTopicPosts(limit = 18): Promise<TopicPost[]> {
  if (_cache && Date.now() - _cache.at < TTL && _cache.posts.length >= limit) {
    return _cache.posts.slice(0, limit);
  }
  const stored = await queryTopicPosts(true);
  let posts: TopicPost[];
  if (stored.length) {
    posts = stored.map(rowToPost);
  } else {
    // 首次 / 库空：实时拉取并写库
    await syncTopicPosts(limit);
    posts = (await queryTopicPosts(true)).map(rowToPost);
  }
  posts = posts.slice(0, limit);
  _cache = { at: Date.now(), posts };
  return posts;
}

export async function topicPostCount(): Promise<number> {
  return countTopicPosts();
}

// 把封面/图片下载到本地 public/topic/，避免热链失效（页面显示裂图）
async function localizeImages(posts: TopicPost[]): Promise<TopicPost[]> {
  const cookie = getBiliCookieSync();
  await Promise.all(
    posts.map(async (p) => {
      if (!p.image) return;
      const file = `img${imgExt(p.image)}`;
      const rel = `/topic/${p.id}/${file}`;
      const ok = await downloadImage(
        p.image,
        path.join(process.cwd(), 'public', 'topic', p.id, file),
        { cookie },
      );
      if (ok) p.image = rel;
    }),
  );
  return posts;
}

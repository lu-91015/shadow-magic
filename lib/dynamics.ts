export type { DynamicsData } from './db';
import type { DynItem } from './bilibili';
import fs from 'fs';
import path from 'path';
import { queryDynamics } from './db';
import { downloadImage, imgExt } from './images';

export async function readDynamics() {
  return queryDynamics();
}

// 按北京时间（Asia/Shanghai）把时间戳格式化为 YYYY-MM-DD
export function toCSTDate(tsSec: number): string {
  if (!tsSec) return '';
  const d = new Date(tsSec * 1000);
  const utc8 = new Date(d.getTime() + (d.getTimezoneOffset() + 480) * 60000);
  const y = utc8.getFullYear();
  const m = String(utc8.getMonth() + 1).padStart(2, '0');
  const day = String(utc8.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export interface DynamicsDay {
  date: string;
  count: number;
  items: DynItem[];
}

// 将动态按天分组（北京时间），每天一页
export function groupDynamicsByDay(items: DynItem[]): DynamicsDay[] {
  const map = new Map<string, DynItem[]>();
  for (const d of items) {
    const date = toCSTDate(d.pubTime);
    if (!date) continue;
    if (!map.has(date)) map.set(date, []);
    map.get(date)!.push(d);
  }
  const days: DynamicsDay[] = [];
  for (const [date, arr] of map) {
    arr.sort((a, b) => b.pubTime - a.pubTime);
    days.push({ date, count: arr.length, items: arr });
  }
  days.sort((a, b) => (a.date < b.date ? 1 : -1));
  return days;
}

// 把动态里的图片（含转发图、视频封面）下载到本地 public/dynamics/，
// 并将 DynItem 中的远程 URL 改写为本地路径；下载失败则保留远程，页面不崩。
const PUB_DIR = path.join(process.cwd(), 'public');

export async function localizeDynImages(
  d: DynItem,
  cookie = process.env.BILI_COOKIE ?? '',
): Promise<DynItem> {
  const dir = path.join(PUB_DIR, 'dynamics', d.id);
  const dl = async (u: string, name: string): Promise<string> => {
    const ext = imgExt(u);
    const file = `${name}${ext}`;
    const rel = `/dynamics/${d.id}/${file}`;
    const ok = await downloadImage(u, path.join(dir, file), { cookie });
    return ok ? rel : u;
  };
  const images = await Promise.all(d.images.map((u, i) => dl(u, `img${i}`)));
  const forward = d.forward
    ? {
        ...d.forward,
        images: await Promise.all(d.forward.images.map((u, i) => dl(u, `fwd${i}`))),
      }
    : undefined;
  const video = d.video
    ? { ...d.video, cover: await dl(d.video.cover, 'cover') }
    : undefined;
  return { ...d, images, forward, video };
}

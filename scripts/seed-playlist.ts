// 将 data/playlist.json 中的歌单写入 PostgreSQL。
// 用法：npm run seed:playlist
import fs from 'fs';
import path from 'path';
import { replacePlaylist } from '../lib/db';

const file = path.join(process.cwd(), 'data', 'playlist.json');

async function main() {
  const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
  const raw = data.songs ?? [];
  // data/playlist.json 的条目可能只含 title/artist/tags，补全 id/category/url 等必填字段
  const songs = raw.map((s: any, i: number) => ({
    id: s.id || String(i + 1),
    title: s.title,
    artist: s.artist ?? '',
    category: s.category || (s.tags && s.tags[0]) || '未分类',
    url: s.url || '',
    tags: s.tags || [],
  }));
  await replacePlaylist(songs);
  console.log(`歌单已写入数据库：${songs.length} 首`);
  process.exit(0);
}

main().catch((e) => {
  console.error('写入失败：', e);
  process.exit(1);
});

// 从指定动态（opus）下载全部李豆沙立绘到 public/characters/，并刷新 lib/characters.ts。
// 用法：npx tsx scripts/fetch-characters.ts
import fs from 'fs';
import path from 'path';
const f = path.join(process.cwd(), '.env');
if (fs.existsSync(f))
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
import { downloadImage, imgExt } from '../lib/images';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const OPUS_ID = '1157213040286892036';
const COOKIE = process.env.BILI_COOKIE ?? '';

async function main() {
  const url = `https://api.bilibili.com/x/polymer/web-dynamic/v1/detail?id=${OPUS_ID}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Referer: 'https://www.bilibili.com/', Cookie: COOKIE, Accept: 'application/json' },
    signal: AbortSignal.timeout(20000),
  });
  const j = (await res.json().catch(() => ({}))) as any;
  if (j?.code !== 0) {
    console.error('opus 详情获取失败：', j?.code, j?.message);
    process.exit(1);
  }
  const maj = j?.data?.item?.modules?.module_dynamic?.major;
  if (maj?.type !== 'MAJOR_TYPE_DRAW') {
    console.error('该动态不是图文类型，major.type =', maj?.type);
    process.exit(1);
  }
  const imgs: string[] = (maj.draw?.items ?? []).map((it: any) => it.src).filter(Boolean);
  console.log(`发现 ${imgs.length} 张立绘，开始下载…`);

  const dir = path.join(process.cwd(), 'public', 'characters');
  const entries: { name: string; src: string; caption?: string }[] = [];
  for (let i = 0; i < imgs.length; i++) {
    const ext = imgExt(imgs[i]);
    const file = `dousha-${i}${ext}`;
    const ok = await downloadImage(imgs[i], path.join(dir, file), { cookie: COOKIE });
    if (ok) {
      // 优先使用抠图版本（scripts/cutout-characters.ts 生成），不存在则回退原图
      const cutRel = `/characters/cut/${file.replace(/\.[^.]+$/, '.png')}`;
      const cutAbs = path.join(process.cwd(), 'public', 'characters', 'cut', file.replace(/\.[^.]+$/, '.png'));
      const src = fs.existsSync(cutAbs) ? cutRel : `/characters/${file}`;
      entries.push({ name: '李豆沙', src, caption: `立绘 ${i + 1}` });
      console.log(`  ✓ ${file}`);
    } else {
      console.warn(`  ✗ 下载失败，跳过 ${imgs[i]}`);
    }
  }

  // 写出 lib/characters.ts（覆盖式生成）
  const body = entries
    .map((e) => `  { name: ${JSON.stringify(e.name)}, src: ${JSON.stringify(e.src)}, caption: ${JSON.stringify(e.caption)} },`)
    .join('\n');
  const ts = `// 首页立绘循环展示配置（由 scripts/fetch-characters.ts 自动生成）。
// 立绘来自动态 opus/${OPUS_ID}，下载至 public/characters/。
export interface Character {
  name: string;
  src: string | null;
  caption?: string;
}

export const CHARACTERS: Character[] = [
${body}
];
`;
  fs.writeFileSync(path.join(process.cwd(), 'lib', 'characters.ts'), ts);
  console.log(`已生成 lib/characters.ts（${entries.length} 张立绘）`);
}
main().catch((e) => { console.error(e); process.exit(1); });

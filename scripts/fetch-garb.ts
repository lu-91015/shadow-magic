// 拉取李豆沙官方装扮「李豆沙与电子星海」(item_id=413365001) 的美术素材并本地化到 public/garb/
// 来源：B站装扮商城公开接口 x/garb/v2/mall/suit/detail（素材版权归装扮作者/B站所有，仅非官方资料站展示用）
// 用法：npx tsx scripts/fetch-garb.ts
import fs from 'fs';
import path from 'path';
import { downloadImage, imgExt } from '../lib/images';

(function loadEnv() {
  const f = path.join(process.cwd(), '.env');
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
})();

const SUIT_ID = '413365001';
const OUT_DIR = path.join(process.cwd(), 'public', 'garb');
const EMOJI_DIR = path.join(OUT_DIR, 'emojis');
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function apiGet(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Referer: 'https://www.bilibili.com/',
      Accept: 'application/json',
      Cookie: process.env.BILI_COOKIE ?? '',
    },
    signal: AbortSignal.timeout(20000),
  });
  return res.json().catch(() => null);
}

async function save(url: string, name: string): Promise<string | null> {
  if (!url || !url.includes('hdslb.com')) return null;
  const dest = path.join(OUT_DIR, name + imgExt(url));
  const ok = await downloadImage(url, dest);
  return ok ? '/garb/' + name + imgExt(url) : null;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(EMOJI_DIR, { recursive: true });

  let d: any = null;
  const res = await apiGet(
    `https://api.bilibili.com/x/garb/v2/mall/suit/detail?item_id=${SUIT_ID}`,
  );
  if (res?.data?.suit_items) {
    d = res.data;
    fs.writeFileSync(
      path.join(process.cwd(), 'data', `garb-suit-${SUIT_ID}.json`),
      JSON.stringify(d, null, 2),
    );
  } else {
    // 接口限流时回退到上次缓存的详情
    const cache = path.join(process.cwd(), 'data', `garb-suit-${SUIT_ID}.json`);
    if (fs.existsSync(cache)) {
      d = JSON.parse(fs.readFileSync(cache, 'utf8'));
      console.warn('接口未返回数据，使用本地缓存详情。');
    }
  }
  if (!d) {
    console.error('装扮详情不可用');
    process.exit(1);
  }

  const manifest: Record<string, string | string[] | null> = {
    name: d.name,
    suitId: SUIT_ID,
  };
  const P = d.properties ?? {};
  const si = d.suit_items ?? {};

  // 主视觉
  manifest.cover = await save(P.image_cover ?? si.skin?.[0]?.properties?.image_cover, 'cover');
  // 空间背景（横版 6 张）
  const bg = si.space_bg?.[0]?.properties ?? {};
  const bgs: string[] = [];
  for (let i = 1; i <= 6; i++) {
    const u = bg[`image${i}_landscape`];
    const local = await save(u, `space-bg-${i}`);
    if (local) bgs.push(local);
  }
  manifest.spaceBg = bgs;
  // 动态卡片背景
  const cardBg = si.card_bg?.[0]?.properties ?? {};
  manifest.cardBg = await save(
    cardBg.image_preview_small ?? cardBg.image,
    'card-bg',
  );
  // 粉丝卡片
  const card = si.card?.[0]?.properties ?? {};
  manifest.fanCard = await save(card.image ?? card.fans_image, 'fan-card');
  // 启动图 / 点赞预览 / 头图
  const loading = si.loading?.[0]?.properties ?? {};
  manifest.loading = await save(loading.image_preview_small, 'loading');
  const thumbup = si.thumbup?.[0]?.properties ?? {};
  manifest.thumbup = await save(thumbup.image_preview, 'thumbup');
  const skin = si.skin?.[0]?.properties ?? {};
  manifest.headBg = await save(skin.head_bg, 'head-bg');

  // 装扮表情包
  const emojiPkg = si.emoji_package?.[0]?.properties ?? {};
  let emojis: Array<{ name: string; src: string }> = [];
  if (emojiPkg.item_emoji_list) {
    const list =
      typeof emojiPkg.item_emoji_list === 'string'
        ? JSON.parse(emojiPkg.item_emoji_list)
        : emojiPkg.item_emoji_list;
    for (const e of list) {
      if (!e?.image || !e?.name) continue;
      const dest = path.join(EMOJI_DIR, e.name + imgExt(e.image));
      if (await downloadImage(e.image, dest)) {
        emojis.push({ name: e.name, src: '/garb/emojis/' + e.name + imgExt(e.image) });
      }
    }
  }
  manifest.emojis = emojis.map((e) => e.src);

  fs.writeFileSync(
    path.join(process.cwd(), 'data', 'garb-assets.json'),
    JSON.stringify(manifest, null, 2),
  );
  console.log('装扮素材下载完成：');
  console.log(JSON.stringify(manifest, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

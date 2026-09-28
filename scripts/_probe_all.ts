import fs from 'fs';
import path from 'path';
const f = path.join(process.cwd(), '.env');
if (fs.existsSync(f))
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
const UID = '1703797642';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const FEATURES =
  'itemOpusStyle,listOnlyfans,opusBigCover,onlyfansVote,decorationCard,onlyfansAssetsV2,forwardListHidden,ugcDelete,onlyfansQaCard,commentsNewVersion,avatarAutoTheme,sunflowerStyle,cardsEnhance,eva3CardOpus,eva3CardVideo,eva3CardComment,eva3CardVote,eva3CardUser';
const LOCALE = JSON.stringify({ c_locale: { language: 'zh', script: 'Hans' }, always_translate: false });
const DEVICE = JSON.stringify({ platform: 'web', device: 'pc', spmid: '0.0', mobi_app: 'web_cn' });

async function fetchPage(offset: string, page: number) {
  const url =
    `https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/all?` +
    `host_mid=${UID}&offset=${encodeURIComponent(offset)}&page=${page}&platform=web` +
    `&features=${encodeURIComponent(FEATURES)}&web_location=0.0` +
    `&x-bili-locale-json=${encodeURIComponent(LOCALE)}` +
    `&x-bili-device-req-json=${encodeURIComponent(DEVICE)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Referer: 'https://space.bilibili.com/', Cookie: process.env.BILI_COOKIE ?? '', Accept: 'application/json' },
    signal: AbortSignal.timeout(20000),
  });
  const j = (await res.json()) as any;
  return j;
}

async function main() {
  let offset = '';
  let page = 1;
  let count = 0;
  let earliest = Date.now() / 1000;
  let newest = 0;
  let hasMore = true;
  while (hasMore && count < 8000) {
    const j = await fetchPage(offset, page);
    const items = j?.data?.items ?? [];
    const code = j?.code;
    const off = j?.data?.offset ?? '';
    hasMore = Boolean(j?.data?.has_more);
    for (const it of items) {
      const ts = Number(it?.modules?.module_author?.pub_ts ?? 0);
      if (ts) {
        count++;
        if (ts < earliest) earliest = ts;
        if (ts > newest) newest = ts;
      }
    }
    offset = off;
    page++;
    if (page % 10 === 0)
      console.log(`page=${page} count=${count} earliest=${new Date(earliest * 1000).toISOString().slice(0, 10)} newest=${new Date(newest * 1000).toISOString().slice(0, 10)} code=${code} hasMore=${hasMore}`);
    await new Promise((r) => setTimeout(r, 350));
  }
  console.log('=== 结果 ===');
  console.log('总条数:', count);
  console.log('最早:', new Date(earliest * 1000).toISOString());
  console.log('最新:', new Date(newest * 1000).toISOString());
}
main().catch((e) => console.error(e));

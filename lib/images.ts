// 把 B站 CDN 图片下载到本地 public/ 目录，避免页面长期热链导致图片失效。
import fs from 'fs';
import path from 'path';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// 从 URL 推断扩展名（去掉 @尺寸 后缀）
export function imgExt(url: string): string {
  const m = url
    .split('?')[0]
    .match(/\.(jpe?g|png|webp|gif)(?:@.*)?$/i);
  if (!m) return '.jpg';
  const e = m[1].toLowerCase();
  return e === 'jpeg' ? '.jpg' : '.' + e;
}

// 下载图片到 destPath；成功返回 true。文件已存在则视为已下载，直接返回 true。
export async function downloadImage(
  url: string,
  destPath: string,
  opts: { cookie?: string; force?: boolean } = {},
): Promise<boolean> {
  if (!opts.force && fs.existsSync(destPath)) return true;
  try {
    const u = url.startsWith('//') ? 'https:' + url : url;
    const headers: Record<string, string> = {
      'User-Agent': UA,
      Referer: 'https://www.bilibili.com/',
    };
    if (opts.cookie) headers['Cookie'] = opts.cookie;
    const res = await fetch(u, {
      headers,
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      console.warn(`  图片下载失败 ${res.status}: ${u}`);
      return false;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, buf);
    return true;
  } catch (e) {
    console.warn(`  图片下载异常: ${url} -> ${(e as Error).message}`);
    return false;
  }
}

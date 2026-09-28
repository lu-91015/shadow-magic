'use client';

import { useMemo } from 'react';
import type { ClipRow } from '@/lib/db';

function fmtWan(n: number): string {
  if (n >= 100000000) return (n / 100000000).toFixed(2) + ' 亿';
  if (n >= 10000) return (n / 10000).toFixed(1) + ' 万';
  return n.toLocaleString();
}

// 低质量小图，换取更多切片格
function thumb(pic: string | null | undefined): string | null {
  if (!pic) return null;
  let url = pic.startsWith('//') ? 'https:' + pic : pic;
  if (url.includes('hdslb.com') && !url.includes('@')) {
    url += '@64w_64h.webp';
  }
  return url;
}

// 提高切片数量：更大网格
const COLS = 100;
const ROWS = 76;

const inEll =
  (cx: number, cy: number, rx: number, ry: number) =>
  (nx: number, ny: number): boolean =>
    ((nx - cx) ** 2) / (rx * rx) + ((ny - cy) ** 2) / (ry * ry) <= 1;

// 图案 1：豆沙骑扫把（向右上倾斜）
function zoneWitch(nx: number, ny: number): 0 | 1 | 2 {
  const star = inEll(0.56, 0.09, 0.028, 0.028)(nx, ny);
  const cone = inEll(0.46, 0.17, 0.105, 0.1)(nx, ny);
  const brim = inEll(0.47, 0.265, 0.185, 0.042)(nx, ny);
  const head = inEll(0.5, 0.42, 0.175, 0.155)(nx, ny);
  const eyeL = inEll(0.435, 0.44, 0.028, 0.04)(nx, ny);
  const eyeR = inEll(0.565, 0.44, 0.028, 0.04)(nx, ny);
  const body = inEll(0.5, 0.65, 0.1, 0.095)(nx, ny);
  const legL = inEll(0.45, 0.755, 0.038, 0.05)(nx, ny);
  const legR = inEll(0.55, 0.755, 0.038, 0.05)(nx, ny);
  const t = (nx - 0.2) / 0.52;
  const handleY = 0.845 - 0.09 * t;
  const handle = t >= 0 && t <= 1 && Math.abs(ny - handleY) <= 0.028;
  const brush = inEll(0.72, 0.745, 0.075, 0.055)(nx, ny);

  if (
    !(star || cone || brim || head || eyeL || eyeR || body || legL || legR || handle || brush)
  )
    return 0;
  if (head) return eyeL || eyeR ? 2 : 1;
  if (star) return 1;
  return 2;
}

export default function PandaClips({ clips }: { clips: ClipRow[] }) {
  // 单一图案：骑扫把。一次性算好所有落在熊猫上的格子，
  // 只渲染这些格子（约半数），避免 7600 个网格节点全量创建。
  const filled = useMemo(() => {
    const out: { x: number; y: number; zone: 0 | 1 | 2; clip: ClipRow | null }[] = [];
    const n = clips.length;
    let on = 0;
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const z = zoneWitch((x + 0.5) / COLS, (y + 0.5) / ROWS);
        if (z === 0) continue;
        const clip = n ? clips[on % n] : null;
        on++;
        out.push({ x, y, zone: z, clip });
      }
    }
    return out;
  }, [clips]);

  if (clips.length === 0) {
    return (
      <div className="text-sm text-white/40">
        暂无切片数据。运行 <code>npm run sync</code> 同步标签投稿后即可展示。
      </div>
    );
  }

  const cw = 100 / COLS;
  const ch = 100 / ROWS;

  return (
    <div className="absolute inset-0 [content-visibility:auto] [contain-intrinsic-size:auto_100%]">
      {filled.map(({ x, y, zone: z, clip }) => {
        const src = thumb(clip?.pic);
        const bg = clip
          ? `hsl(${(clip.bvid.charCodeAt(0) ?? 0) * 37 % 360} 30% 18%)`
          : 'transparent';
        return (
          <a
            key={`${x}-${y}`}
            href={clip?.arcurl || `https://www.bilibili.com/video/${clip?.bvid}`}
            target="_blank"
            rel="noreferrer"
            title={
              clip
                ? `${clip.title}\n切片man：${clip.author}\n播放 ${fmtWan(Number(clip.view))}`
                : undefined
            }
            className="absolute overflow-hidden"
            style={{
              left: `${x * cw}%`,
              top: `${y * ch}%`,
              width: `${cw}%`,
              height: `${ch}%`,
              background: bg,
            }}
          >
            {src && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={src}
                alt=""
                referrerPolicy="no-referrer"
                loading="lazy"
                decoding="async"
                className={`absolute inset-0 w-full h-full object-cover ${
                  z === 2 ? 'brightness-[.45]' : 'brightness-125'
                }`}
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.visibility =
                    'hidden';
                }}
              />
            )}
          </a>
        );
      })}
    </div>
  );
}

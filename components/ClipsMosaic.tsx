'use client';

import { useMemo, useState } from 'react';
import type { ClipRow } from '@/lib/db';

function fmtWan(n: number): string {
  if (n >= 100000000) return (n / 100000000).toFixed(2) + ' 亿';
  if (n >= 10000) return (n / 10000).toFixed(1) + ' 万';
  return n.toLocaleString();
}

type SortKey = 'view' | 'pubdate' | 'like';

export default function ClipsMosaic({ clips }: { clips: ClipRow[] }) {
  const [year, setYear] = useState<string>('all');
  const [sort, setSort] = useState<SortKey>('view');
  const [limit, setLimit] = useState(120);

  const years = useMemo(() => {
    const s = new Set<number>();
    for (const c of clips) s.add(new Date(c.pubdate * 1000).getFullYear());
    return Array.from(s).sort((a, b) => b - a);
  }, [clips]);

  const shown = useMemo(() => {
    const list = clips.filter(
      (c) =>
        year === 'all' ||
        new Date(c.pubdate * 1000).getFullYear() === Number(year),
    );
    const sorted = [...list].sort((a, b) =>
      sort === 'pubdate' ? b.pubdate - a.pubdate : b[sort] - a[sort],
    );
    return sorted.slice(0, limit);
  }, [clips, year, sort, limit]);

  return (
    <div>
      {/* 筛选栏 */}
      <div className="flex flex-wrap items-center gap-2 mb-4 text-sm">
        <select
          value={year}
          onChange={(e) => setYear(e.target.value)}
          className="bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-white/80"
        >
          <option value="all">全部年份</option>
          {years.map((y) => (
            <option key={y} value={String(y)}>
              {y} 年
            </option>
          ))}
        </select>
        <div className="flex gap-1">
          {(
            [
              ['view', '按播放'],
              ['like', '按点赞'],
              ['pubdate', '按最新'],
            ] as [SortKey, string][]
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setSort(k)}
              className={`px-3 py-1.5 rounded-full transition ${
                sort === k
                  ? 'bg-white/10 text-brand-100'
                  : 'text-white/50 hover:text-brand-100 hover:bg-white/5'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="text-xs text-white/40 ml-auto">
          显示 {shown.length} / {clips.length} 条切片 · 每格即一条切片
        </span>
      </div>

      {/* 马赛克墙：每一个格子就是一条切片 */}
      <div className="grid gap-1.5 [grid-template-columns:repeat(auto-fill,minmax(150px,1fr))]">
        {shown.map((c) => (
          <a
            key={c.bvid}
            href={c.arcurl || `https://www.bilibili.com/video/${c.bvid}`}
            target="_blank"
            rel="noreferrer"
            title={`${c.title}\n切片man：${c.author}\n播放 ${fmtWan(Number(c.view))}`}
            className="clip-tile group relative aspect-video rounded-md overflow-hidden bg-white/5 [content-visibility:auto] [contain-intrinsic-size:auto_180px]"
          >
            <div
              className="absolute inset-0"
              style={{
                background: `hsl(${(c.bvid.charCodeAt(0) * 37) % 360} 30% 18%)`,
              }}
            />
            {c.pic ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={c.pic.startsWith('//') ? 'https:' + c.pic : c.pic}
                alt={c.title}
                referrerPolicy="no-referrer"
                loading="lazy"
                decoding="async"
                className="absolute inset-0 w-full h-full object-cover transition duration-300 group-hover:scale-110"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = 'none';
                }}
              />
            ) : null}
            <div className="absolute inset-x-0 bottom-0 p-1.5 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition">
              <div className="text-[11px] leading-tight text-white/90 line-clamp-2">
                {c.title}
              </div>
              <div className="text-[10px] text-white/50 mt-0.5 truncate">
                {c.author} · {fmtWan(Number(c.view))} 播放
              </div>
            </div>
          </a>
        ))}
      </div>

      {shown.length < clips.length && (
        <div className="mt-6 text-center">
          <button
            onClick={() => setLimit((l) => l + 120)}
            className="glass px-6 py-2 text-sm text-brand-100 hover:bg-white/10 transition"
          >
            加载更多（剩余 {clips.length - shown.length} 条）
          </button>
        </div>
      )}
    </div>
  );
}

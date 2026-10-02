'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

type FreqRow = { title: string; count: number };

const RANGES = [
  { key: '30', label: '近一个月' },
  { key: '90', label: '近三个月' },
  { key: 'all', label: '全部' },
] as const;

export default function SongFreqPage() {
  const [range, setRange] = useState<string>('30');
  const [list, setList] = useState<FreqRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (r: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/song-freq?days=${r}`, { cache: 'no-store' });
      const j = await res.json();
      setList(j.list || []);
    } catch {
      setList([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(range);
  }, [range, load]);

  const max = list.reduce((m, x) => Math.max(m, x.count), 1);

  return (
    <main className="min-h-screen bg-neutral-950 text-white">
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <Link
            href="/"
            className="rounded-full border border-white/15 bg-white/10 px-4 py-1.5 text-sm text-white/80 transition hover:bg-white/20"
          >
            ← 返回首页
          </Link>
          <h1 className="text-2xl font-bold">🎵 唱歌频率统计</h1>
        </div>

        <div className="mb-6 flex gap-2">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={`rounded-full px-4 py-1.5 text-sm transition ${
                range === r.key
                  ? 'bg-brand-500 font-semibold text-white shadow-lg shadow-brand-500/30'
                  : 'border border-white/15 bg-white/10 text-white/70 hover:bg-white/20'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>

        {loading ? (
          <p className="py-16 text-center text-white/40">加载中…</p>
        ) : list.length === 0 ? (
          <p className="py-16 text-center text-white/40">该时间段暂无识别记录</p>
        ) : (
          <ol className="space-y-2">
            {list.map((x, i) => (
              <li
                key={x.title}
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-3"
              >
                <div className="flex items-baseline gap-3">
                  <span className="w-8 shrink-0 text-right text-sm tabular-nums text-white/40">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium" title={x.title}>
                    {x.title}
                  </span>
                  <span className="shrink-0 text-sm font-bold tabular-nums text-rose-300">
                    {x.count} 次
                  </span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-brand-400 to-rose-400"
                    style={{ width: `${Math.max(4, (x.count / max) * 100)}%` }}
                  />
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </main>
  );
}

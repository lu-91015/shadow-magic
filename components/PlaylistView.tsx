'use client';

import { useMemo, useState } from 'react';
import type { Song } from '@/lib/playlist';

const FIXED_CATEGORIES = [
  '全部',
  '日文',
  '偶像',
  '元气',
  '安静',
  '甜歌',
  '中文',
  '萌宠',
  '古风',
  '苦情',
];

function firstLetter(title: string): string {
  const c = title.trim()[0] ?? '#';
  return /[a-zA-Z]/.test(c) ? c.toUpperCase() : '#';
}

export default function PlaylistView({ songs }: { songs: Song[] }) {
  const [cat, setCat] = useState('全部');

  const categories = useMemo(() => {
    const exist = new Set<string>();
    songs.forEach((s) => s.tags?.forEach((t) => exist.add(t)));
    return FIXED_CATEGORIES.filter((c) => c === '全部' || exist.has(c));
  }, [songs]);

  const filtered = useMemo(
    () => (cat === '全部' ? songs : songs.filter((s) => s.tags?.includes(cat))),
    [songs, cat],
  );

  const grouped = useMemo(() => {
    const map = new Map<string, Song[]>();
    for (const s of filtered) {
      const l = firstLetter(s.title);
      if (!map.has(l)) map.set(l, []);
      map.get(l)!.push(s);
    }
    return Array.from(map.entries()).sort((a, b) =>
      a[0] === '#' ? 1 : b[0] === '#' ? -1 : a[0].localeCompare(b[0]),
    );
  }, [filtered]);

  const letters = grouped.map(([l]) => l);

  return (
    <div>
      {/* 分类筛选 */}
      <div className="flex flex-wrap gap-2 mb-6">
        {categories.map((c) => (
          <button
            key={c}
            onClick={() => setCat(c)}
            className={`px-3 py-1 rounded-full text-sm transition ${
              cat === c
                ? 'bg-brand-500 text-white'
                : 'bg-white/10 text-brand-100 hover:bg-white/20'
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      {/* 字母索引 */}
      <div className="flex flex-wrap gap-1 mb-6 text-xs text-brand-200">
        {letters.map((l) => (
          <a key={l} href={`#letter-${l}`} className="px-1 hover:text-brand-400">
            {l}
          </a>
        ))}
      </div>

      {/* 分组列表 */}
      <div className="space-y-6">
        {grouped.map(([letter, list]) => (
          <div key={letter} id={`letter-${letter}`}>
            <div className="text-brand-300 font-semibold mb-2">{letter}</div>
            <ul className="space-y-1">
              {list.map((s, i) => (
                <li
                  key={i}
                  className="flex items-center justify-between py-1.5 px-3 rounded-lg hover:bg-white/5"
                >
                  <span className="text-brand-50">
                    {s.title}
                    <span className="text-white/40 text-sm ml-2">
                      - {s.artist}
                    </span>
                  </span>
                  <span className="flex gap-1">
                    {s.tags?.map((t) => (
                      <span key={t} className="chip">
                        {t}
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

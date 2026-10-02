'use client';

import { useEffect, useState } from 'react';

// 装扮「李豆沙与电子星海」官方空间背景（scripts/fetch-garb.ts 下载至 public/garb/）
const BACKGROUNDS = [
  '/garb/space-bg-1.jpg',
  '/garb/space-bg-2.jpg',
  '/garb/space-bg-3.jpg',
  '/garb/space-bg-4.jpg',
  '/garb/space-bg-5.jpg',
  '/garb/space-bg-6.jpg',
];

// 首幕背景：装扮官方背景图轮换 + 暗色遮罩保证文字可读
export default function GarbBackdrop() {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setIdx((i) => (i + 1) % BACKGROUNDS.length), 8000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {BACKGROUNDS.map((src, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={src}
          src={src}
          alt=""
          loading={i === 0 ? 'eager' : 'lazy'}
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-[2000ms] ${
            i === idx ? 'opacity-100' : 'opacity-0'
          }`}
        />
      ))}
      {/* 遮罩：保证前景文字可读（调淡以提亮整体色调） */}
      <div className="absolute inset-0 bg-ink-900/40" />
      <div className="absolute inset-0 bg-gradient-to-b from-ink-900/20 via-transparent to-ink-900/55" />
    </div>
  );
}

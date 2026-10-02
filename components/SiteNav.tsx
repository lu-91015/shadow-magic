'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

const SPACE_URL = 'https://space.bilibili.com/1703797642';
const NAV = [
  { href: '/', label: '首页' },
  { href: '/dynamics', label: '动态' },
];
// 更多入口：分幕与资料页（这些页面也可从首页按钮 / 滚动直达）
const MORE = [
  { href: '/tracks', label: '🐾 熊猫活动轨迹' },
  { href: '/wardrobe', label: '🧩 熊猫衣柜' },
  { href: '/songs', label: '🎤 歌回歌单' },
  { href: '/playlist', label: '🎵 歌单' },
  { href: '/clips', label: '📼 切片墙' },
  { href: '/comments', label: '💬 评论' },
  { href: '/danmaku', label: '🎯 弹幕' },
  { href: '/shop', label: '🛍️ 商店' },
  { href: '/assets', label: '📦 素材库' },
  { href: '/news', label: '📢 通知' },
  { href: '/stats', label: '📊 数据总览' },
];

export default function SiteNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  // 点击外部 / 路由变化后关闭「更多」
  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node))
        setMoreOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  return (
    <header className="fixed top-0 inset-x-0 z-50 bg-ink-900/70 backdrop-blur-md border-b border-white/10">
      <div className="max-w-6xl mx-auto h-12 px-4 flex items-center justify-between">
        <Link href="/" className="font-semibold text-brand-200 shrink-0">
          李豆沙<span className="text-white/50 text-sm">_Channel</span>
        </Link>
        <nav className="hidden sm:flex items-center gap-1 text-sm">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`px-3 py-1.5 rounded-full transition ${
                isActive(n.href)
                  ? 'bg-white/10 text-brand-100'
                  : 'text-white/60 hover:text-brand-100 hover:bg-white/5'
              }`}
            >
              {n.label}
            </Link>
          ))}

          {/* 更多下拉 */}
          <div className="relative" ref={moreRef}>
            <button
              onClick={() => setMoreOpen((v) => !v)}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-full transition ${
                MORE.some((m) => isActive(m.href))
                  ? 'bg-white/10 text-brand-100'
                  : 'text-white/60 hover:text-brand-100 hover:bg-white/5'
              }`}
              aria-expanded={moreOpen}
            >
              更多 <span className="text-[10px]">▾</span>
            </button>
            {moreOpen && (
              <div className="absolute right-0 top-full mt-1 w-44 rounded-xl border border-white/10 bg-ink-900/95 py-1 shadow-xl backdrop-blur">
                {MORE.map((m) => (
                  <Link
                    key={m.href}
                    href={m.href}
                    className={`block px-3 py-2 text-sm transition hover:bg-white/10 ${
                      isActive(m.href) ? 'text-brand-100' : 'text-white/70'
                    }`}
                  >
                    {m.label}
                  </Link>
                ))}
              </div>
            )}
          </div>

          <a
            href={SPACE_URL}
            target="_blank"
            rel="noreferrer"
            className="px-3 py-1.5 rounded-full text-white/60 hover:text-brand-100 hover:bg-white/5 transition"
          >
            B站空间 ↗
          </a>
        </nav>
        {/* 移动端菜单 */}
        <button
          className="sm:hidden text-white/70 px-2 py-1"
          onClick={() => setOpen((v) => !v)}
          aria-label="菜单"
        >
          ☰
        </button>
      </div>
      {open && (
        <nav className="sm:hidden border-t border-white/10 bg-ink-900/95 px-4 py-2 flex flex-col text-sm">
          {NAV.concat(MORE, [{ href: SPACE_URL, label: 'B站空间 ↗' }]).map((n) => (
            <Link
              key={n.href}
              href={n.href}
              onClick={() => setOpen(false)}
              className={`px-3 py-2 rounded-lg ${
                isActive(n.href) ? 'bg-white/10 text-brand-100' : 'text-white/70'
              }`}
            >
              {n.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}

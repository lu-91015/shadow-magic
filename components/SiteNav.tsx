'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

const SPACE_URL = 'https://space.bilibili.com/1703797642';
const NAV = [
  { href: '/', label: '首页' },
  { href: '/clips', label: '切片墙' },
  { href: '/playlist', label: '歌单' },
  { href: '/dynamics', label: '动态' },
  { href: '/songs', label: '歌回歌单' },
];

export default function SiteNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

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
          {NAV.concat([{ href: SPACE_URL, label: 'B站空间 ↗' }]).map((n) => (
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

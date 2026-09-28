'use client';

import { useEffect, useState } from 'react';

// 右侧幕导航：指示当前整屏分幕位置，点击平滑切换到对应幕
const SCREENS = [
  { id: 'screen-hero', label: '首页' },
  { id: 'screen-clips', label: '切片墙' },
  { id: 'screen-portal', label: '更多入口' },
];

export default function ScreenNav() {
  const [active, setActive] = useState('screen-hero');

  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setActive(e.target.id);
        }
      },
      { threshold: 0.55 },
    );
    SCREENS.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) obs.observe(el);
    });
    return () => obs.disconnect();
  }, []);

  const goTo = (id: string) => {
    document
      .getElementById(id)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <nav className="fixed right-3 top-1/2 -translate-y-1/2 z-40 flex flex-col gap-2.5">
      {SCREENS.map((s) => (
        <button
          key={s.id}
          onClick={() => goTo(s.id)}
          title={s.label}
          aria-label={s.label}
          className="group relative flex items-center justify-end"
        >
          <span className="pointer-events-none mr-2 hidden md:inline text-xs text-white/60 opacity-0 group-hover:opacity-100 transition whitespace-nowrap">
            {s.label}
          </span>
          <span
            className={`w-2.5 h-2.5 rounded-full transition ring-1 ring-white/20 ${
              active === s.id
                ? 'bg-brand-200 scale-110'
                : 'bg-white/25 group-hover:bg-white/60'
            }`}
          />
        </button>
      ))}
    </nav>
  );
}

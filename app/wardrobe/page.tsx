'use client';

import { useEffect, useRef, useState } from 'react';

const FALLBACK: { src: string; name: string }[] = [
  { src: '/characters/dousha-0.png', name: '立绘 01' },
  { src: '/characters/dousha-1.png', name: '立绘 02' },
  { src: '/characters/dousha-2.jpg', name: '立绘 03' },
  { src: '/characters/dousha-3.png', name: '立绘 04' },
  { src: '/characters/dousha-4.jpg', name: '立绘 05' },
  { src: '/characters/dousha-5.png', name: '立绘 06' },
  { src: '/characters/dousha-6.jpg', name: '立绘 07' },
  { src: '/characters/dousha-7.png', name: '立绘 08' },
  { src: '/characters/dousha-8.png', name: '立绘 09' },
  { src: '/characters/dousha-9.png', name: '立绘 10' },
  { src: '/characters/dousha-11.png', name: '立绘 11' },
];

const BASE_PX = 70;
const SPEEDS = [
  { label: '正常', mult: 1 },
  { label: '2×', mult: 2 },
  { label: '5×', mult: 5 },
  { label: '10×', mult: 10 },
];

export default function WardrobePage() {
  const [chars, setChars] = useState<{ src: string; name: string }[]>(FALLBACK);
  const [mult, setMult] = useState(1);
  const [active, setActive] = useState<number | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef(0);
  const multRef = useRef(mult);
  const pausedRef = useRef(false);
  multRef.current = mult;

  // 优先读取后台上传的立绘，为空则回退静态资源
  useEffect(() => {
    fetch('/api/characters')
      .then((r) => r.json())
      .then((j) => {
        const list = j?.list;
        if (Array.isArray(list) && list.length) {
          setChars(
            list.map((c: any) => ({
              src: c.src,
              name: c.name || c.caption || '立绘',
            })),
          );
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    pausedRef.current = active !== null;
  }, [active]);

  useEffect(() => {
    if (active === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActive(null);
      if (e.key === 'ArrowLeft')
        setActive((a) => (a! - 1 + chars.length) % chars.length);
      if (e.key === 'ArrowRight')
        setActive((a) => (a! + 1) % chars.length);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, chars.length]);

  const go = (d: number) =>
    setActive((a) => (a === null ? a : (a + d + chars.length) % chars.length));

  // 逐帧滚动：按“单套宽度”无缝循环
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      if (!pausedRef.current) {
        const firstOfSecond = track.children[chars.length] as HTMLElement | undefined;
        const wrap = firstOfSecond ? firstOfSecond.offsetLeft : 0;
        if (wrap > 0) {
          offsetRef.current -= BASE_PX * multRef.current * dt;
          while (offsetRef.current <= -wrap) offsetRef.current += wrap;
          track.style.transform = `translate3d(${offsetRef.current}px,0,0)`;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [chars.length]);

  const loop = [...chars, ...chars];

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-gradient-to-b from-emerald-950 via-ink-900 to-emerald-900/80 text-brand-50">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <span className="absolute right-10 top-12 text-2xl text-emerald-100/40">✦</span>
        <span className="absolute left-16 top-24 text-sm text-amber-200/40">✦</span>
        <span className="absolute right-1/3 bottom-20 text-sm text-white/30">✧</span>
        <span className="absolute right-24 bottom-10 text-xs text-amber-200/40">✦</span>
        <span className="absolute -left-6 bottom-0 text-[10rem] leading-none opacity-10 select-none">
          🐼
        </span>
      </div>

      <header className="absolute left-6 top-5 z-10 flex items-center gap-3">
        <span className="text-4xl">🧺</span>
        <div>
          <h1 className="text-2xl font-bold text-emerald-100">熊猫衣柜</h1>
        </div>
      </header>

      <div className="absolute right-6 top-6 z-10 flex items-center gap-2">
        <div className="flex items-center gap-1 rounded-full border border-emerald-300/40 bg-emerald-900/50 px-2 py-1 backdrop-blur">
          <span className="px-1 text-xs text-emerald-100/70">速度</span>
          {SPEEDS.map((s) => (
            <button
              key={s.label}
              onClick={() => setMult(s.mult)}
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
                mult === s.mult
                  ? 'bg-emerald-400 text-ink-900'
                  : 'bg-emerald-700/70 text-emerald-50 hover:bg-emerald-600'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <a
          href="/"
          className="rounded-full border border-emerald-300/40 bg-emerald-900/50 px-5 py-2 text-sm text-emerald-100 backdrop-blur transition hover:bg-emerald-800/70"
        >
          ← 返回主页
        </a>
      </div>

      <div
        className="absolute inset-0 flex items-center overflow-hidden"
        onMouseEnter={() => (pausedRef.current = true)}
        onMouseLeave={() => (pausedRef.current = false)}
      >
        <div ref={trackRef} className="relative flex h-full w-max items-center">
          {loop.map((o, i) => (
            <figure
              key={`${o.src}-${i}`}
              onClick={() => setActive(i % chars.length)}
              className={`group relative h-[88vh] shrink-0 cursor-pointer ${i > 0 ? '-ml-12' : ''}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={o.src}
                alt={o.name}
                loading={i < chars.length ? 'eager' : 'lazy'}
                className="h-full w-auto object-contain drop-shadow-[0_10px_30px_rgba(0,0,0,0.5)] transition duration-500 group-hover:scale-[1.02]"
              />
            </figure>
          ))}
        </div>
      </div>

      {active !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm"
          onClick={() => setActive(null)}
        >
          <button
            aria-label="关闭"
            onClick={() => setActive(null)}
            className="absolute right-6 top-6 rounded-full border border-white/30 bg-white/10 px-4 py-2 text-lg text-white transition hover:bg-white/20"
          >
            ✕
          </button>
          <button
            aria-label="上一张"
            onClick={(e) => {
              e.stopPropagation();
              go(-1);
            }}
            className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full border border-white/30 bg-white/10 px-4 py-3 text-2xl text-white transition hover:bg-white/20"
          >
            ‹
          </button>
          <button
            aria-label="下一张"
            onClick={(e) => {
              e.stopPropagation();
              go(1);
            }}
            className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full border border-white/30 bg-white/10 px-4 py-3 text-2xl text-white transition hover:bg-white/20"
          >
            ›
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={chars[active].src}
            alt={chars[active].name}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[92vh] max-w-[92vw] object-contain drop-shadow-[0_10px_40px_rgba(0,0,0,0.6)]"
          />
        </div>
      )}
    </main>
  );
}

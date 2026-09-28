'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { CHARACTERS } from '@/lib/characters';

export default function CharacterCarousel() {
  const [chars, setChars] = useState<{ name: string; src: string | null }[]>(CHARACTERS);
  const [idx, setIdx] = useState(0);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    fetch('/api/characters')
      .then((r) => r.json())
      .then((j) => {
        const list = j?.list;
        if (Array.isArray(list) && list.length) {
          setChars(
            list.map((c: any) => ({ name: c.name || c.caption || '李豆沙', src: c.src })),
          );
        }
      })
      .catch(() => {});
    const t = setInterval(
      () => setIdx((i) => (i + 1) % Math.max(chars.length, 1)),
      4500,
    );
    return () => clearInterval(t);
  }, [chars.length]);

  return (
    <div className="relative w-full h-full">
      {chars.map((c, i) => (
        <div
          key={i}
          className={`absolute inset-0 transition-opacity duration-1000 ${
            i === idx ? 'opacity-100' : 'opacity-0'
          }`}
        >
          {c.src ? (
            <Image
              src={c.src}
              alt={c.name}
              fill
              sizes="(max-width: 768px) 90vw, 33vw"
              className="object-contain object-bottom drop-shadow-[0_0_45px_rgba(246,79,151,0.35)]"
              priority={i === 0}
            />
          ) : (
            <div className="w-full h-full grid place-items-center">
              <div className="text-2xl text-brand-200/80 animate-glow">{c.name}</div>
            </div>
          )}
        </div>
      ))}

      {mounted && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
          {chars.map((_, i) => (
            <button
              key={i}
              aria-label={`切换到第 ${i + 1} 张`}
              onClick={() => setIdx(i)}
              className={`w-2.5 h-2.5 rounded-full transition-all ${
                i === idx ? 'bg-brand-400 w-6' : 'bg-white/30'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

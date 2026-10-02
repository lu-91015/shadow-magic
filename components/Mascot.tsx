'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// 左下角豆沙小人：优先渲染 Live2D 模型（若后台配置了模型路径），
// 否则回退为亚克力立牌图片（视线追随鼠标的视差效果）。
// Live2D：模型原生支持视线/头部跟随鼠标（model.focus），点击触发随机动作。
interface Line {
  id: number;
  text: string;
  weight: number;
  timeStart: string | null;
  timeEnd: string | null;
  dates: string | null;
  onlyLive: boolean;
}

// 立绘素材（亚克力牌，每次访问随机一张；不含二维码图 dousha-10）
const STANDEES = [
  '/characters/dousha-0.png',
  '/characters/dousha-1.png',
  '/characters/dousha-3.png',
  '/characters/dousha-5.png',
  '/characters/dousha-7.png',
  '/characters/dousha-8.png',
  '/characters/dousha-9.png',
  '/characters/dousha-11.png',
];

// Cubism 4 运行时核心（Cubism SDK 官方 CDN），Live2D 模型加载前需要它
const CUBISM_CORE = 'https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js';

function loadScript(src: string, ready?: () => boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`) as HTMLScriptElement | null;
    if (existing && (!ready || ready())) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => {
      // 等全局真正就绪（onload 不一定等于全局已挂载）
      if (!ready) return resolve();
      let n = 0;
      const t = setInterval(() => {
        if (ready()) {
          clearInterval(t);
          resolve();
        } else if (++n > 60) {
          clearInterval(t);
          reject(new Error('script ready timeout: ' + src));
        }
      }, 25);
    };
    s.onerror = () => reject(new Error('script load failed: ' + src));
    document.head.appendChild(s);
  });
}

function cstNow(): { hhmm: string; mmdd: string } {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return { hhmm: `${p(d.getHours())}:${p(d.getMinutes())}`, mmdd: `${p(d.getMonth() + 1)}-${p(d.getDate())}` };
}

function inTimeWindow(hhmm: string, s?: string | null, e?: string | null): boolean {
  if (!s && !e) return true;
  if (s && e) return s <= e ? hhmm >= s && hhmm <= e : hhmm >= s || hhmm <= e;
  if (s) return hhmm >= s;
  return hhmm <= e!;
}

function pickWeighted(lines: Line[]): Line | null {
  if (!lines.length) return null;
  const total = lines.reduce((a, b) => a + Math.max(1, b.weight), 0);
  let r = Math.random() * total;
  for (const l of lines) {
    r -= Math.max(1, l.weight);
    if (r <= 0) return l;
  }
  return lines[lines.length - 1];
}

export default function Mascot() {
  const cardRef = useRef<HTMLButtonElement>(null);
  const canvasHost = useRef<HTMLDivElement>(null);
  const idleRef = useRef<HTMLDivElement>(null);
  const modelRef = useRef<any>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [img, setImg] = useState<string | null>(null);
  const [bubble, setBubble] = useState<string | null>(null);
  const [modelOk, setModelOk] = useState(false);
  const [pop, setPop] = useState(false);
  const linesRef = useRef<Line[]>([]);
  const liveRef = useRef(0);

  // 拉取台词、直播状态与模型配置
  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/mascot/lines', { cache: 'no-store' });
      const j = await r.json();
      linesRef.current = j.lines ?? [];
      liveRef.current = j.liveStatus ?? 0;
      return (j.model ?? { url: '', scale: 1 }) as { url: string; scale: number };
    } catch {
      return { url: '', scale: 1 };
    }
  }, []);

  // 初始化 Live2D（动态引入，避免 SSR 与首页体积开销）
  useEffect(() => {
    let disposed = false;
    (async () => {
      const { url, scale } = await load();
      if (!url || !canvasHost.current) return;
      try {
        await loadScript(CUBISM_CORE, () => !!(window as any).Live2DCubismCore);
        const PIXI: any = await import('pixi.js');
        // Cubism 4 模型（.moc3 / .model3.json）必须从 cubism4 子入口引入；
        // 主入口（'pixi-live2d-display'）只包含 Cubism 2 支持。
        const { Live2DModel }: any = await import('pixi-live2d-display/cubism4');
        if (disposed || !canvasHost.current) return;
        // Cubism 4 需要 Ticker 注册
        if (Live2DModel.registerTicker) Live2DModel.registerTicker(PIXI.Ticker);
        const host = canvasHost.current;
        const app = new PIXI.Application({
          width: 260,
          height: 320,
          backgroundAlpha: 0,
          antialias: true,
        });
        host.appendChild(app.view as unknown as Node);
        const model = await Live2DModel.from(url, { autoInteract: false });
        if (disposed) return;
        // 按容器缩放贴底
        const base = Math.min(260 / model.width, 320 / model.height);
        model.scale.set(base * (scale || 1));
        model.x = 130;
        model.y = 320;
        model.anchor.set(0.5, 1);
        app.stage.addChild(model);
        modelRef.current = model;
        setModelOk(true);
      } catch (err) {
        // 模型加载失败（未放文件 / 核心脚本不可用 / 版本不兼容）→ 回退立牌
        console.warn('[Mascot] Live2D 加载失败，回退立牌：', err);
        setModelOk(false);
      }
    })();
    return () => {
      disposed = true;
    };
  }, [load]);

  // 鼠标跟随：Live2D 用模型自带 focus；立牌用位移+倾斜模拟视线
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const m = modelRef.current;
      if (m && m.focus) {
        m.focus(e.clientX, e.clientY);
        return;
      }
      const el = cardRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height * 0.22);
      const dist = Math.hypot(dx, dy) || 1;
      const k = Math.min(1, dist / 500);
      el.style.transform = `translate(${((dx / dist) * 7 * k).toFixed(1)}px, ${((dy / dist) * 5 * k).toFixed(1)}px) rotate(${((dx / dist) * 3.5 * k).toFixed(2)}deg)`;
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  const say = useCallback((text?: string) => {
    const { hhmm, mmdd } = cstNow();
    let pool = linesRef.current;
    if (text == null) {
      pool = pool.filter(
        (l) =>
          inTimeWindow(hhmm, l.timeStart, l.timeEnd) &&
          (!l.dates || l.dates.split(',').includes(mmdd)) &&
          (!l.onlyLive || liveRef.current === 1),
      );
    }
    const line = text ?? pickWeighted(pool)?.text;
    if (!line) return;
    setBubble(line);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setBubble(null), 5000);
  }, []);

  // 点击：Live2D 随机动作 + 发言 + 弹跳
  const onTap = useCallback(() => {
    const m = modelRef.current;
    if (m && m.motion) {
      for (const g of ['tap_body', 'tap', 'Tap', 'flick', 'shake']) {
        try {
          if (m.motion(g)) break;
        } catch {
          /* 该动作组不存在，继续尝试 */
        }
      }
    }
    setPop(false);
    requestAnimationFrame(() => {
      setPop(true);
      setTimeout(() => setPop(false), 440);
    });
    say();
  }, [say]);

  // 闲置时偶尔开口
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const loop = () => {
      t = setTimeout(() => {
        say();
        loop();
      }, 45000 + Math.random() * 45000);
    };
    loop();
    return () => clearTimeout(t);
  }, [say]);

  // 立牌模式：优先用后台上传的立绘（不含二维码图），为空或接口失败时回退静态素材
  useEffect(() => {
    setImg(STANDEES[Math.floor(Math.random() * STANDEES.length)]);
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/characters', { cache: 'no-store' });
        const j = await r.json();
        const srcs: string[] = (j.list ?? [])
          .map((c: { src?: string | null }) => c.src ?? '')
          .filter((s: string) => s && s !== '/characters/dousha-10.png');
        if (!cancelled && srcs.length)
          setImg(srcs[Math.floor(Math.random() * srcs.length)]);
      } catch {
        /* 保留静态兜底 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 简易 Live2D 待机动效：呼吸（纵向缩放）+ 轻摆 + 上下浮动，实时渲染
  useEffect(() => {
    if (modelOk) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = (now - start) / 1000;
      const bob = Math.sin(t * 1.2) * 4; // 上下浮动
      const sway = Math.sin(t * 0.8) * 1.6; // 轻微摇摆
      const breath = 1 + Math.sin(t * 1.6) * 0.012; // 呼吸
      if (idleRef.current)
        idleRef.current.style.transform = `translateY(${bob.toFixed(2)}px) rotate(${sway.toFixed(2)}deg) scaleY(${breath.toFixed(4)})`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [modelOk]);

  return (
    <div className="fixed bottom-3 left-3 z-40 flex select-none flex-col items-center">
      {bubble && (
        <div className="mb-2 max-w-56 rounded-2xl rounded-bl-sm border border-white/25 bg-white/90 px-3.5 py-2 text-sm leading-relaxed text-stone-700 shadow-xl backdrop-blur">
          {bubble}
        </div>
      )}

      {/* Live2D 画布（模型就绪时显示） */}
      <div
        ref={canvasHost}
        onClick={onTap}
        className={modelOk ? 'cursor-pointer' : 'hidden'}
        aria-hidden={!modelOk}
      />

      {/* 回退：亚克力立牌 + 简易 Live2D 待机动效 */}
      {!modelOk && (
        <button
          ref={cardRef}
          onClick={onTap}
          aria-label="豆沙小人"
          title="点点我！"
          className="group origin-bottom transition-transform duration-150 ease-out will-change-transform"
          style={{ transform: 'translate(0,0) rotate(0deg)' }}
        >
          <div ref={idleRef} className="will-change-transform">
            <div className={pop ? 'mascot-pop' : ''}>
              {img && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={img}
                  alt="豆沙"
                  draggable={false}
                  className="h-44 w-auto rounded-md shadow-[0_10px_24px_rgba(0,0,0,0.45)] ring-1 ring-white/20 transition group-hover:brightness-105 md:h-52"
                />
              )}
            </div>
          </div>
        </button>
      )}
    </div>
  );
}

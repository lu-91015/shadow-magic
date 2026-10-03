'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

// 左下角豆沙小人：只渲染 Live2D 模型（无立牌兜底）。
// Live2D：模型原生支持视线/头部跟随鼠标（model.focus），点击触发随机动作。
// 台词按「触发场景」分组：idle 闲置 / tap 点击 / enter 进入站点 /
// admin_guest 游客进后台 / admin_admin 管理员进后台 / page:<路由> 进入某页面。
interface Line {
  id: number;
  text: string;
  weight: number;
  timeStart: string | null;
  timeEnd: string | null;
  dates: string | null;
  onlyLive: boolean;
  scene: string;
}

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
  const canvasHost = useRef<HTMLDivElement>(null);
  const modelRef = useRef<any>(null);
  const earsTickRef = useRef<(() => void) | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [bubble, setBubble] = useState<string | null>(null);
  const [modelOk, setModelOk] = useState(false);
  const linesRef = useRef<Line[]>([]);
  const liveRef = useRef(0);
  const pathname = usePathname();
  const firstRouteRef = useRef(true);
  const enterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const linesLoadedRef = useRef(false);
  const pendingRouteRef = useRef<string | null>(null);
  const pathRef = useRef<string | null>(null);
  const handleRouteSpeechRef = useRef<((path: string, isFirst: boolean) => void) | null>(null);

  // 拉取台词、直播状态与模型配置
  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/mascot/lines', { cache: 'no-store' });
      const j = await r.json();
      linesRef.current = j.lines ?? [];
      liveRef.current = j.liveStatus ?? 0;
      // 台词到位后，补触发进场/首个路由的开场白
      if (!linesLoadedRef.current) {
        linesLoadedRef.current = true;
        const p = pendingRouteRef.current;
        if (p != null) {
          pendingRouteRef.current = null;
          const isFirst = firstRouteRef.current;
          firstRouteRef.current = false;
          handleRouteSpeechRef.current?.(p, isFirst);
        }
      }
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
        const CW = 280, CH = 440; // 画布加大，避免头部被裁
        const host = canvasHost.current;
        const app = new PIXI.Application({
          width: CW,
          height: CH,
          backgroundAlpha: 0,
          antialias: true,
        });
        host.appendChild(app.view as unknown as Node);
        const model = await Live2DModel.from(url, { autoInteract: false });
        if (disposed) return;
        // 按容器缩放贴底，且保证不超出画布（后台 scale 只是偏好，超界时收敛）
        const base = Math.min(CW / model.width, CH / model.height);
        let s = base * (scale || 1);
        if (model.height * s > CH * 0.98) s = (CH * 0.98) / model.height;
        if (model.width * s > CW * 0.98) s = Math.min(s, (CW * 0.98) / model.width);
        model.scale.set(s);
        model.x = CW / 2;
        model.y = CH;
        model.anchor.set(0.5, 1);
        app.stage.addChild(model);
        modelRef.current = model;
        // 熊猫头麦克风：作为模型子节点，跟随整体变换（呼吸/摆动），定位于右手附近
        try {
          const uw = model.width / s, uh = model.height / s; // 未缩放的模型本地尺寸
          const mic = new PIXI.Sprite(PIXI.Texture.from('/live2d/lidousha/mic.png'));
          mic.anchor.set(0.5, 0.15);
          mic.scale.set((uh * 0.15) / 200); // 屏幕高 ≈ 模型高 15%
          mic.position.set(uw * 0.655, uh * 0.52); // 压在裙边、手的高度
          mic.rotation = -0.3;
          model.addChild(mic);
        } catch (micErr) {
          console.warn('[Mascot] mic sprite 失败：', micErr);
        }
        // 熊猫耳：跟随头部网格（取最靠上的部件）逐帧同步位置与旋转，随转头/摆动一起动
        try {
          const im: any = model.internalModel;
          const core: any = im.coreModel;
          const count: number = core.getDrawableCount();
          const bbox = (idx: number) => {
            const v: number[] = im.getDrawableVertices(idx);
            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            for (let k = 0; k < v.length; k += 2) {
              if (v[k] < minX) minX = v[k];
              if (v[k] > maxX) maxX = v[k];
              if (v[k + 1] < minY) minY = v[k + 1];
              if (v[k + 1] > maxY) maxY = v[k + 1];
            }
            return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, top: minY, w: maxX - minX, h: maxY - minY };
          };
          // 头顶部件：中心最靠上且有一定宽度（排除细碎发丝）
          let headIdx = -1, best = Infinity;
          for (let i = 0; i < count; i++) {
            const b = bbox(i);
            if (b.w < 90) continue;
            if (b.cy < best) { best = b.cy; headIdx = i; }
          }
          if (headIdx >= 0) {
            const ref = bbox(headIdx);
            const ears = new PIXI.Sprite(PIXI.Texture.from('/live2d/lidousha/ears.png'));
            ears.anchor.set(0.5, 1.06); // 略微陷入头发，像戴在头上
            ears.scale.set((ref.w * 1.12) / 220); // ears.png 宽 220
            model.addChild(ears);
            const oy = ref.top - ref.cy; // 头顶相对头部中心的偏移（负值，在上方）
            const tick = () => {
              if (ears.destroyed) return;
              const b = bbox(headIdx);
              let deg = 0;
              try { deg = core.getParameterValueById('ParamAngleZ') || 0; } catch { /* 参数不存在 */ }
              const t = -deg * (Math.PI / 180) * 0.7; // Cubism 角度 → PIXI（Y 向下）旋转
              ears.position.set(b.cx - oy * Math.sin(t), b.cy + oy * Math.cos(t));
              ears.rotation = t;
            };
            tick();
            PIXI.Ticker.shared.add(tick);
            earsTickRef.current = tick;
          }
        } catch (earErr) {
          console.warn('[Mascot] 熊猫耳挂载失败：', earErr);
        }
        setModelOk(true);
      } catch (err) {
        // 模型加载失败（未放文件 / 核心脚本不可用 / 版本不兼容）：保持隐藏，不回退立牌
        console.warn('[Mascot] Live2D 加载失败：', err);
        setModelOk(false);
      }
    })();
    return () => {
      disposed = true;
      // 卸载时移除熊猫耳的逐帧回调，避免泄漏
      if (earsTickRef.current) {
        import('pixi.js')
          .then((PIXI: any) => PIXI.Ticker.shared.remove(earsTickRef.current))
          .catch(() => undefined);
        earsTickRef.current = null;
      }
    };
  }, [load]);

  // 鼠标跟随：Live2D 用模型自带 focus
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const m = modelRef.current;
      if (m && m.focus) m.focus(e.clientX, e.clientY);
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  // 显示一句话，5.2 秒后自动收起
  const speak = useCallback((text: string | null) => {
    if (!text) return false;
    setBubble(text);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setBubble(null), 5200);
    return true;
  }, []);

  // 按场景取一句台词（仍受时间/日期/仅直播中条件约束）
  const pickScene = useCallback((scene: string): string | null => {
    const { hhmm, mmdd } = cstNow();
    const pool = linesRef.current.filter(
      (l) =>
        (l.scene || 'idle') === scene &&
        inTimeWindow(hhmm, l.timeStart, l.timeEnd) &&
        (!l.dates || l.dates.split(',').includes(mmdd)) &&
        (!l.onlyLive || liveRef.current === 1),
    );
    return pickWeighted(pool)?.text ?? null;
  }, []);

  // 依次尝试多个场景，取第一个有台词的（兜底退化）
  const sayScene = useCallback(
    (scenes: string[]) => {
      for (const sc of scenes) {
        if (speak(pickScene(sc))) return true;
      }
      return false;
    },
    [pickScene, speak],
  );

  // 台词加载完成后的首个路由，等 load() 结束再触发开场白（避免竞态）
  const handleRouteSpeech = useCallback(
    (path: string, isFirst: boolean) => {
      pathRef.current = path;
      const pageScene = `page:${path}`;
      const speakForPage = () => {
        if (pathRef.current !== path) return; // 路由已变，丢弃过期发言
        if (path === '/admin') {
          // 后台：按登录身份说不同的话（未登录则退回页面台词）
          fetch('/api/admin/me', { cache: 'no-store' })
            .then((r) => (r.ok ? r.json() : null))
            .then((j) => {
              if (pathRef.current !== path) return;
              const role = j?.role;
              if (role === 'guest') sayScene(['admin_guest', pageScene]);
              else if (role === 'admin') sayScene(['admin_admin', pageScene]);
              else sayScene([pageScene]);
            })
            .catch(() => {
              if (pathRef.current === path) sayScene([pageScene]);
            });
          return;
        }
        sayScene([pageScene]);
      };

      if (isFirst) {
        // 首次进入站点：先打招呼；若直达子页面，稍后再补一句页面台词
        const greeted = sayScene(['enter']);
        if (path !== '/') {
          enterTimerRef.current = setTimeout(speakForPage, greeted ? 5600 : 900);
        }
      } else {
        speakForPage();
      }
    },
    [sayScene],
  );
  useEffect(() => {
    handleRouteSpeechRef.current = handleRouteSpeech;
  }, [handleRouteSpeech]);

  // 路由变化 → 场景台词
  useEffect(() => {
    if (!pathname) return;
    if (!linesLoadedRef.current) {
      // 台词尚未拉取完成，交给 load() 完成后触发
      pendingRouteRef.current = pathname;
      return;
    }
    const isFirst = firstRouteRef.current;
    firstRouteRef.current = false;
    handleRouteSpeech(pathname, isFirst);
  }, [pathname, handleRouteSpeech]);

  // 点击：Live2D 随机动作 + 发言
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
    sayScene(['tap', 'idle']);
  }, [sayScene]);

  // 闲置时偶尔开口
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const loop = () => {
      t = setTimeout(() => {
        sayScene(['idle']);
        loop();
      }, 45000 + Math.random() * 45000);
    };
    loop();
    return () => clearTimeout(t);
  }, [sayScene]);

  return (
    <div className="fixed bottom-3 left-3 z-40 flex select-none flex-col items-center">
      {bubble && (
        <div className="mascot-bubble mb-3 max-w-[14rem] px-3.5 py-2 text-[13px] font-medium leading-relaxed text-stone-700">
          {bubble}
        </div>
      )}

      {/* Live2D 画布（唯一形象，无图片兜底） */}
      <div
        ref={canvasHost}
        onClick={onTap}
        className={modelOk ? 'cursor-pointer' : 'invisible'}
        aria-hidden={!modelOk}
        aria-label="豆沙小人"
        title="点点我！"
      />
    </div>
  );
}

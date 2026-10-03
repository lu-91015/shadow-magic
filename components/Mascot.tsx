'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

// 左下角豆沙小人：3D 形象（three.js，加载 PMX 模型 /models/lidousha.pmx）。
// 熊猫耳挂在头部骨骼上，随转头/摆动完美贴合；鼠标移动驱动头部朝向；点击触发弹跳+发言。
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

const PMX_URL = '/models/lidousha.pmx';

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

interface ThreeState {
  THREE: any;
  renderer: any;
  scene: any;
  camera: any;
  modelRoot: any;
  head: any;
  armL: any;
  armR: any;
  elbowL: any;
  elbowR: any;
  isVRM: boolean;
  vrm: any;
  ns: number;
  rootBaseX: number;
  rootBaseY: number;
  rootBaseZ: number;
}

export default function Mascot() {
  const canvasHost = useRef<HTMLDivElement>(null);
  const threeRef = useRef<ThreeState | null>(null);
  const rendererRef = useRef<any>(null);
  const targetYawRef = useRef(0);
  const targetPitchRef = useRef(0);
  const tapBounceRef = useRef(0);
  const onTapRef = useRef<() => void>(() => {});
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [bubble, setBubble] = useState<string | null>(null);
  const [bubblePos, setBubblePos] = useState<{ left: number; bottom: number }>({ left: 160, bottom: 420 });
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

  // 初始化 3D（动态引入 three，避免 SSR 与首页体积开销）
  useEffect(() => {
    let disposed = false;
    let raf = 0;
    let removeClickListener: () => void = () => {};
    (async () => {
      load(); // 台词与 3D 并行拉取，互不阻塞
      if (!canvasHost.current) return;
      try {
        const THREE: any = await import('three');
        const host = canvasHost.current!;
        const W = 320, H = 480;
        const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(W, H);
        host.appendChild(renderer.domElement);
        rendererRef.current = renderer;
        renderer.domElement.style.pointerEvents = 'none';

        // 像素级点击检测：容器 pointer-events:none 不再整块拦截点击，
        // 捕获阶段判断点击位置像素是否真的有模型（alpha>阈值），命中才算点角色
        const onCanvasClick = (e: MouseEvent) => {
          const el = renderer.domElement;
          const rect = el.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;
          if (x < 0 || y < 0 || x >= rect.width || y >= rect.height) return;
          const gl = renderer.getContext();
          const px = Math.floor((x / rect.width) * gl.drawingBufferWidth);
          const py = Math.floor((1 - y / rect.height) * gl.drawingBufferHeight);
          const buf = new Uint8Array(4);
          try {
            gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
          } catch {
            return;
          }
          if (buf[3] > 10) {
            e.stopPropagation();
            e.preventDefault();
            onTapRef.current();
          }
        };
        window.addEventListener('click', onCanvasClick, true);
        removeClickListener = () => window.removeEventListener('click', onCanvasClick, true);

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(30, W / H, 0.1, 100);
        camera.position.set(0, 0.95, 3.4);
        camera.lookAt(0, 0.85, 0);
        scene.add(new THREE.HemisphereLight(0xffffff, 0x444455, 1.3));
        const dir = new THREE.DirectionalLight(0xffffff, 1.1);
        dir.position.set(1, 2, 2);
        scene.add(dir);
        const dir2 = new THREE.DirectionalLight(0xffffff, 0.5);
        dir2.position.set(-2, 1, 1);
        scene.add(dir2);

        // 直接加载 PMX（VRM 文件当前未提供，避免无谓的 404 试探）
        let modelRoot: any = null;
        let head: any = null;
        let isVRM = false;
        let vrmObj: any = null;
        let mmdBones: any[] = [];
        try {
          const { MMDLoader }: any = await import('three/examples/jsm/loaders/MMDLoader.js');
          const mmd = new MMDLoader();
          modelRoot = await mmd.loadAsync(PMX_URL);
          if (disposed) return;
          scene.add(modelRoot);
          let skinned: any = null;
          modelRoot.traverse((o: any) => {
            if (o.isSkinnedMesh && !skinned) skinned = o;
          });
          mmdBones = skinned ? skinned.skeleton.bones : [];
          head = mmdBones.find((b: any) => /頭|head/i.test(b.name)) ?? null;
        } catch (pmxErr) {
          console.warn('[Mascot] PMX 加载失败：', pmxErr);
          setModelOk(false);
          return;
        }
        if (disposed) return;

        // 手臂骨骼：把默认 T-pose 摆成自然站姿（PMX 用日文骨名，VRM 用标准名）
        let armL: any = null;
        let armR: any = null;
        let elbowL: any = null;
        let elbowR: any = null;
        if (isVRM && vrmObj?.humanoid) {
          armL = vrmObj.humanoid.getNormalizedBoneNode('leftUpperArm') ?? null;
          armR = vrmObj.humanoid.getNormalizedBoneNode('rightUpperArm') ?? null;
          elbowL = vrmObj.humanoid.getNormalizedBoneNode('leftLowerArm') ?? null;
          elbowR = vrmObj.humanoid.getNormalizedBoneNode('rightLowerArm') ?? null;
        } else {
          armL = mmdBones.find((b: any) => b.name === '左腕') ?? null;
          armR = mmdBones.find((b: any) => b.name === '右腕') ?? null;
          elbowL = mmdBones.find((b: any) => b.name === '左ひじ') ?? null;
          elbowR = mmdBones.find((b: any) => b.name === '右ひじ') ?? null;
        }

        // 归一化：缩放到身高 1.6，脚底贴 y=0，水平居中
        modelRoot.updateMatrixWorld(true);
        let box = new THREE.Box3().setFromObject(modelRoot);
        const size = new THREE.Vector3();
        box.getSize(size);
        const ns = 1.6 / (size.y || 1);
        modelRoot.scale.setScalar(ns);
        modelRoot.updateMatrixWorld(true);
        box = new THREE.Box3().setFromObject(modelRoot);
        const rootBaseX = -((box.min.x + box.max.x) / 2);
        const rootBaseY = -box.min.y;
        const rootBaseZ = -((box.min.z + box.max.z) / 2);
        modelRoot.position.set(rootBaseX, rootBaseY, rootBaseZ);

        threeRef.current = {
          THREE, renderer, scene, camera, modelRoot, head,
          armL, armR, elbowL, elbowR, isVRM, vrm: vrmObj, ns,
          rootBaseX, rootBaseY, rootBaseZ,
        };
        setModelOk(true);

        const clock = new THREE.Clock();
        let t = 0;
        const animate = () => {
          if (disposed) return;
          raf = requestAnimationFrame(animate);
          const dt = Math.min(clock.getDelta(), 0.05);
          t += dt;
          // 待机微动
          modelRoot.position.x = rootBaseX + Math.sin(t * 0.7) * 0.012;
          modelRoot.position.y = rootBaseY + Math.sin(t * 1.5) * 0.01;
          modelRoot.rotation.z = Math.sin(t * 0.5) * 0.01;
          // 点击弹跳
          modelRoot.scale.setScalar(ns * (1 + 0.05 * tapBounceRef.current));
          tapBounceRef.current *= 0.85;
          // 鼠标驱动头部朝向
          if (head) {
            head.rotation.y += (targetYawRef.current - head.rotation.y) * 0.12;
            head.rotation.x += (targetPitchRef.current - head.rotation.x) * 0.12;
          }
          // 手臂自然站姿（修正 T-pose）+ 待机呼吸摆动：上臂下垂，前臂自然悬垂
          const sway = Math.sin(t * 1.2) * 0.03;
          const breathe = Math.sin(t * 1.5) * 0.02;
          if (armR) {
            armR.rotation.z = 0.5 + sway;
            armR.rotation.x = breathe;
          }
          if (armL) {
            armL.rotation.z = -0.5 - sway;
            armL.rotation.x = breathe;
          }
          if (elbowR) {
            elbowR.rotation.z = 0.55 + sway * 0.5;
            elbowR.rotation.y = 0.12;
          }
          if (elbowL) {
            elbowL.rotation.z = -0.55 - sway * 0.5;
            elbowL.rotation.y = -0.12;
          }
          modelRoot.updateMatrixWorld(true);
          if (isVRM && vrmObj && vrmObj.update) vrmObj.update(dt);
          renderer.render(scene, camera);
        };
        animate();
      } catch (err) {
        console.warn('[Mascot] 3D 初始化失败：', err);
        setModelOk(false);
      }
    })();
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      removeClickListener();
      const r = rendererRef.current;
      if (r) {
        try {
          r.dispose();
        } catch {
          /* noop */
        }
        if (r.domElement && r.domElement.parentNode) r.domElement.parentNode.removeChild(r.domElement);
      }
    };
  }, [load]);

  // 鼠标跟随：记录目标偏航/俯仰
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const nx = (e.clientX / window.innerWidth) * 2 - 1;
      const ny = -((e.clientY / window.innerHeight) * 2 - 1);
      targetYawRef.current = nx * 0.5;
      targetPitchRef.current = -ny * 0.35;
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  // 显示一句话，5.2 秒后自动收起；气泡锚定到角色头顶（头部骨骼投影到画布坐标），
  // 不再依赖画布顶部，任何视口/缩放下都紧贴头部
  const speak = useCallback((text: string | null) => {
    if (!text) return false;
    const st = threeRef.current;
    if (st && st.head && st.camera && st.modelRoot && st.THREE) {
      try {
        st.modelRoot.updateMatrixWorld(true);
        const v = new st.THREE.Vector3();
        st.head.getWorldPosition(v);
        v.project(st.camera);
        const cx = (v.x * 0.5 + 0.5) * 320;
        const cyTop = (1 - (v.y * 0.5 + 0.5)) * 480; // 头部距画布顶部的像素
        setBubblePos({
          left: Math.min(235, Math.max(85, cx)),
          bottom: Math.min(468, 480 - cyTop + 62),
        });
      } catch {
        /* 投影失败则用上次位置 */
      }
    }
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

  // 外部触发台词：mascot:say 传固定文本；mascot:sayScene 按后台 scene 取一句
  useEffect(() => {
    const onSay = (e: Event) => {
      const text = (e as CustomEvent<string>).detail;
      if (typeof text === 'string' && text) speak(text);
    };
    const onSayScene = (e: Event) => {
      const scene = (e as CustomEvent<string>).detail;
      if (typeof scene === 'string' && scene) sayScene([scene]);
    };
    window.addEventListener('mascot:say', onSay);
    window.addEventListener('mascot:sayScene', onSayScene);
    return () => {
      window.removeEventListener('mascot:say', onSay);
      window.removeEventListener('mascot:sayScene', onSayScene);
    };
  }, [speak, sayScene]);

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

  // 点击：弹跳 + 表情 + 发言
  const onTap = useCallback(() => {
    const st = threeRef.current;
    if (st) {
      tapBounceRef.current = 1;
      if (st.isVRM && st.vrm && st.vrm.expressionManager) {
        try {
          const m = st.vrm.expressionManager;
          const ex =
            m.getExpression?.('surprised') ||
            m.getExpression?.('fun') ||
            m.getExpression?.('joy');
          if (ex) {
            ex.weight = 1;
            setTimeout(() => {
              ex.weight = 0;
            }, 450);
          }
        } catch {
          /* noop */
        }
      }
    }
    sayScene(['tap', 'idle']);
  }, [sayScene]);
  onTapRef.current = onTap;

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
    <div className="pointer-events-none fixed bottom-3 left-3 z-40 origin-bottom-left scale-[0.6] select-none sm:scale-100">
      <div className="relative">
        {/* 3D 画布（唯一形象，无图片兜底）；点击由 window 捕获阶段按像素判定 */}
        <div
          ref={canvasHost}
          className={modelOk ? '' : 'invisible'}
          aria-hidden={!modelOk}
          aria-label="豆沙小人"
        />

        {/* 台词气泡：绝对定位锚定在角色头顶 */}
        {bubble && (
          <div
            className="absolute"
            style={{ left: bubblePos.left, bottom: bubblePos.bottom, transform: 'translateX(-50%)' }}
          >
            <div className="mascot-bubble max-w-[15.5rem] px-4 py-2.5 text-[15px] font-medium leading-relaxed text-stone-700">
              <EmoteText text={bubble} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// 气泡台词里的 [表情] 渲染：[李豆沙_别走好吗] → /garb/emojis/别走好吗.png
// 也支持无前缀写法 [别走好吗]；文件不存在时回退为原文
function EmoteText({ text }: { text: string }) {
  const parts: Array<{ t: 'text' | 'emote'; v: string }> = [];
  const re = /\[([^\[\]]{1,32})\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push({ t: 'text', v: text.slice(last, m.index) });
    parts.push({ t: 'emote', v: m[1] });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ t: 'text', v: text.slice(last) });
  return (
    <>
      {parts.map((p, i) =>
        p.t === 'text' ? (
          <span key={i}>{p.v}</span>
        ) : (
          <EmoteImg key={i} token={p.v} />
        ),
      )}
    </>
  );
}

function EmoteImg({ token }: { token: string }) {
  // 解析顺序：B站表情（按全名存于 /emojis/）→ 装扮表情（取最后一个 _ 之后的名字，存于 /garb/emojis/）→ 原文
  const suffix = token.includes('_') ? token.slice(token.lastIndexOf('_') + 1) : token;
  const candidates = [
    `/garb/emojis/${encodeURIComponent(suffix)}.png`,
    `/emojis/${encodeURIComponent(token)}.png`,
    `/garb/emojis/${encodeURIComponent(token)}.png`,
  ];
  const [idx, setIdx] = useState(0);
  const [failed, setFailed] = useState(false);
  if (failed) return <span>{`[${token}]`}</span>;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={candidates[idx]}
      alt={token}
      title={token}
      onError={() => {
        if (idx < candidates.length - 1) setIdx(idx + 1);
        else setFailed(true);
      }}
      className="mx-0.5 inline-block h-7 w-7 align-text-bottom"
      draggable={false}
    />
  );
}

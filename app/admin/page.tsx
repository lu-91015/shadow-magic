'use client';

import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import LiveMonitor from '@/components/LiveMonitor';

let currentRole: string | null = null; // 'admin' | 'guest' | null

// ---------- 全局轻反馈：Toast / 加载指示 / 确认框 ----------
// 用模块级发布订阅实现，各 Tab 无需改造即可复用（挂载点见 AdminPage）
type ToastKind = 'ok' | 'err' | 'info';
interface ToastItem {
  id: number;
  kind: ToastKind;
  text: string;
}

const toastBus = new Set<(t: ToastItem) => void>();
const loadBus = new Set<(n: number) => void>();
const askBus = new Set<(q: string | null) => void>();

let toastSeq = 0;
let pendingLoad = 0;
let askResolve: ((v: boolean) => void) | null = null;
let onUnauthorized: (() => void) | null = null;

function toast(text: string, kind: ToastKind = 'info') {
  const t: ToastItem = { id: ++toastSeq, kind, text };
  toastBus.forEach((fn) => fn(t));
}

// 取代原生 confirm 的自定义确认框（Promise 版，调用处需 await）
function ask(text: string): Promise<boolean> {
  if (askResolve) askResolve(false); // 结束上一个未完成的确认
  return new Promise<boolean>((resolve) => {
    askResolve = resolve;
    askBus.forEach((fn) => fn(text));
  });
}
function settleAsk(v: boolean) {
  askBus.forEach((fn) => fn(null));
  const r = askResolve;
  askResolve = null;
  r?.(v);
}

function pushLoad(d: number) {
  pendingLoad = Math.max(0, pendingLoad + d);
  loadBus.forEach((fn) => fn(pendingLoad));
}

async function api(path: string, opts: RequestInit = {}) {
  const method = (opts.method || 'GET').toUpperCase();
  if (method !== 'GET' && currentRole === 'guest') {
    toast('当前为只读访客账号，无权限执行增删改操作。', 'err');
    return { ok: false, error: 'readonly' } as any;
  }
  pushLoad(1);
  try {
    const res = await fetch(path, {
      ...opts,
      credentials: 'include',
      headers: opts.body ? { 'Content-Type': 'application/json', ...(opts.headers || {}) } : opts.headers,
    });
    if (res.status === 401) {
      toast('登录状态已失效，请重新登录', 'err');
      onUnauthorized?.();
      throw new Error('UNAUTHORIZED');
    }
    return await res.json().catch(() => ({}));
  } catch (e) {
    const msg = (e as Error)?.message;
    if (msg !== 'UNAUTHORIZED') toast(`请求失败：${msg ?? String(e)}`, 'err');
    throw e;
  } finally {
    pushLoad(-1);
  }
}

// 直播回放分类（与 lib/liveCategory.ts 保持一致，含旧值兼容）
const CAT_LABEL: Record<string, string> = {
  official: '官方活动回',
  special: '特殊回',
  collab: '联动回',
  marshmallow: '棉花糖回',
  game: '游戏回',
  talk: '杂谈回',
  other: '其他',
  sing: '歌回',
};

const TABS = [
  { id: 'jobs', label: '任务调度', icon: '⏱️', desc: '定时任务与运行记录' },
  { id: 'hero', label: '首页文案', icon: '🏠', desc: '首页名字 / 粉丝牌 / 默认人设句' },
  { id: 'clips', label: '切片收集', icon: '✂️', desc: '粉丝切片收录与拉黑' },
  { id: 'lives', label: '直播与歌单', icon: '🎬', desc: '回放扫描、分类与导出' },
  { id: 'track', label: '数据追踪', icon: '📈', desc: '粉丝 / 营收趋势' },
  { id: 'chars', label: '立绘上传', icon: '🖼️', desc: '角色形象素材' },
  { id: 'quotes', label: '首页语录', icon: '💬', desc: '首页随机一句话' },
  { id: 'works', label: '豆沙作品', icon: '🎨', desc: '豆沙自制投稿' },
  { id: 'mascot', label: '小人台词', icon: '🐼', desc: '左下角小人说话' },
  { id: 'assets', label: '素材库', icon: '📦', desc: '表情 / 指针 / 输入法' },
  { id: 'shop', label: '商店', icon: '🛍️', desc: '周边与装扮' },
  { id: 'news', label: '通知', icon: '📢', desc: '站点公告' },
  { id: 'topic', label: '豆漫墙', icon: '🧱', desc: '#大熊猫豆漫# 话题动态入库管理' },
  { id: 'creds', label: 'B站凭据', icon: '🔑', desc: 'Cookie 与登录态' },
  { id: 'system', label: '数据 & 审计', icon: '🛠️', desc: '数据库概况与操作日志' },
];

const tabMeta = (id: string) => TABS.find((t) => t.id === id) ?? TABS[0];

// 侧栏分组：把 13 个平铺页签收敛成 3 组，降低查找成本
const NAV_GROUPS = [
  { label: '站点内容', items: ['hero', 'quotes', 'works', 'mascot', 'assets', 'shop', 'news', 'topic'] },
  { label: 'B站数据', items: ['clips', 'lives', 'track', 'chars'] },
  { label: '系统运维', items: ['jobs', 'creds', 'system'] },
];

export default function AdminPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [pw, setPw] = useState('');
  const [loginErr, setLoginErr] = useState('');
  const [tab, setTab] = useState('jobs');
  const [role, setRole] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  // 登录失效时由 api() 回调到此，回到登录页而不是停在过期界面
  useEffect(() => {
    const handle = () => setAuthed(false);
    onUnauthorized = handle;
    return () => {
      if (onUnauthorized === handle) onUnauthorized = null;
    };
  }, []);

  useEffect(() => {
    api('/api/admin/me')
      .then((r) => {
        setAuthed(!!r.ok);
        setRole(r.role ?? null);
        currentRole = r.role ?? null;
      })
      .catch(() => setAuthed(false));
  }, []);

  // 记住所在分页：刷新或分享带 #hash 的链接都能直达
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const h = decodeURIComponent(window.location.hash.replace(/^#/, ''));
    if (h && TABS.some((t) => t.id === h)) setTab(h);
  }, []);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.location.hash.slice(1) !== tab) {
      window.history.replaceState(null, '', `#${tab}`);
    }
  }, [tab]);

  async function doLogin() {
    setLoginErr('');
    const r = await fetch('/api/admin/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw }),
    });
    const j = await r.json().catch(() => ({}));
    if (j.ok) {
      setAuthed(true);
      setRole(j.role ?? null);
      currentRole = j.role ?? null;
      setPw('');
    } else setLoginErr(j.error || '登录失败');
  }

  if (authed === null)
    return <div className="p-10 text-white/60">检查登录中…</div>;

  if (!authed)
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-950 p-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            doLogin();
          }}
          className="w-80 rounded-2xl border border-white/10 bg-neutral-900 p-6"
        >
          <h1 className="mb-4 text-xl font-semibold text-white">🔒 后台登录</h1>
          <input
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder="请输入管理密码"
            autoFocus
            className="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-white outline-none focus:border-emerald-500/60"
          />
          {loginErr && <p className="mt-2 text-sm text-red-400">{loginErr}</p>}
          <button
            type="submit"
            className="mt-4 w-full rounded-lg bg-emerald-600 py-2 font-medium text-white hover:bg-emerald-500"
          >
            进入
          </button>
          <p className="mt-3 text-xs text-white/40">
            管理密码由环境变量 ADMIN_PASSWORD 设置（未设置时默认为 admin）；只读访客账号密码为 GUEST_PASSWORD（未设置时默认为 guest），仅可查看与查询、不能增删改。
          </p>
        </form>
      </div>
    );

  const meta = tabMeta(tab);

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <LoadingBar />
      <AskModal />
      <Toaster />

      <header className="sticky top-0 z-40 border-b border-white/10 bg-neutral-950/90 px-4 py-3 backdrop-blur md:px-6">
        <div className="flex items-center gap-3">
          <h1 className="truncate text-base font-semibold md:text-lg">李豆沙_Channel · 后台管理</h1>
          <span className="hidden rounded-full bg-white/10 px-2 py-0.5 text-xs text-white/50 sm:inline">
            {meta.icon} {meta.label}
          </span>
          <button
            onClick={async () => {
              await fetch('/api/admin/logout', { method: 'POST', credentials: 'include' });
              setAuthed(false);
            }}
            className="ml-auto rounded-lg border border-white/15 px-3 py-1 text-sm text-white/70 transition hover:bg-white/10 hover:text-white"
          >
            退出
          </button>
        </div>
      </header>

      {role === 'guest' && (
        <div className="border-b border-amber-500/30 bg-amber-500/15 px-4 py-2 text-sm text-amber-200 md:px-6">
          👁 只读访客模式：可查看与查询数据，但不能进行任何增删改操作。
        </div>
      )}

      {/* 窄屏：横向可滚动页签 */}
      <nav className="sticky top-[3.4rem] z-30 flex gap-1 overflow-x-auto border-b border-white/10 bg-neutral-950/95 px-3 py-2 backdrop-blur md:hidden">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm transition ${
              tab === t.id ? 'bg-emerald-500/20 text-emerald-200' : 'text-white/55 hover:bg-white/5'
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </nav>

      <div className="flex items-start">
        {/* 宽屏：分组侧栏 */}
        <aside
          className={`sticky top-[3.4rem] hidden h-[calc(100vh-3.4rem)] shrink-0 flex-col overflow-y-auto border-r border-white/10 bg-neutral-950/60 p-3 md:flex ${
            collapsed ? 'w-[4.5rem]' : 'w-60'
          }`}
        >
          <div className="flex-1">
            <NavGroups tab={tab} setTab={setTab} collapsed={collapsed} />
          </div>
          <button
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? '展开侧栏' : '收起侧栏'}
            className="mt-3 rounded-lg border border-white/10 px-2 py-1.5 text-xs text-white/50 transition hover:bg-white/5 hover:text-white"
          >
            {collapsed ? '»' : '« 收起'}
          </button>
        </aside>

        <main className="min-w-0 flex-1 overflow-x-auto p-4 md:p-6">
          <div className="mb-4">
            <h2 className="text-xl font-semibold text-white">
              {meta.icon} {meta.label}
            </h2>
            {meta.desc && <p className="mt-0.5 text-sm text-white/45">{meta.desc}</p>}
          </div>

          {tab === 'jobs' && <JobsTab />}
          {tab === 'hero' && <HeroTab />}
          {tab === 'clips' && <ClipsTab />}
          {tab === 'lives' && <LivesTab />}
          {tab === 'track' && <TrackTab />}
          {tab === 'chars' && <CharsTab />}
          {tab === 'quotes' && <QuotesTab />}
          {tab === 'works' && <WorksTab />}
          {tab === 'mascot' && <MascotTab />}
          {tab === 'assets' && <AssetsTab />}
          {tab === 'shop' && <ShopTab />}
          {tab === 'news' && <NewsTab />}
          {tab === 'topic' && <TopicTab />}
          {tab === 'creds' && <CredsTab />}
          {tab === 'system' && <SystemTab />}
        </main>
      </div>
    </div>
  );
}

function NavGroups({
  tab,
  setTab,
  collapsed,
}: {
  tab: string;
  setTab: (v: string) => void;
  collapsed?: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      {NAV_GROUPS.map((g) => (
        <div key={g.label}>
          {!collapsed && (
            <div className="mb-1 px-2 text-[11px] font-medium uppercase tracking-wider text-white/30">
              {g.label}
            </div>
          )}
          <div className="flex flex-col gap-0.5">
            {g.items.map((id) => {
              const t = tabMeta(id);
              const active = tab === id;
              return (
                <button
                  key={id}
                  onClick={() => setTab(id)}
                  title={collapsed ? t.label : undefined}
                  className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition ${
                    active
                      ? 'bg-emerald-500/15 text-emerald-200'
                      : 'text-white/60 hover:bg-white/5 hover:text-white'
                  } ${collapsed ? 'justify-center' : ''}`}
                >
                  <span className="text-base leading-none">{t.icon}</span>
                  {!collapsed && <span className="truncate">{t.label}</span>}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function LoadingBar() {
  const [n, setN] = useState(0);
  useEffect(() => {
    const fn = (v: number) => setN(v);
    loadBus.add(fn);
    return () => {
      loadBus.delete(fn);
    };
  }, []);
  if (n <= 0) return null;
  return (
    <div className="fixed inset-x-0 top-0 z-[70]">
      <div className="h-0.5 w-full animate-pulse bg-emerald-400/90" />
    </div>
  );
}

function AskModal() {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    const fn = (q: string | null) => setText(q);
    askBus.add(fn);
    return () => {
      askBus.delete(fn);
    };
  }, []);
  useEffect(() => {
    if (!text) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') settleAsk(false);
      if (e.key === 'Enter') settleAsk(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [text]);
  if (!text) return null;
  return (
    <div
      className="fixed inset-0 z-[65] flex items-center justify-center bg-black/60 p-4"
      onClick={() => settleAsk(false)}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-white/10 bg-neutral-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="whitespace-pre-line text-sm leading-relaxed text-white/90">{text}</div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={() => settleAsk(false)}
            className="rounded-lg border border-white/15 px-4 py-2 text-sm text-white/70 transition hover:bg-white/10"
          >
            取消
          </button>
          <button
            onClick={() => settleAsk(true)}
            autoFocus
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500"
          >
            确定
          </button>
        </div>
      </div>
    </div>
  );
}

function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const fn = (t: ToastItem) => {
      setItems((s) => [...s, t]);
      timers.push(
        setTimeout(() => setItems((s) => s.filter((x) => x.id !== t.id)), t.kind === 'err' ? 5200 : 2800),
      );
    };
    toastBus.add(fn);
    return () => {
      toastBus.delete(fn);
      timers.forEach(clearTimeout);
    };
  }, []);
  if (!items.length) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-[60] flex flex-col items-center gap-2 px-4">
      {items.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto max-w-md rounded-xl border px-4 py-2.5 text-sm shadow-lg backdrop-blur transition ${
            t.kind === 'err'
              ? 'border-red-400/40 bg-red-950/85 text-red-100'
              : t.kind === 'ok'
                ? 'border-emerald-400/40 bg-emerald-950/85 text-emerald-100'
                : 'border-white/15 bg-neutral-900/90 text-white/90'
          }`}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}

// 列表快速搜索：按 JSON 序列化后全文匹配，免配置、任意字段都能搜到
function quickFilter<T>(rows: T[], q: string): T[] {
  const k = q.trim().toLowerCase();
  if (!k) return rows;
  return rows.filter((r) => JSON.stringify(r ?? '').toLowerCase().includes(k));
}

function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-white/40">⌕</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? '搜索…'}
        className="w-44 rounded-lg border border-white/15 bg-black/40 py-1.5 pl-8 pr-7 text-sm text-white outline-none focus:border-emerald-500/60"
      />
      {value && (
        <button
          onClick={() => onChange('')}
          title="清除"
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded px-1 text-white/40 transition hover:text-white"
        >
          ✕
        </button>
      )}
    </div>
  );
}

function Sec({
  title,
  desc,
  right,
  children,
}: {
  title: string;
  desc?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mb-7">
      <div className="mb-3 flex items-center gap-3">
        <h3 className="shrink-0 text-sm font-semibold uppercase tracking-wide text-emerald-300">
          {title}
        </h3>
        {desc && <span className="shrink-0 text-xs text-white/40">{desc}</span>}
        <span className="h-px flex-1 bg-white/10" />
        {right && <span className="shrink-0">{right}</span>}
      </div>
      {children}
    </section>
  );
}

// 监控指标格式化：有值显示千分位，未监控(null)显示 —
function nf(v: number | null | undefined): string {
  return v != null ? Number(v).toLocaleString() : '—';
}

// ---------------- 任务调度 ----------------
function JobsTab() {
  const [jobs, setJobs] = useState<any[]>([]);
  const [types, setTypes] = useState<any[]>([]);
  const [runs, setRuns] = useState<any[]>([]);
  const [openRun, setOpenRun] = useState<number | null>(null);
  const [form, setForm] = useState({ type: 'clips', name: '', cron: '0 */6 * * *', enabled: true });
  const [err, setErr] = useState('');
  const timer = useRef<any>(null);

  const refresh = useCallback(async () => {
    try {
      const j = await api('/api/admin/jobs');
      setJobs(j.jobs || []);
      setTypes(j.types || []);
      if (!form.type && (j.types || [])[0]) setForm((f) => ({ ...f, type: j.types[0].type }));
      const r = await api('/api/admin/job-runs?limit=30');
      setRuns(r.runs || []);
    } catch (e: any) {
      setErr(e.message);
    }
  }, [form.type]);

  useEffect(() => {
    refresh();
    timer.current = setInterval(refresh, 8000);
    return () => clearInterval(timer.current);
  }, [refresh]);

  async function create() {
    const r = await api('/api/admin/jobs', { method: 'POST', body: JSON.stringify(form) });
    if (r.ok) refresh();
    else setErr(r.error || '创建失败');
  }
  async function toggle(j: any) {
    await api(`/api/admin/jobs/${j.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: !j.enabled }) });
    refresh();
  }
  async function run(j: any) {
    const r = await api(`/api/admin/jobs/${j.id}`, { method: 'POST' });
    if (r.ok) refresh();
  }
  async function del(j: any) {
    if (!(await ask(`删除任务「${j.name}」？`))) return;
    await api(`/api/admin/jobs/${j.id}`, { method: 'DELETE' });
    refresh();
  }
  async function stopRun(id: number) {
    if (!(await ask(`确认停止运行记录 #${id}？`))) return;
    const r = await api(`/api/admin/job-runs/${id}`, { method: 'POST' });
    setErr(r.ok ? `已发送停止信号（#${id}）` : r.error || '停止失败');
    if (r.ok) {
      const rr = await api('/api/admin/job-runs?limit=30');
      setRuns(rr.runs || []);
    }
  }

  return (
    <div>
      <Sec title="新建定时任务">
        <div className="flex flex-wrap items-end gap-3">
          <select
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
            className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-white"
          >
            {types.map((t) => (
              <option key={t.type} value={t.type}>
                {t.label}
              </option>
            ))}
          </select>
          <input
            placeholder="任务名"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-40 rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-white"
          />
          <input
            placeholder="cron 如 0 */6 * * *"
            value={form.cron}
            onChange={(e) => setForm({ ...form, cron: e.target.value })}
            className="w-48 rounded-lg border border-white/15 bg-black/40 px-3 py-2 font-mono text-white"
          />
          <label className="flex items-center gap-2 text-sm text-white/70">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
            />
            启用
          </label>
          <button
            onClick={create}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-white hover:bg-emerald-500"
          >
            创建
          </button>
        </div>
        <p className="mt-2 text-xs text-white/40">
          cron 为标准的 5 字段（分 时 日 月 周）。例如 0 */6 * * * = 每 6 小时；0 3 * * * = 每天 3 点。
        </p>
        {form.type === 'clips' && (
          <p className="mt-1 text-xs text-amber-300/80">
            切片收集（标签投稿）为<b>时间增量</b>收集：仅收录比库内最新投稿更新的视频，不会全量回扫旧投稿；库内为空时首跑才全量。
          </p>
        )}
        {err && <p className="mt-2 text-sm text-red-400">{err}</p>}
      </Sec>

      <Sec title="任务列表">
        <table className="w-full text-sm">
          <thead className="text-white/50">
            <tr className="border-b border-white/10 text-left">
              <th className="py-2">名称</th>
              <th>类型</th>
              <th>cron</th>
              <th>启用</th>
              <th>上次运行</th>
              <th>下次运行</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id} className="border-b border-white/5">
                <td className="py-2">{j.name}</td>
                <td className="text-white/60">{j.type}</td>
                <td className="font-mono text-white/60">{j.cron}</td>
                <td>{j.enabled ? '✅' : '⛔'}</td>
                <td className="text-white/60">
                  {j.lastStatus ? (
                    <span className={j.lastStatus === 'success' ? 'text-emerald-300' : j.lastStatus === 'failed' ? 'text-red-400' : 'text-amber-300'}>
                      {j.lastStatus === 'success' ? '成功' : j.lastStatus === 'failed' ? '失败' : '运行中'}
                    </span>
                  ) : (
                    '—'
                  )}
                  {j.lastFinishedAt ? (
                    <div className="text-[11px] text-white/40">{new Date(j.lastFinishedAt).toLocaleString()}</div>
                  ) : null}
                </td>
                <td className="text-white/60">
                  {j.running ? <span className="text-amber-300">运行中…</span> : j.enabled && j.nextRun ? (
                    new Date(j.nextRun).toLocaleString()
                  ) : j.enabled ? (
                    '计算中…'
                  ) : (
                    '已停用'
                  )}
                </td>
                <td className="space-x-2">
                  <button onClick={() => toggle(j)} className="text-emerald-300 hover:underline">
                    {j.enabled ? '停用' : '启用'}
                  </button>
                  <button onClick={() => run(j)} className="text-sky-300 hover:underline">
                    运行一次
                  </button>
                  <button onClick={() => del(j)} className="text-red-300 hover:underline">
                    删除
                  </button>
                </td>
              </tr>
            ))}
            {jobs.length === 0 && (
              <tr>
                <td colSpan={7} className="py-3 text-white/40">
                  暂无任务，先建一个吧。建议建：切片收集 / 动态同步 / 评论同步 / 直播回放同步（增量）。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Sec>

      <Sec title="运行记录（每 8 秒刷新，点击展开日志）">
        <table className="w-full text-sm">
          <thead className="text-white/50">
            <tr className="border-b border-white/10 text-left">
              <th className="py-2">ID</th>
              <th>脚本</th>
              <th>状态</th>
              <th>触发</th>
              <th>开始</th>
              <th>结束</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <Fragment key={r.id}>
                <tr
                  className="cursor-pointer border-b border-white/5 hover:bg-white/5"
                  onClick={() => setOpenRun(openRun === r.id ? null : r.id)}
                >
                  <td className="py-2">#{r.id}</td>
                  <td className="text-white/80">
                    {(types.find((t: any) => t.type === r.type)?.label as string) || r.type}
                  </td>
                  <td>
                    <span
                      className={
                        r.status === 'success'
                          ? 'text-emerald-300'
                          : r.status === 'failed'
                          ? 'text-red-400 font-semibold'
                          : r.status === 'cancelled'
                          ? 'text-white/40 line-through'
                          : 'text-amber-300'
                      }
                    >
                      {r.status === 'success'
                        ? '成功'
                        : r.status === 'failed'
                        ? '失败'
                        : r.status === 'cancelled'
                        ? '已取消'
                        : '运行中'}
                    </span>
                  </td>
                  <td className="text-white/60">{r.triggered_by}</td>
                  <td className="text-white/60">{new Date(r.started_at).toLocaleString()}</td>
                  <td className="text-white/60">
                    {r.finished_at ? new Date(r.finished_at).toLocaleString() : '—'}
                  </td>
                  <td className="text-white/40">{openRun === r.id ? '▲' : '▼'}</td>
                </tr>
                {openRun === r.id && (
                  <tr className="border-b border-white/5 bg-black/30">
                    <td colSpan={7} className="px-3 py-3">
                      {r.error && (
                        <div className="mb-2 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                          <span className="font-semibold">报错：</span>
                          {r.error}
                        </div>
                      )}
                      <div className="mb-1 flex items-center justify-between text-xs text-white/40">
                        <span>运行日志</span>
                        {r.status === 'running' && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              stopRun(r.id);
                            }}
                            className="rounded border border-red-500/40 px-2 py-0.5 text-xs text-red-300 hover:bg-red-500/10"
                          >
                            停止任务
                          </button>
                        )}
                        {r.status === 'success' && r.log && (() => {
                          const lines = (r.log || '').trim().split('\n').filter(Boolean);
                          const last = lines[lines.length - 1] || '';
                          if (!last.startsWith('完成：') && !last.startsWith('失败：')) return null;
                          return (
                            <span className={`rounded px-2 py-0.5 ${r.status === 'success' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300'}`}>
                              {last}
                            </span>
                          );
                        })()}
                      </div>
                      <pre className="max-h-[40vh] overflow-auto whitespace-pre-wrap rounded border border-white/10 bg-black/50 p-3 text-xs leading-relaxed text-white/80">
                        {r.log?.trim() || '（暂无日志）'}
                      </pre>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </Sec>
    </div>
  );
}

// ---------------- 切片收集 ----------------
function ClipsTab() {
  const [list, setList] = useState<any[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [q, setQ] = useState('');
  const [noCover, setNoCover] = useState(false);
  const [exclude, setExclude] = useState(false);
  const [page, setPage] = useState(0);
  const pageSize = 50;
  const [addBvid, setAddBvid] = useState('');
  const [upname, setUpname] = useState('');
  const [upkw, setUpkw] = useState('豆沙');
  const [msg, setMsg] = useState('');
  const [blockAuthor, setBlockAuthor] = useState('');
  const [blockedUps, setBlockedUps] = useState<
    { author: string; reason: string | null; created_at: number | null }[]
  >([]);
  const [showBlocked, setShowBlocked] = useState(false);

  const refresh = useCallback(async () => {
    const params = new URLSearchParams();
    params.set('limit', String(pageSize));
    params.set('offset', String(page * pageSize));
    if (q.trim()) params.set('q', q.trim());
    if (noCover) params.set('nocover', '1');
    if (exclude) params.set('exclude', '1');
    const r = await api(`/api/admin/clips?${params.toString()}`);
    setList(r.list || []);
    setTotal(r.total ?? null);
  }, [q, noCover, exclude, page]);

  useEffect(() => {
    refresh();
    loadBlockedUps();
  }, [refresh]);

  async function add() {
    const r = await api('/api/admin/clips', {
      method: 'POST',
      body: JSON.stringify({ bvid: addBvid }),
    });
    setMsg(r.ok ? '已添加/更新' : r.error);
    if (r.ok) {
      setAddBvid('');
      refresh();
    }
  }
  async function scan(mode: string) {
    const body =
      mode === 'upscan' ? { mode, upname, keyword: upkw } : { mode };
    const r = await api('/api/admin/clips/scan', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    setMsg(r.ok ? `已启动（运行记录 #${r.runId}），可在“任务调度”查看进度` : r.error);
  }

  async function syncCovers(bvid?: string) {
    const r = await api('/api/admin/clips/covers', {
      method: 'POST',
      body: JSON.stringify(bvid ? { bvid } : {}),
    });
    setMsg(
      r.ok
        ? bvid
          ? `已启动封面同步（${bvid}，运行记录 #${r.runId}）`
          : `已启动封面补全（运行记录 #${r.runId}），可在“任务调度”查看进度`
        : r.error,
    );
  }

  async function remove(bvid: string) {
    if (!(await ask(`确认删除并拉黑该切片（${bvid}）？\n拉黑后收集与展示都会跳过，且下次同步不会再次收集。`)))
      return;
    const r = await api('/api/admin/clips', {
      method: 'DELETE',
      body: JSON.stringify({ bvid }),
    });
    setMsg(r.ok ? '已删除并拉黑' : r.error);
    if (r.ok) refresh();
  }
  async function loadBlockedUps() {
    const r = await api('/api/admin/blocked-ups');
    if (r.ok) setBlockedUps(r.list || []);
  }
  async function blockUpAuthor(author: string) {
    if (!(await ask(`确认拉黑 UP 主「${author}」？\n将删除其全部已有切片，且下次收集会跳过该 UP。`)))
      return;
    const r = await api('/api/admin/blocked-ups', {
      method: 'POST',
      body: JSON.stringify({ author }),
    });
    setMsg(r.ok ? `已拉黑 UP「${author}」（删除 ${r.removed ?? 0} 条切片）` : r.error);
    if (r.ok) {
      loadBlockedUps();
      refresh();
    }
  }
  async function unblockUpAuthor(author: string) {
    if (!(await ask(`确认解除拉黑 UP 主「${author}」？\n之后收集可重新收录该 UP。`)))
      return;
    const r = await api(`/api/admin/blocked-ups?author=${encodeURIComponent(author)}`, {
      method: 'DELETE',
    });
    setMsg(r.ok ? `已解除拉黑「${author}」` : r.error);
    if (r.ok) loadBlockedUps();
  }

  return (
    <div>
      <Sec title="切片收集（标签投稿）">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => scan('all')}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-white hover:bg-emerald-500"
          >
            全量收集 / 增量更新
          </button>
          <input
            placeholder="UP 名 / 空间链接 / UID"
            value={upname}
            onChange={(e) => setUpname(e.target.value)}
            className="w-56 rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-white"
          />
          <input
            placeholder="关键词(默认 豆沙，逗号分隔可多选)"
            value={upkw}
            onChange={(e) => setUpkw(e.target.value)}
            title="按 UP 名补充切片时，只收录该 UP 投稿标题命中这些词的切片。默认 豆沙，涵盖李豆沙/室豆沙等。"
            className="w-64 rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-white"
          />
          <button
            onClick={() => scan('upscan')}
            className="rounded-lg border border-white/15 px-4 py-2 text-white hover:bg-white/10"
          >
            按 UP 名补充切片
          </button>
          <button
            onClick={() => scan('upscanall')}
            className="rounded-lg border border-amber-500/40 px-4 py-2 text-white hover:bg-amber-500/20"
            title="遍历数据库里所有已知 UP 的空间投稿，补齐切片"
          >
            全部 UP 补充切片
          </button>
        </div>
        <p className="mt-2 text-xs text-white/40">
          全量收集会扫描「李豆沙」相关标签投稿并补全播放/点赞等统计；按 UP 名补充切片时，遍历该 UP 空间投稿列表（全量），只收录标题命中「关键词」框的切片（默认 <b className="text-white/60">豆沙</b>，涵盖李豆沙/室豆沙等；逗号分隔可多选，如 <code className="text-white/50">豆沙,室豆沙</code>）。可填 UP 名、空间链接（如 https://space.bilibili.com/210100507 ）或 UID。「全部 UP 补充切片」会遍历数据库里所有已知 UP、用豆沙默认词补齐，耗时较长，建议在“任务调度”监控进度。
        </p>
      </Sec>

      <div className="mb-8 grid grid-cols-1 gap-6 md:grid-cols-2">
        <div>
          <h2 className="mb-3 text-base font-semibold text-emerald-300">手动添加切片</h2>
          <div className="flex flex-wrap gap-2">
            <input
              placeholder="BV 号"
              value={addBvid}
              onChange={(e) => setAddBvid(e.target.value)}
              className="w-48 rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-white"
            />
            <button
              onClick={add}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-white hover:bg-emerald-500"
            >
              添加
            </button>
            <input
              placeholder="搜索标题 / UP / BV号"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(0);
              }}
              onKeyDown={(e) => e.key === 'Enter' && refresh()}
              className="w-56 rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-white"
            />
            <button
              onClick={() => {
                setPage(0);
                refresh();
              }}
              className="rounded-lg border border-white/15 px-3 py-2 text-white/70 hover:bg-white/10"
            >
              搜索
            </button>
          </div>
          {msg && <p className="mt-2 text-sm text-amber-300">{msg}</p>}
        </div>

        <div>
          <h2 className="mb-3 text-base font-semibold text-emerald-300">拉黑 UP 主</h2>
          <div className="flex flex-wrap items-end gap-2">
            <input
              placeholder="UP 名（精确匹配库内 author，用于提前拉黑未收录的 UP）"
              value={blockAuthor}
              onChange={(e) => setBlockAuthor(e.target.value)}
              className="w-80 rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-white"
            />
            <button
              onClick={() => {
                const a = blockAuthor.trim();
                if (!a) return;
                blockUpAuthor(a);
                setBlockAuthor('');
              }}
              className="rounded-lg border border-orange-500/40 px-4 py-2 text-white hover:bg-orange-500/20"
            >
              拉黑
            </button>
            <button
              onClick={() => setShowBlocked((v) => !v)}
              className="rounded-lg border border-orange-500/40 px-3 py-2 text-orange-200 hover:bg-orange-500/20"
            >
              {showBlocked ? '隐藏已拉黑' : `显示已拉黑（${blockedUps.length}）`}
            </button>
          </div>
          <p className="mt-2 text-xs text-white/40">
            拉黑后：① 删除该 UP 全部已有切片（拉黑切片）；② 下次「按 UP 名补充切片 / 全部 UP 补充切片」会整体跳过该 UP。
          </p>
          {showBlocked && blockedUps.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {blockedUps.map((b) => (
                <span
                  key={b.author}
                  className="flex items-center gap-2 rounded-full border border-orange-500/30 bg-orange-500/10 px-3 py-1 text-sm text-orange-200"
                >
                  {b.author}
                  <button
                    onClick={() => unblockUpAuthor(b.author)}
                    className="text-orange-300/70 hover:text-orange-100"
                    title="解除拉黑"
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <Sec title={`已收集切片（${total ?? list.length}）`}>
        <div className="mb-2 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1 text-xs text-white/60">
            <input
              type="checkbox"
              checked={noCover}
              onChange={(e) => {
                setNoCover(e.target.checked);
                setPage(0);
              }}
            />
            仅无封面
          </label>
          <label className="flex items-center gap-1 text-xs text-white/60">
            <input
              type="checkbox"
              checked={exclude}
              onChange={(e) => {
                setExclude(e.target.checked);
                setPage(0);
              }}
            />
            反向（不包含关键词）
          </label>
        </div>
        <div className="max-h-[50vh] overflow-auto rounded-lg border border-white/10">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-neutral-900 text-white/50">
              <tr className="text-left">
                <th className="py-2 px-2">封面</th>
                <th className="px-2">标题</th>
                <th className="px-2">UP</th>
                <th className="px-2">播放</th>
                <th className="px-2">点赞</th>
                <th className="px-2">硬币</th>
                <th className="px-2">发布时间</th>
                <th className="px-2">手动</th>
                <th className="px-2">操作</th>
              </tr>
            </thead>
            <tbody>
              {list.map((v) => (
                <tr key={v.bvid} className="border-b border-white/5">
                  <td className="px-2 py-1">
                    {v.pic ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={v.pic.startsWith('//') ? 'https:' + v.pic : v.pic} alt="" className="h-8 w-14 object-cover rounded" referrerPolicy="no-referrer" />
                    ) : (
                      <span className="text-red-400 text-xs">无封面</span>
                    )}
                  </td>
                  <td className="px-2 max-w-[40vw]">
                    <a
                      href={v.arcurl || `https://www.bilibili.com/video/${v.bvid}`}
                      target="_blank"
                      rel="noreferrer"
                      title={v.title}
                      className="block truncate text-sky-300 hover:underline"
                    >
                      {v.title}
                    </a>
                  </td>
                  <td className="px-2 text-white/60">{v.author}</td>
                  <td className="px-2">{(v.view || 0).toLocaleString()}</td>
                  <td className="px-2">{(v.like || 0).toLocaleString()}</td>
                  <td className="px-2">{(v.coin || 0).toLocaleString()}</td>
                  <td className="px-2 text-white/60 whitespace-nowrap">{v.pubdate ? new Date(v.pubdate * 1000).toLocaleString('zh-CN') : '-'}</td>
                  <td className="px-2">{v.manual ? '是' : ''}</td>
                  <td className="px-2">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => syncCovers(v.bvid)}
                        className="rounded border border-sky-500/40 px-2 py-1 text-xs text-sky-300 hover:bg-sky-500/20"
                        title="用详情接口重新拉取该视频封面"
                      >
                        同步封面
                      </button>
                      <button
                        onClick={() => remove(v.bvid)}
                        className="rounded border border-red-500/40 px-2 py-1 text-xs text-red-300 hover:bg-red-500/20"
                      >
                        删除
                      </button>
                      <button
                        onClick={() => blockUpAuthor(v.author)}
                        className="rounded border border-orange-500/40 px-2 py-1 text-xs text-orange-300 hover:bg-orange-500/20"
                        title="拉黑该 UP 主：删除其全部切片，且下次收集跳过"
                      >
                        拉黑UP
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-2 flex items-center gap-3 text-sm">
          <button
            disabled={page <= 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="rounded-lg border border-white/15 px-3 py-1.5 text-white/80 disabled:opacity-30 hover:bg-white/10"
          >
            上一页
          </button>
          <span className="text-white/60">
            第 {page + 1} / {Math.max(1, Math.ceil((total ?? 0) / pageSize))} 页
          </span>
          <button
            disabled={page + 1 >= Math.max(1, Math.ceil((total ?? 0) / pageSize))}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-lg border border-white/15 px-3 py-1.5 text-white/80 disabled:opacity-30 hover:bg-white/10"
          >
            下一页
          </button>
        </div>
      </Sec>
    </div>
  );
}

// ---------------- 直播与歌单 ----------------
function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return [h, m, ss].map((n) => String(n).padStart(2, '0')).join(':');
}
function fmtDur(sec: number): string {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return `${h}时${m}分${ss}秒`;
  if (m > 0) return `${m}分${ss}秒`;
  return `${ss}秒`;
}
function TrackTab() {
  const [track, setTrack] = useState<{ follower: any[]; guard: any[] }>({
    follower: [],
    guard: [],
  });
  const loadTrack = useCallback(async () => {
    const r = await api('/api/admin/stats');
    setTrack({ follower: r.follower || [], guard: r.guard || [] });
  }, []);
  useEffect(() => {
    loadTrack();
  }, [loadTrack]);

  return (
    <Sec title="李豆沙 数据追踪（粉丝 / 大航海）">
      <div className="mb-3 flex flex-wrap gap-4 text-sm">
        {track.follower[0] ? (
          <span>
            最新粉丝数{' '}
            <b className="text-emerald-300">
              {track.follower[0].follower?.toLocaleString() ?? '—'}
            </b>{' '}
            <span className="text-white/40">
              （{new Date(track.follower[0].hour * 1000).toLocaleString('zh-CN')}）
            </span>
          </span>
        ) : (
          <span className="text-white/40">暂无粉丝记录</span>
        )}
        {track.guard[0] ? (
          <span className="text-white/70">
            今日大航海 总督{' '}
            <b className="text-amber-300">{track.guard[0].governor}</b> / 提督{' '}
            <b className="text-amber-300">{track.guard[0].admiral}</b> / 舰长{' '}
            <b className="text-amber-300">{track.guard[0].captain}</b> （
            {track.guard[0].day}）
          </span>
        ) : (
          <span className="text-white/40">暂无大航海记录</span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div>
          <div className="mb-2 text-xs text-white/50">每小时粉丝数（最近 24 条）</div>
          <div className="max-h-[32vh] overflow-auto rounded-lg border border-white/10">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-neutral-900 text-white/50">
                <tr className="text-left">
                  <th className="py-1 px-2">时间</th>
                  <th className="px-2 text-right">粉丝</th>
                  <th className="px-2 text-right">关注</th>
                </tr>
              </thead>
              <tbody>
                {track.follower.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-2 py-3 text-center text-white/40">
                      暂无数据（每小时自动记录，下次整点后出现）
                    </td>
                  </tr>
                )}
                {track.follower.slice(0, 24).map((f: any) => (
                  <tr key={f.hour} className="border-b border-white/5">
                    <td className="px-2 whitespace-nowrap">
                      {new Date(f.hour * 1000).toLocaleString('zh-CN')}
                    </td>
                    <td className="px-2 text-right tabular-nums">
                      {f.follower?.toLocaleString() ?? '—'}
                    </td>
                    <td className="px-2 text-right tabular-nums text-white/60">
                      {f.following?.toLocaleString() ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <div className="mb-2 text-xs text-white/50">每天大航海（舰长/提督/总督）</div>
          <div className="max-h-[32vh] overflow-auto rounded-lg border border-white/10">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-neutral-900 text-white/50">
                <tr className="text-left">
                  <th className="py-1 px-2">日期</th>
                  <th className="px-2 text-right">总督</th>
                  <th className="px-2 text-right">提督</th>
                  <th className="px-2 text-right">舰长</th>
                  <th className="px-2 text-right">合计</th>
                </tr>
              </thead>
              <tbody>
                {track.guard.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-2 py-3 text-center text-white/40">
                      暂无数据（每天自动记录）
                    </td>
                  </tr>
                )}
                {track.guard.map((g: any) => (
                  <tr key={g.day} className="border-b border-white/5">
                    <td className="px-2 whitespace-nowrap">{g.day}</td>
                    <td className="px-2 text-right tabular-nums text-amber-300">{g.governor}</td>
                    <td className="px-2 text-right tabular-nums text-amber-300">{g.admiral}</td>
                    <td className="px-2 text-right tabular-nums text-amber-300">{g.captain}</td>
                    <td className="px-2 text-right tabular-nums">{g.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Sec>
  );
}

function LivesTab() {
  const [list, setList] = useState<any[]>([]);
  const [open, setOpen] = useState<any>(null);
  const [songs, setSongs] = useState<any[]>([]);
  const [effective, setEffective] = useState<any[]>([]);
  const [newSong, setNewSong] = useState('');
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [edit, setEdit] = useState<any>({});
  const [dm, setDm] = useState<any[]>([]);
  const [dmTotal, setDmTotal] = useState(0);
  const [dmQuery, setDmQuery] = useState('');
  const [dmPage, setDmPage] = useState(0);
  const [dmSenders, setDmSenders] = useState<any[]>([]);
  const [busy, setBusy] = useState('');
  const [rtSessions, setRtSessions] = useState<any[]>([]);
  const [rtDetail, setRtDetail] = useState<any>(null);
  const [rtDetailId, setRtDetailId] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [catMsg, setCatMsg] = useState('');
  const [page, setPage] = useState(0);

  // 按回放标题自动归类：预览 / 应用
  const previewCategories = async () => {
    setCatMsg('统计中…');
    const r = await api('/api/admin/lives/reclassify');
    if (!r.ok) {
      setCatMsg('预览失败');
      return;
    }
    const s = Object.entries(r.summary || {})
      .map(([k, v]) => `${CAT_LABEL[k] ?? k} ${v}`)
      .join(' · ');
    setCatMsg(`共 ${r.total} 场 → ${s}`);
  };
  const applyCategories = async (overwrite: boolean) => {
    if (
      !(await ask(
        overwrite
          ? '将按标题重新自动归类，覆盖全部已有的人工标记，确定？'
          : '将按标题自动归类，仅填补尚未人工标记的场次，确定？',
      ))
    )
      return;
    setCatMsg('写入中…');
    const r = await api('/api/admin/lives/reclassify', {
      method: 'POST',
      body: JSON.stringify({ overwrite }),
    });
    setCatMsg(r.ok ? `已写入 ${r.changed} 场，刷新列表中…` : '应用失败');
    refresh();
  };

  const allSel = rtSessions.length > 0 && rtSessions.every((s) => sel.has(String(s.id)));
  const toggleAllSel = () =>
    setSel(allSel ? new Set() : new Set(rtSessions.map((s) => String(s.id))));
  const toggleOneSel = (id: string) =>
    setSel((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const exportLive = async () => {
    if (sel.size === 0) {
      toast('请先勾选要导出的直播场次', 'err');
      return;
    }
    try {
      const res = await fetch('/api/admin/export/live', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [...sel] }),
      });
      if (!res.ok) {
        toast('导出失败：' + res.status, 'err');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `live-export-${Date.now()}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast('导出出错：' + (e as Error).message, 'err');
    }
  };
  const [rtDetailLoading, setRtDetailLoading] = useState(false);
  const [rtTab, setRtTab] = useState<'dm' | 'sc' | 'gift' | 'interact' | 'online'>('dm');
  const [monitor, setMonitor] = useState<{
    running: boolean;
    lastSeen: number | null;
    roomId: string | null;
    test: { running: boolean; lastSeen: number | null; roomId: string | null } | null;
  } | null>(null);

  const loadRt = useCallback(async () => {
    const r = await api('/api/admin/live-rt');
    setRtSessions(r.list || []);
  }, []);

  const loadMonitor = useCallback(async () => {
    const r = await api('/api/admin/monitor-status');
    setMonitor({
      running: !!r.running,
      lastSeen: r.lastSeen ?? null,
      roomId: r.roomId ?? null,
      test: r.test ?? null,
    });
  }, []);

  const openRtDetail = useCallback(async (id: string) => {
    setRtDetailId(id);
    setRtDetail(null);
    setRtDetailLoading(true);
    setRtTab('dm');
    const r = await api(`/api/admin/live-rt/${encodeURIComponent(id)}`);
    setRtDetail(r);
    setRtDetailLoading(false);
  }, []);

  const refresh = useCallback(async () => {
    const r = await api('/api/admin/lives');
    setList(r.list || []);
  }, []);
  useEffect(() => {
    refresh();
    loadRt();
    loadMonitor();
    const t = setInterval(() => loadMonitor(), 30_000);
    return () => clearInterval(t);
  }, [refresh, loadRt, loadMonitor]);

  const PAGE_SIZE = 20;
  const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(page, 0), totalPages - 1);
  const paged = list.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  async function openDetail(bvid: string) {
    const r = await api(`/api/admin/lives/${bvid}`);
    setOpen(r.session);
    setEdit({
      categoryManual: r.session.categoryManual || '',
      singDuration: r.session.singDuration ?? '',
      gameDuration: r.session.gameDuration ?? '',
      note: r.session.note || '',
      songStrategy: r.session.songStrategy || 'merge',
    });
    setSongs(r.songs || []);
    setEffective(r.effective || []);
    setDmPage(0);
    setDmQuery('');
    loadDanmaku(bvid, '', 0);
    loadDmSenders(bvid);
  }
  async function loadDanmaku(bvid: string, q: string, page: number) {
    const r = await api(
      `/api/admin/lives/${bvid}/danmaku?limit=200&offset=${page * 200}${q ? `&q=${encodeURIComponent(q)}` : ''}`,
    );
    setDm(r.rows || []);
    setDmTotal(r.total || 0);
  }
  async function loadDmSenders(bvid: string) {
    const r = await api(`/api/danmaku?senders=1&bvid=${bvid}`);
    setDmSenders(r.senders || []);
  }
  async function searchDanmaku() {
    if (!open) return;
    setDmPage(0);
    loadDanmaku(open.bvid, dmQuery, 0);
  }
  async function runBulk(action: string) {
    if (busy) return;
    setBusy(action);
    const r = await api('/api/admin/lives/scan', {
      method: 'POST',
      body: JSON.stringify({ action }),
    });
    setBusy('');
    toast(r.ok ? `已启动「${action}」全量（运行记录 #${r.runId}），可在“任务调度”查看进度` : r.error, r.ok ? 'ok' : 'err');
  }
  async function saveMeta() {
    const r = await api(`/api/admin/lives/${open.bvid}`, {
      method: 'PATCH',
      body: JSON.stringify(edit),
    });
    if (r.ok) {
      refresh();
      openDetail(open.bvid);
    }
  }
  async function scan() {
    const r = await api(`/api/admin/lives/${open.bvid}/songs`, {
      method: 'POST',
      body: JSON.stringify({ action: 'scan' }),
    });
    toast(r.ok ? `已启动歌单识别（运行记录 #${r.runId}）` : r.error, r.ok ? 'ok' : 'err');
  }
  async function collectDanmaku() {
    const r = await api(`/api/admin/lives/${open.bvid}/danmaku`, {
      method: 'POST',
    });
    toast(r.ok ? `已启动弹幕收集（运行记录 #${r.runId}），可在“任务调度”查看进度` : r.error, r.ok ? 'ok' : 'err');
  }
  async function addSong() {
    const r = await api(`/api/admin/lives/${open.bvid}/songs`, {
      method: 'POST',
      body: JSON.stringify({ title: newSong }),
    });
    if (r.ok) {
      setNewSong('');
      openDetail(open.bvid);
    }
  }
  async function toggleExclude(s: any) {
    await api(`/api/admin/lives/${open.bvid}/songs/${s.idx}`, {
      method: 'PATCH',
      body: JSON.stringify({ excluded: !s.excluded }),
    });
    openDetail(open.bvid);
  }
  async function delSong(s: any) {
    await api(`/api/admin/lives/${open.bvid}/songs/${s.idx}`, { method: 'DELETE' });
    openDetail(open.bvid);
  }
  async function renameSong(s: any) {
    const title = editTitle.trim();
    if (!title) {
      setEditIdx(null);
      return;
    }
    await api(`/api/admin/lives/${open.bvid}/songs/${s.idx}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    });
    setEditIdx(null);
    openDetail(open.bvid);
  }

  return (
    <div>
      <LiveMonitor />

      <div className="mb-3 flex items-center gap-3 text-sm">
        {monitor ? (
          monitor.running ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1 text-emerald-300">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              监控守护进程运行中
              {monitor.roomId ? `（房间 ${monitor.roomId}）` : ''}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/15 px-3 py-1 text-red-300">
              <span className="h-2 w-2 rounded-full bg-red-400" />
              监控守护进程未运行
            </span>
          )
        ) : (
          <span className="text-white/40">监控状态检测中…</span>
        )}
        {monitor?.lastSeen ? (
          <span className="text-white/40">
            最近心跳 {new Date(monitor.lastSeen).toLocaleTimeString('zh-CN')}
          </span>
        ) : null}
        {monitor?.test ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-3 py-1 text-amber-300">
            <span className="h-2 w-2 rounded-full bg-amber-400" />
            试运行实例：房间 {monitor.test.roomId ?? '—'}
          </span>
        ) : null}
      </div>

      <Sec title="直播实时监控记录（每次直播）">
        <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
          <button
            onClick={toggleAllSel}
            className="rounded-lg border border-white/15 px-3 py-1.5 text-white/80 hover:bg-white/10"
          >
            {allSel ? '取消全选' : '全选'}
          </button>
          <button
            onClick={exportLive}
            className="rounded-lg border border-emerald-500/40 px-3 py-1.5 text-emerald-200 hover:bg-emerald-500/20"
          >
            导出选中（{sel.size}）
          </button>
          <span className="text-white/40">
            勾选场次后导出 ZIP，每场一个文件夹含弹幕 / 礼物 / SC / 互动明细
          </span>
        </div>
        <div className="max-h-[42vh] overflow-auto rounded-lg border border-white/10">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-neutral-900 text-white/50">
              <tr className="text-left">
                <th className="py-2 px-2 w-8">
                  <input
                    type="checkbox"
                    checked={allSel}
                    onChange={toggleAllSel}
                    className="accent-emerald-500"
                  />
                </th>
                <th className="py-2 px-2">开始时间</th>
                <th className="px-2">房间号</th>
                <th className="px-2">标题</th>
                <th className="px-2">时长</th>
                <th className="px-2">人气峰值</th>
                <th className="px-2">弹幕</th>
                <th className="px-2">醒目留言</th>
                <th className="px-2">礼物(次)</th>
                <th className="px-2">礼物币</th>
                <th className="px-2">进入</th>
                <th className="px-2">关注</th>
                <th className="px-2"></th>
              </tr>
            </thead>
            <tbody>
              {rtSessions.length === 0 && (
                <tr>
                  <td colSpan={12} className="px-2 py-4 text-center text-white/40">
                    暂无记录（运行 npm run live-monitor 后，每次直播结束会自动归档）
                  </td>
                </tr>
              )}
              {rtSessions.map((s) => (
                <tr key={s.id} className="border-b border-white/5">
                  <td className="px-2">
                    <input
                      type="checkbox"
                      checked={sel.has(String(s.id))}
                      onChange={() => toggleOneSel(String(s.id))}
                      className="accent-emerald-500"
                    />
                  </td>
                  <td className="px-2 whitespace-nowrap">
                    {s.start ? new Date(s.start * 1000).toLocaleString('zh-CN') : '—'}
                    {!s.end && <span className="ml-1 text-emerald-400">●直播中</span>}
                  </td>
                  <td className="px-2 whitespace-nowrap text-white/70">{s.roomId || '—'}</td>
                  <td className="px-2 max-w-[32vw] truncate">{s.title || '—'}</td>
                  <td className="px-2 whitespace-nowrap">
                    {s.durationSec != null ? fmtDur(s.durationSec) : '—'}
                  </td>
                  <td className="px-2">{s.onlinePeak?.toLocaleString() ?? '—'}</td>
                  <td className="px-2">{s.danmaku?.toLocaleString()}</td>
                  <td className="px-2">{s.sc?.toLocaleString()}</td>
                  <td className="px-2">{s.gift?.toLocaleString()}</td>
                  <td className="px-2">{s.giftCoin?.toLocaleString()}</td>
                  <td className="px-2 tabular-nums">{s.enter?.toLocaleString()}</td>
                  <td className="px-2 tabular-nums">{s.follow?.toLocaleString()}</td>
                  <td className="px-2 whitespace-nowrap">
                    <button
                      onClick={() => openRtDetail(s.id)}
                      className="text-sky-300 hover:underline"
                    >
                      明细
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Sec>

      {rtDetailId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setRtDetailId('')}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-4xl flex-col rounded-xl border border-white/15 bg-neutral-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <div className="text-sm font-semibold text-emerald-300">场次明细 · {rtDetailId}</div>
              <button
                onClick={() => setRtDetailId('')}
                className="text-white/50 hover:text-white"
              >
                ✕
              </button>
            </div>
            {rtDetailLoading ? (
              <div className="p-8 text-center text-white/40">加载中…</div>
            ) : rtDetail ? (
              (() => {
                const gift = rtDetail.gift || [];
                const sc = rtDetail.sc || [];
                const dm = rtDetail.danmaku || [];
                const it = rtDetail.interact || [];
                const giftCoinSum = gift.reduce(
                  (a: number, b: any) => a + (b.total_coin || 0),
                  0,
                );
                const scRmbSum = sc.reduce(
                  (a: number, b: any) => a + (b.rmb || 0),
                  0,
                );
                const fmt = (ts: number) =>
                  ts ? new Date(ts * 1000).toLocaleTimeString('zh-CN') : '—';
                const Empty = () => (
                  <div className="p-6 text-center text-white/40">本场暂无该类型数据</div>
                );
                return (
                  <>
                    <div className="flex flex-wrap gap-4 border-b border-white/10 px-4 py-2 text-xs text-white/70">
                      <span>
                        礼物币合计 <b className="text-white">{giftCoinSum.toLocaleString()}</b>
                      </span>
                      <span>
                        SC合计(¥) <b className="text-white">{scRmbSum.toLocaleString()}</b>
                      </span>
                      <span>
                        礼物 <b className="text-white">{gift.length}</b> 次
                      </span>
                      <span>
                        弹幕 <b className="text-white">{rtDetail.danmakuTotal?.toLocaleString()}</b>
                      </span>
                      <span>
                        互动 <b className="text-white">{it.length}</b>
                        <span className="text-white/50">
                          （进 {it.filter((x: any) => x.type === 'enter').length} / 关{' '}
                          {it.filter((x: any) => x.type === 'follow').length}）
                        </span>
                      </span>
                    </div>
                    <div className="flex gap-2 border-b border-white/10 px-4 py-2 text-sm">
                      {(
                        [
                          ['dm', '弹幕'],
                          ['sc', '醒目留言'],
                          ['gift', '礼物'],
                          ['interact', '互动'],
                          ['online', '同接曲线'],
                        ] as const
                      ).map(([t, label]) => (
                        <button
                          key={t}
                          onClick={() => setRtTab(t)}
                          className={`rounded px-3 py-1 ${
                            rtTab === t
                              ? 'bg-emerald-500/30 text-emerald-200'
                              : 'text-white/60 hover:bg-white/10'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <div className="overflow-auto p-3 text-sm">
                      {rtTab === 'dm' &&
                        (dm.length === 0 ? (
                          <Empty />
                        ) : (
                          <table className="w-full">
                            <thead className="text-white/40">
                              <tr className="text-left">
                                <th className="py-1 px-2">时间</th>
                                <th className="px-2">用户</th>
                                <th className="px-2">弹幕</th>
                              </tr>
                            </thead>
                            <tbody>
                              {dm.map((d: any, i: number) => (
                                <tr key={i} className="border-b border-white/5">
                                  <td className="px-2 whitespace-nowrap text-white/40">{fmt(d.ts)}</td>
                                  <td className="px-2 whitespace-nowrap">{d.uname}</td>
                                  <td className="px-2 break-all">{d.text}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ))}
                      {rtTab === 'sc' &&
                        (sc.length === 0 ? (
                          <Empty />
                        ) : (
                          <table className="w-full">
                            <thead className="text-white/40">
                              <tr className="text-left">
                                <th className="py-1 px-2">时间</th>
                                <th className="px-2">用户</th>
                                <th className="px-2">¥</th>
                                <th className="px-2">留言</th>
                              </tr>
                            </thead>
                            <tbody>
                              {sc.map((s: any, i: number) => (
                                <tr key={i} className="border-b border-white/5">
                                  <td className="px-2 whitespace-nowrap text-white/40">{fmt(s.ts)}</td>
                                  <td className="px-2 whitespace-nowrap">{s.uname}</td>
                                  <td className="px-2 whitespace-nowrap text-amber-300">{s.rmb}</td>
                                  <td className="px-2 break-all">{s.message}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ))}
                      {rtTab === 'gift' &&
                        (gift.length === 0 ? (
                          <Empty />
                        ) : (
                          <table className="w-full">
                            <thead className="text-white/40">
                              <tr className="text-left">
                                <th className="py-1 px-2">时间</th>
                                <th className="px-2">用户</th>
                                <th className="px-2">礼物</th>
                                <th className="px-2">数量</th>
                                <th className="px-2">币</th>
                              </tr>
                            </thead>
                            <tbody>
                              {gift.map((g: any, i: number) => (
                                <tr key={i} className="border-b border-white/5">
                                  <td className="px-2 whitespace-nowrap text-white/40">{fmt(g.ts)}</td>
                                  <td className="px-2 whitespace-nowrap">{g.uname}</td>
                                  <td className="px-2 whitespace-nowrap">{g.gift_name}</td>
                                  <td className="px-2 whitespace-nowrap">{g.num}</td>
                                  <td className="px-2 whitespace-nowrap text-amber-300">
                                    {(g.total_coin || 0).toLocaleString()}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ))}
                      {rtTab === 'interact' &&
                        (it.length === 0 ? (
                          <Empty />
                        ) : (
                          <table className="w-full">
                            <thead className="text-white/40">
                              <tr className="text-left">
                                <th className="py-1 px-2">时间</th>
                                <th className="px-2">用户</th>
                                <th className="px-2">类型</th>
                              </tr>
                            </thead>
                            <tbody>
                              {it.map((x: any, i: number) => (
                                <tr key={i} className="border-b border-white/5">
                                  <td className="px-2 whitespace-nowrap text-white/40">{fmt(x.ts)}</td>
                                  <td className="px-2 whitespace-nowrap">{x.uname}</td>
                                  <td className="px-2">{x.type}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ))}
                      {rtTab === 'online' && <RtOnlineChart data={rtDetail?.online || []} />}
                    </div>
                  </>
                );
              })()
            ) : null}
          </div>
        </div>
      )}

      <div className="mb-3 flex flex-wrap gap-2">
        <button
          onClick={() => runBulk('live')}
          disabled={!!busy}
          className="rounded-lg border border-white/15 px-4 py-2 text-white hover:bg-white/10 disabled:opacity-40"
        >
          {busy === 'live' ? '同步中…' : '同步全部直播回放'}
        </button>
        <button
          onClick={() => runBulk('songs')}
          disabled={!!busy}
          className="rounded-lg border border-white/15 px-4 py-2 text-white hover:bg-white/10 disabled:opacity-40"
        >
          {busy === 'songs' ? '识别中…' : '识别全部歌单'}
        </button>
        <button
          onClick={() => runBulk('danmaku')}
          disabled={!!busy}
          className="rounded-lg border border-sky-500/40 px-4 py-2 text-sky-300 hover:bg-sky-500/20 disabled:opacity-40"
        >
          {busy === 'danmaku' ? '采集中…' : '收集全部弹幕'}
        </button>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-white/10 bg-black/30 p-3">
        <span className="text-sm text-white/70">标题自动归类</span>
        <button
          onClick={previewCategories}
          className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-white/70 hover:bg-white/10"
        >
          预览归类结果
        </button>
        <button
          onClick={() => applyCategories(false)}
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-500"
        >
          应用（仅补空缺）
        </button>
        <button
          onClick={() => applyCategories(true)}
          className="rounded-lg border border-amber-500/40 px-3 py-1.5 text-sm text-amber-300 hover:bg-amber-500/20"
        >
          覆盖全部重写
        </button>
        {catMsg && <span className="text-xs text-white/60">{catMsg}</span>}
      </div>
      <Sec title={`直播回放列表（共 ${list.length} 场）`}>
        <div className="max-h-[40vh] overflow-auto rounded-lg border border-white/10">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-neutral-900 text-white/50">
              <tr className="text-left">
                <th className="py-2 px-2">标题</th>
                <th className="px-2">自动分类</th>
                <th className="px-2">人工分类</th>
                <th className="px-2">时长(分)</th>
                <th className="px-2">歌数</th>
                <th className="px-2">已识别</th>
                <th className="px-2">弹幕</th>
                <th className="px-2 text-right whitespace-nowrap" title="实时监控采集：本场人气峰值">人气峰值</th>
                <th className="px-2 text-right whitespace-nowrap" title="实时监控采集：醒目留言(SC)数">SC</th>
                <th className="px-2 text-right whitespace-nowrap" title="实时监控采集：礼物事件数">礼物</th>
                <th className="px-2 text-right whitespace-nowrap" title="实时监控采集：礼物币(流水)">流水</th>
                <th className="px-2 text-right whitespace-nowrap" title="实时监控采集：互动(进入/关注等)">互动</th>
                <th className="px-2 whitespace-nowrap" title="歌单已人工核对，自动识曲/同步不再改写">核对</th>
                <th className="px-2"></th>
              </tr>
            </thead>
            <tbody>
              {paged.map((l) => (
                <tr key={l.bvid} className="border-b border-white/5">
                  <td className="px-2 max-w-[36vw] truncate" title={l.bvid}>
                    <a
                      href={`https://www.bilibili.com/video/${l.bvid}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sky-300 hover:underline"
                      title={`在 Bilibili 打开：${l.bvid}`}
                    >
                      {l.title}
                    </a>
                  </td>
                  <td className="px-2 text-white/60">
                    {CAT_LABEL[l.category] ?? l.category ?? '—'}
                  </td>
                  <td className="px-2 text-emerald-300">
                    {l.categoryManual ? CAT_LABEL[l.categoryManual] ?? l.categoryManual : '—'}
                  </td>
                  <td className="px-2">{(l.durationSec / 60).toFixed(0)}</td>
                  <td className="px-2">{l.songCount}</td>
                  <td className="px-2">{l.checked ? '✅' : '⛔'}</td>
                  <td className="px-2">
                    {/* 弹幕以实时采集数为准（与顶部同步记录一致）；未匹配到监控场次时回退到已收集/B站数 */}
                    {l.rtDanmaku != null ? (
                      <span className="text-emerald-300">
                        {nf(l.rtDanmaku)}
                        {l.dmCollected > 0 ? (
                          <span className="text-white/40"> · 存档 {l.dmCollected}</span>
                        ) : null}
                      </span>
                    ) : l.dmCollected > 0 ? (
                      <span className="text-emerald-300">
                        已收集 {l.dmCollected}
                        {l.danmaku ? <span className="text-white/40"> / {l.danmaku}</span> : null}
                      </span>
                    ) : (
                      <span className="text-red-400">未收集</span>
                    )}
                  </td>
                  <td className="px-2 text-right tabular-nums">{nf(l.rtOnlinePeak)}</td>
                  <td className="px-2 text-right tabular-nums">{nf(l.rtSc)}</td>
                  <td className="px-2 text-right tabular-nums">{nf(l.rtGift)}</td>
                  <td className="px-2 text-right tabular-nums">{nf(l.rtGiftCoin)}</td>
                  <td className="px-2 text-right tabular-nums">{nf(l.rtInteract)}</td>
                  <td className="px-2 whitespace-nowrap">
                    {l.songsOverride ? (
                      <span className="text-emerald-300" title="歌单已人工核对，自动流程不再改写">✅ 已核对</span>
                    ) : (
                      <button
                        onClick={async () => {
                          const r = await api(`/api/admin/lives/${l.bvid}/songs-override`, {
                            method: 'POST',
                            body: JSON.stringify({}),
                          });
                          if (r.ok) {
                            setList((ls: any[]) => ls.map((x) => (x.bvid === l.bvid ? { ...x, songsOverride: true } : x)));
                          } else {
                            alert('标记失败，请重试');
                          }
                        }}
                        className="text-amber-300 hover:underline"
                        title="标记这场歌单已人工核对，自动识曲/同步将不再改写"
                      >
                        标记核对
                      </button>
                    )}
                  </td>
                  <td className="px-2">
                    <button onClick={() => openDetail(l.bvid)} className="text-sky-300 hover:underline">
                      管理
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="text-white/50">
            共 {list.length} 场 · 第 {safePage + 1} / {totalPages} 页
          </span>
          <div className="flex flex-wrap items-center gap-1">
            <button
              onClick={() => setPage(0)}
              disabled={safePage === 0}
              className="rounded-lg border border-white/15 px-3 py-1.5 text-white/80 hover:bg-white/10 disabled:opacity-30"
            >
              首页
            </button>
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={safePage === 0}
              className="rounded-lg border border-white/15 px-3 py-1.5 text-white/80 hover:bg-white/10 disabled:opacity-30"
            >
              上一页
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={safePage >= totalPages - 1}
              className="rounded-lg border border-white/15 px-3 py-1.5 text-white/80 hover:bg-white/10 disabled:opacity-30"
            >
              下一页
            </button>
            <button
              onClick={() => setPage(totalPages - 1)}
              disabled={safePage >= totalPages - 1}
              className="rounded-lg border border-white/15 px-3 py-1.5 text-white/80 hover:bg-white/10 disabled:opacity-30"
            >
              末页
            </button>
            <span className="ml-2 flex items-center gap-1 text-white/60">
              跳至
              <input
                type="number"
                min={1}
                max={totalPages}
                defaultValue={safePage + 1}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const v = Math.min(totalPages, Math.max(1, Number((e.target as HTMLInputElement).value)));
                    setPage(v - 1);
                  }
                }}
                onBlur={(e) => {
                  const v = Math.min(totalPages, Math.max(1, Number(e.target.value)));
                  setPage(v - 1);
                }}
                className="w-14 rounded-lg border border-white/15 bg-black/40 px-2 py-1 text-center text-white"
              />
              页
            </span>
          </div>
        </div>
        <p className="mt-2 text-xs text-white/40">
          弹幕：来自回放视频弹幕（点「收集全部弹幕」补全）。人气峰值 / SC / 礼物 / 流水 / 互动：来自
          <code className="text-white/50"> live-monitor </code>
          实时监控，按开播时间自动对齐到对应场次；未被监控的历史回放显示 —。
        </p>
      </Sec>

      {open && (
        <Sec title={`管理：${open.title}`}>
          <div className="rounded-lg border border-white/10 bg-black/30 p-4">
            <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
              <label className="text-sm text-white/70">
                人工分类
                <select
                  value={edit.categoryManual}
                  onChange={(e) => setEdit({ ...edit, categoryManual: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-white/15 bg-black/40 px-2 py-1 text-white"
                >
                  <option value="">（自动）</option>
                  <option value="official">官方活动回</option>
                  <option value="sing">歌回</option>
                  <option value="special">特殊回</option>
                  <option value="collab">联动回</option>
                  <option value="marshmallow">棉花糖回</option>
                  <option value="game">游戏回</option>
                  <option value="talk">杂谈回</option>
                  <option value="other">其他（自动归类）</option>
                </select>
              </label>
              <label className="text-sm text-white/70">
                唱歌时长(分)
                <input
                  value={edit.singDuration}
                  onChange={(e) => setEdit({ ...edit, singDuration: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-white/15 bg-black/40 px-2 py-1 text-white"
                />
              </label>
              <label className="text-sm text-white/70">
                游戏时长(分)
                <input
                  value={edit.gameDuration}
                  onChange={(e) => setEdit({ ...edit, gameDuration: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-white/15 bg-black/40 px-2 py-1 text-white"
                />
              </label>
              <label className="text-sm text-white/70">
                歌单策略
                <select
                  value={edit.songStrategy}
                  onChange={(e) => setEdit({ ...edit, songStrategy: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-white/15 bg-black/40 px-2 py-1 text-white"
                >
                  <option value="auto">仅自动识别</option>
                  <option value="merge">自动+手动合并去重（推荐）</option>
                  <option value="manual">仅手动</option>
                </select>
              </label>
            </div>
            <div className="mb-3 text-sm">
              弹幕：
              {open.rtDanmaku != null ? (
                <span className="text-emerald-300">实时采集 {nf(open.rtDanmaku)} 条</span>
              ) : open.dmCollected > 0 ? (
                <span className="text-emerald-300">已收集 {open.dmCollected} 条</span>
              ) : (
                <span className="text-red-400">未收集</span>
              )}
              {open.danmaku ? <span className="text-white/40">（B站共 {open.danmaku} 条）</span> : null}
              {open.rtDanmaku != null && open.dmCollected > 0 ? (
                <span className="text-white/40"> · 存档 {open.dmCollected} 条</span>
              ) : null}
              {open.dmCollected > 0 && open.danmaku && open.dmCollected < open.danmaku ? (
                <span className="text-amber-300"> · 可能不完整，可重新收集</span>
              ) : null}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-white/70">
              <span>实时监控指标：</span>
              <span>人气峰值 <b className="text-white/90">{nf(open.rtOnlinePeak)}</b></span>
              <span>SC <b className="text-white/90">{nf(open.rtSc)}</b></span>
              <span>礼物 <b className="text-white/90">{nf(open.rtGift)}</b></span>
              <span>流水 <b className="text-white/90">{nf(open.rtGiftCoin)}</b></span>
              <span>互动 <b className="text-white/90">{nf(open.rtInteract)}</b></span>
              {open.rtOnlinePeak == null && (
                <span className="text-white/40">（本场未被 live-monitor 监控，无可对齐数据）</span>
              )}
            </div>
            <label className="block text-sm text-white/70">
              备注
              <textarea
                value={edit.note}
                onChange={(e) => setEdit({ ...edit, note: e.target.value })}
                className="mt-1 w-full rounded-lg border border-white/15 bg-black/40 px-2 py-1 text-white"
                rows={2}
              />
            </label>
            <div className="mt-3 flex gap-2">
              <button onClick={saveMeta} className="rounded-lg bg-emerald-600 px-4 py-2 text-white hover:bg-emerald-500">
                保存
              </button>
              <button onClick={scan} className="rounded-lg border border-white/15 px-4 py-2 text-white hover:bg-white/10">
                重新识别歌单（提供 BV）
              </button>
              <button onClick={collectDanmaku} className="rounded-lg border border-sky-500/40 px-4 py-2 text-sky-300 hover:bg-sky-500/20">
                收集弹幕
              </button>
            </div>

            <div className="mt-4">
              <h3 className="mb-2 text-sm font-semibold text-emerald-300">歌单（自动识别 + 手动）</h3>
              <div className="mb-2 flex gap-2">
                <input
                  placeholder="手动添加一首歌"
                  value={newSong}
                  onChange={(e) => setNewSong(e.target.value)}
                  className="w-64 rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-white"
                />
                <button onClick={addSong} className="rounded-lg bg-emerald-600 px-3 py-2 text-white hover:bg-emerald-500">
                  添加
                </button>
              </div>
              <ul className="space-y-1 text-sm">
                {songs.map((s) => (
                  <li
                    key={s.idx}
                    className={`flex items-center justify-between rounded border border-white/5 px-2 py-1 ${
                      s.excluded ? 'opacity-40 line-through' : ''
                    }`}
                  >
                    <span>
                      <span className="text-white/40">#{s.idx}</span>{' '}
                      {editIdx === s.idx ? (
                        <input
                          autoFocus
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') renameSong(s);
                            if (e.key === 'Escape') setEditIdx(null);
                          }}
                          className="w-56 rounded border border-emerald-500/40 bg-black/60 px-2 py-0.5 text-white"
                        />
                      ) : (
                        s.title
                      )}
                      <span className="ml-2 text-xs text-white/40">
                        {s.source === 'manual' ? '手动' : '自动'}
                      </span>
                    </span>
                    <span className="space-x-2">
                      {editIdx === s.idx ? (
                        <>
                          <button onClick={() => renameSong(s)} className="text-emerald-300 hover:underline">
                            保存
                          </button>
                          <button onClick={() => setEditIdx(null)} className="text-white/50 hover:underline">
                            取消
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => {
                              setEditIdx(s.idx);
                              setEditTitle(s.title || '');
                            }}
                            className="text-sky-300 hover:underline"
                          >
                            改名
                          </button>
                          <button onClick={() => toggleExclude(s)} className="text-amber-300 hover:underline">
                            {s.excluded ? '恢复' : '去垃圾'}
                          </button>
                          {s.source === 'manual' && (
                            <button onClick={() => delSong(s)} className="text-red-300 hover:underline">
                              删除
                            </button>
                          )}
                        </>
                      )}
                    </span>
                  </li>
                ))}
                {songs.length === 0 && <li className="text-white/40">暂无歌单，点“重新识别歌单”并提供 BV。</li>}
              </ul>
            </div>

            <div className="mt-4">
              <h3 className="mb-2 text-sm font-semibold text-emerald-300">
                生效歌单（按策略合并去重后的实际展示）
              </h3>
              {effective.length ? (
                <ul className="space-y-1 text-sm">
                  {effective.map((s, i) => (
                    <li key={i} className="rounded border border-white/5 px-2 py-1">
                      <span className="text-white/40">#{i + 1}</span> {s.title}
                      <span className="ml-2 text-xs text-white/40">
                        {s.source === 'manual' ? '手动' : '自动'}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-white/40">暂无生效歌单。</p>
              )}
            </div>

            <div className="mt-4">
              <h3 className="mb-1 text-sm font-semibold text-sky-300">
                弹幕预览（已收集 {open.dmCollected} 条 / B站共 {open.danmaku || 0} 条，展示 {dmTotal} 条）
              </h3>
              <p className="mb-2 text-xs text-white/40">
                注：B站弹幕接口只返回发送者的匿名哈希；系统会用实时监控数据自动回填真实昵称（任务：弹幕身份回填），未匹配到的仍显示哈希。同一哈希即同一匿名用户。
              </p>
              <div className="mb-2 flex gap-2">
                <input
                  placeholder="搜索弹幕内容"
                  value={dmQuery}
                  onChange={(e) => setDmQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && searchDanmaku()}
                  className="w-64 rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-white"
                />
                <button onClick={searchDanmaku} className="rounded-lg border border-white/15 px-3 py-2 text-white hover:bg-white/10">
                  搜索
                </button>
                {dmTotal > 200 && (
                  <span className="self-center text-xs text-white/40">
                    第 {dmPage + 1} 页
                    <button onClick={() => { setDmPage(Math.max(0, dmPage - 1)); loadDanmaku(open.bvid, dmQuery, dmPage - 1); }} className="ml-2 text-sky-300 hover:underline">上一页</button>
                    <button onClick={() => { setDmPage(dmPage + 1); loadDanmaku(open.bvid, dmQuery, dmPage + 1); }} className="ml-1 text-sky-300 hover:underline">下一页</button>
                  </span>
                )}
              </div>
              <div className="max-h-[36vh] overflow-auto rounded-lg border border-white/10">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-black/70 text-white/50">
                    <tr>
                      <th className="w-20 px-2 text-left font-normal">时间</th>
                      <th className="px-2 text-left font-normal">弹幕内容</th>
                      <th className="w-28 px-2 text-right font-normal">发送者(匿名)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dm.map((d) => (
                      <tr key={d.dmid} className="border-b border-white/5">
                        <td className="w-20 px-2 text-white/40">{fmtTime(d.vtime)}</td>
                        <td className="px-2 text-white/80">{d.text}</td>
                        <td className="w-40 px-2 text-right text-xs">
                          {d.senderName ? (
                            <span className="text-white/80">
                              {d.senderName}
                              {d.senderUid != null && (
                                <span className="ml-1 text-white/40">({d.senderUid})</span>
                              )}
                            </span>
                          ) : (
                            <span className="font-mono text-white/50">{d.sender || '—'}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {dm.length === 0 && (
                      <tr><td colSpan={3} className="px-2 py-3 text-white/40">暂无弹幕，点上方“收集弹幕”或“收集全部弹幕”。</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              <h4 className="mb-2 mt-4 text-sm font-semibold text-sky-300">本场发送人排行（按条数）</h4>
              <div className="grid max-h-[24vh] grid-cols-2 gap-x-6 gap-y-1 overflow-auto pr-2 sm:grid-cols-3">
                {dmSenders.slice(0, 60).map((s, i) => (
                  <div key={s.sender} className="flex items-center justify-between text-xs">
                    <span className="text-white/40">{i + 1}.</span>
                    {s.senderName ? (
                      <span className="mx-1 flex-1 truncate text-white/80">
                        {s.senderName}
                        {s.senderUid != null && <span className="text-white/40"> ({s.senderUid})</span>}
                      </span>
                    ) : (
                      <span className="mx-1 flex-1 truncate font-mono text-white/50">{s.sender}</span>
                    )}
                    <span className="text-sky-300">{s.count}</span>
                  </div>
                ))}
                {dmSenders.length === 0 && (
                  <span className="col-span-3 text-white/40">暂无发送人统计。</span>
                )}
              </div>
            </div>
          </div>
        </Sec>
      )}
    </div>
  );
}

// ---------------- 立绘上传 ----------------
function RtOnlineChart({ data }: { data: { ts: number; online: number }[] }) {
  if (!data || data.length === 0)
    return <p className="text-white/40">本场暂无同接采样（旧数据或未开启监控）。</p>;
  const W = 640, H = 200, pad = 32;
  const tMin = Math.min(...data.map((d) => d.ts));
  const tMax = Math.max(...data.map((d) => d.ts));
  const oMin = Math.min(...data.map((d) => d.online));
  const oMax = Math.max(...data.map((d) => d.online));
  const span = Math.max(1, tMax - tMin);
  const oSpan = Math.max(1, oMax - oMin);
  const X = (t: number) => pad + ((t - tMin) / span) * (W - 2 * pad);
  const Y = (o: number) => H - pad - ((o - oMin) / oSpan) * (H - 2 * pad);
  const pts = data.map((d) => `${X(d.ts).toFixed(1)},${Y(d.online).toFixed(1)}`).join(' ');
  const fmtT = (t: number) =>
    new Date(t * 1000).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  return (
    <div>
      <div className="mb-1 text-xs text-white/50">
        峰值 {oMax.toLocaleString()} · 最低 {oMin.toLocaleString()} · 采样 {data.length} 点（每 30s）
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-3xl rounded-lg border border-white/10 bg-black/30">
        <line x1={pad} y1={H - pad} x2={W - pad} y2={H - pad} stroke="#ffffff22" />
        <line x1={pad} y1={pad} x2={pad} y2={H - pad} stroke="#ffffff22" />
        <polyline points={pts} fill="none" stroke="#34d399" strokeWidth={1.5} />
        <text x={pad} y={H - pad + 16} fill="#ffffff66" fontSize={10}>{fmtT(tMin)}</text>
        <text x={W - pad} y={H - pad + 16} fill="#ffffff66" fontSize={10} textAnchor="end">{fmtT(tMax)}</text>
        <text x={pad - 4} y={H - pad} fill="#ffffff66" fontSize={10} textAnchor="end">{oMin.toLocaleString()}</text>
        <text x={pad - 4} y={pad + 4} fill="#ffffff66" fontSize={10} textAnchor="end">{oMax.toLocaleString()}</text>
      </svg>
    </div>
  );
}

// ---------------- 首页语录 ----------------
// ---------- 首页文案 ----------
function HeroTab() {
  const [name, setName] = useState('');
  const [badges, setBadges] = useState('');
  const [defaultQuote, setDefaultQuote] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api('/api/admin/hero')
      .then((r) => {
        if (r.ok && r.config) {
          setName(r.config.name ?? '');
          setBadges((r.config.badges ?? []).join(' | '));
          setDefaultQuote(r.config.defaultQuote ?? '');
          setLoaded(true);
        }
      })
      .catch(() => {});
  }, []);

  async function save() {
    const r = await api('/api/admin/hero', {
      method: 'PUT',
      body: JSON.stringify({ name, badges, defaultQuote }),
    });
    if (r.ok) {
      toast('首页文案已保存，刷新前台即可生效', 'ok');
    } else {
      toast(r.error || '保存失败', 'err');
    }
  }

  return (
    <div>
      <Sec title="编辑首页文案" desc="对应首页 hero 区展示，留空则保持原值">
        {loaded ? (
          <div className="flex max-w-3xl flex-col gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm text-white/60">名字</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-white"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm text-white/60">粉丝牌 / 标签（用竖线 | 分隔多个）</span>
              <input
                value={badges}
                onChange={(e) => setBadges(e.target.value)}
                placeholder="🎋 粉丝牌 · Kimo熊 | P-SP | #大熊猫豆漫#"
                className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-white"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm text-white/60">默认人设句（语录库为空时显示）</span>
              <input
                value={defaultQuote}
                onChange={(e) => setDefaultQuote(e.target.value)}
                className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-white"
              />
            </label>
            <div>
              <button
                onClick={save}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-white transition hover:bg-emerald-500"
              >
                保存
              </button>
            </div>
          </div>
        ) : (
          <div className="text-sm text-white/40">加载中…</div>
        )}
      </Sec>
      <Sec title="说明">
        <p className="max-w-3xl text-sm leading-relaxed text-white/50">
          这里只管理首页首屏（头像下方）的名字、粉丝牌标签行和默认一句话人设。
          语录库内容请到「首页语录」管理；粉丝数与开播状态来自 B站接口，自动更新。
        </p>
      </Sec>
    </div>
  );
}

function QuotesTab() {
  const [list, setList] = useState<any[]>([]);
  const [text, setText] = useState('');
  const [msg, setMsg] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const [qs, setQs] = useState('');

  const refresh = useCallback(async () => {
    const r = await api('/api/admin/quotes');
    setList(r.list || []);
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  async function add() {
    const t = text.trim();
    if (!t) return;
    const r = await api('/api/admin/quotes', { method: 'POST', body: JSON.stringify({ text: t }) });
    if (r.ok) {
      setText('');
      setMsg('');
      refresh();
    } else {
      setMsg(r.error || '新增失败');
    }
  }
  async function saveEdit(id: number) {
    const t = editText.trim();
    if (!t) return;
    const r = await api('/api/admin/quotes', { method: 'PUT', body: JSON.stringify({ id, text: t }) });
    if (r.ok) {
      setEditing(null);
      setMsg('');
      refresh();
    } else {
      setMsg(r.error || '保存失败');
    }
  }
  async function toggle(id: number, enabled: boolean) {
    await api('/api/admin/quotes', { method: 'PUT', body: JSON.stringify({ id, enabled }) });
    refresh();
  }
  async function del(id: number) {
    if (!(await ask('确定删除这条语录？'))) return;
    await api(`/api/admin/quotes/${id}`, { method: 'DELETE' });
    refresh();
  }

  const shown = quickFilter(list, qs);

  return (
    <div>
      <Sec title="新增语录">
        <div className="flex flex-wrap items-center gap-3">
          <input
            placeholder="一句话内容（无需带「」）"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            className="w-96 rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-white"
          />
          <button onClick={add} className="rounded-lg bg-emerald-600 px-4 py-2 text-white hover:bg-emerald-500">
            添加
          </button>
          {msg && <span className="text-xs text-red-300">{msg}</span>}
        </div>
        <p className="mt-2 text-xs text-white/40">
          首页 hero 区每次刷新随机展示一条“启用中”的语录；库为空时显示默认句。
        </p>
      </Sec>
      <Sec
        title={`语录列表（${shown.length}${shown.length !== list.length ? ` / ${list.length}` : ''}）`}
        right={<SearchBox value={qs} onChange={setQs} placeholder="搜索语录" />}
      >
        <div className="flex flex-col gap-2">
          {shown.map((q) => (
            <div key={q.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-white/10 p-3">
              {editing === q.id ? (
                <>
                  <input
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && saveEdit(q.id)}
                    className="flex-1 min-w-64 rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-white"
                    autoFocus
                  />
                  <button onClick={() => saveEdit(q.id)} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs text-white hover:bg-emerald-500">
                    保存
                  </button>
                  <button onClick={() => setEditing(null)} className="rounded-lg border border-white/20 px-3 py-1.5 text-xs text-white/70 hover:bg-white/10">
                    取消
                  </button>
                </>
              ) : (
                <>
                  <span className={`flex-1 min-w-64 break-words text-sm ${q.enabled ? 'text-white/90' : 'text-white/35 line-through'}`}>
                    「{q.text}」
                  </span>
                  <button
                    onClick={() => toggle(q.id, !q.enabled)}
                    className={`rounded-full px-3 py-1 text-xs ${
                      q.enabled ? 'bg-emerald-900/60 text-emerald-200' : 'bg-white/10 text-white/50'
                    }`}
                  >
                    {q.enabled ? '启用中' : '已停用'}
                  </button>
                  <button
                    onClick={() => {
                      setEditing(q.id);
                      setEditText(q.text);
                    }}
                    className="text-xs text-sky-300 hover:underline"
                  >
                    编辑
                  </button>
                  <button onClick={() => del(q.id)} className="text-xs text-red-300 hover:underline">
                    删除
                  </button>
                </>
              )}
            </div>
          ))}
          {list.length === 0 && <p className="text-white/40">还没有语录，添加后首页将随机展示。</p>}
        </div>
      </Sec>
    </div>
  );
}

// ---------------- 豆沙作品 ----------------
function WorksTab() {
  const [list, setList] = useState<any[]>([]);
  const [form, setForm] = useState({ url: '', title: '', description: '' });
  const [msg, setMsg] = useState('');
  const [editing, setEditing] = useState<any | null>(null);
  const [qs, setQs] = useState('');

  const refresh = useCallback(async () => {
    const r = await api('/api/admin/works');
    setList(r.list || []);
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  async function add() {
    if (!form.url.trim()) {
      setMsg('链接不能为空');
      return;
    }
    setMsg('保存中…（BV 号会自动抓取标题/封面）');
    const r = await api('/api/admin/works', { method: 'POST', body: JSON.stringify(form) });
    if (r.ok) {
      setForm({ url: '', title: '', description: '' });
      setMsg('');
      refresh();
    } else {
      setMsg(r.error || '新增失败');
    }
  }
  async function saveEdit() {
    if (!editing) return;
    const r = await api('/api/admin/works', {
      method: 'PUT',
      body: JSON.stringify({
        id: editing.id,
        title: editing.title,
        url: editing.url,
        description: editing.description,
        cover: editing.cover,
      }),
    });
    if (r.ok) {
      setEditing(null);
      setMsg('');
      refresh();
    } else {
      setMsg(r.error || '保存失败');
    }
  }
  async function del(id: number) {
    if (!(await ask('确定删除这个作品？'))) return;
    await api(`/api/admin/works/${id}`, { method: 'DELETE' });
    refresh();
  }
  async function refetch(id: number) {
    setMsg('重新抓取中…');
    const r = await api('/api/admin/works', {
      method: 'PUT',
      body: JSON.stringify({ id, refetch: true }),
    });
    setMsg(r.ok ? '' : r.error || '抓取失败');
    refresh();
  }

  const shown = quickFilter(list, qs);

  return (
    <div>
      <Sec title="新增作品">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <input
              placeholder="B站链接或 BV 号（如 BV1Z2bpznEag），自动补全信息"
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
              className="w-96 rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-white"
            />
            <input
              placeholder="标题（留空自动抓取）"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="w-64 rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-white"
            />
            <button onClick={add} className="rounded-lg bg-emerald-600 px-4 py-2 text-white hover:bg-emerald-500">
              添加
            </button>
          </div>
          <input
            placeholder="简介（可选，留空自动抓取）"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-white"
          />
          {msg && <span className="text-xs text-amber-300">{msg}</span>}
        </div>
        <p className="mt-2 text-xs text-white/40">作品展示在「熊猫活动轨迹」页的「豆沙作品」栏。</p>
      </Sec>
      <Sec
        title={`作品列表（${shown.length}${shown.length !== list.length ? ` / ${list.length}` : ''}）`}
        right={<SearchBox value={qs} onChange={setQs} placeholder="搜索作品" />}
      >
        <div className="flex flex-col gap-2">
          {shown.map((w) => (
            <div key={w.id} className="rounded-lg border border-white/10 p-3">
              {editing?.id === w.id ? (
                <div className="flex flex-col gap-2">
                  <input
                    value={editing.title}
                    onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                    placeholder="标题"
                    className="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-white"
                  />
                  <input
                    value={editing.url}
                    onChange={(e) => setEditing({ ...editing, url: e.target.value })}
                    placeholder="链接"
                    className="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-white"
                  />
                  <input
                    value={editing.cover || ''}
                    onChange={(e) => setEditing({ ...editing, cover: e.target.value })}
                    placeholder="封面图 URL（可留空）"
                    className="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-white"
                  />
                  <textarea
                    value={editing.description || ''}
                    onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                    placeholder="简介"
                    rows={2}
                    className="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-white"
                  />
                  <div className="flex gap-3">
                    <button onClick={saveEdit} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs text-white hover:bg-emerald-500">
                      保存
                    </button>
                    <button onClick={() => setEditing(null)} className="rounded-lg border border-white/20 px-3 py-1.5 text-xs text-white/70 hover:bg-white/10">
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  {w.cover && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={w.cover} alt="" className="h-12 w-20 rounded object-cover" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-white/90">{w.title}</div>
                    <a href={w.url} target="_blank" rel="noreferrer" className="truncate text-xs text-white/40 hover:text-brand-200">
                      {w.url}
                    </a>
                  </div>
                  <button
                    onClick={() => refetch(w.id)}
                    className="text-xs text-amber-300 hover:underline"
                    title="重新从B站抓取标题/封面/简介"
                  >
                    重新抓取
                  </button>
                  <button
                    onClick={() => setEditing({ ...w })}
                    className="text-xs text-sky-300 hover:underline"
                  >
                    编辑
                  </button>
                  <button onClick={() => del(w.id)} className="text-xs text-red-300 hover:underline">
                    删除
                  </button>
                </div>
              )}
            </div>
          ))}
          {list.length === 0 && <p className="text-white/40">还没有作品，粘贴 BV 号添加。</p>}
        </div>
      </Sec>
    </div>
  );
}

// ---------------- 小人台词 ----------------
const emptyMascot = {
  text: '',
  weight: 1,
  timeStart: '',
  timeEnd: '',
  dates: '',
  onlyLive: false,
};

function MascotTab() {
  const [list, setList] = useState<any[]>([]);
  const [form, setForm] = useState({ ...emptyMascot });
  const [editing, setEditing] = useState<any | null>(null);
  const [msg, setMsg] = useState('');
  const [model, setModel] = useState({ url: '', scale: 1 });
  const [qs, setQs] = useState('');
  const shown = quickFilter(list, qs);

  const refresh = useCallback(async () => {
    const r = await api('/api/admin/mascot');
    setList(r.list || []);
  }, []);
  useEffect(() => {
    refresh();
    api('/api/admin/mascot-config').then((r) =>
      setModel({ url: r.url || '', scale: r.scale || 1 }),
    );
  }, [refresh]);

  async function saveModel() {
    const r = await api('/api/admin/mascot-config', {
      method: 'POST',
      body: JSON.stringify(model),
    });
    setMsg(r.ok ? '模型配置已保存，刷新前台页面生效' : '保存失败');
  }

  async function add() {
    if (!form.text.trim()) {
      setMsg('台词不能为空');
      return;
    }
    const r = await api('/api/admin/mascot', { method: 'POST', body: JSON.stringify(form) });
    if (r.ok) {
      setForm({ ...emptyMascot });
      setMsg('');
      refresh();
    } else {
      setMsg(r.error || '新增失败');
    }
  }
  async function saveEdit() {
    if (!editing) return;
    const r = await api('/api/admin/mascot', { method: 'PUT', body: JSON.stringify(editing) });
    if (r.ok) {
      setEditing(null);
      setMsg('');
      refresh();
    } else {
      setMsg(r.error || '保存失败');
    }
  }
  async function toggle(id: number, enabled: boolean) {
    await api('/api/admin/mascot', { method: 'PUT', body: JSON.stringify({ id, enabled }) });
    refresh();
  }
  async function del(id: number) {
    if (!(await ask('确定删除这条台词？'))) return;
    await api(`/api/admin/mascot/${id}`, { method: 'DELETE' });
    refresh();
  }
  const condText = (l: any) => {
    const parts: string[] = [];
    if (l.time_start || l.time_end)
      parts.push(`${l.time_start || '00:00'}~${l.time_end || '24:00'}`);
    if (l.dates) parts.push(`日期 ${l.dates}`);
    if (l.only_live) parts.push('仅直播中');
    parts.push(`权重 ${l.weight}`);
    return parts.join(' · ');
  };

  const timeInputs = (obj: any, set: (v: any) => void) => (
    <>
      <input
        placeholder="开始 HH:MM"
        value={obj.timeStart}
        onChange={(e) => set({ ...obj, timeStart: e.target.value })}
        className="w-28 rounded-lg border border-white/15 bg-black/40 px-2 py-1.5 text-sm text-white"
      />
      <span className="text-white/40">~</span>
      <input
        placeholder="结束 HH:MM"
        value={obj.timeEnd}
        onChange={(e) => set({ ...obj, timeEnd: e.target.value })}
        className="w-28 rounded-lg border border-white/15 bg-black/40 px-2 py-1.5 text-sm text-white"
      />
    </>
  );

  return (
    <div>
      <Sec title="Live2D 模型">
        <div className="flex flex-wrap items-center gap-2">
          <input
            placeholder="模型路径或 URL，如 /live2d/dousha/model.model3.json"
            value={model.url}
            onChange={(e) => setModel({ ...model, url: e.target.value })}
            className="w-96 rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-white"
          />
          <label className="text-sm text-white/70">
            缩放
            <input
              type="number"
              step={0.1}
              min={0.2}
              max={4}
              value={model.scale}
              onChange={(e) => setModel({ ...model, scale: Number(e.target.value) })}
              className="ml-2 w-20 rounded-lg border border-white/15 bg-black/40 px-2 py-2 text-sm text-white"
            />
          </label>
          <button onClick={saveModel} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white hover:bg-emerald-500">
            保存
          </button>
        </div>
        <p className="mt-2 text-xs text-white/40">
          把模型文件夹（model3.json + .moc3 + 贴图）放到 <code>public/live2d/</code> 下，再填相对路径即可；
          留空则使用亚克力立牌图片。模型需为 Cubism 4（.model3.json / .moc3）格式。
        </p>
      </Sec>
      <Sec title="新增台词">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <input
              placeholder="台词内容（如：中午好呀，记得吃午饭！）"
              value={form.text}
              onChange={(e) => setForm({ ...form, text: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && add()}
              className="w-96 rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-white"
            />
            <input
              type="number"
              min={1}
              max={100}
              title="权重：越大越常出现"
              value={form.weight}
              onChange={(e) => setForm({ ...form, weight: Number(e.target.value) })}
              className="w-20 rounded-lg border border-white/15 bg-black/40 px-2 py-2 text-sm text-white"
            />
            {timeInputs(form, setForm)}
            <label className="flex items-center gap-1.5 text-sm text-white/70">
              <input
                type="checkbox"
                checked={form.onlyLive}
                onChange={(e) => setForm({ ...form, onlyLive: e.target.checked })}
              />
              仅直播中
            </label>
            <button onClick={add} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white hover:bg-emerald-500">
              添加
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              placeholder="特定日期 MM-DD，逗号分隔（如 05-20,10-01，留空=每天）"
              value={form.dates}
              onChange={(e) => setForm({ ...form, dates: e.target.value })}
              className="w-96 rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white"
            />
            {msg && <span className="text-xs text-red-300">{msg}</span>}
          </div>
        </div>
        <p className="mt-2 text-xs text-white/40">
          示例：「中午好呀」设 11:00~14:00 → 只在中午说；「生日快乐！」设日期 05-20；「来听歌呀」勾选仅直播中。
          时间支持跨零点（如 22:00~05:00）。
        </p>
      </Sec>
      <Sec
        title={`台词列表（${shown.length}${shown.length !== list.length ? ` / ${list.length}` : ''}）`}
        right={<SearchBox value={qs} onChange={setQs} placeholder="搜索台词" />}
      >
        <div className="flex flex-col gap-2">
          {shown.map((l) => (
            <div key={l.id} className="rounded-lg border border-white/10 p-3">
              {editing?.id === l.id ? (
                <div className="flex flex-col gap-2">
                  <input
                    value={editing.text}
                    onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                    className="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-white"
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      value={editing.weight}
                      onChange={(e) => setEditing({ ...editing, weight: Number(e.target.value) })}
                      className="w-20 rounded-lg border border-white/15 bg-black/40 px-2 py-1.5 text-sm text-white"
                    />
                    {timeInputs(editing, setEditing)}
                    <input
                      placeholder="MM-DD,MM-DD"
                      value={editing.dates || ''}
                      onChange={(e) => setEditing({ ...editing, dates: e.target.value })}
                      className="w-64 rounded-lg border border-white/15 bg-black/40 px-2 py-1.5 text-sm text-white"
                    />
                    <label className="flex items-center gap-1.5 text-sm text-white/70">
                      <input
                        type="checkbox"
                        checked={!!editing.onlyLive}
                        onChange={(e) => setEditing({ ...editing, onlyLive: e.target.checked })}
                      />
                      仅直播中
                    </label>
                    <button onClick={saveEdit} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs text-white hover:bg-emerald-500">
                      保存
                    </button>
                    <button onClick={() => setEditing(null)} className="rounded-lg border border-white/20 px-3 py-1.5 text-xs text-white/70 hover:bg-white/10">
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <span className={`min-w-0 flex-1 break-words text-sm ${l.enabled ? 'text-white/90' : 'text-white/35 line-through'}`}>
                    「{l.text}」
                  </span>
                  <span className="text-xs text-white/40">{condText(l)}</span>
                  <button
                    onClick={() => toggle(l.id, !l.enabled)}
                    className={`rounded-full px-3 py-1 text-xs ${
                      l.enabled ? 'bg-emerald-900/60 text-emerald-200' : 'bg-white/10 text-white/50'
                    }`}
                  >
                    {l.enabled ? '启用中' : '已停用'}
                  </button>
                  <button
                    onClick={() =>
                      setEditing({
                        ...l,
                        timeStart: l.time_start || '',
                        timeEnd: l.time_end || '',
                        dates: l.dates || '',
                      })
                    }
                    className="text-xs text-sky-300 hover:underline"
                  >
                    编辑
                  </button>
                  <button onClick={() => del(l.id)} className="text-xs text-red-300 hover:underline">
                    删除
                  </button>
                </div>
              )}
            </div>
          ))}
          {list.length === 0 && <p className="text-white/40">还没有台词，添加后左下角小人就会说话啦。</p>}
        </div>
      </Sec>
    </div>
  );
}

// ---------------- 素材库 ----------------
type CatTuple = [string, string];
// API 加载前的兜底；实际分类以后台「分类管理」配置为准（内置 + 自定义）
const FALLBACK_CATS: CatTuple[] = [
  ['standee_cut', '立绘（抠图）'],
  ['standee_raw', '立绘（原图）'],
  ['garb', '装扮素材'],
  ['emoji', '装扮表情包'],
  ['cursor', '鼠标指针'],
  ['ime', '输入法皮肤'],
  ['other', '其他'],
];

function AssetsTab() {
  const [list, setList] = useState<any[]>([]);
  const [cats, setCats] = useState<CatTuple[]>(FALLBACK_CATS);
  const [newCat, setNewCat] = useState('');
  const [catMsg, setCatMsg] = useState('');
  const [cat, setCat] = useState('standee_cut');
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [filter, setFilter] = useState('all');
  const [msg, setMsg] = useState('');
  const [editing, setEditing] = useState<any | null>(null);
  const [qs, setQs] = useState('');
  const catLabel = Object.fromEntries(cats) as Record<string, string>;

  const refresh = useCallback(async () => {
    const r = await api('/api/admin/assets');
    setList(r.list || []);
    const rc = await api('/api/admin/asset-categories');
    if (rc.ok && Array.isArray(rc.list)) setCats(rc.list.map((c: any) => [c.key, c.label]));
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  async function addCat() {
    const label = newCat.trim();
    if (!label) return;
    setCatMsg('');
    const r = await api('/api/admin/asset-categories', {
      method: 'POST',
      body: JSON.stringify({ label }),
    });
    if (r.ok) {
      setCats((r.list || []).map((c: any) => [c.key, c.label]));
      setNewCat('');
    } else {
      setCatMsg(r.error || '添加失败');
    }
  }
  async function delCat(key: string, label: string) {
    if (!(await ask(`确定删除分类「${label}」？`))) return;
    setCatMsg('');
    const r = await api('/api/admin/asset-categories', {
      method: 'DELETE',
      body: JSON.stringify({ key }),
    });
    if (r.ok) {
      setCats((r.list || []).map((c: any) => [c.key, c.label]));
      if (filter === key || cat === key) {
        setFilter('all');
        setCat('other');
      }
    } else {
      setCatMsg(r.error || '删除失败');
    }
  }

  async function upload() {
    if (!file) {
      setMsg('请选择文件');
      return;
    }
    setMsg('上传中…');
    const fd = new FormData();
    fd.append('file', file);
    fd.append('category', cat);
    fd.append('title', title);
    const res = await fetch('/api/admin/assets', { method: 'POST', credentials: 'include', body: fd });
    const j = await res.json().catch(() => ({}));
    if (j.ok) {
      setFile(null);
      setTitle('');
      setMsg('');
      refresh();
    } else {
      setMsg(j.error || '上传失败');
    }
  }
  async function saveEdit() {
    if (!editing) return;
    const r = await api('/api/admin/assets', {
      method: 'PUT',
      body: JSON.stringify({ id: editing.id, title: editing.title, category: editing.category }),
    });
    if (r.ok) {
      setEditing(null);
      refresh();
    } else {
      setMsg(r.error || '保存失败');
    }
  }
  async function del(a: any) {
    if (!(await ask(`确定把「${a.title || a.file}」移出素材库？`))) return;
    await api(`/api/admin/assets/${a.id}`, { method: 'DELETE' });
    refresh();
  }

  const shown = quickFilter(filter === 'all' ? list : list.filter((a) => a.category === filter), qs);

  return (
    <div>
      <Sec title="分类管理">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={newCat}
            onChange={(e) => setNewCat(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addCat()}
            placeholder="新分类名称"
            maxLength={20}
            className="w-48 rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-white"
          />
          <button
            onClick={addCat}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-white hover:bg-emerald-500"
          >
            添加分类
          </button>
          {catMsg && <span className="text-xs text-amber-300">{catMsg}</span>}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {cats.map(([k, v]) => (
            <span
              key={k}
              className="flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 py-1 pl-3 pr-1.5 text-xs text-white/80"
            >
              {v}
              {k.startsWith('c_') && (
                <button
                  onClick={() => delCat(k, v)}
                  title="删除该分类"
                  className="rounded-full px-1.5 text-red-300 transition hover:bg-red-500/20"
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
        <p className="mt-2 text-xs text-white/40">
          带 × 的是自定义分类，可删除（分类下仍有素材时需先移走）；内置 7 类不可删除。分类顺序：内置在前，自定义按添加时间排列。
        </p>
      </Sec>
      <Sec title="上传素材">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm text-white/70">
            分类
            <select
              value={cat}
              onChange={(e) => setCat(e.target.value)}
              className="mt-1 block rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-white"
            >
              {cats.map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-white/70">
            名称（可选）
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 block w-56 rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-white"
            />
          </label>
          <label className="text-sm text-white/70">
            文件
            <input
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              accept=".png,.jpg,.jpeg,.webp,.gif,.svg,.cur,.ani,.zip,.rar,.7z,.json,.ttf,.otf"
              className="mt-1 block text-white/70"
            />
          </label>
          <button onClick={upload} className="rounded-lg bg-emerald-600 px-4 py-2 text-white hover:bg-emerald-500">
            上传
          </button>
          {msg && <span className="text-xs text-amber-300">{msg}</span>}
        </div>
        <p className="mt-2 text-xs text-white/40">
          支持图片（png/jpg/webp/gif/svg）与非图片素材（鼠标指针 .cur/.ani、输入法皮肤 .zip/.json、字体 .ttf/.otf 等）。
          上传的文件保存到 /uploads/assets/。
        </p>
      </Sec>
      <Sec
        title={`素材列表（${shown.length} / ${list.length}）`}
        right={<SearchBox value={qs} onChange={setQs} placeholder="搜索素材" />}
      >
        <div className="mb-3 flex flex-wrap gap-2">
          <button
            onClick={() => setFilter('all')}
            className={`rounded-full px-3 py-1 text-xs ${
              filter === 'all' ? 'bg-brand-500 text-white' : 'border border-white/15 text-white/60 hover:bg-white/10'
            }`}
          >
            全部
          </button>
          {cats.map(([k, v]) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`rounded-full px-3 py-1 text-xs ${
                filter === k ? 'bg-brand-500 text-white' : 'border border-white/15 text-white/60 hover:bg-white/10'
              }`}
            >
              {v} {list.filter((a) => a.category === k).length}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-3 md:grid-cols-6">
          {shown.map((a) => (
            <div key={a.id} className="rounded-lg border border-white/10 p-2">
              {a.kind === 'image' ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={a.file} alt="" className="aspect-square w-full object-contain" />
              ) : (
                <div className="flex aspect-square w-full flex-col items-center justify-center gap-1 text-center">
                  <span className="text-2xl">📦</span>
                  <span className="break-all text-[10px] text-white/50">{a.file.split('/').pop()}</span>
                </div>
              )}
              {editing?.id === a.id ? (
                <div className="mt-1 flex flex-col gap-1">
                  <input
                    value={editing.title || ''}
                    onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                    placeholder="名称"
                    className="w-full rounded border border-white/15 bg-black/40 px-1.5 py-1 text-xs text-white"
                  />
                  <select
                    value={editing.category}
                    onChange={(e) => setEditing({ ...editing, category: e.target.value })}
                    className="w-full rounded border border-white/15 bg-black/40 px-1 py-1 text-xs text-white"
                  >
                    {cats.map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                  <div className="flex gap-1">
                    <button onClick={saveEdit} className="flex-1 rounded bg-emerald-600 px-1 py-1 text-[10px] text-white">
                      保存
                    </button>
                    <button onClick={() => setEditing(null)} className="flex-1 rounded border border-white/20 px-1 py-1 text-[10px] text-white/70">
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="mt-1 truncate text-xs text-white/70">{a.title || a.file.split('/').pop()}</p>
                  <p className="text-[10px] text-white/30">{catLabel[a.category] ?? a.category}</p>
                  <div className="mt-1 flex gap-2">
                    <button
                      onClick={() => setEditing({ ...a })}
                      className="text-xs text-sky-300 hover:underline"
                    >
                      编辑
                    </button>
                    <button onClick={() => del(a)} className="text-xs text-red-300 hover:underline">
                      删除
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
          {shown.length === 0 && <p className="text-white/40">暂无素材。</p>}
        </div>
      </Sec>
    </div>
  );
}

// ---------------- 商店 ----------------
function ShopTab() {
  const [list, setList] = useState<any[]>([]);
  const [form, setForm] = useState({
    title: '',
    url: '',
    tag: '',
    description: '',
    coverUrl: '',
  });
  const [cover, setCover] = useState<File | null>(null);
  const [editing, setEditing] = useState<any | null>(null);
  const [editCover, setEditCover] = useState<File | null>(null);
  const [msg, setMsg] = useState('');
  const [qs, setQs] = useState('');
  const shown = quickFilter(list, qs);

  const refresh = useCallback(async () => {
    const r = await api('/api/admin/shop');
    setList(r.list || []);
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  async function submit(url: string, method: string, body: FormData | string) {
    const res = await fetch(url, { method, credentials: 'include', body });
    return res.json().catch(() => ({}));
  }

  async function add() {
    if (!form.title.trim() || !form.url.trim()) {
      setMsg('标题和链接必填');
      return;
    }
    setMsg('保存中…');
    const fd = new FormData();
    Object.entries(form).forEach(([k, v]) => fd.append(k, v));
    if (cover) fd.append('cover', cover);
    const r = await submit('/api/admin/shop', 'POST', fd);
    if (r.ok) {
      setForm({ title: '', url: '', tag: '', description: '', coverUrl: '' });
      setCover(null);
      setMsg('');
      refresh();
    } else {
      setMsg(r.error || '新增失败');
    }
  }

  async function saveEdit() {
    if (!editing) return;
    const fd = new FormData();
    fd.append('id', String(editing.id));
    fd.append('title', editing.title);
    fd.append('url', editing.url);
    fd.append('tag', editing.tag || '');
    fd.append('description', editing.description || '');
    fd.append('sort_order', String(editing.sort_order ?? 0));
    fd.append('enabled', String(!!editing.enabled));
    if (editCover) fd.append('cover', editCover);
    const r = await submit('/api/admin/shop', 'PUT', fd);
    if (r.ok) {
      setEditing(null);
      setEditCover(null);
      setMsg('');
      refresh();
    } else {
      setMsg(r.error || '保存失败');
    }
  }

  async function toggle(id: number, enabled: boolean) {
    const fd = new FormData();
    fd.append('id', String(id));
    fd.append('enabled', String(enabled));
    await submit('/api/admin/shop', 'PUT', fd);
    refresh();
  }

  async function del(id: number) {
    if (!(await ask('确定删除这个商品？'))) return;
    await api(`/api/admin/shop/${id}`, { method: 'DELETE' });
    refresh();
  }

  return (
    <div>
      <Sec title="新增商品">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <input
              placeholder="商品标题"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="w-64 rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-white"
            />
            <input
              placeholder="链接（支持B站 / 淘宝 / 天猫等，http(s):// 开头）"
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
              className="w-96 rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-white"
            />
            <input
              placeholder="小标签（装扮/周边/谷子…）"
              value={form.tag}
              onChange={(e) => setForm({ ...form, tag: e.target.value })}
              className="w-44 rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-white"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              placeholder="商品简介"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-96 rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-white"
            />
            <input
              placeholder="封面图 URL（可选）"
              value={form.coverUrl}
              onChange={(e) => setForm({ ...form, coverUrl: e.target.value })}
              className="w-64 rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-white"
            />
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setCover(e.target.files?.[0] || null)}
              className="text-white/70"
              title="或直接上传封面图"
            />
            <button onClick={add} className="rounded-lg bg-emerald-600 px-4 py-2 text-white hover:bg-emerald-500">
              添加
            </button>
          </div>
          {msg && <span className="text-xs text-red-300">{msg}</span>}
        </div>
      </Sec>
      <Sec
        title={`商品列表（${shown.length}${shown.length !== list.length ? ` / ${list.length}` : ''}）`}
        right={<SearchBox value={qs} onChange={setQs} placeholder="搜索商品" />}
      >
        <div className="flex flex-col gap-2">
          {shown.map((s) => (
            <div key={s.id} className="rounded-lg border border-white/10 p-3">
              {editing?.id === s.id ? (
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={editing.title}
                      onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                      placeholder="标题"
                      className="w-56 rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-white"
                    />
                    <input
                      value={editing.url}
                      onChange={(e) => setEditing({ ...editing, url: e.target.value })}
                      placeholder="链接"
                      className="w-96 rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-white"
                    />
                    <input
                      value={editing.tag || ''}
                      onChange={(e) => setEditing({ ...editing, tag: e.target.value })}
                      placeholder="标签"
                      className="w-32 rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-white"
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={editing.description || ''}
                      onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                      placeholder="简介"
                      className="w-96 rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-white"
                    />
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => setEditCover(e.target.files?.[0] || null)}
                      className="text-white/70"
                      title="更换封面"
                    />
                    <button onClick={saveEdit} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs text-white hover:bg-emerald-500">
                      保存
                    </button>
                    <button onClick={() => setEditing(null)} className="rounded-lg border border-white/20 px-3 py-1.5 text-xs text-white/70 hover:bg-white/10">
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  {s.cover && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={s.cover} alt="" className="h-12 w-20 rounded object-cover" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {s.tag && (
                        <span className="rounded-full bg-brand-500/20 px-2 py-0.5 text-[10px] text-brand-100">
                          {s.tag}
                        </span>
                      )}
                      <span className={`truncate text-sm ${s.enabled ? 'text-white/90' : 'text-white/35 line-through'}`}>
                        {s.title}
                      </span>
                    </div>
                    <a href={s.url} target="_blank" rel="noreferrer" className="truncate text-xs text-white/40 hover:text-brand-200">
                      {s.url}
                    </a>
                  </div>
                  <button
                    onClick={() => toggle(s.id, !s.enabled)}
                    className={`rounded-full px-3 py-1 text-xs ${
                      s.enabled ? 'bg-emerald-900/60 text-emerald-200' : 'bg-white/10 text-white/50'
                    }`}
                  >
                    {s.enabled ? '上架中' : '已下架'}
                  </button>
                  <button
                    onClick={() => setEditing({ ...s })}
                    className="text-xs text-sky-300 hover:underline"
                  >
                    编辑
                  </button>
                  <button onClick={() => del(s.id)} className="text-xs text-red-300 hover:underline">
                    删除
                  </button>
                </div>
              )}
            </div>
          ))}
          {list.length === 0 && <p className="text-white/40">还没有商品。</p>}
        </div>
      </Sec>
    </div>
  );
}

// ---------------- 豆漫墙（#大熊猫豆漫# 话题动态） ----------------
function TopicTab() {
  const [list, setList] = useState<any[]>([]);
  const [msg, setMsg] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [qs, setQs] = useState('');

  const refresh = useCallback(async () => {
    const r = await api('/api/admin/topic');
    setList(r.list || []);
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  async function sync() {
    setSyncing(true);
    setMsg('同步中…');
    const r = await api('/api/admin/topic', { method: 'POST', body: JSON.stringify({ limit: 18 }) });
    setMsg(r.ok ? `已同步 ${r.count} 条（新/更新）` : r.error || '同步失败');
    setSyncing(false);
    refresh();
  }
  async function toggle(w: any) {
    await api(`/api/admin/topic/${w.id}`, {
      method: 'PUT',
      body: JSON.stringify({ enabled: !w.enabled }),
    });
    refresh();
  }
  async function del(w: any) {
    if (!(await ask(`确定删除这条「${w.text?.slice(0, 12) || w.id}」？`))) return;
    await api(`/api/admin/topic/${w.id}`, { method: 'DELETE' });
    refresh();
  }

  const shown = quickFilter(list, qs);

  return (
    <div>
      <Sec
        title="同步话题动态"
        desc="从 B站 #大熊猫豆漫# 拉取最新动态并写库（已有条目保留手动开关状态）"
        right={
          <button
            onClick={sync}
            disabled={syncing}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {syncing ? '同步中…' : '同步最新动态'}
          </button>
        }
      >
        <p className="text-sm text-white/60">
          共 {list.length} 条（含隐藏 {list.filter((w) => !w.enabled).length} 条）。首页「豆漫墙」只展示启用的条目。
        </p>
        {msg && <p className="mt-2 text-xs text-amber-300">{msg}</p>}
      </Sec>
      <Sec
        title={`动态列表（${shown.length}${shown.length !== list.length ? ` / ${list.length}` : ''}）`}
        right={<SearchBox value={qs} onChange={setQs} placeholder="搜索作者/文字" />}
      >
        <div className="flex flex-col gap-2">
          {shown.map((w) => (
            <div
              key={w.id}
              className={`flex items-center gap-3 rounded-lg border border-white/10 p-3 ${w.enabled ? '' : 'opacity-50'}`}
            >
              {w.image ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={w.image} alt="" className="h-14 w-14 flex-none rounded object-cover" />
              ) : (
                <div className="flex h-14 w-14 flex-none items-center justify-center rounded bg-white/5 text-lg">
                  {w.kind === 'video' ? '🎬' : w.kind === 'article' ? '📄' : '💬'}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-white/90">
                  {w.text || <span className="text-white/40">（无文字，仅图）</span>}
                </div>
                <div className="truncate text-xs text-white/40">
                  {w.author} · {w.pub_time} · {w.kind}
                </div>
              </div>
              <a
                href={w.url}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-sky-300 hover:underline"
              >
                原帖
              </a>
              <button onClick={() => toggle(w)} className="text-xs text-amber-300 hover:underline">
                {w.enabled ? '隐藏' : '显示'}
              </button>
              <button onClick={() => del(w)} className="text-xs text-red-300 hover:underline">
                删除
              </button>
            </div>
          ))}
          {shown.length === 0 && <p className="text-white/40">暂无动态，点上方「同步最新动态」拉取。</p>}
        </div>
      </Sec>
    </div>
  );
}

// ---------------- 通知 ----------------
function NewsTab() {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
  const [list, setList] = useState<any[]>([]);
  const [form, setForm] = useState({ date: today, tag: '', title: '', body: '' });
  const [editing, setEditing] = useState<any | null>(null);
  const [msg, setMsg] = useState('');
  const [qs, setQs] = useState('');
  const shown = quickFilter(list, qs);

  const refresh = useCallback(async () => {
    const r = await api('/api/admin/news');
    setList(r.list || []);
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  async function add() {
    const r = await api('/api/admin/news', { method: 'POST', body: JSON.stringify(form) });
    if (r.ok) {
      setForm({ date: today, tag: '', title: '', body: '' });
      setMsg('');
      refresh();
    } else {
      setMsg(r.error || '新增失败');
    }
  }
  async function saveEdit() {
    if (!editing) return;
    const r = await api('/api/admin/news', { method: 'PUT', body: JSON.stringify(editing) });
    if (r.ok) {
      setEditing(null);
      setMsg('');
      refresh();
    } else {
      setMsg(r.error || '保存失败');
    }
  }
  async function toggle(id: number, enabled: boolean) {
    await api('/api/admin/news', { method: 'PUT', body: JSON.stringify({ id, enabled }) });
    refresh();
  }
  async function del(id: number) {
    if (!(await ask('确定删除这条通知？'))) return;
    await api(`/api/admin/news/${id}`, { method: 'DELETE' });
    refresh();
  }

  const fields = (obj: any, set: (v: any) => void) => (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="date"
          value={obj.date}
          onChange={(e) => set({ ...obj, date: e.target.value })}
          className="w-40 rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white"
        />
        <input
          placeholder="标签（功能/改版/数据…可留空）"
          value={obj.tag || ''}
          onChange={(e) => set({ ...obj, tag: e.target.value })}
          className="w-56 rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white"
        />
        <input
          placeholder="标题"
          value={obj.title}
          onChange={(e) => set({ ...obj, title: e.target.value })}
          className="w-96 rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white"
        />
      </div>
      <textarea
        placeholder="正文"
        rows={2}
        value={obj.body}
        onChange={(e) => set({ ...obj, body: e.target.value })}
        className="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white"
      />
    </div>
  );

  return (
    <div>
      <Sec title="新增通知">
        {fields(form, setForm)}
        <div className="mt-2 flex items-center gap-3">
          <button onClick={add} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white hover:bg-emerald-500">
            发布
          </button>
          {msg && <span className="text-xs text-red-300">{msg}</span>}
        </div>
      </Sec>
      <Sec
        title={`通知列表（${shown.length}${shown.length !== list.length ? ` / ${list.length}` : ''}）`}
        right={<SearchBox value={qs} onChange={setQs} placeholder="搜索通知" />}
      >
        <div className="flex flex-col gap-2">
          {shown.map((n) => (
            <div key={n.id} className="rounded-lg border border-white/10 p-3">
              {editing?.id === n.id ? (
                <div className="flex flex-col gap-2">
                  {fields(editing, setEditing)}
                  <div className="flex gap-2">
                    <button onClick={saveEdit} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs text-white hover:bg-emerald-500">
                      保存
                    </button>
                    <button onClick={() => setEditing(null)} className="rounded-lg border border-white/20 px-3 py-1.5 text-xs text-white/70 hover:bg-white/10">
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <span className="w-24 shrink-0 text-xs text-white/40">{n.date}</span>
                  {n.tag && (
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/70">
                      {n.tag}
                    </span>
                  )}
                  <span className={`min-w-0 flex-1 truncate text-sm ${n.enabled ? 'text-white/90' : 'text-white/35 line-through'}`}>
                    {n.title}
                  </span>
                  <button
                    onClick={() => toggle(n.id, !n.enabled)}
                    className={`rounded-full px-3 py-1 text-xs ${
                      n.enabled ? 'bg-emerald-900/60 text-emerald-200' : 'bg-white/10 text-white/50'
                    }`}
                  >
                    {n.enabled ? '显示中' : '已隐藏'}
                  </button>
                  <button onClick={() => setEditing({ ...n })} className="text-xs text-sky-300 hover:underline">
                    编辑
                  </button>
                  <button onClick={() => del(n.id)} className="text-xs text-red-300 hover:underline">
                    删除
                  </button>
                </div>
              )}
            </div>
          ))}
          {list.length === 0 && <p className="text-white/40">还没有通知。</p>}
        </div>
      </Sec>
    </div>
  );
}

function CharsTab() {
  const [list, setList] = useState<any[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [caption, setCaption] = useState('');

  const refresh = useCallback(async () => {
    const r = await api('/api/admin/characters');
    setList(r.list || []);
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  async function upload() {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    fd.append('name', name);
    fd.append('caption', caption);
    const res = await fetch('/api/admin/characters', { method: 'POST', credentials: 'include', body: fd });
    const j = await res.json().catch(() => ({}));
    if (j.ok) {
      setFile(null);
      setName('');
      setCaption('');
      refresh();
    }
  }
  async function del(id: number) {
    await api(`/api/admin/characters/${id}`, { method: 'DELETE' });
    refresh();
  }

  return (
    <div>
      <Sec title="上传立绘">
        <div className="flex flex-wrap items-end gap-3">
          <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] || null)} className="text-white/70" />
          <input placeholder="名称" value={name} onChange={(e) => setName(e.target.value)} className="w-40 rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-white" />
          <input placeholder="备注" value={caption} onChange={(e) => setCaption(e.target.value)} className="w-48 rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-white" />
          <button onClick={upload} className="rounded-lg bg-emerald-600 px-4 py-2 text-white hover:bg-emerald-500">
            上传
          </button>
        </div>
        <p className="mt-2 text-xs text-white/40">上传的立绘会保存到 public/characters 并在衣柜/轮播展示（优先于静态资源）。</p>
      </Sec>
      <Sec title={`已上传立绘（${list.length}）`}>
        <div className="grid grid-cols-3 gap-3 md:grid-cols-6">
          {list.map((c) => (
            <div key={c.id} className="rounded-lg border border-white/10 p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={c.src} alt={c.name || ''} className="aspect-square w-full object-contain" />
              <p className="mt-1 truncate text-xs text-white/70">{c.name || c.caption || c.src}</p>
              <button onClick={() => del(c.id)} className="text-xs text-red-300 hover:underline">
                删除
              </button>
            </div>
          ))}
          {list.length === 0 && <p className="text-white/40">还没有上传的立绘。</p>}
        </div>
      </Sec>
    </div>
  );
}

// ---------------- B站凭据 ----------------
function CredsTab() {
  const [info, setInfo] = useState<any>({});
  const [cookie, setCookie] = useState('');
  const [login, setLogin] = useState({ username: '', password: '' });
  const [msg, setMsg] = useState('');
  const [qr, setQr] = useState<{ img: string; key: string } | null>(null);
  const [qrStatus, setQrStatus] = useState('');
  const qrTimer = useRef<any>(null);

  const refresh = useCallback(async () => {
    const r = await api('/api/admin/settings');
    setInfo(r);
  }, []);
  useEffect(() => {
    refresh();
    return () => qrTimer.current && clearInterval(qrTimer.current);
  }, [refresh]);

  async function saveCookie() {
    const r = await api('/api/admin/settings', { method: 'POST', body: JSON.stringify({ cookie }) });
    setMsg(r.ok ? '已保存 Cookie' : r.error);
    refresh();
  }
  async function doLogin() {
    const r = await api('/api/admin/bili-login', {
      method: 'POST',
      body: JSON.stringify(login),
    });
    if (r.ok) setMsg('登录成功，Cookie 已保存');
    else if (r.geetest) setMsg('需要验证码（极验），请改用“粘贴 Cookie”方式');
    else setMsg(r.message || r.error || '登录失败');
    refresh();
  }
  async function genQr() {
    const r = await api('/api/admin/bili-qr', { method: 'POST', body: JSON.stringify({ action: 'generate' }) });
    if (!r.ok) { setMsg(r.error || '二维码生成失败'); return; }
    setQr({ img: r.qr, key: r.qrcodeKey });
    setQrStatus('等待扫码…');
    if (qrTimer.current) clearInterval(qrTimer.current);
    qrTimer.current = setInterval(async () => {
      try {
        const p = await api('/api/admin/bili-qr', { method: 'POST', body: JSON.stringify({ action: 'poll', qrcode_key: r.qrcodeKey }) });
        if (p.status === 'scanned') setQrStatus('已扫码，请在手机端确认…');
        else if (p.status === 'expired') { setQrStatus('二维码已过期，请重新生成'); clearInterval(qrTimer.current); }
        else if (p.status === 'success') {
          clearInterval(qrTimer.current);
          setQrStatus('登录成功，Cookie 已保存');
          setQr(null);
          refresh();
        } else {
          // waiting / 异常：透出后端 message，便于排查
          setQrStatus(p.message ? `等待中：${p.message}` : '等待扫码…');
        }
      } catch (e: any) {
        setQrStatus('轮询失败：' + (e?.message ?? e));
      }
    }, 2000);
  }

  return (
    <div>
      <Sec title="当前状态">
        <p className="text-sm text-white/70">
          UID：{info.uid} ｜ Cookie：{info.hasCookie ? `已设置（${info.cookieMasked}）` : '未设置'} ｜
          SESSDATA：{info.hasSess ? '已设置' : '未设置'}
        </p>
      </Sec>
      <Sec title="粘贴 Cookie（推荐，最稳）">
        <p className="mb-2 text-xs text-white/40">
          从浏览器开发者工具复制 B站 的 Cookie 整段字符串，粘到下面保存。用于需要登录的接口（动态/评论/直播回放）。
        </p>
        <textarea
          value={cookie}
          onChange={(e) => setCookie(e.target.value)}
          rows={3}
          placeholder="SESSDATA=...; bili_jct=...; ..."
          className="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 font-mono text-xs text-white"
        />
        <button onClick={saveCookie} className="mt-2 rounded-lg bg-emerald-600 px-4 py-2 text-white hover:bg-emerald-500">
          保存 Cookie
        </button>
      </Sec>
      <Sec title="账号登录（免验证码时可用）">
        <div className="flex flex-wrap gap-2">
          <input placeholder="B站账号" value={login.username} onChange={(e) => setLogin({ ...login, username: e.target.value })} className="w-48 rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-white" />
          <input type="password" placeholder="密码" value={login.password} onChange={(e) => setLogin({ ...login, password: e.target.value })} className="w-48 rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-white" />
          <button onClick={doLogin} className="rounded-lg border border-white/15 px-4 py-2 text-white hover:bg-white/10">
            登录
          </button>
        </div>
        <p className="mt-2 text-xs text-white/40">注意：B站登录常触发极验验证码，此时请改用上方“粘贴 Cookie”。</p>
      </Sec>
      <Sec title="扫码登录（推荐，免验证码）">
        <div className="flex items-start gap-4">
          <div>
            {qr ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qr.img} alt="二维码" className="h-44 w-44 rounded bg-white p-2" />
            ) : (
              <div className="flex h-44 w-44 items-center justify-center rounded border border-white/15 bg-black/40 text-xs text-white/40">
                点击右侧按钮生成
              </div>
            )}
          </div>
          <div className="space-y-2">
            <button
              onClick={genQr}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-white hover:bg-emerald-500"
            >
              生成登录二维码
            </button>
            <p className="text-xs text-white/40">用 B站 App 扫码并在手机端确认即可登录，Cookie 自动保存。</p>
            {qrStatus && <p className="text-sm text-sky-300">{qrStatus}</p>}
          </div>
        </div>
      </Sec>
      {msg && <p className="text-sm text-amber-300">{msg}</p>}
    </div>
  );
}

// ---------------- 数据导出 & 审计日志 ----------------
function SystemTab() {
  const [audits, setAudits] = useState<any[]>([]);
  const timer = useRef<any>(null);

  const refresh = useCallback(async () => {
    const r = await api('/api/admin/audit?limit=100');
    setAudits(r.rows || []);
  }, []);
  useEffect(() => {
    refresh();
    timer.current = setInterval(refresh, 10000);
    return () => clearInterval(timer.current);
  }, [refresh]);

  const exports: { type: string; label: string }[] = [
    { type: 'clips', label: '切片' },
    { type: 'lives', label: '直播回放' },
    { type: 'songs', label: '歌单' },
    { type: 'comments', label: '评论' },
    { type: 'dynamics', label: '动态' },
    { type: 'rtsessions', label: '直播实时监控' },
  ];

  return (
    <div>
      <Sec title="数据导出（CSV）">
        <div className="flex flex-wrap gap-2">
          {exports.map((e) => (
            <a
              key={e.type}
              href={`/api/admin/export?type=${e.type}`}
              className="rounded-lg border border-white/15 px-4 py-2 text-white/80 hover:bg-white/10"
            >
              导出{e.label}
            </a>
          ))}
        </div>
        <p className="mt-2 text-xs text-white/40">
          导出的 CSV 带 UTF‑8 BOM，Excel 可直接打开。含 BOM 头，评论/动态含原始数据。
        </p>
      </Sec>

      <Sec title="操作审计日志（每 10 秒刷新）">
        <div className="max-h-[55vh] overflow-auto rounded-lg border border-white/10">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-neutral-900 text-white/50">
              <tr className="text-left">
                <th className="py-2 px-2">时间</th>
                <th className="px-2">操作</th>
                <th className="px-2">对象</th>
                <th className="px-2">详情</th>
                <th className="px-2">IP</th>
              </tr>
            </thead>
            <tbody>
              {audits.map((a) => (
                <tr key={a.id} className="border-b border-white/5">
                  <td className="px-2 py-1 text-white/60">
                    {new Date(a.created_at).toLocaleString()}
                  </td>
                  <td className="px-2 text-emerald-300">{a.action}</td>
                  <td className="px-2 text-white/60">{a.target ?? '—'}</td>
                  <td className="px-2 max-w-[40vw] truncate text-white/50">
                    {a.detail ? JSON.stringify(a.detail) : '—'}
                  </td>
                  <td className="px-2 text-white/50">{a.ip}</td>
                </tr>
              ))}
              {audits.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-2 py-3 text-white/40">
                    暂无审计记录。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Sec>
    </div>
  );
}

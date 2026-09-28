'use client';

import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import LiveMonitor from '@/components/LiveMonitor';

let currentRole: string | null = null; // 'admin' | 'guest' | null

async function api(path: string, opts: RequestInit = {}) {
  const method = (opts.method || 'GET').toUpperCase();
  if (method !== 'GET' && currentRole === 'guest') {
    if (typeof window !== 'undefined') alert('当前为只读访客账号，无权限执行增删改操作。');
    return { ok: false, error: 'readonly' } as any;
  }
  const res = await fetch(path, {
    ...opts,
    credentials: 'include',
    headers: opts.body ? { 'Content-Type': 'application/json', ...(opts.headers || {}) } : opts.headers,
  });
  if (res.status === 401) throw new Error('UNAUTHORIZED');
  return res.json().catch(() => ({}));
}

const TABS = [
  { id: 'jobs', label: '任务调度' },
  { id: 'clips', label: '切片收集' },
  { id: 'lives', label: '直播与歌单' },
  { id: 'track', label: '数据追踪' },
  { id: 'chars', label: '立绘上传' },
  { id: 'creds', label: 'B站凭据' },
  { id: 'system', label: '数据 & 审计' },
];

export default function AdminPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [pw, setPw] = useState('');
  const [loginErr, setLoginErr] = useState('');
  const [tab, setTab] = useState('jobs');
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    api('/api/admin/me')
      .then((r) => {
        setAuthed(!!r.ok);
        setRole(r.role ?? null);
        currentRole = r.role ?? null;
      })
      .catch(() => setAuthed(false));
  }, []);

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
    } else setLoginErr(j.error || '登录失败');
  }

  if (authed === null) return <div className="p-10 text-white/60">检查登录中…</div>;
  if (!authed)
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-950">
        <div className="w-80 rounded-2xl border border-white/10 bg-neutral-900 p-6">
          <h1 className="mb-4 text-xl font-semibold text-white">🔒 后台登录</h1>
          <input
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && doLogin()}
            placeholder="请输入管理密码"
            className="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-white outline-none"
          />
          {loginErr && <p className="mt-2 text-sm text-red-400">{loginErr}</p>}
          <button
            onClick={doLogin}
            className="mt-4 w-full rounded-lg bg-emerald-600 py-2 font-medium text-white hover:bg-emerald-500"
          >
            进入
          </button>
          <p className="mt-3 text-xs text-white/40">
            管理密码由环境变量 ADMIN_PASSWORD 设置（未设置时默认为 admin）；只读访客账号密码为 GUEST_PASSWORD（未设置时默认为 guest），仅可查看与查询、不能增删改。
          </p>
        </div>
      </div>
    );

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <header className="flex items-center justify-between border-b border-white/10 px-6 py-3">
        <h1 className="text-lg font-semibold">李豆沙_Channel · 后台管理</h1>
        <button
          onClick={async () => {
            await fetch('/api/admin/logout', { method: 'POST', credentials: 'include' });
            setAuthed(false);
          }}
          className="rounded-lg border border-white/15 px-3 py-1 text-sm text-white/70 hover:bg-white/10"
        >
          退出
        </button>
      </header>
      {role === 'guest' && (
        <div className="border-b border-amber-500/30 bg-amber-500/15 px-6 py-2 text-sm text-amber-200">
          👁 只读访客模式：可查看与查询数据，但不能进行任何增删改操作。
        </div>
      )}
      <nav className="flex gap-1 border-b border-white/10 px-4">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-3 text-sm ${
              tab === t.id
                ? 'border-b-2 border-emerald-400 text-white'
                : 'text-white/50 hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <main className="p-6">
        {tab === 'jobs' && <JobsTab />}
        {tab === 'clips' && <ClipsTab />}
        {tab === 'lives' && <LivesTab />}
        {tab === 'track' && <TrackTab />}
        {tab === 'chars' && <CharsTab />}
        {tab === 'creds' && <CredsTab />}
        {tab === 'system' && <SystemTab />}
      </main>
    </div>
  );
}

function Sec({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-base font-semibold text-emerald-300">{title}</h2>
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
    if (!confirm(`删除任务「${j.name}」？`)) return;
    await api(`/api/admin/jobs/${j.id}`, { method: 'DELETE' });
    refresh();
  }
  async function stopRun(id: number) {
    if (!window.confirm(`确认停止运行记录 #${id}？`)) return;
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
    if (!confirm(`确认删除并拉黑该切片（${bvid}）？\n拉黑后收集与展示都会跳过，且下次同步不会再次收集。`))
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
    if (!confirm(`确认拉黑 UP 主「${author}」？\n将删除其全部已有切片，且下次收集会跳过该 UP。`))
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
    if (!confirm(`确认解除拉黑 UP 主「${author}」？\n之后收集可重新收录该 UP。`))
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
      alert('请先勾选要导出的直播场次');
      return;
    }
    try {
      const res = await fetch('/api/admin/export/live', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [...sel] }),
      });
      if (!res.ok) {
        alert('导出失败：' + res.status);
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
      alert('导出出错：' + (e as Error).message);
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
    alert(r.ok ? `已启动「${action}」全量（运行记录 #${r.runId}），可在“任务调度”查看进度` : r.error);
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
    alert(r.ok ? `已启动歌单识别（运行记录 #${r.runId}）` : r.error);
  }
  async function collectDanmaku() {
    const r = await api(`/api/admin/lives/${open.bvid}/danmaku`, {
      method: 'POST',
    });
    alert(r.ok ? `已启动弹幕收集（运行记录 #${r.runId}），可在“任务调度”查看进度` : r.error);
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
      <Sec title="直播回放列表">
        <div className="max-h-[40vh] overflow-auto rounded-lg border border-white/10">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-neutral-900 text-white/50">
              <tr className="text-left">
                <th className="py-2 px-2">房间</th>
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
                <th className="px-2"></th>
              </tr>
            </thead>
            <tbody>
              {list.map((l) => (
                <tr key={l.bvid} className="border-b border-white/5">
                  <td className="px-2 max-w-[36vw] truncate">{l.title}</td>
                  <td className="px-2 text-white/60">{l.category}</td>
                  <td className="px-2 text-emerald-300">{l.categoryManual || '—'}</td>
                  <td className="px-2">{(l.durationSec / 60).toFixed(0)}</td>
                  <td className="px-2">{l.songCount}</td>
                  <td className="px-2">{l.checked ? '✅' : '⛔'}</td>
                  <td className="px-2">
                    {l.dmCollected > 0 ? (
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
                  <option value="sing">唱歌回</option>
                  <option value="game">游戏回</option>
                  <option value="other">其他</option>
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
              {open.dmCollected > 0 ? (
                <span className="text-emerald-300">已收集 {open.dmCollected} 条</span>
              ) : (
                <span className="text-red-400">未收集</span>
              )}
              {open.danmaku ? <span className="text-white/40">（B站共 {open.danmaku} 条）</span> : null}
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
                      <span className="text-white/40">#{s.idx}</span> {s.title}
                      <span className="ml-2 text-xs text-white/40">
                        {s.source === 'manual' ? '手动' : '自动'}
                      </span>
                    </span>
                    <span className="space-x-2">
                      <button onClick={() => toggleExclude(s)} className="text-amber-300 hover:underline">
                        {s.excluded ? '恢复' : '去垃圾'}
                      </button>
                      {s.source === 'manual' && (
                        <button onClick={() => delSong(s)} className="text-red-300 hover:underline">
                          删除
                        </button>
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
                注：B站弹幕接口只返回发送者的匿名哈希（非真实 UID），无法对应到具体昵称；同一哈希即同一匿名用户，可据此做“发送人排行”。
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
                        <td className="w-28 px-2 text-right font-mono text-xs text-white/50">{d.sender || '—'}</td>
                      </tr>
                    ))}
                    {dm.length === 0 && (
                      <tr><td colSpan={3} className="px-2 py-3 text-white/40">暂无弹幕，点上方“收集弹幕”或“收集全部弹幕”。</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              <h4 className="mb-2 mt-4 text-sm font-semibold text-sky-300">本场发送人排行（按条数，匿名）</h4>
              <div className="grid max-h-[24vh] grid-cols-2 gap-x-6 gap-y-1 overflow-auto pr-2 sm:grid-cols-3">
                {dmSenders.slice(0, 60).map((s, i) => (
                  <div key={s.sender} className="flex items-center justify-between text-xs">
                    <span className="text-white/40">{i + 1}.</span>
                    <span className="mx-1 flex-1 truncate font-mono text-white/50">{s.sender}</span>
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

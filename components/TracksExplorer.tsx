'use client';

import { useMemo, useState } from 'react';
import type { LiveReplayLite, LiveDayRow, WorkRow } from '@/lib/db';
import SongFreq from '@/components/SongFreq';

import { LIVE_CATEGORIES, CATEGORY_LABEL, CATEGORY_CHIP } from '@/lib/liveCategory';

const CAT_LABEL: Record<string, string> = CATEGORY_LABEL;
const CAT_CLS: Record<string, string> = CATEGORY_CHIP;
// 筛选条：全部 + 各分类
const FILTERS: { key: string; label: string }[] = [
  { key: 'all', label: '全部' },
  ...LIVE_CATEGORIES.map((c) => ({ key: c.key, label: c.label })),
];

function fmtDur(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h > 0 ? `${h}小时${m}分` : `${m}分钟`;
}
function fmtDate(ts: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ts * 1000));
}
function cstDate(ts: number): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
  }).format(new Date(ts * 1000));
}

type Tab = 'replays' | 'heat' | 'songs' | 'works';

// 热力图色阶（青→墨绿，同参考站）
const HEAT_COLORS = [
  'rgba(255,255,255,0.06)',
  '#0e7490',
  '#0891b2',
  '#14b8a6',
  '#2dd4bf',
  '#99f6e4',
];

function heatColor(sec: number, levels: number[]): string {
  if (sec <= 0) return HEAT_COLORS[0];
  for (let i = 0; i < levels.length; i++) {
    if (sec <= levels[i]) return HEAT_COLORS[i + 1];
  }
  return HEAT_COLORS[5];
}

export default function TracksExplorer({
  replays,
  days,
  works,
}: {
  replays: LiveReplayLite[];
  days: LiveDayRow[];
  works: WorkRow[];
}) {
  const [tab, setTab] = useState<Tab>('works');

  // 按日期索引回放，热力图点击日详情用
  const byDate = useMemo(() => {
    const m = new Map<string, LiveReplayLite[]>();
    for (const r of replays) {
      const d = cstDate(r.startTime);
      if (!m.has(d)) m.set(d, []);
      m.get(d)!.push(r);
    }
    return m;
  }, [replays]);

  const years = useMemo(() => {
    const s = new Set<string>();
    for (const d of days) s.add(d.date.slice(0, 4));
    return [...s].sort().reverse();
  }, [days]);
  const [year, setYear] = useState<string>(years[0] ?? '');
  const [selected, setSelected] = useState<string | null>(null);

  const yearDays = useMemo(
    () => days.filter((d) => d.date.startsWith(year)),
    [days, year],
  );
  const yearStat = useMemo(() => {
    let sec = 0;
    let max = 0;
    for (const d of yearDays) {
      sec += d.sec;
      if (d.maxSec > max) max = d.maxSec;
    }
    return { sec, max, count: yearDays.reduce((a, b) => a + b.count, 0) };
  }, [yearDays]);
  // 色阶分位（当年活跃日时长）
  const levels = useMemo(() => {
    const act = yearDays.filter((d) => d.sec > 0).map((d) => d.sec).sort((a, b) => a - b);
    if (!act.length) return [1800, 3600, 7200, 14400];
    return [0.25, 0.5, 0.75, 0.95].map((p) => act[Math.floor(act.length * p)]);
  }, [yearDays]);

  // 热力图周列
  const weeks = useMemo(() => {
    if (!year) return [];
    const start = new Date(Date.UTC(Number(year), 0, 1));
    // 对齐到周一（getUTCDay: 0=周日）
    const dow = (start.getUTCDay() + 6) % 7;
    start.setUTCDate(start.getUTCDate() - dow);
    const end = new Date(Date.UTC(Number(year), 11, 31));
    const cols: { date: string; inYear: boolean }[][] = [];
    const cur = new Date(start);
    while (cur <= end) {
      const col: { date: string; inYear: boolean }[] = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(cur);
        col.push({
          date: d.toISOString().slice(0, 10),
          inYear: d.getUTCFullYear() === Number(year),
        });
        cur.setUTCDate(cur.getUTCDate() + 1);
      }
      cols.push(col);
    }
    return cols;
  }, [year]);

  const dayMap = useMemo(() => {
    const m = new Map<string, LiveDayRow>();
    for (const d of days) m.set(d.date, d);
    return m;
  }, [days]);

  return (
    <div>
      {/* Tab 栏 */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        {(
          [
            ['works', '🎮 豆沙作品'],
            ['replays', '📼 录播回放'],
            ['heat', '🔥 直播热力'],
            ['songs', '🎵 唱歌频率'],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`rounded-full px-5 py-2 text-sm font-medium transition ${
              tab === id
                ? 'bg-brand-500 text-white shadow-lg shadow-brand-500/30'
                : 'border border-white/15 bg-white/5 text-white/70 hover:bg-white/10'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 录播回放 */}
      {tab === 'replays' && <ReplaysTab replays={replays} />}

      {/* 唱歌频率 */}
      {tab === 'songs' && (
        <div className="glass !bg-ink-900/50 p-5">
          <SongFreq />
        </div>
      )}

      {/* 直播热力 */}
      {tab === 'heat' && (
        <div className="glass !bg-ink-900/50 p-5">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {years.map((y) => (
              <button
                key={y}
                onClick={() => {
                  setYear(y);
                  setSelected(null);
                }}
                className={`rounded-full px-4 py-1.5 text-sm transition ${
                  y === year
                    ? 'bg-emerald-600 text-white'
                    : 'border border-white/15 text-white/60 hover:bg-white/10'
                }`}
              >
                {y}
              </button>
            ))}
          </div>
          <div className="mb-5 flex flex-wrap gap-x-8 gap-y-2 text-sm text-white/70">
            <span>
              总直播 <b className="text-brand-100">{replays.length}</b> 场
            </span>
            <span>
              {year} 年直播场次{' '}
              <b className="text-brand-100">{yearStat.count}</b> 场
            </span>
            <span>
              {year} 年总时长{' '}
              <b className="text-brand-100">{fmtDur(yearStat.sec)}</b>
            </span>
            <span>
              单日最大直播时长{' '}
              <b className="text-brand-100">{fmtDur(yearStat.max)}</b>
            </span>
          </div>

          {/* 热力图：列=周，行=周一~周日 */}
          <div className="overflow-x-auto pb-2">
            <div className="inline-block min-w-full">
              <div className="mb-1 flex gap-[3px] pl-8">
                {weeks.map((col, i) => {
                  const first = col[0].date;
                  const prev = i > 0 ? weeks[i - 1][0].date : '';
                  const showLabel = first.slice(5, 7) !== prev.slice(5, 7);
                  return (
                    <div
                      key={i}
                      className="relative h-4 w-3.5 text-[9px] text-white/40"
                    >
                      {showLabel && (
                        <span className="absolute left-0 whitespace-nowrap">
                          {Number(first.slice(5, 7))}月
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="flex gap-[3px]">
                <div className="mr-1 flex w-6 flex-col gap-[3px] text-[9px] text-white/40">
                  {['一', '二', '三', '四', '五', '六', '日'].map((w, i) => (
                    <span key={i} className="h-3.5 leading-3.5">
                      {i % 2 === 0 ? w : ''}
                    </span>
                  ))}
                </div>
                {weeks.map((col, i) => (
                  <div key={i} className="flex flex-col gap-[3px]">
                    {col.map((cell) => {
                      const d = dayMap.get(cell.date);
                      const sec = d?.sec ?? 0;
                      const active = cell.inYear && sec > 0;
                      return (
                        <button
                          key={cell.date}
                          title={
                            active
                              ? `${cell.date} · 直播 ${fmtDur(sec)}（${d!.count} 场）`
                              : cell.date
                          }
                          onClick={() =>
                            active && setSelected(cell.date === selected ? null : cell.date)
                          }
                          className={`h-3.5 w-3.5 rounded-[3px] transition ${
                            selected === cell.date
                              ? 'ring-2 ring-amber-300'
                              : 'hover:ring-1 hover:ring-white/40'
                          }`}
                          style={{
                            backgroundColor: cell.inYear
                              ? heatColor(sec, levels)
                              : 'transparent',
                          }}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
              {/* 图例 */}
              <div className="mt-3 flex items-center gap-1.5 text-[10px] text-white/40">
                <span>短</span>
                {HEAT_COLORS.map((c, i) => (
                  <span
                    key={i}
                    className="h-3 w-3 rounded-[3px]"
                    style={{ backgroundColor: c }}
                  />
                ))}
                <span>长</span>
              </div>
            </div>
          </div>

          {/* 点击日的详情 */}
          {selected && (
            <div className="mt-5 rounded-xl border border-white/10 bg-black/30 p-4">
              <div className="mb-3 text-sm font-medium text-brand-100">
                🗓 {selected} ·{' '}
                {fmtDur(dayMap.get(selected)?.sec ?? 0)}（
                {byDate.get(selected)?.length ?? 0} 场）
              </div>
              <div className="flex flex-col gap-2">
                {(byDate.get(selected) ?? []).map((r) => (
                  <a
                    key={r.id}
                    href={`https://www.bilibili.com/video/${r.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex flex-wrap items-center gap-3 rounded-lg border border-white/10 px-3 py-2 text-sm text-white/80 transition hover:bg-white/5"
                  >
                    <span className="text-white/50">
                      {new Intl.DateTimeFormat('zh-CN', {
                        timeZone: 'Asia/Shanghai',
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: false,
                      }).format(new Date(r.startTime * 1000))}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{r.title}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        CAT_CLS[r.category] ?? CAT_CLS.other
                      }`}
                    >
                      {CAT_LABEL[r.category] ?? '杂谈'}
                    </span>
                    <span className="text-xs text-white/50">{fmtDur(r.durationSec)}</span>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 豆沙作品 */}
      {tab === 'works' && <WorksTab works={works} />}
    </div>
  );
}

function fmtHM(ts: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(ts * 1000));
}

function ReplaysTab({ replays }: { replays: LiveReplayLite[] }) {
  const [cat, setCat] = useState<string>('all');
  const [q, setQ] = useState('');
  const [monthLimit, setMonthLimit] = useState(6);

  // 每个筛选项的数量
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: replays.length };
    for (const r of replays) c[r.category] = (c[r.category] ?? 0) + 1;
    return c;
  }, [replays]);

  const filtered = useMemo(() => {
    return replays.filter(
      (r) =>
        (cat === 'all' || r.category === cat) &&
        (!q.trim() || (r.title || '').toLowerCase().includes(q.trim().toLowerCase())),
    );
  }, [replays, cat, q]);

  // 按月分组（东八区），倒序
  const months = useMemo(() => {
    const m = new Map<string, LiveReplayLite[]>();
    for (const r of filtered) {
      const key = cstDate(r.startTime).slice(0, 7); // YYYY-MM
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(r);
    }
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [filtered]);

  // 默认展开最近 2 个月，其余折叠；用户点过的月份记住其展开状态
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const toggleMonth = (key: string) => {
    setCollapsed((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
    setTouched((prev) => new Set(prev).add(key));
  };

  const shownMonths = months.slice(0, monthLimit);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setCat(f.key)}
            className={`rounded-full px-4 py-1.5 text-sm transition ${
              cat === f.key
                ? 'bg-brand-500 text-white'
                : 'border border-white/15 bg-white/5 text-white/70 hover:bg-white/10'
            }`}
          >
            {f.label}
            <span className="ml-1 text-xs opacity-60">{counts[f.key] ?? 0}</span>
          </button>
        ))}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索标题…"
          className="ml-auto w-56 rounded-full border border-white/15 bg-black/40 px-4 py-1.5 text-sm text-white placeholder:text-white/30"
        />
      </div>

      {months.length === 0 && (
        <p className="py-8 text-center text-sm text-white/40">没有匹配的回放。</p>
      )}

      {shownMonths.map(([key, items], idx) => {
        // 展开规则：用户点过的按其状态；没点过的默认展开最近 2 个月
        const expanded = touched.has(key)
          ? !collapsed.has(key)
          : idx < 2;
        return (
          <div key={key} className="mb-4">
            <button
              onClick={() => toggleMonth(key)}
              className="flex w-full items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2.5 text-left text-sm text-white/80 transition hover:bg-white/[0.08]"
            >
              <span
                className={`text-xs text-white/40 transition ${expanded ? 'rotate-90' : ''}`}
              >
                ▶
              </span>
              <span className="font-medium">
                {key.slice(0, 4)}年{Number(key.slice(5, 7))}月
              </span>
              <span className="text-xs text-white/40">{items.length} 场</span>
            </button>
            {expanded && (
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {items.map((r) => (
                  <a
                    key={r.id}
                    href={`https://www.bilibili.com/video/${r.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="group glass !bg-ink-900/50 overflow-hidden rounded-xl transition hover:-translate-y-0.5 hover:bg-white/10"
                  >
                    <div className="relative aspect-video w-full overflow-hidden bg-white/5">
                      {r.cover ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={r.cover}
                          alt={r.title}
                          loading="lazy"
                          className="h-full w-full object-cover transition group-hover:scale-105"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-2xl text-white/25">
                          📺
                        </div>
                      )}
                      <span
                        className={`absolute right-1.5 top-1.5 rounded-full px-2 py-0.5 text-[10px] backdrop-blur ${
                          CAT_CLS[r.category] ?? CAT_CLS.other
                        }`}
                      >
                        {CAT_LABEL[r.category] ?? '杂谈'}
                      </span>
                      <span className="absolute bottom-1.5 right-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white/90">
                        {fmtDur(r.durationSec)}
                      </span>
                    </div>
                    <div className="p-2.5">
                      <div className="line-clamp-1 text-sm text-white/85 group-hover:text-brand-100">
                        {r.title}
                      </div>
                      <div className="mt-1 text-[11px] text-white/40">
                        {fmtDate(r.startTime)} {fmtHM(r.startTime)} 开播
                      </div>
                    </div>
                  </a>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {months.length > monthLimit && (
        <button
          onClick={() => setMonthLimit(monthLimit + 6)}
          className="mx-auto block rounded-full border border-white/15 px-6 py-2 text-sm text-white/60 transition hover:bg-white/10"
        >
          展开更早的月份（还有 {months.length - monthLimit} 个月）
        </button>
      )}
    </div>
  );
}

function WorksTab({ works }: { works: WorkRow[] }) {
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {works.map((w) => (
        <a
          key={w.id}
          href={w.url}
          target="_blank"
          rel="noreferrer"
          className="group glass !bg-ink-900/50 overflow-hidden transition hover:-translate-y-1 hover:bg-white/10"
        >
          {w.cover && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={w.cover}
              alt={w.title}
              className="aspect-video w-full object-cover transition group-hover:scale-[1.03]"
              loading="lazy"
            />
          )}
          <div className="p-4">
            <div className="truncate font-medium text-brand-50 group-hover:text-brand-100">
              {w.title}
            </div>
            {w.description && (
              <div className="mt-1 line-clamp-2 text-xs leading-relaxed text-white/50">
                {w.description}
              </div>
            )}
            {w.pubdate > 0 && (
              <div className="mt-2 text-xs text-white/40">
                {new Date(w.pubdate * 1000).toLocaleDateString('zh-CN')}
              </div>
            )}
          </div>
        </a>
      ))}
      {works.length === 0 && (
        <p className="col-span-full py-8 text-center text-sm text-white/40">
          还没有收录作品，可在后台「豆沙作品」中添加。
        </p>
      )}
    </div>
  );
}

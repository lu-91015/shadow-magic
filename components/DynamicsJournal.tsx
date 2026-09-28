'use client';

import { useMemo, useState } from 'react';
import type { DynItem } from '@/lib/bilibili';
import DynCard from './DynCard';

export interface JournalDay {
  date: string;
  count: number;
  items: DynItem[];
}

export default function DynamicsJournal({ days }: { days: JournalDay[] }) {
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const [selYear, setSelYear] = useState(() => days[0]?.date.slice(0, 4) ?? '');
  const [selMonth, setSelMonth] = useState('');
  const [dateInput, setDateInput] = useState('');

  // 搜索：按动态正文 / 昵称过滤，重新按天分组（仅保留命中的天）
  const filteredDays = useMemo(() => {
    if (!q.trim()) return days;
    const kw = q.trim();
    return days
      .map((d) => ({
        ...d,
        items: d.items.filter((it) => (it.text + ' ' + it.name).includes(kw)),
      }))
      .filter((d) => d.items.length > 0);
  }, [days, q]);

  const total = filteredDays.length;
  const safeIdx = Math.min(idx, Math.max(0, total - 1));
  const day = filteredDays[safeIdx];

  // 窗口化渲染：当前天 + 前后各一天，保证性能
  const start = Math.max(0, safeIdx - 1);
  const end = Math.min(total, safeIdx + 2);
  const windowDays = filteredDays.slice(start, end);

  function go(dir: number) {
    setIdx((i) => Math.min(total - 1, Math.max(0, i + dir)));
  }

  // 数据中出现过的年份（倒序）
  const years = useMemo(() => {
    const s = new Set(days.map((d) => d.date.slice(0, 4)));
    return [...s].sort((a, b) => (a < b ? 1 : -1));
  }, [days]);

  function jumpToIndex(pred: (d: JournalDay) => boolean) {
    const i = filteredDays.findIndex(pred);
    if (i >= 0) setIdx(i);
  }

  // 按 年 / 年-月 跳转：定位到该范围最新的那一天
  function jumpByYM(year: string, month: string) {
    const prefix = month ? `${year}-${month}` : year;
    jumpToIndex((d) => d.date.startsWith(prefix));
  }

  // 按精确日期跳转：命中则定位，否则定位到该日期之前最近的一天
  function jumpToDate(target: string) {
    if (!target) return;
    const exact = filteredDays.findIndex((d) => d.date === target);
    if (exact >= 0) {
      setIdx(exact);
      return;
    }
    let i = filteredDays.findIndex((d) => d.date <= target);
    if (i < 0) i = filteredDays.length - 1;
    setIdx(i);
  }

  return (
    <div>
      {/* 日历 / 跳转：年-月下拉 + 原生日期选择器，选完自动定位 */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="text-xs text-white/50">跳转到：</span>
        <select
          value={selYear}
          onChange={(e) => {
            setSelYear(e.target.value);
            jumpByYM(e.target.value, selMonth);
          }}
          className="bg-white/10 text-white text-sm rounded px-2 py-1.5 border border-white/10"
        >
          {years.map((y) => (
            <option key={y} value={y} className="bg-ink-900">
              {y} 年
            </option>
          ))}
        </select>
        <select
          value={selMonth}
          onChange={(e) => {
            setSelMonth(e.target.value);
            jumpByYM(selYear, e.target.value);
          }}
          className="bg-white/10 text-white text-sm rounded px-2 py-1.5 border border-white/10"
        >
          <option value="" className="bg-ink-900">
            全部月份
          </option>
          {Array.from({ length: 12 }, (_, i) =>
            String(i + 1).padStart(2, '0'),
          ).map((m) => (
            <option key={m} value={m} className="bg-ink-900">
              {m} 月
            </option>
          ))}
        </select>
        <input
          type="date"
          value={dateInput}
          onChange={(e) => {
            setDateInput(e.target.value);
            jumpToDate(e.target.value);
          }}
          className="bg-white/10 text-white text-sm rounded px-2 py-1.5 border border-white/10"
        />
      </div>

      {/* 顶部：搜索 + 左右翻滚（方向已交换：左=更新，右=更早） */}
      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={() => go(-1)}
          disabled={safeIdx <= 0}
          className="text-xl w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-30"
          title="更新的动态"
        >
          ‹
        </button>
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setIdx(0);
          }}
          placeholder="搜索动态正文，如：歌回、联动、生日"
          className="bg-white/10 text-white text-sm rounded px-3 py-2 border border-white/10 flex-1"
        />
        <button
          onClick={() => go(1)}
          disabled={safeIdx >= total - 1}
          className="text-xl w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-30"
          title="更早的动态"
        >
          ›
        </button>
        {q && (
          <button
            onClick={() => {
              setQ('');
              setIdx(0);
            }}
            className="text-xs text-white/50 hover:text-white"
          >
            清除
          </button>
        )}
      </div>

      <div className="text-xs text-white/40 mb-2">
        {total > 0
          ? `第 ${safeIdx + 1} / ${total} 天${q ? '（搜索命中）' : ''}`
          : '无匹配动态'}
      </div>

      {/* 横向日志：窗口化轮播 + 滑动动画 */}
      <div className="relative overflow-hidden">
        <div
          className="flex transition-transform duration-300 ease-out"
          style={{
            transform: `translateX(-${((safeIdx - start) * 100)}%)`,
          }}
        >
          {windowDays.map((d) => (
            <div key={d.date} className="w-full shrink-0 px-0.5">
              <div className="glass rounded-xl p-4 h-[78vh] flex flex-col">
                <div className="flex items-center justify-between mb-3 pb-2 border-b border-white/10">
                  <span className="text-brand-100 font-medium">{d.date}</span>
                  <span className="text-xs text-white/40">
                    {d.count} 条动态
                  </span>
                </div>
                <div className="flex-1 overflow-y-auto space-y-4 pr-1">
                  {d.items.map((it) => (
                    <DynCard key={it.id} d={it} />
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 底部翻页提示（方向已交换：左=更新，右=更早） */}
      <div className="flex items-center justify-center gap-4 mt-4 text-sm text-white/50">
        <button
          onClick={() => go(-1)}
          disabled={safeIdx <= 0}
          className="hover:text-brand-200 disabled:opacity-30"
        >
          ‹ 更新
        </button>
        <button
          onClick={() => go(1)}
          disabled={safeIdx >= total - 1}
          className="hover:text-brand-200 disabled:opacity-30"
        >
          更早 ›
        </button>
      </div>
    </div>
  );
}

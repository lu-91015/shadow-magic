'use client';

import { useEffect, useState, useCallback } from 'react';

interface Replay {
  id: string;
  title: string;
  category: string;
  durationSec: number;
  danmaku: number;
}

export default function DanmakuExplorer({
  initialReplays,
  initialTotal,
  initialTotalDanmaku,
  initialSenders,
}: {
  initialReplays: Replay[];
  initialTotal: number;
  initialTotalDanmaku: number;
  initialSenders: number;
}) {
  const [replays] = useState<Replay[]>(initialReplays);
  const [bvid, setBvid] = useState('');
  const [senders, setSenders] = useState<{ sender: string; count: number }[]>([]);
  const [phrases, setPhrases] = useState<{ text: string; count: number }[]>([]);
  const [q, setQ] = useState('');
  const [search, setSearch] = useState<{ q: string; bvid: string; count: number } | null>(null);
  const [loading, setLoading] = useState(false);

  const loadSenders = useCallback(async () => {
    const res = await fetch(`/api/danmaku?senders=1${bvid ? `&bvid=${bvid}` : ''}`);
    setSenders((await res.json()).senders ?? []);
  }, [bvid]);

  const loadPhrases = useCallback(async () => {
    const res = await fetch(`/api/danmaku?phrases=1${bvid ? `&bvid=${bvid}` : ''}`);
    setPhrases((await res.json()).phrases ?? []);
  }, [bvid]);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadSenders(), loadPhrases()]).finally(() => setLoading(false));
  }, [loadSenders, loadPhrases]);

  async function doSearch() {
    if (!q.trim()) return;
    const res = await fetch(
      `/api/danmaku?search=${encodeURIComponent(q)}${bvid ? `&bvid=${bvid}` : ''}`,
    );
    setSearch(await res.json());
  }

  const fmtDur = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h ? `${h}h${m}m` : `${m}m`;
  };

  return (
    <div className="space-y-8">
      {/* 概览 */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="弹幕总数" value={initialTotalDanmaku.toLocaleString()} />
        <Stat label="已入库回放" value={`${initialReplays.filter((r) => r.danmaku > 0).length}/${initialReplays.length}`} />
        <Stat label="弹幕发送人数" value={initialSenders.toLocaleString()} />
        <Stat label="已解析弹幕" value={initialTotal.toLocaleString()} />
      </section>

      {/* 弹幕条数最多的回放 */}
      <section>
        <h2 className="text-lg font-semibold text-brand-200 mb-3">各回放弹幕数</h2>
        <div className="glass overflow-hidden rounded-lg">
          <table className="w-full text-sm">
            <thead className="text-white/50">
              <tr className="border-b border-white/10">
                <th className="text-left px-3 py-2">标题</th>
                <th className="text-left px-3 py-2">分类</th>
                <th className="text-left px-3 py-2">时长</th>
                <th className="text-right px-3 py-2">弹幕数</th>
              </tr>
            </thead>
            <tbody>
              {replays.slice(0, 60).map((r) => (
                <tr
                  key={r.id}
                  className="border-b border-white/5 hover:bg-white/5 cursor-pointer"
                  onClick={() => setBvid(bvid === r.id ? '' : r.id)}
                >
                  <td className="px-3 py-2 text-white/90">
                    {r.title}
                    {bvid === r.id && (
                      <span className="ml-2 text-xs text-brand-400">已选</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-white/50">{r.category}</td>
                  <td className="px-3 py-2 text-white/50">{fmtDur(r.durationSec)}</td>
                  <td className="px-3 py-2 text-right text-brand-200">
                    {r.danmaku.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 排行榜 + 搜索 */}
      <section>
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <h2 className="text-lg font-semibold text-brand-200 mr-2">
            弹幕分析 {bvid ? '（当前回放）' : '（全部回放）'}
          </h2>
          {bvid && (
            <button
              onClick={() => setBvid('')}
              className="text-xs text-brand-400 hover:text-brand-200"
            >
              清除回放筛选
            </button>
          )}
          <span className="text-xs text-white/40">{loading ? '加载中…' : ''}</span>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {/* 发送人排行 */}
          <div className="glass rounded-lg">
            <div className="px-3 py-2 text-sm text-white/70 border-b border-white/10">
              弹幕发送人排行（按条数）
            </div>
            <table className="w-full text-sm">
              <tbody>
                {senders.slice(0, 30).map((s, i) => (
                  <tr key={s.sender} className="border-b border-white/5">
                    <td className="px-3 py-1.5 text-white/40 w-8">{i + 1}</td>
                    <td className="px-3 py-1.5 text-white/80">
                      用户 <span className="font-mono text-xs">{s.sender}</span>
                    </td>
                    <td className="px-3 py-1.5 text-right text-brand-200">{s.count}</td>
                  </tr>
                ))}
                {!senders.length && (
                  <tr>
                    <td colSpan={3} className="px-3 py-6 text-center text-white/40">
                      暂无数据，请先运行 npm run sync:danmaku
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* 高频弹幕 */}
          <div className="glass rounded-lg">
            <div className="px-3 py-2 text-sm text-white/70 border-b border-white/10">
              高频弹幕文本（按出现次数）
            </div>
            <table className="w-full text-sm">
              <tbody>
                {phrases.slice(0, 30).map((p, i) => (
                  <tr key={p.text} className="border-b border-white/5">
                    <td className="px-3 py-1.5 text-white/40 w-8">{i + 1}</td>
                    <td className="px-3 py-1.5 text-white/80 break-words">{p.text}</td>
                    <td className="px-3 py-1.5 text-right text-brand-200">{p.count}</td>
                  </tr>
                ))}
                {!phrases.length && (
                  <tr>
                    <td colSpan={3} className="px-3 py-6 text-center text-white/40">
                      暂无数据
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* 关键词统计 */}
        <div className="flex items-center gap-2 mt-4">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && doSearch()}
            placeholder="统计某条弹幕出现次数，如：打call"
            className="bg-white/10 text-white text-sm rounded px-2 py-1 border border-white/10 w-64"
          />
          <button
            onClick={doSearch}
            className="text-sm px-3 py-1 rounded bg-brand-500/30 text-brand-100 hover:bg-brand-500/50"
          >
            统计
          </button>
          {search && (
            <span className="text-sm text-white/70">
              “{search.q}” 共出现{' '}
              <span className="text-brand-200 font-semibold">
                {search.count.toLocaleString()}
              </span>{' '}
              次{search.bvid ? '（当前回放）' : '（全部回放）'}
            </span>
          )}
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="glass rounded-lg px-4 py-3">
      <div className="text-xs text-white/50">{label}</div>
      <div className="text-xl font-semibold text-brand-200 mt-1">{value}</div>
    </div>
  );
}

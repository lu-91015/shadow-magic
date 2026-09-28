'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { UID } from '@/lib/constants';

export interface CommenterStat {
  mid: string;
  uname: string;
  count: number;
  likes: number;
  lastCtime: number;
}

export interface CommentRow {
  rpid: string;
  oid: string;
  mid: string;
  uname: string;
  message: string;
  ctime: number;
  like_count: number;
  parent: string;
  is_sub: boolean;
  created_at: string;
}

interface DynOpt {
  oid: string;
  count: number;
}

const dynUrl = (oid: string) => `https://space.bilibili.com/${UID}/dynamic/${oid}`;

export default function CommentsExplorer({
  initialStats,
  initialDynamics,
  initialOid = '',
}: {
  initialStats: CommenterStat[];
  initialDynamics: DynOpt[];
  initialOid?: string;
}) {
  const [stats, setStats] = useState<CommenterStat[]>(initialStats);
  const [dynamics] = useState<DynOpt[]>(initialDynamics);
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [total, setTotal] = useState(0);
  const [oid, setOid] = useState(initialOid);
  const [mid, setMid] = useState('');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);

  const loadComments = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (oid) params.set('oid', oid);
    if (mid) params.set('mid', mid);
    if (q) params.set('q', q);
    params.set('limit', '200');
    try {
      const res = await fetch(`/api/comments?${params.toString()}`);
      const data = await res.json();
      setComments(data.comments ?? []);
      setTotal(data.total ?? 0);
    } finally {
      setLoading(false);
    }
  }, [oid, mid, q]);

  // 切换筛选条件时重新拉取评论
  useEffect(() => {
    loadComments();
  }, [loadComments]);

  // 切换"评论达人榜 / 单条动态"时刷新统计榜
  const loadStats = useCallback(async () => {
    const params = new URLSearchParams();
    params.set('stats', '1');
    if (oid) params.set('oid', oid);
    const res = await fetch(`/api/comments?${params.toString()}`);
    const data = await res.json();
    setStats(data.stats ?? []);
  }, [oid]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const fmtTime = (t: number) =>
    t ? new Date(t * 1000).toLocaleString('zh-CN') : '—';

  // 父评论 rpid -> 作者昵称，用于"回复 @某人"可读展示
  const parentName = useMemo(() => {
    const m = new Map<string, string>();
    comments.forEach((c) => m.set(c.rpid, c.uname));
    return m;
  }, [comments]);

  return (
    <div className="space-y-8">
      {/* 评论达人榜 */}
      <section>
        <h2 className="text-lg font-semibold text-brand-200 mb-3">
          评论达人榜 {oid ? '（当前动态）' : ''}
        </h2>
        <div className="glass overflow-hidden rounded-lg">
          <table className="w-full text-sm">
            <thead className="text-white/50">
              <tr className="border-b border-white/10">
                <th className="text-left px-3 py-2">#</th>
                <th className="text-left px-3 py-2">昵称</th>
                <th className="text-right px-3 py-2">评论数</th>
                <th className="text-right px-3 py-2">获赞</th>
                <th className="text-left px-3 py-2">最近评论</th>
              </tr>
            </thead>
            <tbody>
              {stats.slice(0, 30).map((s, i) => (
                <tr
                  key={s.mid}
                  className="border-b border-white/5 hover:bg-white/5 cursor-pointer"
                  onClick={() => setMid(mid === s.mid ? '' : s.mid)}
                >
                  <td className="px-3 py-2 text-white/40">{i + 1}</td>
                  <td className="px-3 py-2 text-white/90">
                    {s.uname}
                    {mid === s.mid && (
                      <span className="ml-2 text-xs text-brand-400">已筛选</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right text-brand-200">{s.count}</td>
                  <td className="px-3 py-2 text-right text-white/70">{s.likes}</td>
                  <td className="px-3 py-2 text-white/50">{fmtTime(s.lastCtime)}</td>
                </tr>
              ))}
              {!stats.length && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-white/40">
                    暂无评论数据，请先运行 npm run sync:comments
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* 筛选 + 评论列表 */}
      <section>
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <h2 className="text-lg font-semibold text-brand-200 mr-2">评论列表</h2>
          <select
            value={oid}
            onChange={(e) => setOid(e.target.value)}
            className="bg-white/10 text-white text-sm rounded px-2 py-1 border border-white/10"
          >
            <option value="">全部动态（{dynamics.length}）</option>
            {dynamics.map((d) => (
              <option key={d.oid} value={d.oid}>
                {d.oid}（{d.count}）
              </option>
            ))}
          </select>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索评论内容…"
            className="bg-white/10 text-white text-sm rounded px-2 py-1 border border-white/10 w-48"
          />
          {mid && (
            <button
              onClick={() => setMid('')}
              className="text-xs text-brand-400 hover:text-brand-200"
            >
              清除用户筛选（{stats.find((s) => s.mid === mid)?.uname ?? mid}）
            </button>
          )}
          <span className="text-xs text-white/40">
            共 {total} 条{loading ? ' · 加载中…' : ''}
          </span>
        </div>

        <div className="glass rounded-lg divide-y divide-white/5">
          {comments.map((c) => (
            <div key={c.rpid} className="px-4 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <div className="text-sm">
                  <span className="text-brand-200">{c.uname}</span>
                  {c.is_sub && (
                    <span className="ml-2 text-[10px] text-white/40">
                      回复 @{parentName.get(c.parent) ?? c.parent}
                    </span>
                  )}
                </div>
                <div className="text-xs text-white/40 whitespace-nowrap">
                  {fmtTime(c.ctime)} · 👍 {c.like_count}
                </div>
              </div>
              <div className="text-white/80 text-sm mt-1 whitespace-pre-wrap break-words">
                {c.message}
              </div>
              <a
                href={dynUrl(c.oid)}
                target="_blank"
                rel="noreferrer"
                className="text-[11px] text-white/30 hover:text-brand-400"
              >
                动态 {c.oid} ↗
              </a>
            </div>
          ))}
          {!comments.length && (
            <div className="px-4 py-6 text-center text-white/40 text-sm">
              {loading ? '加载中…' : '无匹配评论'}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

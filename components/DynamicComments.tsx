'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import type { CommentRow, CommenterStat } from '@/lib/db';

const fmtTime = (t: number) =>
  t ? new Date(t * 1000).toLocaleString('zh-CN') : '—';

// 评论者头像：远程 B站 face 地址（no-referrer 规避防盗链），加载失败降级为首字母
function Avatar({ src, name }: { src?: string; name: string }) {
  const [err, setErr] = useState(false);
  if (!src || err) {
    return (
      <div className="w-6 h-6 rounded-full bg-brand-500/40 text-brand-100 flex items-center justify-center text-xs shrink-0">
        {name.slice(0, 1)}
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={name}
      width={24}
      height={24}
      referrerPolicy="no-referrer"
      onError={() => setErr(true)}
      className="w-6 h-6 rounded-full object-cover shrink-0"
    />
  );
}

interface CNode extends CommentRow {
  children: CNode[];
}

// 把扁平评论列表构建成树：parent 指向父评论 rpid 的挂到父下，其余作为顶层。
function buildTree(comments: CommentRow[]): CNode[] {
  const map = new Map<string, CNode>();
  for (const c of comments) map.set(c.rpid, { ...c, children: [] });
  const roots: CNode[] = [];
  for (const c of comments) {
    const node = map.get(c.rpid)!;
    const parent =
      c.parent && c.parent !== '0' ? map.get(c.parent) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  // 子回复按时间正序，便于顺着看对话
  const sortRec = (nodes: CNode[]) => {
    nodes.forEach((n) => {
      n.children.sort((a, b) => a.ctime - b.ctime);
      sortRec(n.children);
    });
  };
  sortRec(roots);
  return roots;
}

function CommentItem({
  node,
  depth,
  parentName,
}: {
  node: CNode;
  depth: number;
  parentName?: string;
}) {
  return (
    <div
      className={
        depth > 0
          ? 'pl-4 mt-2 border-l border-white/10'
          : 'py-2'
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          <Avatar src={node.avatar} name={node.uname} />
          <span className="text-sm text-brand-200">
            {node.uname}
            {node.is_sub && (
              <span className="text-xs text-white/40 ml-1">
                · 回复{node.parent && parentName ? ` ${parentName}` : ''}
              </span>
            )}
          </span>
        </div>
        <span className="text-xs text-white/40 whitespace-nowrap">
          {fmtTime(node.ctime)} · 👍 {node.like_count}
        </span>
      </div>
      <div className="text-white/80 text-sm whitespace-pre-wrap break-words">
        {node.messageHtml ? (
          <span dangerouslySetInnerHTML={{ __html: node.messageHtml }} />
        ) : (
          node.message
        )}
      </div>
      {node.children.map((ch) => (
        <CommentItem
          key={ch.rpid}
          node={ch}
          depth={depth + 1}
          parentName={node.uname}
        />
      ))}
    </div>
  );
}

export default function DynamicComments({
  oid,
  type,
  initialComments,
  initialCount,
  initialStats,
}: {
  oid: string;
  type: number;
  initialComments: CommentRow[];
  initialCount: number;
  initialStats: CommenterStat[];
}) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');
  const [q, setQ] = useState('');

  const tree = useMemo(
    () => buildTree(initialComments),
    [initialComments],
  );

  async function sync() {
    setSyncing(true);
    setSyncMsg('正在从 B站拉取评论（含子回复）…');
    try {
      const res = await fetch('/api/comments/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oid, type }),
      });
      const data = await res.json();
      if (data.ok) {
        setSyncMsg(`已拉取 ${data.count} 条（本批新增/更新）`);
        router.refresh();
      } else {
        setSyncMsg('拉取失败：' + (data.error ?? '未知错误'));
      }
    } catch (e) {
      setSyncMsg('拉取失败：' + (e as Error).message);
    } finally {
      setSyncing(false);
    }
  }

  const kw = q.trim();
  // 有筛选词时退化为扁平过滤（嵌套 + 搜索体验较差），否则按树形嵌套展示
  const flatFiltered = kw
    ? initialComments.filter((c) => c.message.includes(kw))
    : [];

  return (
    <section className="mt-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-brand-200">
          评论 {initialCount > 0 ? `(${initialCount})` : ''}
        </h2>
        <button
          onClick={sync}
          disabled={syncing}
          className="text-sm px-3 py-1 rounded bg-brand-500/30 text-brand-100 hover:bg-brand-500/50 disabled:opacity-50"
        >
          {syncing ? '拉取中…' : initialCount > 0 ? '刷新评论' : '加载评论'}
        </button>
      </div>

      {syncMsg && <div className="text-xs text-white/40 mb-2">{syncMsg}</div>}

      {initialCount === 0 && !syncing && (
        <div className="text-sm text-white/40 mb-2">
          该动态尚未拉取评论，点上方"加载评论"从 B站获取。
        </div>
      )}

      {initialCount > 0 && (
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="筛选评论关键词，如：打call、好听"
          className="bg-white/10 text-white text-sm rounded px-2 py-1 border border-white/10 w-full mb-3"
        />
      )}

      <div className="divide-y divide-white/5 max-h-[60vh] overflow-auto">
        {kw ? (
          flatFiltered.map((c) => (
            <div key={c.rpid} className="py-2">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2 min-w-0">
                  <Avatar src={c.avatar} name={c.uname} />
                  <span className="text-sm text-brand-200">
                    {c.uname}
                    {c.is_sub && (
                      <span className="text-xs text-white/40 ml-1">· 回复</span>
                    )}
                  </span>
                </div>
                <span className="text-xs text-white/40 whitespace-nowrap">
                  {fmtTime(c.ctime)} · 👍 {c.like_count}
                </span>
              </div>
              <div className="text-white/80 text-sm whitespace-pre-wrap break-words">
                {c.messageHtml ? (
                  <span dangerouslySetInnerHTML={{ __html: c.messageHtml }} />
                ) : (
                  c.message
                )}
              </div>
            </div>
          ))
        ) : (
          tree.map((n) => (
            <CommentItem key={n.rpid} node={n} depth={0} />
          ))
        )}
        {kw && flatFiltered.length === 0 && (
          <div className="text-sm text-white/40 py-2">无匹配评论</div>
        )}
      </div>
    </section>
  );
}

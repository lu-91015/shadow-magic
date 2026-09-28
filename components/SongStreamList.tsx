'use client';

function fmtDate(ts: number | null): string {
  if (!ts) return '待识别';
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export interface SongStream {
  bvid: string;
  title: string | null;
  songCount: number;
  checkedAt: number | null;
}

export default function SongStreamList({
  streams,
  songMap,
}: {
  streams: SongStream[];
  songMap: Record<string, string[]>;
}) {
  return (
    <div className="space-y-2">
      {streams.map((s) => (
        <details
          key={s.bvid}
          className="glass !bg-ink-900/50 px-4 py-3 open:bg-ink-900/70"
        >
          <summary className="flex items-center gap-2 cursor-pointer list-none">
            <span className="text-sm text-brand-50 min-w-0 truncate flex-1">
              {s.title || s.bvid}
            </span>
            <a
              href={`https://www.bilibili.com/video/${s.bvid}`}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-xs text-white/40 hover:text-brand-100 shrink-0"
            >
              回放 ›
            </a>
            <span className="text-xs text-white/50 shrink-0 w-16 text-right">
              {s.songCount > 0 ? `${s.songCount} 首` : '未识别'}
            </span>
          </summary>
          <div className="text-[11px] text-white/40 mt-1 mb-2">
            识别于 {fmtDate(s.checkedAt)}
          </div>
          {s.songCount > 0 ? (
            <ol className="list-decimal list-inside text-sm text-brand-50/90 space-y-0.5 columns-2">
              {(songMap[s.bvid] ?? []).map((t, i) => (
                <li key={i} className="break-inside-avoid">
                  {t}
                </li>
              ))}
            </ol>
          ) : (
            <div className="text-sm text-white/40">该场未识别到歌单。</div>
          )}
        </details>
      ))}
    </div>
  );
}

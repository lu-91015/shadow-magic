import { LIVE_URL } from '@/lib/constants';
import type { LiveStatus } from '@/lib/bilibili';

export default function LiveWidget({ live }: { live: LiveStatus }) {
  const isLive = live.liveStatus === 1;
  return (
    <div className="glass p-5 flex items-center gap-4">
      <span
        className={`relative flex h-3 w-3 ${isLive ? 'animate-glow' : ''}`}
      >
        {isLive && (
          <span className="absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75 animate-ping" />
        )}
        <span
          className={`relative inline-flex h-3 w-3 rounded-full ${
            isLive ? 'bg-red-500' : 'bg-white/40'
          }`}
        />
      </span>

      <div className="flex-1 min-w-0">
        <div className="text-sm text-brand-200">
          {isLive ? '正在直播' : '当前未开播'}
        </div>
        <div className="truncate text-brand-50 font-medium">
          {live.title || '—'}
        </div>
        {isLive && live.online != null && (
          <div className="text-xs text-white/50">
            在线 {live.online.toLocaleString()} 人
          </div>
        )}
      </div>

      <a
        href={LIVE_URL}
        target="_blank"
        rel="noreferrer"
        className="shrink-0 px-4 py-2 rounded-full bg-brand-500 hover:bg-brand-400 transition text-white text-sm font-medium"
      >
        进入直播间
      </a>
    </div>
  );
}

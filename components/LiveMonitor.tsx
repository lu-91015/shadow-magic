'use client';

import { useEffect, useState } from 'react';

interface StatusResp {
  live: boolean;
  title: string | null;
  session: {
    id: string;
    room_id: string;
    title: string | null;
    start_time: number;
    online_peak: number | null;
  } | null;
  counts: {
    danmaku: number;
    sc: number;
    gift: number;
    interact: number;
    enter?: number;
    follow?: number;
  };
}

export default function LiveMonitor() {
  const [data, setData] = useState<StatusResp | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch('/api/live/status', { cache: 'no-store' });
        const j = (await r.json()) as StatusResp;
        if (alive) setData(j);
      } catch {
        /* ignore */
      }
    };
    load();
    const t = setInterval(load, 10_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const c =
    data?.counts ?? { danmaku: 0, sc: 0, gift: 0, interact: 0, enter: 0, follow: 0 };
  const startedAt = data?.session?.start_time
    ? new Date(data.session.start_time * 1000).toLocaleString('zh-CN')
    : '';

  return (
    <div className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-4">
      <div className="mb-2 flex items-center gap-2">
        <span
          className={`inline-block h-2.5 w-2.5 rounded-full ${
            data?.live ? 'bg-emerald-400 animate-pulse' : 'bg-white/30'
          }`}
        />
        <span className="text-sm font-semibold text-sky-200">
          {data?.live
            ? data.session?.room_id
              ? `房间 ${data.session.room_id} 直播中`
              : '李豆沙直播中'
            : '当前未开播'}
        </span>
        {data?.title ? (
          <span className="text-sm text-white/60">· {data.title}</span>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-5">
        <Stat label="本场弹幕" value={c.danmaku.toLocaleString()} />
        <Stat label="醒目留言" value={c.sc.toLocaleString()} />
        <Stat label="礼物事件" value={c.gift.toLocaleString()} />
        <Stat label="进入" value={(c.enter ?? 0).toLocaleString()} />
        <Stat label="关注" value={(c.follow ?? 0).toLocaleString()} />
        <Stat
          label="人气峰值"
          value={data?.session?.online_peak?.toLocaleString() ?? '—'}
        />
      </div>
      {data?.session ? (
        <p className="mt-2 text-xs text-white/40">
          会话 {data.session.id} · 开始于 {startedAt}
          {data.live ? '' : ' · 已下播'}
        </p>
      ) : (
        <p className="mt-2 text-xs text-white/40">
          暂无直播会话（未开播）。运行 <code>npm run live-monitor</code> 后，开播将自动记录。
        </p>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  title,
}: {
  label: string;
  value: string;
  title?: string;
}) {
  return (
    <div className="rounded-lg bg-black/30 px-3 py-2" title={title}>
      <div className="text-xs text-white/40">{label}</div>
      <div className="text-lg font-semibold text-white/90">{value}</div>
    </div>
  );
}

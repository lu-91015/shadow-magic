import type { YearBucket } from '@/lib/yearly';

export default function YearlyChart({
  byYear,
}: {
  byYear: Record<string, YearBucket>;
}) {
  const years = Object.keys(byYear).sort();
  const max = Math.max(1, ...years.map((y) => byYear[y].count));

  if (years.length === 0) {
    return (
      <div className="text-white/40 text-sm">
        暂无年度数据，请运行 <code>npm run fetch:yearly</code> 生成。
      </div>
    );
  }

  return (
    <div className="glass p-5">
      <div className="flex items-end gap-3 h-56">
        {years.map((y) => {
          const b = byYear[y];
          const h = Math.round((b.count / max) * 100);
          return (
            <div key={y} className="flex-1 flex flex-col items-center justify-end gap-2">
              <div className="text-xs text-brand-200">{b.count}</div>
              <div
                className="w-full rounded-t-lg bg-gradient-to-t from-brand-700 to-brand-400 transition-all"
                title={`${y}年 · ${b.count} 条 · 播放 ${(b.view / 10000).toFixed(0)}万 · 点赞 ${(b.like / 10000).toFixed(0)}万`}
                style={{ height: `${h}%` }}
              />
              <div className="text-xs text-white/60">{y}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

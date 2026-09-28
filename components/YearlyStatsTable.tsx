import type { YearBucket } from '@/lib/yearly';

function fmt(n: number): string {
  if (n >= 100000000) return (n / 100000000).toFixed(2) + ' 亿';
  if (n >= 10000) return (n / 10000).toFixed(1) + ' 万';
  return n.toLocaleString();
}

export default function YearlyStatsTable({
  byYear,
}: {
  byYear: Record<string, YearBucket>;
}) {
  const years = Object.keys(byYear).sort().reverse();
  if (years.length === 0) {
    return <div className="text-white/40 text-sm">暂无年度数据。</div>;
  }

  return (
    <div className="glass p-5 overflow-x-auto">
      <table className="w-full text-sm whitespace-nowrap">
        <thead>
          <tr className="text-brand-200 text-left">
            <th className="py-2 pr-4">年份</th>
            <th className="pr-4">投稿</th>
            <th className="pr-4">播放</th>
            <th className="pr-4">点赞</th>
            <th className="pr-4">投币</th>
            <th className="pr-4">转发</th>
            <th className="pr-4">收藏</th>
            <th className="pr-4">评论</th>
          </tr>
        </thead>
        <tbody>
          {years.map((y) => {
            const b = byYear[y];
            return (
              <tr key={y} className="border-t border-white/5">
                <td className="py-2 pr-4 text-brand-100">{y}</td>
                <td className="pr-4">{b.count}</td>
                <td className="pr-4">{fmt(b.view)}</td>
                <td className="pr-4">{fmt(b.like)}</td>
                <td className="pr-4">{fmt(b.coin)}</td>
                <td className="pr-4">{fmt(b.share)}</td>
                <td className="pr-4">{fmt(b.favorite)}</td>
                <td className="pr-4">{fmt(b.reply)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

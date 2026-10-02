import YearlyChart from '@/components/YearlyChart';
import YearlyStatsTable from '@/components/YearlyStatsTable';
import { readYearly } from '@/lib/yearly';

export const dynamic = 'force-dynamic';

function fmtWan(n: number): string {
  if (n >= 100000000) return (n / 100000000).toFixed(2) + ' 亿';
  if (n >= 10000) return (n / 10000).toFixed(1) + ' 万';
  return n.toLocaleString();
}

export default async function StatsPage() {
  const data = await readYearly();
  const totals = data?.totals;
  const hasData = !!totals && totals.count > 0;

  const CARDS = totals
    ? [
        { label: '投稿总数', value: totals.count.toLocaleString() },
        { label: '总播放', value: fmtWan(totals.view) },
        { label: '总点赞', value: fmtWan(totals.like) },
        { label: '总弹幕', value: fmtWan(totals.danmaku) },
      ]
    : [];

  return (
    <main className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-semibold text-brand-200 mb-2">数据总览</h1>
      <p className="text-white/60 text-sm mb-8">
        豆沙在 B站的投稿年度统计：按投稿年份汇总播放、点赞、投币、转发、收藏与评论量，
        数据由后台同步任务自动更新。
      </p>

      {hasData ? (
        <>
          {/* 汇总卡片 */}
          <section className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {CARDS.map((c) => (
              <div key={c.label} className="glass !bg-ink-900/50 p-4">
                <div className="text-xs text-white/40">{c.label}</div>
                <div className="mt-1 text-xl font-semibold text-brand-100">{c.value}</div>
              </div>
            ))}
          </section>

          {/* 年度投稿柱状图 */}
          <section className="mb-10">
            <h2 className="mb-4 text-lg font-semibold text-brand-200">年度投稿量</h2>
            <YearlyChart byYear={data!.byYear} />
          </section>

          {/* 年度明细表 */}
          <section className="mb-10">
            <h2 className="mb-4 text-lg font-semibold text-brand-200">年度明细</h2>
            <YearlyStatsTable byYear={data!.byYear} />
          </section>
        </>
      ) : (
        <div className="glass p-6 text-sm text-white/50">
          暂无数据。请先在后台运行数据同步任务（npm run sync）生成投稿统计。
        </div>
      )}

      <div className="mt-8">
        <a href="/" className="text-sm text-white/50 transition hover:text-brand-100">
          ‹ 返回首页
        </a>
      </div>
    </main>
  );
}

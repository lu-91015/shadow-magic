import { queryNews, seedNewsOnce } from '@/lib/db';

export const dynamic = 'force-dynamic';

const TAG_COLOR: Record<string, string> = {
  功能: 'bg-brand-500/20 text-brand-100',
  改版: 'bg-white/10 text-white/80',
  数据: 'bg-white/10 text-white/80',
};

export default async function NewsPage() {
  await seedNewsOnce(); // 表为空时播种历史公告
  const news = await queryNews(true);

  return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-semibold text-brand-200 mb-2">通知</h1>
      <p className="text-white/60 text-sm mb-8">本网站的升级公告与说明。</p>

      <div className="space-y-4">
        {news.map((n) => (
          <article key={n.id} className="glass !bg-ink-900/50 p-4">
            <div className="mb-1.5 flex items-center gap-2">
              {n.tag && (
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    TAG_COLOR[n.tag] ?? 'bg-white/10 text-white/70'
                  }`}
                >
                  {n.tag}
                </span>
              )}
              <h2 className="font-medium text-brand-50">{n.title}</h2>
              <time className="ml-auto shrink-0 text-xs text-white/40">{n.date}</time>
            </div>
            <p className="text-sm leading-relaxed text-white/60">{n.body}</p>
          </article>
        ))}
        {news.length === 0 && (
          <div className="glass p-6 text-sm text-white/50">暂无公告。</div>
        )}
      </div>

      <div className="mt-8">
        <a href="/" className="text-sm text-white/50 transition hover:text-brand-100">
          ‹ 返回首页
        </a>
      </div>
    </main>
  );
}

import ClipsMosaic from '@/components/ClipsMosaic';
import { queryClips, queryClipAuthors } from '@/lib/db';

export const dynamic = 'force-dynamic';

function fmtWan(n: number): string {
  if (n >= 100000000) return (n / 100000000).toFixed(2) + ' 亿';
  if (n >= 10000) return (n / 10000).toFixed(1) + ' 万';
  return n.toLocaleString();
}

export default async function ClipsPage() {
  const [clips, authors] = await Promise.all([
    queryClips(),
    queryClipAuthors(),
  ]);

  return (
    <main className="max-w-6xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-semibold text-brand-200 mb-2">切片墙</h1>
      <p className="text-white/60 text-sm mb-6">
        标题含“李豆沙”或“礼豆沙”（CP 名）的相关切片共 {clips.length} 条，由 {authors.length} 位切片man
        投稿。每一格就是一条切片，悬停可查看标题与切片man，点击前往 B站观看。
      </p>

      {/* 切片man 统计 */}
      <section className="mb-10">
        <h2 className="text-lg font-semibold text-brand-200 mb-4">
          切片man 统计（按切片数排序）
        </h2>
        {authors.length === 0 ? (
          <div className="text-sm text-white/40">暂无数据。</div>
        ) : (
          <div className="glass overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-white/50 border-b border-white/10">
                  <th className="px-4 py-2.5 font-medium">#</th>
                  <th className="px-4 py-2.5 font-medium">切片man</th>
                  <th className="px-4 py-2.5 font-medium text-right">切片数</th>
                  <th className="px-4 py-2.5 font-medium text-right">总播放</th>
                  <th className="px-4 py-2.5 font-medium text-right">总点赞</th>
                  <th className="px-4 py-2.5 font-medium text-right">总投币</th>
                  <th className="px-4 py-2.5 font-medium text-right">最近投稿</th>
                </tr>
              </thead>
              <tbody>
                {authors.slice(0, 50).map((a, i) => (
                  <tr
                    key={a.author}
                    className="border-b border-white/5 hover:bg-white/5 transition"
                  >
                    <td className="px-4 py-2 text-white/40">{i + 1}</td>
                    <td className="px-4 py-2 text-brand-50">{a.author}</td>
                    <td className="px-4 py-2 text-right text-brand-100">
                      {a.count}
                    </td>
                    <td className="px-4 py-2 text-right text-white/70">
                      {fmtWan(Number(a.view))}
                    </td>
                    <td className="px-4 py-2 text-right text-white/70">
                      {fmtWan(Number(a.like))}
                    </td>
                    <td className="px-4 py-2 text-right text-white/70">
                      {fmtWan(Number(a.coin))}
                    </td>
                    <td className="px-4 py-2 text-right text-white/40 text-xs">
                      {a.lastAt
                        ? new Date(Number(a.lastAt) * 1000)
                            .toISOString()
                            .slice(0, 10)
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {authors.length > 50 && (
          <p className="text-xs text-white/40 mt-2">
            仅显示前 50 位切片man，共 {authors.length} 位。
          </p>
        )}
      </section>

      {/* 马赛克墙 */}
      <section>
        <h2 className="text-lg font-semibold text-brand-200 mb-4">切片马赛克墙</h2>
        {clips.length === 0 ? (
          <div className="text-sm text-white/40">
            暂无切片数据。运行 <code>npm run sync</code> 同步标签投稿后即可展示。
          </div>
        ) : (
          <ClipsMosaic clips={clips} />
        )}
      </section>
    </main>
  );
}

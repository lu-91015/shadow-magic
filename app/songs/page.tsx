import {
  querySongStreams,
  querySongFrequency,
  getEffectiveSongs,
} from '@/lib/db';
import SongStreamList from '@/components/SongStreamList';

export const dynamic = 'force-dynamic';

function fmtDate(ts: number | null): string {
  if (!ts) return '待识别';
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export default async function SongsPage() {
  const [streams, freq] = await Promise.all([
    querySongStreams(),
    querySongFrequency(),
  ]);
  // 预先拉取每场歌单（数据量可控），用普通对象以便跨服务端/客户端边界序列化
  const songsByBvid: Record<string, string[]> = {};
  for (const s of streams) {
    if (s.songCount > 0) {
      const rows = await getEffectiveSongs(s.bvid);
      songsByBvid[s.bvid] = rows.map((r) => r.title);
    }
  }

  const checked = streams.filter((s) => s.checkedAt != null).length;
  const withSongs = streams.filter((s) => s.songCount > 0).length;

  return (
    <main className="max-w-5xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-semibold text-brand-200 mb-2">歌回歌单</h1>
      <p className="text-white/60 text-sm mb-6">
        从每场直播回放尾段画面（右上角歌单）自动识别。已识别 {checked} / {streams.length} 场，
        其中 {withSongs} 场识别到歌单，去重歌曲 {freq.length} 首。
      </p>

      {/* 热门歌曲榜 */}
      <section className="mb-10">
        <h2 className="text-lg font-semibold text-brand-200 mb-4">
          热门歌曲榜（按出现场次）
        </h2>
        {freq.length === 0 ? (
          <div className="text-sm text-white/40">暂无数据，运行 npm run sync:songs 生成。</div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-2">
            {freq.slice(0, 60).map((f, i) => (
              <div
                key={f.title}
                className="glass !bg-ink-900/50 px-3 py-2 flex items-center gap-3"
              >
                <span className="text-xs text-white/40 w-6 shrink-0">{i + 1}</span>
                <span className="text-sm text-brand-50 min-w-0 truncate">{f.title}</span>
                <span className="ml-auto text-xs text-white/50 shrink-0">
                  {f.count} 场
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 各场歌单 */}
      <section>
        <h2 className="text-lg font-semibold text-brand-200 mb-4">各场歌单</h2>
        <SongStreamList streams={streams} songMap={songsByBvid} />
      </section>

      <div className="mt-8">
        <a href="/" className="text-sm text-white/50 hover:text-brand-100 transition">
          ‹ 返回首页
        </a>
      </div>
    </main>
  );
}

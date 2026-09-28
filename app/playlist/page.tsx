import PlaylistView from '@/components/PlaylistView';
import { readPlaylist } from '@/lib/playlist';

export const dynamic = 'force-dynamic';

export default async function PlaylistPage() {
  const data = await readPlaylist();
  const songs = data?.songs ?? [];

  return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-brand-200">豆沙宝贝的歌单</h1>
        <div className="text-sm text-white/40">{songs.length} 首</div>
      </div>

      {songs.length === 0 ? (
        <div className="text-white/40 text-sm">
          歌单为空。运行 <code>npm run seed:playlist</code> 将 data/playlist.json 写入数据库后即可展示。
        </div>
      ) : (
        <PlaylistView songs={songs} />
      )}
    </main>
  );
}

import { queryAssets, seedAssetsOnce, countAssets, getAssetCategories } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function AssetsPage() {
  await seedAssetsOnce(); // 首次访问播种历史素材（跳过二维码图）
  const assets = (await countAssets()) > 0 ? await queryAssets() : [];
  const GROUPS = await getAssetCategories(); // 内置 + 后台自定义分类

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="mb-2 text-2xl font-semibold text-brand-200">素材库</h1>
      <p className="mb-8 text-sm text-white/60">
        李豆沙的各类素材：立绘、装扮、表情包、鼠标指针、输入法皮肤等，点击查看 / 下载。
      </p>

      {GROUPS.map((g) => {
        const items = assets.filter((a) => a.category === g.key);
        return (
          <section key={g.key} className="mb-10">
            <h2 className="mb-1 text-lg font-semibold text-brand-200">{g.label}</h2>
            {g.desc && <p className="mb-3 text-xs text-white/40">{g.desc}</p>}
            <div className="mb-4 h-px" />
            {items.length === 0 ? (
              <div className="text-sm text-white/40">暂无素材。</div>
            ) : (
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
                {items.map((a) =>
                  a.kind === 'image' ? (
                    <a
                      key={a.id}
                      href={a.file}
                      target="_blank"
                      rel="noreferrer"
                      title={a.title || a.file}
                      className="glass group aspect-square overflow-hidden rounded-lg !bg-ink-900/50 transition hover:bg-white/10"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={a.file}
                        alt={a.title || ''}
                        loading="lazy"
                        className="h-full w-full object-contain p-1 transition group-hover:scale-105"
                      />
                    </a>
                  ) : (
                    <a
                      key={a.id}
                      href={a.file}
                      download
                      title={a.title || a.file}
                      className="glass group flex aspect-square flex-col items-center justify-center gap-2 rounded-lg !bg-ink-900/50 p-2 text-center transition hover:bg-white/10"
                    >
                      <span className="text-3xl">
                        {a.file.endsWith('.zip') || a.file.endsWith('.rar') || a.file.endsWith('.7z')
                          ? '🗜️'
                          : a.file.endsWith('.cur') || a.file.endsWith('.ani')
                            ? '🖱️'
                            : a.file.endsWith('.json')
                              ? '⌨️'
                              : '📦'}
                      </span>
                      <span className="line-clamp-2 w-full break-all text-xs text-white/70 group-hover:text-brand-100">
                        {a.title || a.file.split('/').pop()}
                      </span>
                      <span className="text-[10px] text-white/40">点击下载 ↓</span>
                    </a>
                  ),
                )}
              </div>
            )}
          </section>
        );
      })}

      <div className="mt-8">
        <a href="/" className="text-sm text-white/50 transition hover:text-brand-100">
          ‹ 返回首页
        </a>
      </div>
    </main>
  );
}

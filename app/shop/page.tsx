import Link from 'next/link';
import { queryShopItems, seedShopOnce } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function ShopPage() {
  await seedShopOnce(); // 表为空时播种现有装扮商品
  const items = await queryShopItems(true);

  return (
    <main className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-semibold text-brand-200 mb-2">商店</h1>
      <p className="text-white/60 text-sm mb-6">
        李豆沙相关的官方周边与装扮，点击前往对应平台获取。
      </p>

      {items.length === 0 ? (
        <div className="glass !bg-ink-900/30 p-8 flex flex-col items-center justify-center text-center border border-dashed border-white/15">
          <div className="text-3xl mb-2">🛍️</div>
          <div className="text-sm text-white/50">更多商品上架中</div>
          <div className="text-xs text-white/30 mt-1">
            有新的周边 / 装扮会第一时间放在这里
          </div>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {items.map((s) => (
            <a
              key={s.id}
              href={s.url}
              target="_blank"
              rel="noreferrer"
              className="glass !bg-ink-900/50 p-4 flex flex-col hover:bg-white/10 transition group"
            >
              {s.cover && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={s.cover}
                  alt={s.title}
                  className="w-full aspect-video rounded-lg object-cover bg-white/5 mb-3"
                  loading="lazy"
                />
              )}
              <div className="font-medium text-brand-100 flex items-center gap-2">
                {s.tag && (
                  <span className="rounded-full bg-brand-500/20 px-2 py-0.5 text-xs text-brand-100">
                    {s.tag}
                  </span>
                )}
                <span className="min-w-0 truncate">{s.title}</span>
              </div>
              {s.description && (
                <div className="text-xs text-white/50 mt-1 flex-1">{s.description}</div>
              )}
              <span className="mt-3 text-xs text-white/40 group-hover:text-brand-100 transition">
                前往获取 ›
              </span>
            </a>
          ))}
        </div>
      )}

      <div className="mt-8">
        <Link href="/" className="text-sm text-white/50 hover:text-brand-100 transition">
          ‹ 返回首页
        </Link>
      </div>
    </main>
  );
}

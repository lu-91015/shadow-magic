import Link from 'next/link';

const GARB_URL =
  'https://www.bilibili.com/h5/mall/equity-link/collect-home?item_id=413365001&isdiy=0&part=suit&f_source=garb';

export default function ShopPage() {
  return (
    <main className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-semibold text-brand-200 mb-2">商店</h1>
      <p className="text-white/60 text-sm mb-6">
        李豆沙相关的官方周边与装扮，点击前往 B站获取。
      </p>

      <div className="grid sm:grid-cols-2 gap-4">
        {/* 装扮：李豆沙与电子星海 */}
        <a
          href={GARB_URL}
          target="_blank"
          rel="noreferrer"
          className="glass !bg-ink-900/50 p-4 flex flex-col hover:bg-white/10 transition group"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/garb/cover.jpg"
            alt="李豆沙与电子星海"
            className="w-full aspect-video rounded-lg object-cover bg-white/5 mb-3"
          />
          <div className="font-medium text-brand-100">
            装扮 · 李豆沙与电子星海
          </div>
          <div className="text-xs text-white/50 mt-1 flex-1">
            官方装扮已上线 · 含粉丝卡片 / 表情包 / 空间背景
          </div>
          <span className="mt-3 text-xs text-white/40 group-hover:text-brand-100 transition">
            前往获取 ›
          </span>
        </a>

        {/* 占位：更多商品 */}
        <div className="glass !bg-ink-900/30 p-4 flex flex-col items-center justify-center text-center border border-dashed border-white/15">
          <div className="text-3xl mb-2">🛍️</div>
          <div className="text-sm text-white/50">更多商品上架中</div>
          <div className="text-xs text-white/30 mt-1">
            有新的周边 / 装扮会第一时间放在这里
          </div>
        </div>
      </div>

      <div className="mt-8">
        <Link href="/" className="text-sm text-white/50 hover:text-brand-100 transition">
          ‹ 返回首页
        </Link>
      </div>
    </main>
  );
}

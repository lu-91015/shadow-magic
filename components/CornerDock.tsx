import Link from 'next/link';

// 主页右下角悬浮按钮组：商店 / 素材 / 通知 / 后台
// 图标用官方表情包 PNG（豆沙主题），悬停时上方弹出另一张表情包 + 名称气泡
const DOCK = [
  { href: '/shop', label: '商店', icon: '展示.png', emoji: '爱心.png' },
  { href: '/assets', label: '素材', icon: '只是熊猫.png', emoji: '抱抱.png' },
  { href: '/news', label: '通知', icon: '举手.png', emoji: '打call.png' },
  { href: '/admin', label: '后台', icon: '侦探.png', emoji: '安眠.png' },
];

export default function CornerDock() {
  return (
    <div className="fixed bottom-6 right-6 z-40 flex gap-3">
      {DOCK.map((b) => (
        <Link
          key={b.href}
          href={b.href}
          aria-label={b.label}
          className="group relative flex flex-col items-center"
        >
          {/* 磨砂圆角底 + 表情包图标 */}
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/15 bg-ink-900/60 shadow-lg backdrop-blur-md transition group-hover:-translate-y-1 group-hover:border-brand-300/40 group-hover:bg-white/10">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/garb/emojis/${b.icon}`}
              alt={b.label}
              className="h-10 w-10 object-contain drop-shadow-[0_2px_6px_rgba(0,0,0,0.45)] transition group-hover:scale-110"
            />
          </span>
          {/* 名称 */}
          <span className="mt-1 text-[10px] leading-none text-white/50 transition group-hover:text-brand-100">
            {b.label}
          </span>
          {/* 悬停弹出豆沙表情包 */}
          <span className="pointer-events-none absolute bottom-full left-1/2 mb-3 hidden -translate-x-1/2 md:block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/garb/emojis/${b.emoji}`}
              alt={b.label}
              className="w-24 h-24 -translate-y-2 object-contain opacity-0 drop-shadow-[0_4px_10px_rgba(0,0,0,0.5)] transition duration-200 group-hover:translate-y-0 group-hover:opacity-100"
            />
          </span>
        </Link>
      ))}
    </div>
  );
}

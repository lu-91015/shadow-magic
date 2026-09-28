import Link from 'next/link';

// 主页右下角悬浮按钮组：商店 / 素材 / 通知 / 后台
// 每个按钮悬停时，在其上方弹出一张「豆沙表情包」（素材库 /garb/emojis 下的 PNG）
const DOCK = [
  { href: '/shop', label: '商店', icon: '🛒', emoji: '展示.png' },
  { href: '/assets', label: '素材', icon: '🎁', emoji: '抱抱.png' },
  { href: '/news', label: '通知', icon: '📮', emoji: '打call.png' },
  { href: '/admin', label: '后台', icon: '🔒', emoji: '安眠.png' },
];

export default function CornerDock() {
  return (
    <div className="fixed bottom-6 right-6 z-40 flex gap-4">
      {DOCK.map((b) => (
        <Link
          key={b.href}
          href={b.href}
          aria-label={b.label}
          className="group relative w-24 h-24 flex items-center justify-center text-7xl opacity-80 hover:opacity-100 hover:scale-105 transition"
        >
          <span aria-hidden>{b.icon}</span>
          {/* 悬停显示豆沙表情包 */}
          <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden md:block opacity-0 group-hover:opacity-100 transition">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/garb/emojis/${b.emoji}`}
              alt={b.label}
              className="w-28 h-28 object-contain drop-shadow-[0_4px_10px_rgba(0,0,0,0.5)]"
            />
          </span>
        </Link>
      ))}
    </div>
  );
}

import type { TopicPost } from '@/lib/topic';
import { TOPIC_URL } from '@/lib/topic';

// 「线索墙」：仿手作留言墙排版——条纹壁纸底 + 深绿软木板 + 散落倾斜的钉卡。
// 卡片位置用预置槽位（确定性，避免水合抖动），重叠与倾斜是效果的一部分。
const SLOTS: Array<{ x: number; y: number; r: number }> = [
  { x: 1, y: 4, r: -5 },
  { x: 20, y: 2, r: 3 },
  { x: 40, y: 6, r: -2 },
  { x: 58, y: 1, r: 4 },
  { x: 76, y: 5, r: -4 },
  { x: 4, y: 30, r: 4 },
  { x: 24, y: 26, r: -3 },
  { x: 45, y: 32, r: 2 },
  { x: 66, y: 28, r: -5 },
  { x: 84, y: 33, r: 3 },
  { x: 2, y: 58, r: -3 },
  { x: 22, y: 62, r: 5 },
  { x: 43, y: 56, r: -2 },
  { x: 64, y: 60, r: 3 },
  { x: 84, y: 57, r: -4 },
  { x: 12, y: 82, r: 2 },
  { x: 36, y: 80, r: -4 },
  { x: 60, y: 84, r: 3 },
];

function Card({ p, tilt = 0 }: { p: TopicPost; tilt?: number }) {
  return (
    <a
      href={p.url}
      target="_blank"
      rel="noreferrer"
      className="group relative block"
      style={{ transform: `rotate(${tilt}deg)` }}
    >
      <div className="overflow-hidden rounded-md bg-white shadow-[0_8px_18px_rgba(0,0,0,0.4)] transition duration-200 group-hover:scale-[1.05] group-hover:shadow-[0_14px_30px_rgba(0,0,0,0.55)]">
        {/* 橙色带头：作者 + 日期钉 */}
        <div className="flex items-center justify-between gap-2 bg-gradient-to-r from-amber-400 to-orange-500 px-3 py-1.5">
          <span className="truncate text-sm font-bold text-white drop-shadow-sm">
            {p.author || 'Kimo熊'}
          </span>
          <span className="shrink-0 rounded-sm bg-white/25 px-1.5 py-0.5 text-[10px] leading-none text-white/95">
            {p.pubTime}
          </span>
        </div>
        {/* 白色卡身：文字 + 缩略图 */}
        <div className="p-3">
          {p.text && (
            <div className="line-clamp-4 text-[13px] leading-relaxed text-stone-700">
              {p.text}
            </div>
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {p.image && (
            <img
              src={p.image}
              alt={p.text || p.author}
              loading="lazy"
              className="mt-2 h-28 w-full rounded object-cover"
            />
          )}
        </div>
      </div>
    </a>
  );
}

export default function TopicWall({ posts }: { posts: TopicPost[] }) {
  return (
    <div
      className="relative mx-auto flex h-[88%] w-full max-w-[1360px] overflow-hidden rounded-2xl shadow-2xl ring-1 ring-black/30"
      style={{
        background:
          'repeating-linear-gradient(90deg, #f0ebe1 0px, #f0ebe1 26px, #e8e1d5 26px, #e8e1d5 52px)',
      }}
    >
      {/* 左侧竖排标题（仿参考站的「线索墙」竖字） */}
      <div className="hidden w-14 shrink-0 items-center justify-center md:flex lg:w-16">
        <span
          className="select-none text-xl font-bold tracking-[0.5em] text-stone-600 lg:text-2xl"
          style={{ writingMode: 'vertical-rl' }}
        >
          🎋 豆漫墙
        </span>
      </div>

      {/* 深绿软木板 */}
      <div className="relative m-2 flex-1 overflow-hidden rounded-xl bg-[#1d3b35] shadow-[inset_0_2px_16px_rgba(0,0,0,0.55)] ring-1 ring-black/40 md:mb-4 md:ml-1 md:mr-5 md:mt-4">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-2 rounded-lg border border-dashed border-white/15"
        />
        {/* 右上：去B站话题页 */}
        <a
          href={TOPIC_URL}
          target="_blank"
          rel="noreferrer"
          className="absolute right-4 top-3 z-30 rounded-full bg-black/30 px-3 py-1 text-xs text-emerald-100/90 backdrop-blur transition hover:bg-black/50 hover:text-white"
        >
          #大熊猫豆漫# · 去B站话题页 ›
        </a>

        {posts.length === 0 ? (
          <div className="flex h-full items-center justify-center text-emerald-100/60">
            🎋 线索还在路上……（话题内容暂时拉取不到）
          </div>
        ) : (
          <>
            {/* 桌面：预置槽位散落布局 */}
            <div className="absolute inset-0 hidden md:block">
              {posts.map((p, i) => {
                const s = SLOTS[i % SLOTS.length];
                return (
                  <div
                    key={p.id}
                    className="absolute w-60"
                    style={{
                      left: `${s.x}%`,
                      top: `${s.y}%`,
                      transform: `rotate(${s.r}deg)`,
                    }}
                  >
                    <Card p={p} />
                  </div>
                );
              })}
            </div>
            {/* 移动：流式小卡 */}
            <div className="no-scrollbar flex h-full flex-wrap content-start justify-center gap-4 overflow-y-auto p-4 pt-10 md:hidden">
              {posts.map((p, i) => (
                <div key={p.id} className="w-56">
                  <Card p={p} tilt={(i % 5) - 2} />
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

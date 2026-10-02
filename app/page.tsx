import Link from 'next/link';
import TopicWall from '@/components/TopicWall';
import GarbBackdrop from '@/components/GarbBackdrop';
import { LIVE_URL, SPACE_URL } from '@/lib/constants';
import ScreenNav from '@/components/ScreenNav';
import CornerDock from '@/components/CornerDock';
import CountUp from '@/components/CountUp';
import { getLiveStatus, getFollowerStats } from '@/lib/bilibili';
import { getRandomQuote, getHeroConfig, HERO_DEFAULTS, queryVerifiedSongCount } from '@/lib/db';
import { getTopicPosts } from '@/lib/topic';

export const dynamic = 'force-dynamic';

export default function Home() {
  return (
    <main className="no-scrollbar h-[calc(100vh-3rem)] overflow-y-auto overflow-x-hidden snap-y snap-mandatory scroll-smooth">
      <ScreenNav />
      <CornerDock />
      <HomeScreens />
    </main>
  );
}

// 单路数据失败（B站风控/超时/网络抖动）不影响整页渲染，降级为兜底值
async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch {
    return fallback;
  }
}

async function HomeScreens() {
  const [live, follower, topicPosts, quote, hero, verifiedSongs] = await Promise.all([
    safe(getLiveStatus(), {
      liveStatus: 0,
      title: null,
      roomId: null,
      online: null,
      cover: null,
      url: null,
      liveTime: null,
    }),
    safe(getFollowerStats(), { follower: null, following: null }),
    safe(getTopicPosts(), []),
    safe(getRandomQuote(), null),
    safe(getHeroConfig(), HERO_DEFAULTS),
    safe(queryVerifiedSongCount(), 0),
  ]);

  return (
    <>
      {/* 第一幕：首页 —— 居中式简洁 hero（头像 + 名字 + 人设一句话 + 大数字 + 按钮排） */}
      <section
        id="screen-hero"
        className="no-scrollbar relative h-full snap-start snap-always flex items-center justify-center px-4 overflow-y-auto md:overflow-hidden"
      >
        <GarbBackdrop />
        {/* 左缘：竹枝装饰（钉在画面边上，营造分散感） */}
        <div
          aria-hidden
          className="hidden lg:flex absolute left-3 top-1/2 -translate-y-1/2 flex-col items-center gap-2 opacity-40 select-none pointer-events-none"
        >
          <span className="text-3xl -rotate-12">🎋</span>
          <span className="w-1.5 h-44 rounded-full bg-gradient-to-b from-emerald-400/50 via-emerald-700/30 to-emerald-400/50" />
          <span className="text-2xl">🐼</span>
        </div>
        {/* 右缘：爪印脚印（往画面外走） */}
        <div
          aria-hidden
          className="hidden lg:flex absolute right-4 bottom-8 flex-col gap-4 opacity-25 text-lg rotate-12 select-none pointer-events-none"
        >
          <span>🐾</span>
          <span className="ml-4">🐾</span>
          <span>🐾</span>
          <span className="ml-2">🐾</span>
        </div>

        {/* 居中主内容 */}
        <div className="relative z-10 mx-auto flex w-full max-w-2xl flex-col items-center gap-5 py-10 text-center">
          {/* 头像（直播中戴 LIVE 徽标，点击前往B站主页） */}
          <a
            href={SPACE_URL}
            target="_blank"
            rel="noreferrer"
            title="前往B站主页"
            className="group relative block animate-floaty"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/garb/cover.jpg"
              alt="李豆沙"
              className="h-28 w-28 rounded-full object-cover shadow-2xl ring-4 ring-white/20 transition group-hover:scale-105 group-hover:ring-brand-300/60 md:h-36 md:w-36"
            />
            {live.liveStatus === 1 && (
              <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-full bg-red-500 px-2.5 py-0.5 text-xs font-semibold text-white shadow-lg">
                LIVE
              </span>
            )}
          </a>

          {/* 名字 + 粉丝牌 */}
          <div>
            <h1 className="text-5xl font-bold tracking-wide text-white md:text-6xl">
              {hero.name}
            </h1>
            <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-1.5 text-sm text-emerald-100">
              {hero.badges.map((b, i) => (
                <span key={`${b}-${i}`} className="flex items-center gap-2">
                  {i > 0 && <span className="text-white/30">|</span>}
                  <span>{b}</span>
                </span>
              ))}
            </div>
          </div>

          {/* 一句话人设（后台语录库随机，库空回退默认句） */}
          <p className="text-lg leading-relaxed text-white/75 md:text-xl">
            「{quote ?? hero.defaultQuote}」
          </p>

          {/* 大数字：已投喂竹子（关注数） + 已核对唱歌次数 */}
          <div className="mt-1 flex items-end justify-center gap-8 md:gap-12">
            <div>
              <div className="text-5xl font-extrabold tracking-wide text-amber-300 tabular-nums drop-shadow-lg md:text-7xl">
                {follower.follower == null ? (
                  '—'
                ) : (
                  <CountUp value={follower.follower} />
                )}
              </div>
              <div className="mt-1 text-sm text-white/50">已投喂竹子（根）</div>
            </div>
            <div>
              <div className="text-5xl font-extrabold tracking-wide text-rose-300 tabular-nums drop-shadow-lg md:text-7xl">
                <CountUp value={verifiedSongs} />
              </div>
              <div className="mt-1 text-sm text-white/50">已核对唱过的歌（次）</div>
              <div className="mt-2">
                <Link
                  href="/song-freq"
                  className="rounded-full border border-white/15 bg-white/10 px-4 py-1 text-xs text-white/75 backdrop-blur-md transition hover:bg-white/20"
                >
                  📊 唱歌频率统计
                </Link>
              </div>
            </div>
          </div>

          {/* 开播状态一行 */}
          <div className="flex items-center justify-center gap-2 text-base">
            {live.liveStatus === 1 ? (
              <>
                <span className="relative flex h-3 w-3 shrink-0">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75 animate-ping" />
                  <span className="relative inline-flex h-3 w-3 rounded-full bg-red-500" />
                </span>
                <span className="font-medium text-red-300">正在直播</span>
                {live.title && (
                  <span className="max-w-xs truncate text-white/60">{live.title}</span>
                )}
              </>
            ) : (
              <>
                <span className="inline-block h-3 w-3 shrink-0 rounded-full bg-white/40" />
                <span className="text-white/50">当前熊猫正在睡觉</span>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/garb/emojis/安眠.png"
                  alt="睡觉"
                  className="inline-block h-6 w-6 object-contain align-bottom"
                />
              </>
            )}
          </div>

          {/* 按钮排（主 CTA 高对比 + 次级玻璃胶囊） */}
          <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
            <a
              href={LIVE_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-full bg-brand-500 px-7 py-3 text-base font-semibold text-white shadow-lg shadow-brand-500/30 transition hover:scale-[1.03] hover:bg-brand-400"
            >
              🔴 进入直播间
            </a>
            <Link
              href="/wardrobe"
              className="rounded-full border border-white/15 bg-white/10 px-6 py-3 text-base text-white/85 backdrop-blur-md transition hover:bg-white/20"
            >
              🧩 熊猫衣柜
            </Link>
            <Link
              href="/tracks"
              className="rounded-full border border-white/15 bg-white/10 px-6 py-3 text-base text-white/85 backdrop-blur-md transition hover:bg-white/20"
            >
              🐾 熊猫活动轨迹
            </Link>
            <a
              href="https://lidousha.top"
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-white/15 bg-white/10 px-6 py-3 text-base text-white/85 backdrop-blur-md transition hover:bg-white/20"
            >
              🎵 歌单
            </a>
            <a
              href="https://lu-91015.github.io/shadowlee.github.io/"
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-white/15 bg-white/10 px-6 py-3 text-base text-white/85 backdrop-blur-md transition hover:bg-white/20"
            >
              🟫 沙按钮
            </a>
          </div>
        </div>
      </section>

      {/* 第二幕：豆漫墙 —— B站话题 #大熊猫豆漫# 内容散落钉卡墙 */}
      <section
        id="screen-profile"
        className="no-scrollbar flex h-full snap-start snap-always items-center justify-center px-3 py-4 md:px-6 md:py-6"
      >
        <TopicWall posts={topicPosts} />
      </section>
    </>
  );
}

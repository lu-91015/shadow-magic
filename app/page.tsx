import Link from 'next/link';
import ProfileCard from '@/components/ProfileCard';
import GarbBackdrop from '@/components/GarbBackdrop';
import { LIVE_URL } from '@/lib/constants';
import ScreenNav from '@/components/ScreenNav';
import CornerDock from '@/components/CornerDock';
import PandaClips from '@/components/PandaClips';
import CountUp from '@/components/CountUp';
import { getLiveStatus, getFollowerStats } from '@/lib/bilibili';
import { readDynamics } from '@/lib/dynamics';
import { queryClips, queryLatestLiveSession } from '@/lib/db';

function fmtDate(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

type PortalVariant = 'tile' | 'bamboo' | 'scroll' | 'hang';

interface Portal {
  href: string;
  label: string;
  desc: string;
  icon: string;
  external?: boolean;
  variant: PortalVariant;
  emoji?: string;
}

const PORTALS: Portal[] = [
  { href: '/wardrobe', label: '熊猫衣柜', desc: '', icon: '🧩', external: false, variant: 'bamboo', emoji: '只是熊猫.png' },
  { href: 'https://www.lidousha.top/', label: '歌单', desc: '', icon: '🎵', external: true, variant: 'bamboo', emoji: '真正的音乐.png' },
  { href: 'https://lu-91015.github.io/shadowlee.github.io/', label: '沙按钮', desc: '', icon: '🟫', external: true, variant: 'bamboo', emoji: '只是熊猫.png' },
];

// 入口造型组件：四个入口各一种实体小物件造型（熊猫/竹子主题），
// 仿参考站的「路标木牌 / 链条吊牌」手作感——每块倾斜角度、材质、配色都不同。
function PortalCard({ p, size = 'sm' }: { p: Portal; size?: 'sm' | 'lg' }) {
  const labelCls =
    size === 'lg' ? 'text-3xl font-bold' : 'text-sm font-medium';
  const descCls = size === 'lg' ? 'text-lg' : 'text-[11px]';
  // 大号（右栏 / 更多入口）用更大的内边距，整体放大
  const padAll = size === 'lg' ? 'p-10' : 'p-3.5';
  const padX2 = size === 'lg' ? 'px-10 py-10' : 'px-3.5 py-3';
  const bambooPad = size === 'lg' ? 'pl-14 pr-10 py-10' : 'pl-6 pr-3 py-3';

  const body = (() => {
    switch (p.variant) {
      // 切片墙：马赛克胶片砖（琥珀色瓷砖，微微倾斜）
      case 'tile':
        return (
          <div className={`rounded-xl border border-amber-300/40 bg-amber-400/15 ${padAll} -rotate-2 group-hover:rotate-0 group-hover:bg-amber-400/25 transition`}>
            <div className="grid grid-cols-2 gap-1.5 w-fit mb-3">
              <span className="w-6 h-6 rounded-[5px] bg-amber-300/80" />
              <span className="w-6 h-6 rounded-[5px] bg-amber-300/30" />
              <span className="w-6 h-6 rounded-[5px] bg-amber-300/30" />
              <span className="w-6 h-6 rounded-[5px] bg-amber-300/80 flex items-center justify-center text-sm">
                {p.icon}
              </span>
            </div>
            <div className={labelCls + ' text-amber-100'}>{p.label}</div>
            <div className={descCls + ' text-amber-100/50 truncate'}>{p.desc}</div>
          </div>
        );
      // 歌单：竹筒（翠绿竹节，外链 ↗）
      case 'bamboo':
        return (
          <div className={`relative rounded-2xl border border-emerald-300/40 bg-gradient-to-b from-emerald-500/20 to-emerald-800/20 ${bambooPad} group-hover:from-emerald-400/30 transition`}>
            <span className="absolute left-2 top-2 bottom-2 w-1 rounded-full bg-emerald-300/40" />
            <span className="absolute left-1 top-1/3 w-2.5 h-1 rounded-full bg-emerald-200/50" />
            <span className="absolute left-1 top-2/3 w-2.5 h-1 rounded-full bg-emerald-200/50" />
            <div className={labelCls + ' text-emerald-50 flex items-center gap-1.5'}>
              <span>{p.icon}</span>
              {p.label}
              <span className="text-[10px] text-emerald-200/70">↗</span>
            </div>
            <div className={descCls + ' text-emerald-100/50 truncate'}>{p.desc}</div>
          </div>
        );
      // 动态日志：宣纸卷轴（浅纸色深字，像钉在墙上的白木牌）
      case 'scroll':
        return (
          <div className={`rounded-lg border border-white/50 bg-[#f3ead6]/90 ${padX2} rotate-[1.5deg] group-hover:rotate-0 transition shadow-sm`}>
            <div className={labelCls + ' text-stone-800 flex items-center gap-1.5'}>
              <span>{p.icon}</span>
              {p.label}
            </div>
            <div className={descCls + ' text-stone-500 truncate'}>{p.desc}</div>
          </div>
        );
      // 歌回歌单：麻绳悬挂竹牌（悬着、hover 轻摆）
      case 'hang':
        return (
          <div className="flex flex-col items-center origin-top group-hover:rotate-2 transition">
            <span className="w-px h-3 bg-white/30" />
            <div className={`w-full rounded-lg border border-lime-200/30 bg-lime-900/50 ${padX2} shadow-md`}>
              <div className={labelCls + ' text-lime-50 flex items-center gap-1.5'}>
                <span>{p.icon}</span>
                {p.label}
              </div>
              <div className={descCls + ' text-lime-100/50 truncate'}>{p.desc}</div>
            </div>
          </div>
        );
    }
  })();

  return p.external ? (
    <a href={p.href} target="_blank" rel="noopener noreferrer" className="relative block group cursor-pointer">
      {body}
      {p.emoji && (
        <span className="pointer-events-none absolute -top-20 left-1/2 -translate-x-1/2 hidden md:block opacity-0 group-hover:opacity-100 transition">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/garb/emojis/${p.emoji}`}
            alt={p.label}
            className="w-28 h-28 object-contain drop-shadow-[0_4px_10px_rgba(0,0,0,0.5)]"
          />
        </span>
      )}
    </a>
  ) : (
    <Link href={p.href} className="relative block group cursor-pointer">
      {body}
      {p.emoji && (
        <span className="pointer-events-none absolute -top-20 left-1/2 -translate-x-1/2 hidden md:block opacity-0 group-hover:opacity-100 transition">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/garb/emojis/${p.emoji}`}
            alt={p.label}
            className="w-28 h-28 object-contain drop-shadow-[0_4px_10px_rgba(0,0,0,0.5)]"
          />
        </span>
      )}
    </Link>
  );
}

export const dynamic = 'force-dynamic';

export default function Home() {
  return (
    <main className="h-[calc(100vh-3rem)] overflow-y-auto snap-y snap-mandatory scroll-smooth">
      <ScreenNav />
      <CornerDock />
      <HomeScreens />
    </main>
  );
}

async function HomeScreens() {
  const [live, follower, clips, dynamics, lastLive] =
    await Promise.all([
      getLiveStatus(),
      getFollowerStats(),
      queryClips(),
      readDynamics(),
      queryLatestLiveSession(),
    ]);

  // 最近一条：直播回放 / 动态 / 切片
  const lastDyn = dynamics?.items?.[0] ?? null;
  const lastClip = [...clips].sort((a, b) => b.pubdate - a.pubdate)[0] ?? null;

  // 动态正文回退链：自身文本 → 转发正文 → 视频标题（纯文本，避免空内容）
  const dynPlain =
    (lastDyn?.text && lastDyn.text.trim()) ||
    (lastDyn?.forward?.text && lastDyn.forward.text.trim()) ||
    lastDyn?.video?.title ||
    undefined;

  return (
    <>
      {/* 第一幕：首页 / 房间 */}
      <section
        id="screen-hero"
        className="relative h-full snap-start snap-always flex items-center justify-center px-4 overflow-y-auto md:overflow-hidden"
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
        <div className="relative w-full max-w-[min(94vw,2800px)] mx-auto flex flex-col md:flex-row md:items-stretch md:justify-between gap-6 py-6 pl-1 md:pl-1 xl:pl-1 pr-6 md:pr-10 xl:pr-14 md:h-full">
          {/* 左栏：欢迎牌 / 已投喂竹子+开播 / 三连，贴左铺排 */}
          <div className="flex flex-col justify-start w-full md:w-[22rem] lg:w-[30rem] xl:w-[34rem] shrink-0 order-2 md:order-1 gap-6 md:-translate-x-5 md:min-h-0 md:overflow-y-auto">
            {/* 左上：竹林入口竹牌（继续放大，钉在左上角） */}
            <div className="hidden md:flex items-center gap-5 self-start rounded-2xl border-2 border-emerald-300/50 bg-emerald-900/50 px-9 py-6 -rotate-2 shadow-lg">
              <span className="text-7xl">🎋</span>
              <span className="text-3xl font-bold text-emerald-100/90">欢迎来到豆沙船</span>
            </div>

            {/* 横向三连：最后的动态 / 直播 / 切片（从左到右，继续放大填充） */}
            <div className="grid grid-cols-3 gap-5">
              {/* 最后的动态 */}
              <a
                href={lastDyn ? `https://t.bilibili.com/${lastDyn.id}` : 'https://space.bilibili.com/1703797642/dynamic'}
                target="_blank"
                rel="noreferrer"
                className="glass !bg-ink-900/50 p-6 flex flex-col gap-3 group hover:bg-white/10 transition"
              >
                <div className="text-base text-white/40">动态</div>
                <div className="text-lg text-brand-50 line-clamp-6 break-words group-hover:text-brand-100 transition">
                  {dynPlain || '暂无'}
                </div>
                <div className="mt-auto text-sm text-white/40">
                  {lastDyn ? fmtDate(lastDyn.pubTime) : ''}
                </div>
              </a>
              {/* 直播 */}
              <a
                href={lastLive ? `https://www.bilibili.com/video/${lastLive.id}` : 'https://live.bilibili.com/22966160'}
                target="_blank"
                rel="noreferrer"
                className="glass !bg-ink-900/50 p-6 flex flex-col gap-3 group hover:bg-white/10 transition"
              >
                <div className="text-base text-white/40">直播</div>
                <div className="text-lg text-brand-50 line-clamp-6 group-hover:text-brand-100 transition">
                  {lastLive?.title || '暂无'}
                </div>
                <div className="mt-auto text-sm text-white/40">
                  {lastLive ? fmtDate(lastLive.start_time) : ''}
                </div>
              </a>
              {/* 切片 */}
              <a
                href={lastClip ? (lastClip.arcurl || `https://www.bilibili.com/video/${lastClip.bvid}`) : '#'}
                target="_blank"
                rel="noreferrer"
                className="glass !bg-ink-900/50 p-6 flex flex-col gap-3 group hover:bg-white/10 transition"
              >
                <div className="text-base text-white/40">切片</div>
                <div className="text-lg text-brand-50 line-clamp-6 group-hover:text-brand-100 transition">
                  {lastClip?.title || '暂无'}
                </div>
                <div className="mt-auto text-sm text-white/40">
                  {lastClip ? fmtDate(lastClip.pubdate) : ''}
                </div>
              </a>
            </div>

            {/* 已投喂竹子 + 开播状态（合并版面，置于三连下方，放大并左移） */}
            <div className="relative self-start -translate-x-2 rotate-1">
              <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-950/95 via-ink-900/95 to-emerald-900/70 ring-1 ring-emerald-300/30 shadow-xl px-9 py-10">
                {/* 主题装饰：星光 + 竹影 + 熊猫剪影 */}
                <div aria-hidden className="pointer-events-none absolute inset-0">
                  <span className="absolute right-6 top-4 text-xl text-emerald-100/70">✦</span>
                  <span className="absolute right-20 top-10 text-xs text-amber-200/60">✦</span>
                  <span className="absolute right-32 top-6 text-sm text-white/50">✧</span>
                  <span className="absolute left-8 bottom-6 text-sm text-emerald-100/50">✧</span>
                  <span className="absolute left-24 bottom-10 text-xs text-amber-200/50">✦</span>
                  <span className="absolute -right-4 -bottom-6 text-[7rem] leading-none opacity-10 select-none">
                    🐼
                  </span>
                  <span className="absolute -left-3 -top-4 text-8xl leading-none opacity-10 select-none">
                    🎋
                  </span>
                  <span className="absolute right-10 top-1/2 h-24 w-24 -translate-y-1/2 rounded-full bg-emerald-400/20 blur-3xl" />
                </div>

                <div className="relative rounded-xl border-2 border-dashed border-emerald-200/35 px-8 py-8">
                  {/* 竹子投喂 */}
                  <div className="text-xl font-medium text-white/90">已投喂竹子：</div>
                  <div className="mt-2 w-fit rounded-lg bg-white/90 px-6 py-2">
                    <span className="text-4xl font-extrabold text-amber-400 tabular-nums tracking-wide">
                      {follower.follower == null ? (
                        '—'
                      ) : (
                        <CountUp value={follower.follower} />
                      )}
                    </span>
                    <span className="ml-1 text-lg font-normal text-stone-400">根</span>
                  </div>

                  {/* 分隔线 */}
                  <div className="my-6 border-t border-dashed border-emerald-200/25" />

                  {/* 当前开播状态 */}
                  <div className="flex items-center gap-4">
                    <span className="relative flex h-4 w-4 shrink-0">
                      {live.liveStatus === 1 && (
                        <span className="absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75 animate-ping" />
                      )}
                      <span
                        className={`relative inline-flex h-4 w-4 rounded-full ${
                          live.liveStatus === 1 ? 'bg-red-500' : 'bg-white/40'
                        }`}
                      />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-base font-medium text-brand-200">
                        {live.liveStatus === 1 ? (
                          '正在直播'
                        ) : (
                          <>
                            当前熊猫正在睡觉
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src="/garb/emojis/安眠.png"
                              alt="睡觉"
                              className="ml-1 inline-block h-7 w-7 translate-y-1 object-contain align-bottom"
                            />
                          </>
                        )}
                      </div>
                      {live.liveStatus === 1 && live.title && (
                        <div className="truncate text-base text-brand-50">{live.title}</div>
                      )}
                      {live.liveStatus === 1 && live.online != null && (
                        <div className="text-sm text-white/50">
                          在线 {live.online.toLocaleString()} 人
                        </div>
                      )}
                    </div>
                    <a
                      href={LIVE_URL}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 rounded-full bg-brand-500 px-6 py-3 text-base font-medium text-white transition hover:bg-brand-400"
                    >
                      进入直播间
                    </a>
                  </div>
                </div>
              </div>
            </div>

            {/* 小李最新作品（带封面） */}
            <div className="glass !bg-ink-900/50 p-4 -rotate-1">
              <div className="mb-3 flex items-start gap-2">
                <span className="text-2xl shrink-0">🎮</span>
                <span className="flex-1 min-w-0 text-lg font-semibold text-brand-100 leading-snug break-words">
                  【原创百合游戏】百合厨女子的恋爱理论【互动视频】
                </span>
                <a
                  href="https://www.bilibili.com/video/BV1Z2bpznEag/?vd_source=abe79d9bc2a0f09663fdc98d07248b66"
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 text-sm text-white/40 transition hover:text-brand-100"
                >
                  前往观看 ›
                </a>
              </div>
              <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black/40">
                <iframe
                  src="https://player.bilibili.com/player.html?bvid=BV1Z2bpznEag&page=1&high_quality=1&danmaku=0&autoplay=0"
                  className="absolute inset-0 h-full w-full"
                  allowFullScreen
                  scrolling="no"
                  frameBorder={0}
                  title="小李最新作品"
                />
              </div>
            </div>

          </div>

          {/* 中栏：人物档案卡（仿推理社人物卡，独占中间） */}
          <div className="order-1 md:order-2 h-[52vh] md:h-[82vh] flex-1 min-w-0 flex items-center justify-center">
            <ProfileCard />
          </div>

          {/* 右栏：上装饰 + 四个入口 + 下装饰，全部直接参与纵向均布铺满 */}
          <nav className="order-3 hidden md:flex flex-col justify-between items-end w-[24rem] lg:w-[28rem] xl:w-[30rem] shrink-0 md:min-h-0 md:overflow-y-auto">
            {/* 右上：竹枝装饰 */}
            <div aria-hidden className="text-2xl -rotate-12 opacity-50 select-none self-start pl-2">🎋</div>
            {PORTALS.map((p, i) => (
              <div
                key={p.href}
                className={
                  'w-80 lg:w-96 ' +
                  [
                    'md:-translate-x-3',
                    'md:translate-x-5',
                    'md:-translate-x-6',
                    'md:translate-x-2',
                  ][i]
                }
              >
                <PortalCard p={p} size="lg" />
              </div>
            ))}
            {/* 右下：爪印装饰 */}
            <div aria-hidden className="flex flex-col gap-1 text-base opacity-30 rotate-12 select-none">
              <span>🐾</span>
              <span className="ml-3">🐾</span>
            </div>
          </nav>
        </div>
      </section>

      {/* 第二幕：切片墙 · 全站投稿 */}
      <section
        id="screen-clips"
        className="relative h-full snap-start snap-always flex items-start justify-center px-4 overflow-y-auto"
      >
        <PandaClips clips={clips} />
      </section>

      {/* 第三幕：更多入口 */}
      <section
        id="screen-portal"
        className="h-full snap-start snap-always flex items-center justify-center px-4 overflow-y-auto"
      >
        <div className="w-full max-w-5xl py-10">
          <h2 className="text-2xl font-semibold text-brand-200 mb-6">更多入口</h2>
          <div className="grid sm:grid-cols-2 gap-8">
            {PORTALS.map((p) => (
              <PortalCard key={p.href} p={p} size="lg" />
            ))}
          </div>
          <footer className="mt-10 pt-6 border-t border-white/10 text-center text-xs text-white/40">
            非官方二创资料站 · 数据来自哔哩哔哩公开接口 · 立绘版权归原作者所有
          </footer>
        </div>
      </section>
    </>
  );
}

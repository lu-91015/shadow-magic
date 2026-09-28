// 网站通知 / 升级公告（新增公告直接在此追加即可）
const NEWS: { date: string; tag: string; title: string; body: string }[] = [
  {
    date: '2026-09-26',
    tag: '功能',
    title: '首页右下角新增快捷入口',
    body: '新增「商店 / 素材 / 通知」三个快捷按钮：商店汇集官方装扮与周边，素材库收录立绘与装扮图片，本页用于发布网站升级公告。',
  },
  {
    date: '2026-09-26',
    tag: '改版',
    title: '首页切片熊猫墙上线',
    body: '原「全站投稿统计」与切片墙合并：切片缩略图拼成熊猫造型，切片man 统计移至侧栏，支持点击与随机抽选高亮。同时移除年度明细与直播时长统计两个分屏。',
  },
  {
    date: '2026-09-26',
    tag: '数据',
    title: '歌单模块改为外站直达',
    body: '歌单入口现在直接跳转至 lidousha.top 歌单站；首页新增实时粉丝数展示。',
  },
];

const TAG_COLOR: Record<string, string> = {
  功能: 'bg-brand-500/20 text-brand-100',
  改版: 'bg-white/10 text-white/80',
  数据: 'bg-white/10 text-white/80',
};

export default function NewsPage() {
  return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-semibold text-brand-200 mb-2">通知</h1>
      <p className="text-white/60 text-sm mb-8">本网站的升级公告与说明。</p>

      <div className="space-y-4">
        {NEWS.map((n) => (
          <article key={n.title} className="glass !bg-ink-900/50 p-4">
            <div className="flex items-center gap-2 mb-1.5">
              <span
                className={`text-xs px-2 py-0.5 rounded-full ${
                  TAG_COLOR[n.tag] ?? 'bg-white/10 text-white/70'
                }`}
              >
                {n.tag}
              </span>
              <h2 className="font-medium text-brand-50">{n.title}</h2>
              <time className="ml-auto text-xs text-white/40 shrink-0">
                {n.date}
              </time>
            </div>
            <p className="text-sm text-white/60 leading-relaxed">{n.body}</p>
          </article>
        ))}
      </div>

      <div className="mt-8">
        <a href="/" className="text-sm text-white/50 hover:text-brand-100 transition">
          ‹ 返回首页
        </a>
      </div>
    </main>
  );
}

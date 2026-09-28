import { readDynamics, groupDynamicsByDay } from '@/lib/dynamics';
import DynamicsJournal from '@/components/DynamicsJournal';
import { SPACE_URL } from '@/lib/constants';

export const dynamic = 'force-dynamic';

export default async function DynamicsPage() {
  const data = await readDynamics();
  const days = data.items.length ? groupDynamicsByDay(data.items) : [];

  return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-brand-200">豆沙动态日志</h1>
        <a
          href={SPACE_URL}
          target="_blank"
          rel="noreferrer"
          className="text-sm text-white/60 hover:text-brand-200"
        >
          原空间 ›
        </a>
      </div>

      {days.length === 0 ? (
        <div className="glass p-6 text-white/50 text-sm leading-relaxed">
          尚未抓取动态数据。
          <br />
          1. 从浏览器登录 B站后，按 F12 → Application → Cookies →
          <code> SESSDATA</code>，复制其值。
          <br />
          2. 运行：<code>BILI_SESSDATA=你的SESSDATA npm run sync</code>
          <br />
          （建议用 Cookie 而非明文密码；SESSDATA 仅存于你自己的环境变量，不要提交到仓库。）
        </div>
      ) : (
        <DynamicsJournal days={days} />
      )}
    </main>
  );
}

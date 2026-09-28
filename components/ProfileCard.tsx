/* 人物档案卡：仿「推理社」人物卡版式（纸卡 + 深色证件卡 + 手写档案）。
   资料来源：萌娘百科「李豆沙」公开设定。 */

const FIELDS: [string, string][] = [
  ['种族', '熊猫'],
  ['身高', '165cm'],
  ['生日', '8月7日'],
  ['粉丝牌', 'Kimo熊'],
  ['所属', 'P-SP'],
  ['出道', '2021年4月4日'],
  ['tag', '#大熊猫豆漫#'],
];

export default function ProfileCard() {
  return (
    <div className="relative w-[30rem] lg:w-[36rem] max-w-full -rotate-1">
      {/* 背后文件夹 */}
      <div
        aria-hidden
        className="absolute inset-0 translate-x-4 translate-y-5 rotate-2 rounded-lg bg-emerald-700/80 shadow-2xl"
      />

      {/* 纸卡本体 */}
      <div className="relative overflow-hidden rounded-lg bg-[#f6f2e7] text-stone-800 shadow-2xl">
        {/* 竖条纹纸纹 */}
        <div
          aria-hidden
          className="absolute inset-0 opacity-40 [background:repeating-linear-gradient(90deg,transparent_0_26px,rgba(120,100,80,0.12)_26px_28px)]"
        />

        <div className="relative p-14">
          {/* 头部：手写体名 + 社名 + 红色批注 */}
          <div className="flex items-start justify-between border-b-2 border-stone-700/70 pb-4">
            <div className="font-serif text-5xl italic leading-none text-stone-700">
              Dousha
              <div className="mt-1 text-xs not-italic tracking-[0.3em] text-stone-500">
                PANDA GIRL
              </div>
            </div>
            <div className="relative pr-8">
              <div className="text-5xl font-bold tracking-[0.3em] text-stone-700">
                熊猫社
              </div>
              <div className="absolute -right-1 -top-3 rotate-6 whitespace-nowrap text-[11px] font-semibold text-red-500">
                パンダ少女日々進化中！
              </div>
            </div>
          </div>

          {/* 深色证件卡 */}
          <div className="relative mt-12 rounded-xl bg-[#3a4256] p-8 text-white shadow-lg">
            {/* 打孔 */}
            <span
              aria-hidden
              className="absolute right-5 top-5 h-5 w-5 rounded-full bg-[#f6f2e7]"
            />
            <div className="font-serif text-base italic text-white/80">
              Dousha Panda Club
            </div>
            <div className="mt-5 flex items-center gap-6">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/garb/cover.jpg"
                alt="李豆沙"
                className="h-28 w-28 shrink-0 rounded-full object-cover ring-2 ring-white/60"
              />
              <p className="text-xl font-bold leading-relaxed">
                「過去の罪を償うためここにいる、大切な人を守るためここにいる。」
              </p>
            </div>
            <div className="mt-5 font-mono text-2xl tracking-wider text-white/90">
              ID：1703797642
            </div>
          </div>

          {/* 自我介绍 */}
          <p className="mt-10 text-lg leading-relaxed text-stone-700">
            你们好，我是一只为了寻找失散伙伴而成为VUP的熊猫少女！请多多指教。
          </p>

          {/* 档案字段 */}
          <dl className="mt-10 space-y-2 text-lg">
            {FIELDS.map(([k, v]) => (
              <div key={k} className="flex gap-2">
                <dt className="w-24 shrink-0 text-stone-500">{k}：</dt>
                <dd className="font-medium text-stone-800">{v}</dd>
              </div>
            ))}
          </dl>

          {/* 底部备注 */}
          <div className="mt-10 border-t-2 border-stone-700/70 pt-2 text-base text-stone-500">
            直播与动态情报详见{' '}
            <a
              href="https://space.bilibili.com/1703797642/dynamic"
              target="_blank"
              rel="noreferrer"
              className="text-emerald-700 underline"
            >
              动态
            </a>{' '}
            /{' '}
            <a
              href="https://live.bilibili.com/22966160"
              target="_blank"
              rel="noreferrer"
              className="text-emerald-700 underline"
            >
              直播间
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

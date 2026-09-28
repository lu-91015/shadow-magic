import Link from 'next/link';
import type { DynItem } from '@/lib/bilibili';

function fmt(n: string | number): string {
  const v = Number(n) || 0;
  return v >= 10000 ? (v / 10000).toFixed(1) + ' 万' : v.toLocaleString();
}

export default function DynCard({
  d,
  link = true,
}: {
  d: DynItem;
  link?: boolean;
}) {
  const commentOid = d.commentId ?? d.id;
  return (
    <article className="glass p-5">
      <div className="flex items-center gap-3 mb-3">
        {/* 头像来自 B站，域名不固定，用原生 img 避免远程域名配置 */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={d.face}
          alt={d.name}
          className="w-10 h-10 rounded-full object-cover bg-white/10"
          loading="lazy"
        />
        <div>
          <div className="text-brand-100 font-medium">{d.name}</div>
          <div className="text-xs text-white/40">{d.timeText || d.pubTime}</div>
        </div>
      </div>

      {d.textHtml ? (
        <div
          className="text-brand-50 whitespace-pre-wrap leading-relaxed break-words"
          dangerouslySetInnerHTML={{ __html: d.textHtml }}
        />
      ) : (
        d.text && (
          <p className="text-brand-50 whitespace-pre-wrap leading-relaxed">
            {d.text}
          </p>
        )
      )}

      {d.images.length > 0 && (
        <div
          className="mt-3 grid gap-2"
          style={{
            gridTemplateColumns: `repeat(${Math.min(d.images.length, 3)}, minmax(0,1fr))`,
          }}
        >
          {d.images.map((src, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={i}
              src={src}
              alt=""
              className="rounded-lg object-cover w-full h-40 bg-white/5"
              loading="lazy"
            />
          ))}
        </div>
      )}

      {d.video && (
        <a
          href={
            d.video.bvid.startsWith('live/')
              ? `https://live.bilibili.com/${d.video.bvid.slice(5)}`
              : `https://www.bilibili.com/video/${d.video.bvid}`
          }
          target="_blank"
          rel="noreferrer"
          className="mt-3 flex gap-3 items-center glass !rounded-xl p-3 hover:bg-white/10 transition"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={d.video.cover}
            alt=""
            className="w-28 h-16 rounded object-cover bg-white/5"
            loading="lazy"
          />
          <span className="text-brand-50 text-sm line-clamp-2">{d.video.title}</span>
        </a>
      )}

      {d.forward && (
        <div className="mt-3 pl-3 border-l-2 border-white/15 text-white/70">
          <div className="text-xs text-brand-200 mb-1">转发自 {d.forward.name}</div>
          {d.forward.textHtml ? (
            <div
              className="whitespace-pre-wrap text-sm break-words"
              dangerouslySetInnerHTML={{ __html: d.forward.textHtml }}
            />
          ) : (
            d.forward.text && (
              <p className="whitespace-pre-wrap text-sm">{d.forward.text}</p>
            )
          )}
          {d.forward.images.length > 0 && (
            <div className="mt-2 grid grid-cols-3 gap-2">
              {d.forward.images.map((src, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={i}
                  src={src}
                  alt=""
                  className="rounded object-cover w-full h-24 bg-white/5"
                  loading="lazy"
                />
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mt-3 flex items-center gap-4 text-xs text-white/50">
        <span>👍 {fmt(d.stat.like)}</span>
        <span>🔁 {fmt(d.stat.forward)}</span>
        <span>💬 {fmt(d.stat.comment)}</span>
        {link && (
          <Link
            href={`/dynamic/${d.id}`}
            className="ml-auto text-brand-300 hover:text-brand-100"
          >
            详情 / 评论 ›
          </Link>
        )}
      </div>
    </article>
  );
}

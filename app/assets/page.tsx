import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

function listImages(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => /\.(png|jpe?g|webp|gif)$/i.test(f))
      .sort();
  } catch {
    return [];
  }
}

function Gallery({ files, base }: { files: string[]; base: string }) {
  if (files.length === 0) {
    return <div className="text-sm text-white/40">暂无素材。</div>;
  }
  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
      {files.map((f) => (
        <a
          key={f}
          href={`${base}/${f}`}
          target="_blank"
          rel="noreferrer"
          title={f}
          className="glass !bg-ink-900/50 aspect-square rounded-lg overflow-hidden hover:bg-white/10 transition group"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`${base}/${f}`}
            alt={f}
            loading="lazy"
            className="w-full h-full object-contain p-1 transition group-hover:scale-105"
          />
        </a>
      ))}
    </div>
  );
}

export default function AssetsPage() {
  const pub = path.join(process.cwd(), 'public');
  const raw = listImages(path.join(pub, 'characters'));
  const cut = listImages(path.join(pub, 'characters', 'cut'));
  const garb = listImages(path.join(pub, 'garb'));
  const emojis = listImages(path.join(pub, 'garb', 'emojis'));

  return (
    <main className="max-w-6xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-semibold text-brand-200 mb-2">素材库</h1>
      <p className="text-white/60 text-sm mb-8">
        李豆沙的各类图片素材，点击查看原图。
      </p>

      <section className="mb-10">
        <h2 className="text-lg font-semibold text-brand-200 mb-4">立绘（抠图）</h2>
        <Gallery files={cut} base="/characters/cut" />
      </section>

      <section className="mb-10">
        <h2 className="text-lg font-semibold text-brand-200 mb-4">立绘（原图）</h2>
        <Gallery files={raw} base="/characters" />
      </section>

      <section className="mb-10">
        <h2 className="text-lg font-semibold text-brand-200 mb-4">装扮素材</h2>
        <Gallery files={garb} base="/garb" />
      </section>

      <section className="mb-4">
        <h2 className="text-lg font-semibold text-brand-200 mb-4">装扮表情包</h2>
        <Gallery files={emojis} base="/garb/emojis" />
      </section>

      <div className="mt-8">
        <a href="/" className="text-sm text-white/50 hover:text-brand-100 transition">
          ‹ 返回首页
        </a>
      </div>
    </main>
  );
}

import type { Metadata } from 'next';
import { SITE_TITLE, SITE_DESC } from '@/lib/constants';
import SiteNav from '@/components/SiteNav';
import Mascot from '@/components/Mascot';
import './globals.css';

export const metadata: Metadata = {
  title: `${SITE_TITLE} · 资料站`,
  description: SITE_DESC,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <head>
        {/* 提前下载 3D 模型，避免等 JS  hydrate 完成才开始拉取 */}
        <link rel="preload" as="fetch" href="/models/lidousha.pmx" />
      </head>
      <body>
        <SiteNav />
        <div className="pt-12">{children}</div>
        <Mascot />
      </body>
    </html>
  );
}

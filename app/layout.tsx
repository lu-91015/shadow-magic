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
      <body>
        <SiteNav />
        <div className="pt-12">{children}</div>
        <Mascot />
      </body>
    </html>
  );
}

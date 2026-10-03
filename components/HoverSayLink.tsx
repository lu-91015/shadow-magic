'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

// hover 时让左下角小人说一句话（按后台「小人台词」里的 hover 场景触发）
export default function HoverSayLink({
  href,
  className,
  scene,
  children,
}: {
  href: string;
  className?: string;
  scene: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={className}
      onMouseEnter={() => window.dispatchEvent(new CustomEvent('mascot:sayScene', { detail: scene }))}
    >
      {children}
    </Link>
  );
}

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { readDynamics } from '@/lib/dynamics';
import {
  queryComments,
  queryCommenterStats,
  getCommentCount,
} from '@/lib/db';
import DynCard from '@/components/DynCard';
import DynamicComments from '@/components/DynamicComments';
import { SPACE_URL } from '@/lib/constants';

export const dynamic = 'force-dynamic';

export default async function DynamicDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const id = params.id;
  const data = await readDynamics();
  const item = data.items.find((d) => d.id === id);
  if (!item) notFound();

  const oid = item.commentId ?? item.id;
  const type = item.commentType ?? 11;
  const comments = await queryComments({ oid, limit: 200 });
  const count = await getCommentCount(oid);
  const stats = await queryCommenterStats(oid);

  return (
    <main className="max-w-4xl mx-auto px-4 py-8" style={{ zoom: 1.25 }}>
      <header className="flex items-center justify-between mb-6">
        <Link href="/dynamics" className="text-sm text-white/60 hover:text-brand-200">
          ‹ 动态日志
        </Link>
        <div className="text-xl font-semibold text-brand-200">动态详情</div>
        <a
          href={SPACE_URL}
          target="_blank"
          rel="noreferrer"
          className="text-sm text-white/60 hover:text-brand-200"
        >
          原空间 ›
        </a>
      </header>

      <DynCard d={item} link={false} />

      <DynamicComments
        oid={oid}
        type={type}
        initialComments={comments}
        initialCount={count}
        initialStats={stats}
      />
    </main>
  );
}

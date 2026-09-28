import { queryCommenterStats, queryCommentDynamics, getCommentCount } from '@/lib/db';
import CommentsExplorer from '@/components/CommentsExplorer';

export const dynamic = 'force-dynamic';

export default async function CommentsPage({
  searchParams,
}: {
  searchParams: { oid?: string };
}) {
  const stats = await queryCommenterStats();
  const dynamics = await queryCommentDynamics();
  const total = await getCommentCount();
  return (
    <main className="max-w-5xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-semibold text-brand-200 mb-2">动态评论分析</h1>
      <p className="text-white/60 text-sm mb-6">
        共 {total} 条评论，覆盖 {dynamics.length} 条动态。数据来自 B站评论接口，原始请求已入库。
      </p>

      <CommentsExplorer
        initialStats={stats}
        initialDynamics={dynamics}
        initialOid={searchParams.oid}
      />
    </main>
  );
}

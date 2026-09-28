import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { cancelRun } from '@/lib/jobs';
import { getPool, ensureReady } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 取消一个运行中的任务：
//  1) 设置内存取消标志（对仍在当前进程内循环的任务，下一次循环检测即停止）；
//  2) 若运行记录仍标记为 running（例如服务重启后残留的孤儿任务），直接置为已取消。
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!(await requireAdmin(req)))
    return NextResponse.json({ ok: false }, { status: 401 });
  const id = Number(params.id);
  if (!Number.isFinite(id))
    return NextResponse.json({ ok: false, error: '无效 id' }, { status: 400 });
  try {
    cancelRun(id);
    await ensureReady();
    await getPool().query(
      `UPDATE job_run SET status='cancelled', error=NULL, log=COALESCE(log,'')||'已取消\n', finished_at=$2 WHERE id=$1 AND status='running'`,
      [id, Date.now()],
    );
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? '取消失败' },
      { status: 500 },
    );
  }
}

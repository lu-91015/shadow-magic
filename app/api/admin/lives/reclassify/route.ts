import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getClientIp, requireView } from '@/lib/auth';
import { queryLiveReplays, updateLiveSessionMeta, insertAudit } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 预览当前自动归类结果（不落库）
export async function GET(req: Request) {
  if (!(await requireView(req)))
    return NextResponse.json({ ok: false }, { status: 401 });
  const list = await queryLiveReplays();
  const summary: Record<string, number> = {};
  for (const r of list) {
    summary[r.category] = (summary[r.category] ?? 0) + 1;
  }
  return NextResponse.json({
    ok: true,
    total: list.length,
    summary,
    samples: list.slice(0, 12).map((r) => ({
      id: r.id,
      title: r.title,
      auto: r.autoCategory,
      manual: r.categoryManual,
    })),
  });
}

// 把自动归类结果写入人工标记
// overwrite=false（默认）：只填补尚无人工标记的场次；overwrite=true：全部覆盖重写
export async function POST(req: NextRequest) {
  if (!(await requireAdmin(req)))
    return NextResponse.json({ ok: false }, { status: 401 });
  const body = await req.json().catch(() => ({}) as any);
  const overwrite = !!body.overwrite;
  const list = await queryLiveReplays();
  let changed = 0;
  const summary: Record<string, number> = {};
  for (const r of list) {
    if (!overwrite && r.categoryManual) continue;
    await updateLiveSessionMeta(r.id, { categoryManual: r.autoCategory });
    changed++;
    summary[r.autoCategory] = (summary[r.autoCategory] ?? 0) + 1;
  }
  await insertAudit(
    'live_reclassify',
    '-',
    { changed, total: list.length, overwrite },
    getClientIp(req),
  );
  return NextResponse.json({ ok: true, changed, total: list.length, summary });
}

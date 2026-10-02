import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getClientIp, requireView } from '@/lib/auth';
import {
  queryMascotLines,
  insertMascotLine,
  updateMascotLine,
  insertAudit,
} from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const MMD = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

// 校验并规范化时间/日期条件
function normCond(body: any) {
  const timeStart = String(body?.timeStart ?? '').trim() || null;
  const timeEnd = String(body?.timeEnd ?? '').trim() || null;
  if ((timeStart && !HHMM.test(timeStart)) || (timeEnd && !HHMM.test(timeEnd)))
    return { error: '时间格式应为 HH:MM' } as const;
  const dates = String(body?.dates ?? '')
    .replace(/，/g, ',')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const d of dates) {
    if (!MMD.test(d)) return { error: `日期格式应为 MM-DD：${d}` } as const;
  }
  return {
    timeStart,
    timeEnd,
    dates: dates.length ? dates.join(',') : null,
    onlyLive: !!body?.onlyLive,
    weight: Math.max(1, Math.min(100, Number(body?.weight) || 1)),
  } as const;
}

export async function GET(req: Request) {
  if (!(await requireView(req)))
    return NextResponse.json({ ok: false }, { status: 401 });
  const list = await queryMascotLines();
  return NextResponse.json({ ok: true, list });
}

export async function POST(req: NextRequest) {
  if (!(await requireAdmin(req)))
    return NextResponse.json({ ok: false }, { status: 401 });
  const body = await req.json().catch(() => null);
  const text = String(body?.text ?? '').trim();
  if (!text)
    return NextResponse.json({ ok: false, error: '台词不能为空' }, { status: 400 });
  const cond = normCond(body);
  if ('error' in cond)
    return NextResponse.json({ ok: false, error: cond.error }, { status: 400 });
  const id = await insertMascotLine({ text, ...cond });
  await insertAudit('mascot_add', String(id), { text, ...cond }, getClientIp(req));
  return NextResponse.json({ ok: true, id });
}

export async function PUT(req: NextRequest) {
  if (!(await requireAdmin(req)))
    return NextResponse.json({ ok: false }, { status: 401 });
  const body = await req.json().catch(() => null);
  const id = Number(body?.id);
  if (!id) return NextResponse.json({ ok: false, error: '缺少 id' }, { status: 400 });
  const patch: Parameters<typeof updateMascotLine>[1] = {};
  if (body.text != null) {
    const t = String(body.text).trim();
    if (!t)
      return NextResponse.json({ ok: false, error: '台词不能为空' }, { status: 400 });
    patch.text = t;
  }
  if (body.weight != null) patch.weight = Math.max(1, Math.min(100, Number(body.weight) || 1));
  if (
    body.timeStart !== undefined ||
    body.timeEnd !== undefined ||
    body.dates !== undefined ||
    body.onlyLive !== undefined
  ) {
    const cur = (await queryMascotLines()).find((l) => l.id === id);
    const cond = normCond({
      timeStart: body.timeStart ?? cur?.time_start ?? '',
      timeEnd: body.timeEnd ?? cur?.time_end ?? '',
      dates: body.dates ?? cur?.dates ?? '',
      onlyLive: body.onlyLive ?? cur?.only_live ?? false,
      weight: body.weight ?? cur?.weight ?? 1,
    });
    if ('error' in cond)
      return NextResponse.json({ ok: false, error: cond.error }, { status: 400 });
    patch.time_start = cond.timeStart;
    patch.time_end = cond.timeEnd;
    patch.dates = cond.dates;
    patch.only_live = cond.onlyLive;
    if (body.weight != null) patch.weight = cond.weight;
  }
  if (body.enabled !== undefined) patch.enabled = !!body.enabled;
  await updateMascotLine(id, patch);
  await insertAudit('mascot_update', String(id), patch, getClientIp(req));
  return NextResponse.json({ ok: true });
}

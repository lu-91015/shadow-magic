import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getClientIp } from '@/lib/auth';
import { deleteMascotLine, insertAudit } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!(await requireAdmin(req)))
    return NextResponse.json({ ok: false }, { status: 401 });
  const id = Number(params.id);
  if (!id) return NextResponse.json({ ok: false, error: '缺少 id' }, { status: 400 });
  await deleteMascotLine(id);
  await insertAudit('mascot_delete', String(id), {}, getClientIp(req));
  return NextResponse.json({ ok: true });
}

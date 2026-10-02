import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { requireAdmin, getClientIp } from '@/lib/auth';
import { deleteShopItem, insertAudit } from '@/lib/db';

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
  const cover = await deleteShopItem(id);
  if (cover) {
    try {
      const fp = path.join(process.cwd(), 'public', cover);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    } catch {
      /* ignore */
    }
  }
  await insertAudit('shop_delete', String(id), { cover }, getClientIp(req));
  return NextResponse.json({ ok: true });
}

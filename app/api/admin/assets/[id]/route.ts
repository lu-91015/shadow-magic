import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { requireAdmin, getClientIp } from '@/lib/auth';
import { deleteAsset, insertAudit } from '@/lib/db';

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
  // 仅上传到 /uploads/assets/ 的文件会从磁盘删除；播种的历史素材只移出素材库
  const local = await deleteAsset(id);
  if (local) {
    try {
      const fp = path.join(process.cwd(), 'public', local);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    } catch {
      /* ignore */
    }
  }
  await insertAudit('asset_delete', String(id), { file: local }, getClientIp(req));
  return NextResponse.json({ ok: true });
}

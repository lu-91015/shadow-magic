import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { requireAdmin, getClientIp } from '@/lib/auth';
import { deleteCharacter, queryCharacters, insertAudit } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DIR = path.join(process.cwd(), 'public', 'characters');

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!(await requireAdmin(req)))
    return NextResponse.json({ ok: false }, { status: 401 });
  const id = Number(params.id);
  const list = await queryCharacters();
  const row = list.find((c) => c.id === id);
  if (row) {
    const fp = path.join(DIR, path.basename(row.src));
    try {
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    } catch {
      /* ignore */
    }
  }
  await deleteCharacter(id);
  await insertAudit('char_delete', String(id), { src: row?.src }, getClientIp(req));
  return NextResponse.json({ ok: true });
}

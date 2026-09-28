import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getClientIp, requireView } from '@/lib/auth';
import { blockUp, unblockUp, getBlockedUps, insertAudit } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!(await requireView(req)))
    return NextResponse.json({ ok: false }, { status: 401 });
  const list = await getBlockedUps();
  return NextResponse.json({ ok: true, list });
}

export async function POST(req: NextRequest) {
  if (!(await requireAdmin(req)))
    return NextResponse.json({ ok: false }, { status: 401 });
  const { author, reason } = await req.json().catch(() => ({}) as any);
  const a = (author || '').trim();
  if (!a) return NextResponse.json({ ok: false, error: '缺少 author' }, { status: 400 });
  const removed = await blockUp(a, reason || null);
  await insertAudit('block_up', a, { reason: reason || null, removed }, getClientIp(req));
  return NextResponse.json({ ok: true, removed });
}

export async function DELETE(req: NextRequest) {
  if (!(await requireAdmin(req)))
    return NextResponse.json({ ok: false }, { status: 401 });
  const author = (req.nextUrl.searchParams.get('author') || '').trim();
  if (!author)
    return NextResponse.json({ ok: false, error: '缺少 author' }, { status: 400 });
  await unblockUp(author);
  await insertAudit('unblock_up', author, undefined, getClientIp(req));
  return NextResponse.json({ ok: true });
}

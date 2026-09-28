import { NextResponse } from 'next/server';
import { getRole } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const role = await getRole(req);
  if (!role) return NextResponse.json({ ok: false }, { status: 401 });
  return NextResponse.json({ ok: true, role });
}

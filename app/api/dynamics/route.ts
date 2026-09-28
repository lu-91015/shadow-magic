import { NextResponse } from 'next/server';
import { readDynamics } from '@/lib/dynamics';

export const dynamic = 'force-dynamic';

export async function GET() {
  const data = await readDynamics();
  if (!data || data.count === 0) {
    return NextResponse.json(
      { error: '尚未同步动态，请运行 npm run sync（需 BILI_SESSDATA）' },
      { status: 404 },
    );
  }
  return NextResponse.json(data);
}

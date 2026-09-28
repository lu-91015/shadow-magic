import { NextResponse } from 'next/server';
import { readYearly } from '@/lib/yearly';

export const dynamic = 'force-dynamic';

export async function GET() {
  const data = await readYearly();
  if (!data) {
    return NextResponse.json(
      { error: '尚未同步数据，请运行 npm run sync（需配置 DATABASE_URL）' },
      { status: 404 },
    );
  }
  return NextResponse.json(data);
}

import { NextResponse } from 'next/server';
import { queryCharacters } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 公开：返回后台上传的立绘（空则前端回退到静态资源）
export async function GET() {
  const list = await queryCharacters();
  return NextResponse.json({ list });
}

import { NextResponse } from 'next/server';
import { queryCharacters, seedCharactersOnce } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 公开：返回后台上传的立绘（空则前端回退到静态资源）
export async function GET() {
  await seedCharactersOnce(); // 首次访问把 public/characters/ 历史立绘播种进库
  const list = await queryCharacters();
  return NextResponse.json({ list });
}

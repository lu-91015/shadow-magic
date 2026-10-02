import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getClientIp, requireView } from '@/lib/auth';
import { getHeroConfig, setHeroConfig, insertAudit } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 首页 hero 可配置文案（名字 / 粉丝牌标签 / 默认人设句）
export async function GET(req: Request) {
  if (!(await requireView(req)))
    return NextResponse.json({ ok: false }, { status: 401 });
  const config = await getHeroConfig();
  return NextResponse.json({ ok: true, config });
}

// 保存：name / badges（竖线 | 或逗号分隔）/ defaultQuote，均可选传
export async function PUT(req: NextRequest) {
  if (!(await requireAdmin(req)))
    return NextResponse.json({ ok: false }, { status: 401 });
  const body = (await req.json().catch(() => null)) as {
    name?: string;
    badges?: string;
    defaultQuote?: string;
  } | null;
  if (!body) return NextResponse.json({ ok: false, error: '请求体解析失败' }, { status: 400 });

  const cur = await getHeroConfig();
  const name = (body.name ?? cur.name).trim();
  if (!name) return NextResponse.json({ ok: false, error: '名字不能为空' }, { status: 400 });

  let badges = cur.badges;
  if (typeof body.badges === 'string') {
    badges = body.badges
      .split(/[|,，]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  const defaultQuote = (body.defaultQuote ?? cur.defaultQuote).trim();
  if (!defaultQuote)
    return NextResponse.json({ ok: false, error: '默认人设句不能为空' }, { status: 400 });

  await setHeroConfig({ name, badges, defaultQuote });
  await insertAudit(
    'hero_update',
    'hero',
    { name, badges: badges.length, defaultQuote },
    getClientIp(req),
  );
  return NextResponse.json({ ok: true, config: { name, badges, defaultQuote } });
}

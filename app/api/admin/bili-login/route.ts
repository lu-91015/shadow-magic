import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getClientIp } from '@/lib/auth';
import { setBiliCookie } from '@/lib/bilibili';
import { insertAudit } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// B站网页登录：用户名 + 密码。遇极验(geetest)验证码时需人工补全，这里仅处理免验证的常规情况。
export async function POST(req: NextRequest) {
  if (!(await requireAdmin(req)))
    return NextResponse.json({ ok: false }, { status: 401 });
  const { username, password } = await req.json().catch(() => ({}) as any);
  if (!username || !password)
    return NextResponse.json({ ok: false, error: '缺少账号或密码' }, { status: 400 });

  try {
    const res = await fetch('https://api.bilibili.com/x/passport-login/web/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': UA,
        Referer: 'https://www.bilibili.com/',
        Origin: 'https://www.bilibili.com',
      },
      body: new URLSearchParams({
        username,
        password,
        keep: 'true',
        go_url: 'https://www.bilibili.com/',
      }).toString(),
      signal: AbortSignal.timeout(20000),
    });
    const data: any = await res.json();
    if (data?.code !== 0 || !data?.data?.cookie_info) {
      // -105 / geetest 等：需要验证码
      return NextResponse.json({
        ok: false,
        geetest: data?.data?.geetest ?? null,
        message: data?.message ?? '登录失败（可能需要验证码）',
      });
    }
    const cookies: any[] = data.data.cookie_info.cookies || [];
    const cookieStr = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    const sess = cookies.find((c) => c.name === 'SESSDATA')?.value;
    await setBiliCookie(cookieStr, sess);
    await insertAudit('bili_login', undefined, { username }, getClientIp(req));
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? '登录请求异常' },
      { status: 500 },
    );
  }
}

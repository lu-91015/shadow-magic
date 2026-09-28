import { NextRequest, NextResponse } from 'next/server';

// 统一保护后台 API：除 /api/admin/login 外，所有 /api/admin/* 必须携带有效会话。
// 注意：这里的 HMAC 校验逻辑必须与 lib/auth.ts 的 verifyToken 保持一致
// （SECRET 取值、MAX_AGE、签名算法），否则会出现“中间件放行但路由拒绝”或反之。
const ADMIN_COOKIE = 'admin_sid';
const MAX_AGE = 7 * 24 * 3600; // 7 天，与 lib/auth 一致

// Edge 运行时无 Node 的 crypto 模块，使用全局 Web Crypto 做 HMAC-SHA256 校验。
async function verifyToken(token: string): Promise<boolean> {
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [role, ts, sig] = parts;
  if (role !== 'admin' && role !== 'guest') return false;
  if (!/^\d+$/.test(ts)) return false;
  if (Date.now() - Number(ts) > MAX_AGE * 1000) return false;

  const secret = process.env.ADMIN_SECRET || process.env.ADMIN_PASSWORD || 'admin';
  const data = `${role}.${ts}`;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const buf = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  const expected = Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  if (expected.length !== sig.length) return false;
  let ok = true;
  for (let i = 0; i < expected.length; i++) ok = ok && expected[i] === sig[i];
  return ok;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // 登录接口放行（否则永远无法拿到第一个会话）
  if (pathname === '/api/admin/login') return NextResponse.next();

  const token = req.cookies.get(ADMIN_COOKIE)?.value;
  if (!token || !(await verifyToken(token))) {
    return NextResponse.json(
      { ok: false, error: '未登录或会话已失效' },
      { status: 401 },
    );
  }
  return NextResponse.next();
}

export const config = {
  // 只在后台 API 上运行，不影响前台页面与公开接口
  matcher: ['/api/admin/:path*'],
};

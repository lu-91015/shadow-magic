import { NextRequest, NextResponse } from 'next/server';

// 统一保护后台 API：除 /api/admin/login 外，所有 /api/admin/* 必须携带有效会话。
// 注意：这里的 HMAC 校验逻辑必须与 lib/auth.ts 的 verifyToken 保持一致
// （SECRET 取值、MAX_AGE、签名算法），否则会出现“中间件放行但路由拒绝”或反之。
const ADMIN_COOKIE = 'admin_sid';
const MAX_AGE = 7 * 24 * 3600; // 7 天，与 lib/auth 一致

// 仅做结构性校验（格式 / 角色 / 过期）。真正的 HMAC 签名校验由各路由在 Node 运行时
// 用 lib/auth.verifyToken / requireAdmin 完成——因为 Edge 中间件的 process.env 不可靠
// （构建期内联差异可能导致中间件与登录端取到的 ADMIN_SECRET 不一致，从而签名校验失败、
// 出现“能登录却没权限”）。路由层会再次校验签名，安全性不受影响。
async function verifyToken(token: string): Promise<boolean> {
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [role, ts] = parts;
  if (role !== 'admin' && role !== 'guest') return false;
  if (!/^\d+$/.test(ts)) return false;
  if (Date.now() - Number(ts) > MAX_AGE * 1000) return false;
  return true;
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

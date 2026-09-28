import crypto from 'crypto';

// 后台简易鉴权：HMAC 签名会话 + 环境变量 ADMIN_PASSWORD。
// 未设置 ADMIN_PASSWORD 时退化为默认密码 'admin'（仅用于本地首次启动，生产务必设置）。
const SECRET = process.env.ADMIN_SECRET || process.env.ADMIN_PASSWORD || 'admin';
export const ADMIN_COOKIE = 'admin_sid';
const MAX_AGE = 7 * 24 * 3600; // 7 天

export type Role = 'admin' | 'guest';

// 游客（guest）仅可查看/查询，不能调用任何增删改接口。
export function expectedPassword(): string {
  return process.env.ADMIN_PASSWORD || 'admin';
}

// 游客默认密码 'guest'，生产请在环境变量 GUEST_PASSWORD 设置。
export function expectedGuestPassword(): string {
  return process.env.GUEST_PASSWORD || 'guest';
}

export function createSessionToken(role: Role): string {
  const ts = Date.now().toString();
  const sig = crypto.createHmac('sha256', SECRET).update(`${role}.${ts}`).digest('hex');
  return `${role}.${ts}.${sig}`;
}

// 解析会话 token，返回角色；非法/过期返回 null。
export function verifyToken(token?: string | null): Role | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [role, ts, sig] = parts;
  if (role !== 'admin' && role !== 'guest') return null;
  const expected = crypto.createHmac('sha256', SECRET).update(`${role}.${ts}`).digest('hex');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;
  if (Date.now() - Number(ts) > MAX_AGE * 1000) return null;
  return role as Role;
}

function tokenFromReq(req: Request): string | null {
  const cookie = req.headers.get('cookie') || '';
  const m = cookie.match(/(?:^|;\s*)admin_sid=([^;]+)/);
  return m?.[1] ?? null;
}

// 仅管理员可调用（用于增删改接口）。
export async function requireAdmin(req: Request): Promise<boolean> {
  return verifyToken(tokenFromReq(req)) === 'admin';
}

// 管理员或游客均可调用（用于只读/查询接口）。
export async function requireView(req: Request): Promise<boolean> {
  return verifyToken(tokenFromReq(req)) !== null;
}

export async function getRole(req: Request): Promise<Role | null> {
  return verifyToken(tokenFromReq(req));
}

export const ADMIN_COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: MAX_AGE,
};

export function getClientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('x-real-ip') || 'unknown';
}

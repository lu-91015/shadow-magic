import { NextResponse } from 'next/server';
import { requireView } from '@/lib/auth';
import { getKv } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 守护进程每 ~20s 写入一次心跳；超过该阈值视为未运行。
const THRESHOLD = 90_000;

type Hb = { running: boolean; lastSeen: number | null; roomId: string | null };

async function readHb(key: string): Promise<Hb> {
  const raw = await getKv(key).catch(() => null);
  if (!raw) return { running: false, lastSeen: null, roomId: null };
  try {
    const o = JSON.parse(raw);
    const lastSeen = o.ts ? Number(o.ts) : null;
    return {
      running: !!(lastSeen && Date.now() - lastSeen < THRESHOLD),
      lastSeen,
      roomId: o.roomId ?? null,
    };
  } catch {
    return { running: false, lastSeen: null, roomId: null };
  }
}

export async function GET(req: Request) {
  if (!(await requireView(req)))
    return NextResponse.json({ ok: false }, { status: 401 });
  const main = await readHb('monitor_heartbeat');
  const test = await readHb('monitor_heartbeat_test');
  return NextResponse.json({ ok: true, ...main, test: test.running ? test : null });
}

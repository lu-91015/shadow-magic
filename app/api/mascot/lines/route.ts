import { NextResponse } from 'next/server';
import { queryMascotLines, getKv } from '@/lib/db';
import { getLiveStatus } from '@/lib/bilibili';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 左下角小人配置（模型路径 / 缩放），存于 admin_kv
interface MascotModelConfig {
  url: string;
  scale: number;
}

async function readMascotModel(): Promise<MascotModelConfig> {
  try {
    const raw = await getKv('mascot_model');
    if (!raw) return { url: '', scale: 1 };
    const j = JSON.parse(raw);
    return { url: String(j?.url ?? ''), scale: Number(j?.scale) || 1 };
  } catch {
    return { url: '', scale: 1 };
  }
}

// 左下角小人台词（公开）：返回启用中的台词、当前直播状态与 Live2D 模型配置。
// 具体的时间/日期条件由前端按当地时钟筛选。
export async function GET() {
  try {
    const [lines, live, model] = await Promise.all([
      queryMascotLines(),
      getLiveStatus(),
      readMascotModel(),
    ]);
    return NextResponse.json({
      ok: true,
      lines: lines
        .filter((l) => l.enabled)
        .map((l) => ({
          id: l.id,
          text: l.text,
          weight: l.weight,
          timeStart: l.time_start,
          timeEnd: l.time_end,
          dates: l.dates,
          onlyLive: l.only_live,
          scene: l.scene || 'idle',
        })),
      liveStatus: live.liveStatus ?? 0,
      model,
    });
  } catch {
    return NextResponse.json({ ok: true, lines: [], liveStatus: 0, model: { url: '', scale: 1 } });
  }
}

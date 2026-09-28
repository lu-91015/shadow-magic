import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getClientIp } from '@/lib/auth';
import { queryRtSessions, queryRtDetail, queryRtOnline, insertAudit } from '@/lib/db';
import { zipStore } from '@/lib/zip';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  if (typeof v === 'number' && v > 1e12) return new Date(v).toISOString();
  return String(v);
}

function toCsv(columns: string[], rows: Record<string, unknown>[]): string {
  const lines = [columns.join(',')];
  for (const r of rows) {
    lines.push(
      columns
        .map((c) => {
          const s = csvCell(r[c]).replace(/"/g, '""');
          return /[",\n]/.test(s) ? `"${s}"` : s;
        })
        .join(','),
    );
  }
  return '﻿' + lines.join('\n'); // BOM 便于 Excel 识别 UTF-8
}

const ts = (t?: number | null) => (t ? new Date(t * 1000).toISOString() : '');

// 清洗标题用于文件夹名：去除路径非法字符、收敛长度，标题为空时回退到场次 ID
function safeFolderName(title: string | null | undefined, id: string): string {
  let t = (title || '')
    .trim()
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_');
  if (t.length > 40) t = t.slice(0, 40);
  if (!t) t = id;
  return `直播_${t}_${id}`;
}

export async function POST(req: NextRequest) {
  if (!(await requireAdmin(req)))
    return NextResponse.json({ ok: false }, { status: 401 });

  let ids: string[] = [];
  try {
    const body = await req.json();
    ids = Array.isArray(body?.ids) ? body.ids.map(String) : [];
  } catch {
    /* ignore */
  }
  if (ids.length === 0)
    return NextResponse.json(
      { ok: false, error: '请至少选择一场直播' },
      { status: 400 },
    );

  const all = await queryRtSessions(100000);
  const byId = new Map(all.map((s) => [String(s.id), s]));
  const files: { name: string; data: string }[] = [];

  for (const id of ids) {
    const s: any = byId.get(String(id));
    if (!s) continue;
    const d: any = await queryRtDetail(String(id), 5_000_000); // 弹幕全量

    const folder = safeFolderName(s.title, String(s.id));

    // 场次信息
    files.push({
      name: `${folder}/场次信息.csv`,
      data: toCsv(
        [
          '场次ID', '房间号', '标题', '开始时间', '结束时间', '时长秒',
          '人气峰值', '弹幕数', '醒目留言数', '礼物次数', '礼物币',
          '总互动', '进入', '关注',
        ],
        [
          {
            场次ID: s.id,
            房间号: s.roomId,
            标题: s.title,
            开始时间: ts(s.start),
            结束时间: ts(s.end),
            时长秒: s.durationSec,
            人气峰值: s.onlinePeak,
            弹幕数: s.danmaku,
            醒目留言数: s.sc,
            礼物次数: s.gift,
            礼物币: s.giftCoin,
            总互动: s.interact,
            进入: s.enter,
            关注: s.follow,
          },
        ],
      ),
    });

    // 弹幕明细
    files.push({
      name: `${folder}/弹幕.csv`,
      data: toCsv(
        ['时间', 'UID', '用户名', '内容', '颜色'],
        d.danmaku.map((x: any) => ({
          时间: ts(x.ts),
          UID: x.uid,
          用户名: x.uname,
          内容: x.text,
          颜色: x.color,
        })),
      ),
    });

    // 醒目留言明细
    files.push({
      name: `${folder}/醒目留言.csv`,
      data: toCsv(
        ['时间', 'UID', '用户名', '留言', '金额(元)', '单价(元)'],
        d.sc.map((x: any) => ({
          时间: ts(x.ts),
          UID: x.uid,
          用户名: x.uname,
          留言: x.message,
          金额: x.rmb,
          单价: x.price,
        })),
      ),
    });

    // 礼物明细
    files.push({
      name: `${folder}/礼物.csv`,
      data: toCsv(
        ['时间', 'UID', '用户名', '礼物名', '数量', '币种', '总币', '动作'],
        d.gift.map((x: any) => ({
          时间: ts(x.ts),
          UID: x.uid,
          用户名: x.uname,
          礼物名: x.gift_name,
          数量: x.num,
          币种: x.coin_type,
          总币: x.total_coin,
          动作: x.action,
        })),
      ),
    });

    // 互动明细（进入/关注/分享/特别关注/互粉等）
    files.push({
      name: `${folder}/互动.csv`,
      data: toCsv(
        ['时间', 'UID', '用户名', '类型'],
        d.interact.map((x: any) => ({
          时间: ts(x.ts),
          UID: x.uid,
          用户名: x.uname,
          类型: x.type,
        })),
      ),
    });
    // 同接（在线人数）曲线
    files.push({
      name: `${folder}/同接曲线.csv`,
      data: toCsv(
        ['时间', '在线人数'],
        d.online.map((x: any) => ({
          时间: ts(x.ts),
          在线人数: x.online,
        })),
      ),
    });
  }

  if (files.length === 0)
    return NextResponse.json(
      { ok: false, error: '未找到选中的场次' },
      { status: 404 },
    );

  const zip = zipStore(files);
  await insertAudit('export_live', `${ids.length}场`, undefined, getClientIp(req));
  return new NextResponse(zip, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="live-export-${Date.now()}.zip"`,
    },
  });
}

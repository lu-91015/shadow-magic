import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getClientIp, requireView } from '@/lib/auth';
import {
  getPool,
  queryVideosAdmin,
  queryLiveSessionsAdmin,
  queryRtSessions,
  insertAudit,
} from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function cell(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  if (typeof v === 'number' && v > 1e12) return new Date(v).toISOString();
  return String(v);
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const headers = Array.from(
    rows.reduce((set, r) => {
      Object.keys(r).forEach((k) => set.add(k));
      return set;
    }, new Set<string>()),
  );
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push(headers.map((h) => {
      const s = cell(r[h]).replace(/"/g, '""');
      return /[",\n]/.test(s) ? `"${s}"` : s;
    }).join(','));
  }
  return '﻿' + lines.join('\n'); // BOM 便于 Excel 识别 UTF-8
}

// 全量数据导出：仅管理员可用（只读访客不得导出全站数据）
export async function GET(req: NextRequest) {
  if (!(await requireAdmin(req)))
    return NextResponse.json({ ok: false }, { status: 401 });
  const type = req.nextUrl.searchParams.get('type') || 'clips';
  const ip = getClientIp(req);

  let rows: Record<string, unknown>[] = [];
  let filename = `${type}.csv`;
  if (type === 'clips') {
    rows = (await queryVideosAdmin({ limit: 100000 })).map((r) => ({
      bvid: r.bvid,
      title: r.title,
      author: r.author,
      pubdate: r.pubdate,
      view: r.view,
      like: r.like,
      coin: r.coin,
      share: r.share,
      favorite: r.favorite,
      reply: r.reply,
      danmaku: r.danmaku,
      manual: r.manual,
      arcurl: r.arcurl,
    }));
  } else if (type === 'lives') {
    rows = (await queryLiveSessionsAdmin()).map((r) => ({
      bvid: r.bvid,
      title: r.title,
      category: r.category,
      categoryManual: r.categoryManual,
      startTime: r.startTime,
      endTime: r.endTime,
      durationSec: r.durationSec,
      singDuration: r.singDuration,
      gameDuration: r.gameDuration,
      note: r.note,
      songCount: r.songCount,
    }));
  } else if (type === 'songs') {
    const { rows: raw } = await getPool().query<Record<string, unknown>>(
      'SELECT bvid, idx, title, source, excluded, created_at FROM live_song ORDER BY bvid, idx',
    );
    rows = raw.map((r) => ({ ...r, created_at: Number(r.created_at) }));
  } else if (type === 'comments') {
    const { rows: raw } = await getPool().query<Record<string, unknown>>(
      'SELECT rpid, oid, mid, uname, message, ctime, like_count, parent, is_sub FROM dyn_comment ORDER BY id LIMIT 200000',
    );
    rows = raw.map((r) => ({ ...r, ctime: Number(r.ctime) }));
  } else if (type === 'dynamics') {
    const { rows: raw } = await getPool().query<Record<string, unknown>>(
      'SELECT * FROM dynamic ORDER BY id LIMIT 200000',
    );
    rows = raw;
  } else if (type === 'rtsessions') {
    // 直播实时监控场次（live_rt_session）：开播时间、人气峰值、弹幕/SC/礼物、
    // 进入/关注、流水等。时间转 ISO 便于 Excel 直接解析。
    const list = await queryRtSessions(100000);
    rows = list.map((s: any) => ({
      sessionId: s.id,
      roomId: s.roomId,
      title: s.title,
      startTime: s.start ? new Date(s.start * 1000).toISOString() : '',
      endTime: s.end ? new Date(s.end * 1000).toISOString() : '',
      durationSec: s.durationSec,
      onlinePeak: s.onlinePeak,
      danmaku: s.danmaku,
      sc: s.sc,
      gift: s.gift,
      enter: s.enter,
      follow: s.follow,
      interactTotal: s.interact,
      giftCoin: s.giftCoin,
    }));
    filename = 'live-rt-sessions.csv';
  } else {
    return NextResponse.json({ ok: false, error: '未知类型' }, { status: 400 });
  }

  await insertAudit('export', type, undefined, ip);
  const csv = toCsv(rows);
  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}

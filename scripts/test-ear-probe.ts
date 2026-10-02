// 实验脚本：对一场回放的多个时间点抽音频并调 Shazam，验证识别率
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { getVideoCid, getVideoPlayUrl } from '../lib/bilibili';
import { FFMPEG, FFMPEG_HEADERS, PYTHON } from './sync-songs';

const envFile = path.join(process.cwd(), '.env');
if (fs.existsSync(envFile))
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }

const BVID = process.argv[2] || 'BV1RbaB6UEhz';
const TIMES = (process.argv[3] || '1200,1800,2400,3000,3600,4200,4800,5400,6000,6600,7200,7800,8400')
  .split(',')
  .map(Number);
const LOCAL_FFMPEG_DIR = path.join(process.cwd(), 'tools', 'ffmpeg', 'bin');

function extract(url: string, t: number, out: string): Promise<void> {
  return new Promise((res, rej) => {
    const ps = spawn(
      FFMPEG,
      ['-ss', String(t), '-t', '12', '-headers', FFMPEG_HEADERS, '-i', url, '-vn', '-ac', '1', '-ar', '44100', '-y', out],
      { windowsHide: true },
    );
    let err = '';
    ps.stderr.on('data', (d) => (err += d.toString()));
    ps.on('error', rej);
    ps.on('close', (c) => (c === 0 ? res() : rej(new Error(`exit ${c}: ${err.slice(-120)}`))));
  });
}

function audioId(wav: string): Promise<string> {
  return new Promise((res, rej) => {
    const env = { ...process.env, PATH: `${LOCAL_FFMPEG_DIR};${process.env.PATH ?? ''}` };
    const ps = spawn(PYTHON, [path.join(process.cwd(), 'scripts', 'audio_id.py'), wav], { windowsHide: true, env });
    let out = '';
    ps.stdout.on('data', (d) => (out += d.toString()));
    ps.stderr.on('data', (d) => (out += d.toString()));
    ps.on('error', rej);
    ps.on('close', () => res(out));
  });
}

(async () => {
  const cid = await getVideoCid(BVID);
  if (!cid) process.exit(1);
  const url = await getVideoPlayUrl(BVID, cid);
  if (!url) process.exit(1);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ear-probe-'));
  for (const t of TIMES) {
    const wav = path.join(tmp, `p${t}.wav`);
    try {
      await extract(url, t, wav);
    } catch (e) {
      console.log(`${t}s 抽取失败 ${(e as Error).message.slice(0, 80)}`);
      continue;
    }
    const out = await audioId(wav);
    const m = out.match(/SHAZAM_JSON:(\{.*\})/);
    if (m) {
      const j = JSON.parse(m[1]);
      console.log(`${t}s → ${j.ok ? `♪ ${j.title} — ${j.artist}` : 'no_match'}`);
    } else {
      console.log(`${t}s → 异常: ${out.slice(-100)}`);
    }
    try { fs.unlinkSync(wav); } catch { /* */ }
  }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
  process.exit(0);
})();

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { getVideoCid, getVideoPlayUrl } from '../lib/bilibili';

const envFile = path.join(process.cwd(), '.env');
if (fs.existsSync(envFile))
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const FFMPEG = path.join(process.cwd(), 'tools', 'ffmpeg', 'bin', 'ffmpeg.exe');
const HEADERS = `Referer: https://www.bilibili.com/\r\nUser-Agent: ${UA}`;

function runFfmpegFull(args: string[]): Promise<string> {
  return new Promise((resolve) => {
    const ps = spawn(FFMPEG, args, { windowsHide: true });
    let err = '';
    ps.stderr.on('data', (d) => (err += d.toString()));
    ps.on('close', (code) => resolve(`exit=${code}\n${err.slice(-1500)}`));
    ps.on('error', (e) => resolve(`spawn err=${e.message}`));
  });
}

async function main() {
  const bvid = process.argv[2] || 'BV1VyeV6JEYb';
  const cid = await getVideoCid(bvid);
  if (!cid) { console.log('NO CID RETURNED'); return; }
  console.log('cid=', cid);
  const url = await getVideoPlayUrl(bvid, cid);
  console.log('url?', !!url, url ? url.slice(0, 100) : '');
  if (!url) {
    console.log('NO URL RETURNED');
    return;
  }
  const frame = path.join(process.cwd(), 'diag.png');
  const out = await runFfmpegFull([
    '-sseof', '-20', '-headers', HEADERS, '-i', url, '-frames:v', '1', frame,
  ]);
  console.log('--- ffmpeg ---');
  console.log(out);
  console.log('frame exists?', fs.existsSync(frame));
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

import sharp from 'sharp';
import path from 'path';
(async () => {
const SRC = path.join(process.cwd(), 'public/characters');
function isBlueBg(r: number, g: number, b: number): boolean { return b - r >= 14 && b - g >= 6 && b >= 170; }
const file = 'dousha-0.png';
const img = sharp(path.join(SRC, file)).ensureAlpha();
const { width: w, height: h } = await img.metadata();
const raw = await img.raw().toBuffer();
const n = w * h;
const alpha = new Uint8Array(n).fill(255);
const q: number[] = []; const visited = new Uint8Array(n);
const push = (x: number, y: number) => { if (x < 0 || y < 0 || x >= w || y >= h) return; const i = y * w + x; if (visited[i]) return; visited[i] = 1; if (!isBlueBg(raw[i * 4], raw[i * 4 + 1], raw[i * 4 + 2])) return; alpha[i] = 0; q.push(i); };
for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
while (q.length) { const i = q.pop()!; const x = i % w, y = (i / w) | 0; push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1); }
const comp = new Int32Array(n).fill(-1); const info: { size: number; touch: boolean }[] = [];
for (let s = 0; s < n; s++) { if (alpha[s] === 0 || comp[s] !== -1) continue; const id = info.length; let size = 0, touch = false; const stack = [s]; comp[s] = id;
  while (stack.length) { const i = stack.pop()!; size++; const x = i % w, y = (i / w) | 0; if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touch = true;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) { if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue; const j = ny * w + nx; if (alpha[j] === 255 && comp[j] === -1) { comp[j] = id; stack.push(j); } } }
  info.push({ size, touch }); }
const top = info.map((v, i) => ({ i, ...v })).sort((a, b) => b.size - a.size).slice(0, 5);
console.log('w,h=', w, h, 'components=', info.length);
for (const t of top) console.log('#' + t.i, 'size=' + t.size, 'touch=' + t.touch);
process.exit(0);
})();

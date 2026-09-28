// 立绘抠图：去除浅蓝装饰背景，输出透明 PNG 至 public/characters/cut/
// 策略：从边缘 BFS 泛洪偏蓝背景（不向白色泛洪，角色内部有白色描边环保护）；
// 连通域计算排除"被泛洪触碰"的边界像素（打断近蓝残余造成的桥接）；
// 过滤：丢弃贴边/近边缘组件、均值近白组件（白框）、过小组件，
// 其余组件需与最大组件（角色主体）外接框有 ≥40px 深度重叠。
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const SRC = path.join(process.cwd(), 'public/characters');
const OUT = path.join(SRC, 'cut');

// 偏蓝背景判定：蓝通道显著高于红/绿（涵盖浅蓝面板、波点、装饰线）
function isBlueBg(r: number, g: number, b: number): boolean {
  return b - r >= 14 && b - g >= 6 && b >= 170;
}

async function cutout(file: string): Promise<void> {
  const img = sharp(path.join(SRC, file)).ensureAlpha();
  const { width: w, height: h } = await img.metadata();
  const raw = await img.raw().toBuffer();
  const n = w * h;
  const alpha = new Uint8Array(n).fill(255);

  // 阶段1：从四边 BFS 泛洪偏蓝像素（visited 记录所有触碰过的像素）
  const q: number[] = [];
  const visited = new Uint8Array(n);
  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = y * w + x;
    if (visited[i]) return;
    visited[i] = 1;
    if (!isBlueBg(raw[i * 4], raw[i * 4 + 1], raw[i * 4 + 2])) return;
    alpha[i] = 0;
    q.push(i);
  };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  while (q.length) {
    const i = q.pop()!;
    const x = i % w, y = (i / w) | 0;
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
  }

  // 阶段2：连通域（排除被泛洪触碰过的像素，打断近蓝残余"桥接"）
  const comp = new Int32Array(n).fill(-1);
  const sizes: number[] = [];
  const touches: boolean[] = [];
  const minSums: number[] = [];
  const boxes: [number, number, number, number][] = []; // minX, minY, maxX, maxY
  for (let s = 0; s < n; s++) {
    if (alpha[s] === 0 || visited[s] || comp[s] !== -1) continue;
    const id = sizes.length;
    let size = 0, touch = false, minSum = 0;
    let minX = w, minY = h, maxX = 0, maxY = 0;
    const stack = [s];
    comp[s] = id;
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      const o = i * 4;
      minSum += Math.min(raw[o], raw[o + 1], raw[o + 2]);
      const x = i % w, y = (i / w) | 0;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touch = true;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (alpha[j] === 255 && !visited[j] && comp[j] === -1) { comp[j] = id; stack.push(j); }
      }
    }
    sizes.push(size);
    touches.push(touch);
    minSums.push(minSum);
    boxes.push([minX, minY, maxX, maxY]);
  }
  // 以最大组件（角色主体）为锚：其余组件需通过基础过滤且与角色外接框深度重叠
  const maxId = sizes.indexOf(Math.max(...sizes, 1));
  const [ax0, ay0, ax1, ay1] = boxes[maxId];
  const keep = sizes.map((size, id) => {
    if (id === maxId) return true;
    if (touches[id] || minSums[id] / size > 244 || size < sizes[maxId] * 0.02) return false;
    const [x0, y0, x1, y1] = boxes[id];
    // 贴近图像边缘的组件多为白框/装饰残余
    if (x0 < 12 || y0 < 12 || x1 > w - 13 || y1 > h - 13) return false;
    // 需与角色外接框有足够深度的重叠（浅重叠的多为贴边的花边残余）
    const ox = Math.min(x1, ax1) - Math.max(x0, ax0);
    const oy = Math.min(y1, ay1) - Math.max(y0, ay0);
    return ox >= 40 && oy >= 40;
  });
  const keepMask = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (alpha[i] === 255 && comp[i] >= 0 && keep[comp[i]]) keepMask[i] = 1;
  }
  // 被泛洪触碰的边界像素（comp=-1）：仅回收紧邻保留区域的（角色描边外沿）
  for (let pass = 0; pass < 2; pass++) {
    const add: number[] = [];
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (alpha[i] === 255 && comp[i] < 0 && !keepMask[i]) {
          if (keepMask[i - 1] || keepMask[i + 1] || keepMask[i - w] || keepMask[i + w]) add.push(i);
        }
      }
    }
    for (const i of add) keepMask[i] = 1;
  }
  for (let i = 0; i < n; i++) {
    if (alpha[i] === 255 && !keepMask[i]) alpha[i] = 0;
  }

  // 边缘去蓝边：与透明相邻的保留像素若偏蓝则向灰色收敛
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (alpha[i] === 0) continue;
      const nb = [i - 1, i + 1, i - w, i + w];
      if (!nb.some((j) => alpha[j] === 0)) continue;
      const o = i * 4;
      const [r, g, b] = [raw[o], raw[o + 1], raw[o + 2]];
      if (b - r > 24) {
        const m = (r + g + b) / 3;
        raw[o] = Math.round(r * 0.4 + m * 0.6);
        raw[o + 1] = Math.round(g * 0.4 + m * 0.6);
        raw[o + 2] = Math.round(b * 0.4 + m * 0.6);
      }
    }
  }

  // 将 alpha 结果写回缓冲区
  for (let i = 0; i < n; i++) raw[i * 4 + 3] = alpha[i];

  // 裁剪到不透明区域外接矩形（留 8px 边距）
  let minX = w, minY = h, maxX = 0, maxY = 0, kept = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (alpha[y * w + x] === 0) continue;
      kept++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (kept === 0) { console.warn(`  ${file}: 无保留像素，跳过`); return; }
  const pad = 8;
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
  maxX = Math.min(w - 1, maxX + pad); maxY = Math.min(h - 1, maxY + pad);

  const out = sharp(raw, { raw: { width: w, height: h, channels: 4 } })
    .extract({ left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 })
    .png();
  const base = file.replace(/\.(png|jpe?g)$/i, '');
  await out.toFile(path.join(OUT, `${base}.png`));
  console.log(`  ${file} → cut/${base}.png  (${maxX - minX + 1}x${maxY - minY + 1}, 保留 ${kept}px)`);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const files = fs.readdirSync(SRC).filter((f) => /\.(png|jpe?g)$/i.test(f));
  console.log(`抠图 ${files.length} 张…`);
  for (const f of files) await cutout(f);
  console.log('完成');
})();

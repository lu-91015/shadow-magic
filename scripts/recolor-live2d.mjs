// 李豆沙 Live2D 贴图精细化重绘 v2
// 参照官方立绘：银白双马尾 / 白色偶像上衣 / 蓝色蓬蓬裙 / 白袜 / 白蓝短靴 / 蓝色蝴蝶结
// 骨骼/物理/动作不变，仅重绘贴图；从原版 Hiyori 贴图生成，可重复运行。
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const SRC = 'public/live2d/Hiyori';
const DST = 'public/live2d/lidousha';

function rgb2hsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return [h, max === 0 ? 0 : d / max, max];
}

function hsv2rgb(h, s, v) {
  const c = v * s;
  const hh = (h % 360) / 60;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hh < 1) [r, g, b] = [c, x, 0];
  else if (hh < 2) [r, g, b] = [x, c, 0];
  else if (hh < 3) [r, g, b] = [0, c, x];
  else if (hh < 4) [r, g, b] = [0, x, c];
  else if (hh < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = v - c;
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// ---------- 通用变换 ----------

// 棕发 → 银白（保留明暗）
function hairToSilver(r, g, b) {
  const [h, s, v] = rgb2hsv(r, g, b);
  const ns = s * 0.16;
  const nv = clamp(0.82 + (v - 0.62) * 0.42, 0.58, 0.97);
  const [nr, ng, nb] = hsv2rgb(h, ns, nv);
  return [clamp(nr * 0.985 + 4, 0, 255), clamp(ng * 0.995 + 4, 0, 255), clamp(nb + 8, 0, 255)];
}

// 白色偶像上衣（原米色开衫）：去黄提亮，阴影转冷蓝灰
function beigeToWhiteTop(r, g, b) {
  const [h, s, v] = rgb2hsv(r, g, b);
  const nv = clamp(0.90 + (v - 0.85) * 0.7, 0.80, 1.0);
  const ns = clamp(s * 0.35, 0.02, 0.16);
  const [nr, ng, nb] = hsv2rgb(215, ns, nv);
  return [nr, ng, nb];
}

// 蓝色蓬蓬裙（原深灰蓝裙）：提亮为明快的蓝
function navyToBlueSkirt(r, g, b) {
  const [h, s, v] = rgb2hsv(r, g, b);
  const nv = clamp(0.42 + (v - 0.2) * 1.05, 0.40, 0.88);
  const [nr, ng, nb] = hsv2rgb(216, 0.52, nv);
  return [nr, ng, nb];
}

// 白色过膝袜（原深色袜）：保留褶皱明暗
function navyToWhiteSock(r, g, b) {
  const [h, s, v] = rgb2hsv(r, g, b);
  const nv = clamp(0.905 + (v - 0.28) * 0.34, 0.80, 0.99);
  const [nr, ng, nb] = hsv2rgb(220, 0.05, nv);
  return [nr, ng, nb];
}

// 水手领（原深蓝领）：改为清爽藏蓝
function collarNavy(r, g, b) {
  const [h, s, v] = rgb2hsv(r, g, b);
  const nv = clamp(0.34 + (v - 0.2) * 0.9, 0.30, 0.75);
  const [nr, ng, nb] = hsv2rgb(222, 0.5, nv);
  return [nr, ng, nb];
}

// 白蓝短靴（原棕色乐福鞋）
function brownToBoots(r, g, b) {
  const [h, s, v] = rgb2hsv(r, g, b);
  const nv = clamp(0.84 + (v - 0.3) * 0.42, 0.72, 0.97);
  const [nr, ng, nb] = hsv2rgb(218, 0.1, nv);
  return [nr, ng, nb];
}

// 蓝色蝴蝶结（原红色丝带）
function redToBlueBow(r, g, b) {
  const [h, s, v] = rgb2hsv(r, g, b);
  const nv = clamp(0.5 + (v - 0.35) * 0.75, 0.42, 0.85);
  const [nr, ng, nb] = hsv2rgb(219, 0.55, nv);
  return [nr, ng, nb];
}

// 五角星多边形顶点（外半径 R，内半径 0.42R，尖端朝上）
function starPoly(R) {
  const pts = [];
  for (let i = 0; i < 5; i++) {
    const aO = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
    const aI = aO + Math.PI / 5;
    pts.push([Math.cos(aO) * R, Math.sin(aO) * R]);
    pts.push([Math.cos(aI) * R * 0.42, Math.sin(aI) * R * 0.42]);
  }
  return pts;
}

function pointInPoly(px, py, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function distToEdges(px, py, pts) {
  let m = Infinity;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
    const vx = xj - xi, vy = yj - yi;
    const t = clamp(((px - xi) * vx + (py - yi) * vy) / (vx * vx + vy * vy), 0, 1);
    const d = Math.hypot(px - (xi + t * vx), py - (yi + t * vy));
    if (d < m) m = d;
  }
  return m;
}

// 绘制一颗五角星（可限制只画在蓝色像素上）
function paintStar5(data, width, height, ch, cx, cy, R, col, core, onlyBlue) {
  const pts = starPoly(R);
  let n = 0;
  const rOut = Math.ceil(R) + 2;
  for (let dy = -rOut; dy <= rOut; dy++) {
    for (let dx = -rOut; dx <= rOut; dx++) {
      const inside = pointInPoly(dx, dy, pts);
      const edge = distToEdges(dx, dy, pts);
      if (!inside && edge > 1.4) continue;
      const x = Math.round(cx + dx), y = Math.round(cy + dy);
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const o = (y * width + x) * ch;
      if (ch === 4 && data[o + 3] < 8) continue;
      const r0 = data[o], g0 = data[o + 1], b0 = data[o + 2];
      if (onlyBlue) {
        const [h0] = rgb2hsv(r0, g0, b0);
        if (!(h0 >= 185 && h0 <= 265)) continue; // 只画在蓝色面上
      }
      // 边缘 1.4px 抗锯齿淡出
      const alpha = inside ? (edge < 1.4 ? 0.45 + (edge / 1.4) * 0.55 : 1) : 1 - edge / 1.4;
      if (alpha <= 0.03) continue;
      const d = Math.hypot(dx, dy);
      const cc = d < R * 0.3 ? core : col;
      data[o] = Math.round(r0 * (1 - alpha) + cc[0] * alpha);
      data[o + 1] = Math.round(g0 * (1 - alpha) + cc[1] * alpha);
      data[o + 2] = Math.round(b0 * (1 - alpha) + cc[2] * alpha);
      n++;
    }
  }
  return n;
}

// 在脸部贴图上画「眼下星星」（李豆沙标志性细节：左眼下蓝色五角星）
function drawCheekStar(data, width, height, ch) {
  // 脸部圆形贴图在 atlas 左上角（椭圆范围，比例坐标）
  const cx0 = 0.119, cy0 = 0.142, ra = 0.112, rb = 0.137; // 椭圆中心与半径（比例）
  const cx = cx0 * width, cy = cy0 * height;
  const a = ra * width, b = rb * height;
  // 星星位置：观众视角右眼外下角、贴着下眼睑（对齐官方立绘）
  const sx = cx + a * 0.60, sy = cy + b * 0.52;
  const R = a * 0.14; // 星星大小（五角星外半径）
  const col = [116, 158, 232]; // 蓝星（实心）
  const n = paintStar5(data, width, height, ch, sx, sy, R, col, col, false);
  console.log(`  t0: cheek star(5) ${n} px @ (${Math.round(sx)},${Math.round(sy)})`);
}

// ---------- texture_00：头发银白 + 红丝带转蓝 + 脸颊星星 ----------
function recolorT0(data, width, height, ch) {
  let hair = 0, bow = 0;
  for (let i = 0; i < width * height; i++) {
    const o = i * ch;
    if (ch === 4 && data[o + 3] < 8) continue;
    const r = data[o], g = data[o + 1], b = data[o + 2];
    const fx = (i % width) / width, fy = Math.floor(i / width) / height;
    const [h, s, v] = rgb2hsv(r, g, b);

    // 保护嘴部/耳内粉色区
    const protectedPink = (fx < 0.08 && fy > 0.49 && fy < 0.61) || (fx >= 0.08 && fx < 0.23 && fy > 0.49 && fy < 0.60 && s < 0.45 && v > 0.75);

    // 红丝带 → 蓝蝴蝶结
    if (!protectedPink && (h <= 18 || h >= 340) && s > 0.32 && v > 0.15 && v < 0.92) {
      const [nr, ng, nb] = redToBlueBow(r, g, b);
      data[o] = Math.round(nr); data[o + 1] = Math.round(ng); data[o + 2] = Math.round(nb);
      bow++;
      continue;
    }
    // 头发 → 银白
    if (h >= 12 && h <= 52 && s >= 0.14 && s <= 0.62 && v >= 0.18 && v <= 0.82) {
      const [nr, ng, nb] = hairToSilver(r, g, b);
      data[o] = Math.round(nr); data[o + 1] = Math.round(ng); data[o + 2] = Math.round(nb);
      hair++;
    }
  }
  drawCheekStar(data, width, height, ch);
  console.log(`  t0: hair ${hair} px, bow ${bow} px`);
}

// 袜口蓝色饰带：逐列检测皮肤→白袜过渡线，沿边画 16px 蓝带
function paintSockBands(data, width, height, ch) {
  let n = 0;
  for (let x = 845; x < 1300; x++) {
    let bound = -1;
    for (let y = 750; y < 1250; y++) {
      const o = (y * width + x) * ch;
      if (ch === 4 && data[o + 3] < 8) continue;
      const [h, s, v] = rgb2hsv(data[o], data[o + 1], data[o + 2]);
      if (h >= 190 && h <= 265 && s < 0.22 && v > 0.72) { bound = y; break; }
    }
    if (bound < 0) continue;
    for (let y = bound; y < Math.min(bound + 16, 1260); y++) {
      const o = (y * width + x) * ch;
      if (ch === 4 && data[o + 3] < 8) continue;
      const [h2, , v2] = rgb2hsv(data[o], data[o + 1], data[o + 2]);
      if (!(h2 >= 190 && h2 <= 265 && v2 > 0.6)) continue;
      data[o] = Math.round(data[o] * 0.25 + 96 * 0.75);
      data[o + 1] = Math.round(data[o + 1] * 0.25 + 128 * 0.75);
      data[o + 2] = Math.round(data[o + 2] * 0.25 + 202 * 0.75);
      n++;
    }
  }
  console.log(`  t1 decorate: sock bands ${n} px`);
}

// 裙摆星星图案 + 胸口蝴蝶结白色结心（对齐偶像服立绘；星星为五角星）
function decorateT1(data, width, height, ch) {
  // 裙子 bbox（atlas 像素）
  const sL = 16, sR = 780, sT = 1195, sB = 1430;
  const bw = sR - sL, bh = sB - sT;
  const white = [245, 249, 255], gold = [242, 196, 92], coreW = white, coreG = gold;
  let total = 0;
  const stars = [
    [0.20, 0.32, 15, white, coreW],
    [0.44, 0.62, 13, white, coreW],
    [0.66, 0.30, 14, white, coreW],
    [0.88, 0.58, 13, white, coreW],
    [0.30, 0.80, 12, white, coreW],
  ];
  for (const [fx, fy, r, col, core] of stars) {
    total += paintStar5(data, width, height, ch, sL + fx * bw, sT + fy * bh, r, col, core, true);
  }
  total += paintStar5(data, width, height, ch, sL + 0.72 * bw, sT + 0.42 * bh, 26, gold, coreG, true);
  console.log(`  t1 decorate: skirt stars ${total} px`);

  // 胸口蝴蝶结白色结心（打结点在两环交汇处）
  const bx = 108, by = 1790, br = 12;
  let knot = 0;
  const rOut = br + 2;
  for (let dy = -rOut; dy <= rOut; dy++) {
    for (let dx = -rOut; dx <= rOut; dx++) {
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > br + 1.5) continue;
      const x = bx + dx, y = by + dy;
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const o = (y * width + x) * ch;
      if (ch === 4 && data[o + 3] < 8) continue;
      const [h0, s0] = rgb2hsv(data[o], data[o + 1], data[o + 2]);
      if (!(h0 >= 185 && h0 <= 265)) continue; // 只盖蓝色结面
      const alpha = d < br - 1 ? 1 : clamp((br + 1.5 - d) / 2.5, 0, 1);
      data[o] = Math.round(data[o] * (1 - alpha) + 250 * alpha);
      data[o + 1] = Math.round(data[o + 1] * (1 - alpha) + 252 * alpha);
      data[o + 2] = Math.round(data[o + 2] * (1 - alpha) + 255 * alpha);
      knot++;
    }
  }
  console.log(`  t1 decorate: bow knot ${knot} px`);
}

// ---------- texture_00 精修：刘海补染 + 发梢蓝渐变 + 缎带星星 ----------
function refineT0(data, width, height, ch) {
  let bangs = 0, tip = 0;
  // 发梢渐变区：[x0,x1,y0,y1,最大混合强度]（双马尾两束 + 后发下摆）
  const tipZones = [
    [580, 1240, 860, 1360, 0.5],
    [1280, 1990, 1540, 2010, 0.38],
  ];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * ch;
      if (ch === 4 && data[o + 3] < 8) continue;
      const r = data[o], g = data[o + 1], b = data[o + 2];
      const [h, s, v] = rgb2hsv(r, g, b);

      // 1) 桃色刘海块（原漏染的高亮棕发）→ 银白
      if (x >= 540 && x <= 1080 && y >= 30 && y <= 470 && h >= 10 && h <= 60 && s >= 0.03 && s <= 0.6 && v >= 0.55) {
        const nv = clamp(0.88 + (v - 0.9) * 0.35, 0.82, 0.99);
        const [nr, ng, nb] = hsv2rgb(215, clamp(s * 0.25, 0.02, 0.12), nv);
        data[o] = Math.round(nr); data[o + 1] = Math.round(ng); data[o + 2] = Math.round(nb);
        bangs++;
        continue;
      }

      // 2) 银白发梢 → 淡蓝渐变（越靠近发梢越蓝，暗部少染）
      const isHairish = (s < 0.3 && v > 0.35) && (h >= 180 && h <= 270 || v > 0.5);
      if (!isHairish) continue;
      for (const [zx0, zx1, zy0, zy1, fMax] of tipZones) {
        if (x < zx0 || x > zx1 || y < zy0 || y > zy1) continue;
        const t = Math.pow(clamp((y - zy0) / (zy1 - zy0), 0, 1), 1.6);
        const f = t * fMax * clamp(v / 0.9, 0.25, 1);
        data[o] = Math.round(r * (1 - f) + 172 * f);
        data[o + 1] = Math.round(g * (1 - f) + 200 * f);
        data[o + 2] = Math.round(b * (1 - f) + 238 * f);
        tip++;
        break;
      }
    }
  }
  console.log(`  t0 refine: bangs ${bangs} px, tip gradient ${tip} px`);

  // 3) 蓝色缎带/蝴蝶结上画白色五角星（位置按蓝色像素密度图实测；
  //    注意 (160,915)/(368,915) 一带是眼睛——Hiyori 自带星星瞳孔，不要覆盖）
  const ribbonStars = [
    [295, 1437, 12],   // 胸前斜缎带
    [64, 1690, 13],    // 左竖缎带
    [176, 1690, 13],   // 右竖缎带
  ];
  let rs = 0;
  for (const [sx, sy, R] of ribbonStars) {
    rs += paintStar5(data, width, height, ch, sx, sy, R, [250, 252, 255], [250, 252, 255], true);
  }
  console.log(`  t0 refine: ribbon stars ${rs} px`);
}

// 简易蝴蝶结：左右两片三角翼 + 中心结（可限制只画在浅色像素上）
function paintBow(data, width, height, ch, cx, cy, R, col, onlyLight) {
  const wings = [
    [[-1.15, -0.62], [-1.15, 0.62], [-0.1, 0]],
    [[1.15, -0.62], [1.15, 0.62], [0.1, 0]],
  ];
  let n = 0;
  const rOut = Math.ceil(R * 1.2) + 2;
  const inBow = (px, py) => {
    if (Math.hypot(px, py) < R * 0.34) return true; // 中心结
    for (const tri of wings) {
      const pts = tri.map(([ux, uy]) => [ux * R, uy * R]);
      if (pointInPoly(px, py, pts)) return true;
    }
    return false;
  };
  for (let dy = -rOut; dy <= rOut; dy++) {
    for (let dx = -rOut; dx <= rOut; dx++) {
      if (!inBow(dx, dy)) continue;
      const x = Math.round(cx + dx), y = Math.round(cy + dy);
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const o = (y * width + x) * ch;
      if (ch === 4 && data[o + 3] < 8) continue;
      if (onlyLight) {
        const [, s0, v0] = rgb2hsv(data[o], data[o + 1], data[o + 2]);
        if (!(s0 < 0.28 && v0 > 0.68)) continue; // 只画在白袜上
      }
      data[o] = Math.round(data[o] * 0.15 + col[0] * 0.85);
      data[o + 1] = Math.round(data[o + 1] * 0.15 + col[1] * 0.85);
      data[o + 2] = Math.round(data[o + 2] * 0.15 + col[2] * 0.85);
      n++;
    }
  }
  return n;
}

// ---------- texture_01 精修：袜口蝴蝶结 + 鞋底蓝边 + 裙摆补星 ----------
function refineT1(data, width, height, ch) {
  // 1) 袜口侧面小蓝蝴蝶结：沿每只袜子外侧找蓝色饰带顶边，往下贴一只结
  //    左袜结贴外侧左缘 (+14)，右袜结贴外侧右缘 (-14)，避免越出袜子
  const bowCols = [
    [852, 1],
    [1276, -1],
  ];
  let bows = 0;
  for (const [bx0, dir] of bowCols) {
    let bandY = -1, bx = bx0;
    for (const cx of [bx0, bx0 - 6 * dir, bx0 - 12 * dir]) {
      for (let y = 900; y < 1350; y++) {
        const o = (y * width + cx) * ch;
        if (ch === 4 && data[o + 3] < 8) continue;
        const [h0, s0, v0] = rgb2hsv(data[o], data[o + 1], data[o + 2]);
        if (h0 >= 200 && h0 <= 240 && s0 > 0.3 && v0 > 0.55) { bandY = y; bx = cx; break; }
      }
      if (bandY >= 0) break;
    }
    if (bandY < 0) continue;
    bows += paintBow(data, width, height, ch, bx + 14 * dir, bandY + 58, 17, [96, 138, 214], true);
  }
  console.log(`  t1 refine: sock bows ${bows} px`);

  // 2) 鞋底蓝边：每只鞋矩形内逐列找不透明最底端，往上 55px 染蓝
  const shoes = [
    [30, 215, 1400, 1820],
    [220, 465, 1400, 1820],
  ];
  let sole = 0;
  for (const [x0, x1, y0, y1] of shoes) {
    for (let x = x0; x <= x1; x++) {
      let bottom = -1;
      for (let y = y1; y >= y0; y--) {
        const o = (y * width + x) * ch;
        if (ch === 4 && data[o + 3] < 8) continue;
        bottom = y; break;
      }
      if (bottom < 0) continue;
      for (let y = Math.max(y0, bottom - 60); y <= bottom; y++) {
        const o = (y * width + x) * ch;
        if (ch === 4 && data[o + 3] < 8) continue;
        const [, s0, v0] = rgb2hsv(data[o], data[o + 1], data[o + 2]);
        if (!(s0 < 0.5 && v0 > 0.3)) continue;
        const f = 0.55;
        data[o] = Math.round(data[o] * (1 - f) + 118 * f);
        data[o + 1] = Math.round(data[o + 1] * (1 - f) + 158 * f);
        data[o + 2] = Math.round(data[o + 2] * (1 - f) + 226 * f);
        sole++;
      }
    }
  }
  console.log(`  t1 refine: shoe soles ${sole} px`);

  // 3) 裙摆补两颗小金星（与已有白星错开）
  const sL = 16, sR = 780, sT = 1195, sB = 1430;
  const bw = sR - sL, bh = sB - sT;
  const gold = [242, 196, 92];
  let stars = 0;
  for (const [fx, fy, r] of [[0.08, 0.58, 10], [0.56, 0.78, 10]]) {
    stars += paintStar5(data, width, height, ch, sL + fx * bw, sT + fy * bh, r, gold, gold, true);
  }
  console.log(`  t1 refine: extra skirt stars ${stars} px`);
}

// ---------- texture_01：整套服装替换 ----------
function recolorT1(data, width, height, ch) {
  let top = 0, skirt = 0, sock = 0, collar = 0, boots = 0;
  for (let i = 0; i < width * height; i++) {
    const o = i * ch;
    if (ch === 4 && data[o + 3] < 8) continue;
    const r = data[o], g = data[o + 1], b = data[o + 2];
    const fx = (i % width) / width, fy = Math.floor(i / width) / height;
    const [h, s, v] = rgb2hsv(r, g, b);
    const br = r === 0 ? 9 : b / r; // 蓝/红比：区分米色衣服与皮肤的关键

    // 白色（高光/纽扣/白袜）保持
    if (s < 0.08 && v > 0.93) continue;
    // 蓝色系
    if (h >= 190 && h <= 260) {
      const inCollar = fx > 0.20 && fx < 0.50 && fy > 0.80;
      const inSkirt = fx < 0.42 && fy > 0.58 && fy < 0.78;
      const inSocks = fx > 0.36 && fx < 0.70 && fy > 0.36;
      if (v < 0.60) {
        if (inCollar) { const c = collarNavy(r, g, b); data[o] = c[0] | 0; data[o + 1] = c[1] | 0; data[o + 2] = c[2] | 0; collar++; }
        else if (inSkirt) { const c = navyToBlueSkirt(r, g, b); data[o] = c[0] | 0; data[o + 1] = c[1] | 0; data[o + 2] = c[2] | 0; skirt++; }
        else if (inSocks) { const c = navyToWhiteSock(r, g, b); data[o] = c[0] | 0; data[o + 1] = c[1] | 0; data[o + 2] = c[2] | 0; sock++; }
        else if (s < 0.35 && v > 0.55) { // 浅蓝装饰带 → 亮蓝蝴蝶结色
          const c = redToBlueBow(120, 120, 200);
          data[o] = c[0] | 0; data[o + 1] = c[1] | 0; data[o + 2] = c[2] | 0; skirt++;
        }
        // 其余深蓝保持
      }
      continue;
    }
    // 米色开衫/袖子 → 白色：排除大腿与小腿皮肤矩形区（其余米色都是衣服）
    const ax = i % width, ay = Math.floor(i / width);
    const inLegs =
      (ax >= 620 && ax < 1230 && ay >= 20 && ay < 745) ||   // 大腿两块
      (ax >= 820 && ax < 1310 && ay >= 745 && ay < 1690);   // 小腿（过膝袜上方的皮肤）
    if (
      !inLegs && h >= 24 && h <= 62 && s >= 0.10 && s <= 0.55 && v >= 0.5 && br < 0.845
    ) {
      const c = beigeToWhiteTop(r, g, b);
      data[o] = Math.round(c[0]); data[o + 1] = Math.round(c[1]); data[o + 2] = Math.round(c[2]);
      top++;
      continue;
    }
    // 棕色鞋（含浅棕/中棕，避免斑驳）
    if (h >= 8 && h <= 48 && s > 0.10 && v < 0.88 && br < 0.80) {
      const c = brownToBoots(r, g, b);
      data[o] = Math.round(c[0]); data[o + 1] = Math.round(c[1]); data[o + 2] = Math.round(c[2]);
      boots++;
    }
  }
  console.log(`  t1: top ${top}, skirt ${skirt}, sock ${sock}, collar ${collar}, boots ${boots}`);
}

async function recolorFile(rel, outRel, fn) {
  const { data, info } = await sharp(path.join(SRC, rel)).raw().toBuffer({ resolveWithObject: true });
  fn(data, info.width, info.height, info.channels);
  const png = await sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } }).png().toBuffer();
  fs.writeFileSync(path.join(DST, outRel), png);
  console.log('wrote', outRel);
}

async function main() {
  fs.mkdirSync(path.join(DST, 'Lidousha.2048'), { recursive: true });
  fs.mkdirSync(path.join(DST, 'motions'), { recursive: true });

  await recolorFile('Hiyori.2048/texture_00.png', 'Lidousha.2048/texture_00.png', (d, w, h, c) => {
    recolorT0(d, w, h, c);
    refineT0(d, w, h, c);
  });
  await recolorFile('Hiyori.2048/texture_01.png', 'Lidousha.2048/texture_01.png', (d, w, h, c) => {
    recolorT1(d, w, h, c);
    decorateT1(d, w, h, c);
    paintSockBands(d, w, h, c);
    refineT1(d, w, h, c);
  });
  await sharp(path.join(SRC, 'Hiyori.2048/texture_00.png')).metadata(); // noop keep sharp import used

  // 其余文件（moc3/physics/pose/cdi/userdata/motions/model3.json）
  for (const f of fs.readdirSync(SRC)) {
    const p = path.join(SRC, f);
    if (fs.statSync(p).isFile() && !f.endsWith('.model3.json')) {
      fs.copyFileSync(p, path.join(DST, f.replace(/^Hiyori/, 'Lidousha')));
    }
  }
  for (const f of fs.readdirSync(path.join(SRC, 'motions'))) {
    fs.copyFileSync(path.join(SRC, 'motions', f), path.join(DST, 'motions', f));
  }
  const src = JSON.parse(fs.readFileSync(path.join(SRC, 'Hiyori.model3.json'), 'utf8'));
  src.FileReferences.Moc = 'Lidousha.moc3';
  src.FileReferences.Textures = src.FileReferences.Textures.map((t) => t.replace('Hiyori.2048', 'Lidousha.2048'));
  for (const k of ['Physics', 'Pose', 'UserData', 'DisplayInfo']) {
    if (src.FileReferences[k]) src.FileReferences[k] = src.FileReferences[k].replace(/^Hiyori/, 'Lidousha');
  }
  fs.writeFileSync(path.join(DST, 'Lidousha.model3.json'), JSON.stringify(src, null, '\t'));
  console.log('done ->', DST);
}

main().catch((e) => { console.error(e); process.exit(1); });

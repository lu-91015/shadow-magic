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

// 在脸部贴图上画「眼下星星」（李豆沙标志性细节：左眼下蓝色四角星）
function drawCheekStar(data, width, height, ch) {
  // 脸部圆形贴图在 atlas 左上角（椭圆范围，比例坐标）
  const cx0 = 0.119, cy0 = 0.142, ra = 0.112, rb = 0.137; // 椭圆中心与半径（比例）
  const cx = cx0 * width, cy = cy0 * height;
  const a = ra * width, b = rb * height;
  // 星星位置：椭圆内右下（=角色左眼下方脸颊）
  const sx = cx + a * 0.46, sy = cy + b * 0.40;
  const R = a * 0.16; // 星星大小
  const p = 0.55; // 四角星凹度
  const col = [116, 158, 232]; // 蓝星
  const core = [232, 242, 255]; // 星心微亮
  let n = 0;
  const rOut = Math.ceil(R) + 2;
  for (let dy = -rOut; dy <= rOut; dy++) {
    for (let dx = -rOut; dx <= rOut; dx++) {
      const adx = Math.abs(dx), ady = Math.abs(dy);
      // 四角星距离场：|x|^p+|y|^p 归一化
      const d = (Math.pow(adx, p) + Math.pow(ady, p)) / Math.pow(R, p);
      if (d > 1.12) continue;
      const x = Math.round(sx + dx), y = Math.round(sy + dy);
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const o = (y * width + x) * ch;
      if (ch === 4 && data[o + 3] < 8) continue;
      // 软边缘 + 星心提亮
      const alpha = d < 0.92 ? 1 : clamp((1.12 - d) / 0.2, 0, 1);
      const cc = d < 0.45 ? core : col;
      data[o] = Math.round(data[o] * (1 - alpha) + cc[0] * alpha);
      data[o + 1] = Math.round(data[o + 1] * (1 - alpha) + cc[1] * alpha);
      data[o + 2] = Math.round(data[o + 2] * (1 - alpha) + cc[2] * alpha);
      n++;
    }
  }
  console.log(`  t0: cheek star ${n} px @ (${Math.round(sx)},${Math.round(sy)})`);
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
    // 米色衣服（含袖子阴影）：b/r 判别，区分于皮肤
    if (h >= 24 && h <= 62 && s >= 0.10 && s <= 0.55 && v >= 0.5 && br < 0.845) {
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

  await recolorFile('Hiyori.2048/texture_00.png', 'Lidousha.2048/texture_00.png', recolorT0);
  await recolorFile('Hiyori.2048/texture_01.png', 'Lidousha.2048/texture_01.png', recolorT1);

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
  fs.writeFileSync(path.join(DST, 'Lidousha.model3.json'), JSON.stringify(src, null, '\t'));
  console.log('done ->', DST);
}

main().catch((e) => { console.error(e); process.exit(1); });

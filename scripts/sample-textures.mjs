// 采样贴图关键部位颜色，为精细化重绘建立参照
import sharp from 'sharp';

const files = [
  'public/live2d/Hiyori/Hiyori.2048/texture_00.png',
  'public/live2d/Hiyori/Hiyori.2048/texture_01.png',
];

for (const f of files) {
  const { data, info } = await sharp(f).raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const px = (fx, fy) => {
    const x = Math.round(fx * width), y = Math.round(fy * height);
    const o = (y * width + x) * channels;
    return `(${fx.toFixed(2)},${fy.toFixed(2)})=rgb(${data[o]},${data[o + 1]},${data[o + 2]})`;
  };
  console.log('==', f, `${width}x${height}`);
  if (f.includes('texture_00')) {
    console.log(' face-skin  :', px(0.13, 0.12), px(0.35, 0.12));
    console.log(' hair-bangs :', px(0.42, 0.08), px(0.38, 0.15));
    console.log(' hair-back  :', px(0.78, 0.75), px(0.65, 0.55));
    console.log(' hair-hi    :', px(0.75, 0.18));
    console.log(' ribbon-red :', px(0.135, 0.72), px(0.09, 0.85));
    console.log(' eye-blue   :', px(0.095, 0.455), px(0.20, 0.455));
    console.log(' blush      :', px(0.10, 0.61));
  } else {
    console.log(' cardigan   :', px(0.17, 0.30), px(0.30, 0.42), px(0.07, 0.15));
    console.log(' cardigan-sh:', px(0.17, 0.55), px(0.36, 0.50));
    console.log(' sleeve     :', px(0.78, 0.10), px(0.88, 0.55), px(0.75, 0.85));
    console.log(' skirt      :', px(0.16, 0.66), px(0.30, 0.68), px(0.08, 0.64));
    console.log(' sock-dark  :', px(0.46, 0.68), px(0.55, 0.60), px(0.43, 0.78));
    console.log(' sock-top   :', px(0.45, 0.42), px(0.52, 0.45));
    console.log(' shoe-brown :', px(0.09, 0.82), px(0.16, 0.86));
    console.log(' leg-skin   :', px(0.42, 0.10), px(0.52, 0.12), px(0.44, 0.35));
    console.log(' blue-strap :', px(0.26, 0.79), px(0.39, 0.75));
    console.log(' collar     :', px(0.36, 0.88), px(0.42, 0.91));
    console.log(' sock-cuff  :', px(0.32, 0.87), px(0.50, 0.86));
  }
}

// 生成熊猫头麦克风贴片（白头+黑耳+灰网罩+深色手柄）
import sharp from 'sharp';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="200">
  <g>
    <!-- 手柄 -->
    <rect x="52" y="86" width="24" height="100" rx="12" fill="#3a3f4a"/>
    <rect x="56" y="90" width="16" height="40" rx="8" fill="#4d5460"/>
    <!-- 耳朵 -->
    <circle cx="34" cy="26" r="17" fill="#2b2f38"/>
    <circle cx="94" cy="26" r="17" fill="#2b2f38"/>
    <!-- 头 -->
    <circle cx="64" cy="58" r="40" fill="#f7f9fc"/>
    <circle cx="64" cy="58" r="40" fill="none" stroke="#d8dee8" stroke-width="2"/>
    <!-- 眼睛 -->
    <circle cx="48" cy="56" r="5.5" fill="#2b2f38"/>
    <circle cx="80" cy="56" r="5.5" fill="#2b2f38"/>
    <!-- 鼻嘴 -->
    <ellipse cx="64" cy="72" rx="9" ry="6.5" fill="#2b2f38"/>
    <!-- 网罩环 -->
    <rect x="30" y="84" width="68" height="9" rx="4.5" fill="#9aa3b2"/>
  </g>
</svg>`;

await sharp(Buffer.from(svg)).png().toFile('public/live2d/lidousha/mic.png');
console.log('written mic.png');

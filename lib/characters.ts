// 首页立绘循环展示配置（原始素材由 scripts/fetch-characters.ts 下载，
// 抠图版本由 scripts/cutout-characters.ts 生成至 public/characters/cut/）。
export interface Character {
  name: string;
  src: string | null;
  caption?: string;
}

export const CHARACTERS: Character[] = [
  { name: "李豆沙", src: "/characters/cut/dousha-0.png" },
  { name: "李豆沙", src: "/characters/cut/dousha-1.png" },
  { name: "李豆沙", src: "/characters/cut/dousha-2.png" },
  { name: "李豆沙", src: "/characters/cut/dousha-3.png" },
  { name: "李豆沙", src: "/characters/cut/dousha-4.png" },
  { name: "李豆沙", src: "/characters/cut/dousha-5.png" },
  { name: "李豆沙", src: "/characters/cut/dousha-6.png" },
  { name: "李豆沙", src: "/characters/cut/dousha-9.png" },
  { name: "李豆沙", src: "/characters/cut/dousha-11.png" },
];

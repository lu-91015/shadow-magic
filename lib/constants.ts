// 李豆沙_Channel 基础常量（均来自实测 B站数据）
export const UID = '1703797642';
export const ROOM_ID = '22966160';
// 直播回放合集（"直播回放"系列，共 939 条回放）；mid 即 UID。
// 直播/唱歌/游戏时长均来自此合集，按视频标题关键词归类。
export const LIVE_SERIES_ID = 210668;
export const TAG_NAME = '李豆沙';
export const TAG_ID = '19254526';

// 切片墙“已确认保留”的名号白名单：标题命中其中任一即展示。
// 人工判断后的 X豆沙 变体：本人 李豆沙、CP 名 礼豆沙/室豆沙/悠豆沙/路豆沙/烤豆沙，以及罕见 CP 名 李与春/lihiru。
export const CLIP_APPROVED_NAMES = [
  '李豆沙',
  '礼豆沙',
  '室豆沙',
  '悠豆沙',
  '路豆沙',
  '烤豆沙',
  '李与春',
  'lihiru',
];

// 李豆沙头像：已下载到本地 public/avatar.webp（B站 CDN 热链有 referer 限制，本地最稳）
export const AVATAR_URL = '/avatar.webp';

export const SITE_TITLE = '李豆沙_Channel';
export const SITE_DESC = '李豆沙非官方资料站 · 直播 · 歌单 · 年度统计';
export const LIVE_URL = `https://live.bilibili.com/${ROOM_ID}`;
export const SPACE_URL = `https://space.bilibili.com/${UID}`;
export const TAG_URL = `https://search.bilibili.com/all?keyword=${encodeURIComponent('#' + TAG_NAME)}`;

// 现有歌切站（歌单数据源，本站整合为模块）
export const PLAYLIST_SITE = 'https://www.lidousha.top/';

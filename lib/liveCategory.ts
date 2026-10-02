// 直播回放分类体系（按回放标题粗略归类，后台可人工覆盖）
// all（全部）仅用于前台筛选，不作为可标记的类别。

export const LIVE_CATEGORY_KEYS = [
  'official',
  'sing',
  'special',
  'collab',
  'marshmallow',
  'game',
  'talk',
  'other',
] as const;

export type LiveCategoryKey = (typeof LIVE_CATEGORY_KEYS)[number];

export const LIVE_CATEGORIES: {
  key: LiveCategoryKey;
  label: string;
  chipCls: string;
}[] = [
  { key: 'official', label: '官方活动回', chipCls: 'bg-amber-500/20 text-amber-200' },
  { key: 'sing', label: '歌回', chipCls: 'bg-rose-500/20 text-rose-200' },
  { key: 'special', label: '特殊回', chipCls: 'bg-pink-500/20 text-pink-200' },
  { key: 'collab', label: '联动回', chipCls: 'bg-fuchsia-500/20 text-fuchsia-200' },
  { key: 'marshmallow', label: '棉花糖回', chipCls: 'bg-orange-500/20 text-orange-200' },
  { key: 'game', label: '游戏回', chipCls: 'bg-sky-500/20 text-sky-200' },
  { key: 'talk', label: '杂谈回', chipCls: 'bg-teal-500/20 text-teal-200' },
  { key: 'other', label: '其他', chipCls: 'bg-white/10 text-white/70' },
];

export const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(
  LIVE_CATEGORIES.map((c) => [c.key, c.label]),
);
export const CATEGORY_CHIP: Record<string, string> = Object.fromEntries(
  LIVE_CATEGORIES.map((c) => [c.key, c.chipCls]),
);

// 旧的三分类（game/other）兼容映射：历史数据里存的是旧值。
// 旧值 sing（唱歌回）如今就是正式分类，不再映射到 special。
const LEGACY_MAP: Record<string, LiveCategoryKey> = {
  game: 'game',
  other: 'other',
};

// 各类别关键词（越具体越靠前，命中即返回）
// 说明：同一场可能兼具多个属性（如「沉浸式唱歌 + 杂谈」），按下列优先级取最先命中者。
const RULES: { key: LiveCategoryKey; re: RegExp }[] = [
  // 棉花糖回：读粉丝来信 / 提问箱 / 集中回答
  {
    key: 'marshmallow',
    re: /(棉花糖|提问箱|来信|读信|相談|烦恼相談|答疑|回答一切问题|回答问题|建议箱|表白回|誊写|墓志铭)/i,
  },
  // 联动回：与他人连线 / 合作 / 双人企划
  {
    key: 'collab',
    re: /(联动|连麦|连线|合作|串台|同框|双人|群星|同行|一起冒险|feat\.?|with\s)/i,
  },
  // 官方活动回：漫展线下、官方企划、新衣/装扮发布、跨年公演等
  {
    key: 'official',
    re: /(BW|萤火虫|漫展|嘉年华|官方|线下|公演|颁奖|首发|首曝|披露回|新衣|发售|发布|年会|跨年|活动日)/i,
  },
  // 游戏回：具体游戏名 + 通用玩法词
  {
    key: 'game',
    re: /(游戏|实况|试玩|通关|速通|副本|boss|BOSS|开黑|上分|联机|抽卡|炸麦|直播挑战|艰难游戏|黑相集|宝可梦|pokemon|韭菜|夜雀食堂|东方夜雀|锈湖|湖之仆|杖剑传说|爆炸小队|炸弹人|魔法少女的魔女(审判|裁判)|三个炸弹|鹅鸭杀|终末地|呼唤少女|终末了|原神|星铁|绝区零|塞尔达|王国之泪|守望|apex|valorant|瓦罗兰特|蛋仔|第五人格|黑神话|糖豆人|宅墓地|恐鬼症|宠物小精灵|马里奥|路易吉|猛兽派对|胡闹厨房)/i,
  },
  // 歌回：唱歌专场（演唱会 / 点歌 / 翻唱 / 耐久等）
  {
    key: 'sing',
    re: /(歌回|歌会|演唱会|唱歌|清唱|翻唱|首唱|合唱|点歌|歌单|小唱|唱一会|kimo熊合唱|耐久|\d+首|ktv|KTV|卡拉OK|串烧|麦序)/i,
  },
  // 特殊回：3D / 生日 / 周年 / 宅舞等纪念性专场
  {
    key: 'special',
    re: /(周年|纪念日|\d{3,}天了|生日|生日会|宅舞|连跳|3D|披露|公演)/i,
  },
  // 杂谈回：明确聊天/闲聊 + 她长期固定的闲聊系列
  {
    key: 'talk',
    re: /(杂谈|闲聊|聊天|小聊|卧谈会|夜谈|谈心|生存报告|充电站|工作音|歌杂|歌谈|悄悄话|悄悄|偷偷摸摸|轮回|聚会|登场|在这李|在这|来李|李来|来了|好吗|就是|而已|睡醒|醒了|早安|晚安|午安|深夜|午休|你好|喂喂)/i,
  },
];

// 按标题自动归类（无命中 → 杂谈回，因为她的常态就是杂谈，异常/待定的可在后台改标为「其他」）
export function classifyLiveTitle(title: string): LiveCategoryKey {
  const raw = title || '';
  // 去掉尾部标点，便于以「歌」「唱」收尾的判定
  const t = raw.trim().replace(/[!！?？。、…~～\s]+$/, '');
  if (!t) return 'talk';
  // 「歌杂 / 歌谈」= 边唱边聊，算杂谈；其余带歌/唱字的多为唱歌专场
  if (/(歌杂|歌谈)/.test(t)) return 'talk';
  if (/[歌唱]/.test(t)) return 'sing';
  for (const r of RULES) {
    if (r.re.test(t)) return r.key;
  }
  return 'talk';
}

// 某场直播的最终分类：人工标记优先，否则按标题自动归类
export function resolveCategory(row: {
  title?: string | null;
  category_manual?: string | null;
}): LiveCategoryKey {
  const manual = row.category_manual;
  if (manual) {
    const key = LEGACY_MAP[manual] ?? (manual as LiveCategoryKey);
    if (LIVE_CATEGORY_KEYS.includes(key)) return key;
  }
  return classifyLiveTitle(row.title ?? '');
}

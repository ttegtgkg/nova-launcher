// i18n.mjs —— 模组中文名库 / 中文搜索转换 / 外部链接
// 说明：中文译名参考 MC百科(MCMOD) 与社区通用叫法，用于显示与搜索辅助。
// 这些译名由中文社区长期使用形成，此处仅作为「别名索引」提供，不代表官方命名。

/** slug / 英文 id -> 中文名 */
export const MOD_CN = {
  // ---- 性能优化（客户端）----
  'sodium': '钠',
  'sodium-extra': '钠 · 扩展',
  'lithium': '锂',
  'phosphor': '磷光',
  'krypton': '氪',
  'ferrite-core': '铁氧体核心',
  'indium': '铟',
  'hydrogen': '氢',
  'starlight': '星光',
  'embeddium': '嵌入版',
  'rubidium': '铷',
  'oculus': '眼（Forge 光影）',
  'iris': '鸢尾花',
  'optifine': '高清修复',
  'betterfps': '更好的 FPS',
  'modernfix': '现代修复',
  'memoryleakfix': '内存泄漏修复',
  'entityculling': '实体剔除',
  'immediatelyfast': '即时渲染加速',
  'badoptimizations': '性能负优化修复',
  'c2me-fabric': 'C2ME 多线程区块',

  // ---- 界面与实用 ----
  'jei': 'JEI 物品管理器',
  'roughly-enough-items': 'REI 物品管理器',
  'emi': 'EMI 物品管理器',
  'appleskin': '苹果皮',
  'journeymap': '旅程地图',
  'xaeros-minimap': 'Xaero 的小地图',
  'xaeros-world-map': 'Xaero 的世界地图',
  'jade': 'Jade 信息显示',
  'wthit': 'WTHIT 方块信息',
  'modmenu': '模组菜单',
  'cloth-config': 'Cloth 配置 API',
  'architectury-api': 'Architectury API',
  'geckolib': 'GeckoLib 动画库',
  'curios': '饰品栏 API',
  'patchouli': '帕秋莉手册',
  'simple-voice-chat': '简单语音聊天',
  'modrinth': 'Modrinth',
  'inventory-profiles-next': '背包整理',
  'shulkerboxtooltip': '潜影盒提示',
  'controlling': '按键冲突助手',
  'craftpresence': 'Discord 状态显示',
  'kubejs': 'KubeJS 脚本',
  'probejs': 'ProbeJS',
  'ftb-quests': 'FTB 任务',
  'ftb-library': 'FTB 库',
  'waystones': '传送石碑',
  'comforts': '睡袋',
  'sophisticated-backpacks': '精致背包',
  'corail-tombstone': '墓碑',
  'easy-villagers': '村民交易查询',
  'carry-on': '搬运',

  // ---- 大型玩法模组 ----
  'create': '机械动力',
  'appliedenergistics2': 'AE2 · 应用能源 2',
  'ae2': 'AE2 · 应用能源 2',
  'refined-storage': '精炼存储',
  'botania': '植物魔法',
  'thermal-expansion': '热力膨胀',
  'immersiveengineering': '沉浸工程',
  'mekanism': '通用机械',
  'draconic-evolution': '龙之研究',
  'actually-additions': '实用扩展',
  'extreme-reactors': '极端反应堆',
  'ender-io': '末影接口',
  'tinkers-construct': '匠魂',
  'projecte': '等价交换',
  'quark': '夸克',
  'supplementaries': '附属物',
  'farmers-delight': '农夫乐事',
  'cooking-for-blockheads': '懒人厨房',
  'distant-horizons': '遥远的地平线',
  'createaddition': '机械动力：附加',

  // ---- 世界生成 ----
  'twilightforest': '暮色森林',
  'biomesoplenty': '超多生物群系',
  'oh-the-biomes-youll-go': '你将去的生物群系',
  'terralith': 'Terralith 地形',
  'aether': '天境',
  'betterend': '更好的末地',
  'betternether': '更好的下界',
  'tectonic': '地壳地形',
  'the-lost-cities': '失落之城',
  'yungs-better-mineshafts': 'YUNG 的更好矿井',

  // ---- 光影 ----
  'complementary-reimagined': 'Complementary 光影 · 重构版',
  'complementary-unbound': 'Complementary 光影 · 无界版',
  'complementary-shaders': 'Complementary 光影',
  'bsl-shaders': 'BSL 光影',
  'sildurs-vibrant-shaders': 'Sildur 光影',
  'chocapic13-shaders': 'Chocapic13 光影',
  'seus': 'SEUS 光影',
  'kapa-shaders': 'Kappa 光影',
  'solas-shader': 'Solas 光影',
  'nostalgia-shaders': 'Nostalgia 光影',
  'makeup-ultra-fast-shader': 'MakeUp 极致流畅光影',
  'rethinking-voxels': 'Rethinking Voxels 光影',
  'photon-shader': 'Photon 光影',

  // ---- 连锁挖矿 / 挖矿辅助 ----
  'veinminer': '矿脉矿工（连锁挖矿）',
  'ultimine-rewind': 'FTB Ultimine 重制版',
  'ultimine-unchained': 'Ultimine 解放',
  'create-ultimine': '机械动力 · 连锁挖掘',
  'excavate': '连锁采掘',
  'ore-excavation': '矿石连锁挖掘',

  // ---- 中文相关（本启动器内置推荐）----
  'i18nupdatemod': '自动汉化更新（CFPA 简中）',
  'i18nautoupdatemod': '自动汉化更新（CFPA · 重构版）',
  'chinese-tutorial': '中文本地化',
};

/** 汉化相关模组的 Modrinth 项目 id（用于一键安装） */
export const CFPA_MODS = [
  { id: 'PWERr14M', slug: 'i18nupdatemod', name: 'I18nUpdateMod', desc: 'CFPA 简中语言包自动下载与更新（经典版）' },
  { id: 'mEn7eS3l', slug: 'i18nautoupdatemod', name: 'I18nAutoUpdateMod', desc: 'CFPA 简中语言包自动更新（重构版，无启动阻塞）' },
];

/**
 * 热门模组的中文简介（人工撰写，优先于机器翻译显示）。
 * 只对最常见的几十个模组做，其余走 MyMemory 机器翻译。
 */
export const MOD_CN_DESC = {
  // 性能
  'sodium': '现代化的渲染引擎重写，大幅提升帧数并修复图形问题，低配机首选。',
  'sodium-extra': 'Sodium 的功能扩展，提供更多画面选项与细节调节。',
  'lithium': '通用游戏逻辑优化，改善物理、AI、方块刻等性能，不改变玩法。',
  'phosphor': '重写游戏光照引擎，显著减少光照计算带来的卡顿。',
  'krypton': '网络协议栈优化，降低多人游戏时的网络延迟与 CPU 占用。',
  'ferrite-core': '内存优化模组，压缩模型、纹理等资源的常驻内存占用。',
  'indium': '为 Sodium 提供 Fabric 渲染 API 兼容层，让使用它的模组正常渲染。',
  'iris': '光影加载器，让 Fabric 端也能使用 OptiFine 格式的光影包。',
  'oculus': 'Forge 端的光影加载器，等同于 Iris 的 Forge 版本。',
  'embeddium': 'Sodium 的 Forge 移植版，为 Forge 带来同样的渲染优化。',
  'rubidium': 'Sodium 的 Forge 移植版（早期版本），提供渲染优化。',
  'modernfix': '集合多种启动与运行优化，缩短加载时间、降低内存占用。',
  'memoryleakfix': '修复原版与部分模组中的内存泄漏问题。',
  'entityculling': '跳过看不见的实体的渲染计算，提升帧数。',
  'distant-horizons': '超远视距模组，以 LOD 方式渲染数千米外的地形。',
  'optifine': '老牌优化模组，集光影、连接纹理、性能优化于一体。',

  // 界面/实用
  'jei': '物品与合成配方查询，按 R 查看用途、按 U 查看配方。',
  'roughly-enough-items': '物品与配方管理器，支持合成、熔炼、酿造等全部配方查看。',
  'emi': '新一代物品与配方浏览器，界面简洁、支持拖拽自动合成。',
  'appleskin': '显示食物恢复的饱食度与饱和度，并在 HUD 上提示。',
  'journeymap': '全屏世界地图，支持路径点、死亡点与地形记录。',
  'xaeros-minimap': '小地图模组，支持路径点、实体雷达与多世界切换。',
  'xaeros-world-map': '全屏世界地图，与 Xaero 小地图联动。',
  'jade': '准星指向方块或实体时显示其详细信息。',
  'wthit': '方块与实体信息显示（WAILA 的继任者）。',
  'modmenu': '在游戏主界面提供模组列表与配置入口。',
  'cloth-config': '通用的模组配置界面 API，很多模组依赖它。',
  'architectury-api': '跨加载器开发 API，同时支持 Fabric 与 Forge。',
  'curios': '饰品栏 API，提供额外的装备槽位。',
  'patchouli': '游戏内说明书 API，很多模组用它做指南书。',
  'simple-voice-chat': '近距离语音聊天，支持 3D 空间音效与噪声抑制。',
  'waystones': '传送石碑，可在已激活的石碑之间快速传送。',
  'comforts': '睡袋，可以在白天睡觉且不设置重生点。',
  'sophisticated-backpacks': '可升级的背包系统，支持自动拾取与物品过滤。',
  'corail-tombstone': '死亡墓碑，把掉落物收进墓碑，防止装备丢失。',

  // 大型玩法
  'create': '机械动力，以齿轮、轴承与传送带构建自动化机械与工厂。',
  'appliedenergistics2': '应用能源 2，数字化存储与自动合成系统的经典模组。',
  'ae2': '应用能源 2，数字化存储与自动合成系统的经典模组。',
  'refined-storage': '精炼存储，用网格终端统一存取大量物品。',
  'botania': '植物魔法，以魔力花与符文构建独特的魔法自动化体系。',
  'thermal-expansion': '热力膨胀，提供机器、能源与物流的一整套工业化内容。',
  'immersiveengineering': '沉浸工程，写实风格的电力、多方块机器与线路。',
  'mekanism': '通用机械，从矿石处理到核聚变的完整科技树。',
  'draconic-evolution': '龙之研究，末影龙之后的强力装备与能量系统。',
  'ender-io': '末影接口，导管传输、机器与电容的一体化方案。',
  'tinkers-construct': '匠魂，自由组合材料打造工具与武器。',
  'projecte': '等价交换，用 EMC 值转换物品。',
  'quark': '夸克，大量原版风格的小功能与装饰方块集合。',
  'supplementaries': '附属物，补充原版风格的装饰方块与实用道具。',
  'farmers-delight': '农夫乐事，扩展农业与烹饪内容。',
  'twilightforest': '暮色森林，一个完整的冒险维度与 Boss 线。',
  'aether': '天境，天空之上的另一个维度与冒险内容。',
  'biomesoplenty': '超多生物群系，为世界生成增加数十种新地形。',
  'oh-the-biomes-youll-go': '你将去的生物群系，新增大量风格迥异的群系与方块。',

  // 光影
  'complementary-reimagined': 'Complementary 光影重构版，画面与性能平衡，适合日常游玩。',
  'complementary-unbound': 'Complementary 光影无界版，视觉效果更华丽、开销也更高。',
  'complementary-shaders': 'Complementary 光影，广受好评的写实风格光影。',
  'bsl-shaders': 'BSL 光影，色彩浓郁、氛围感强，配置选项丰富。',
  'sildurs-vibrant-shaders': 'Sildur 光影，鲜艳明快的色彩，配置档位多、适配范围广。',
  'chocapic13-shaders': 'Chocapic13 光影，经典的写实光照与水面效果。',
  'makeup-ultra-fast-shader': '主打极致流畅的光影，低配机也能开的画面增强。',
  'rethinking-voxels': 'Rethinking Voxels 光影，强调整体光照与体积光表现。',
  'photon-shader': 'Photon 光影，柔和自然的光照风格。',

  // 中文相关
  'i18nupdatemod': '自动下载并应用 CFPA 简体中文语言包，让模组界面变中文。',
  'i18nautoupdatemod': 'CFPA 中文语言包自动更新模组（重构版），启动时不阻塞。',
};

/** 取内置中文简介 */
export function cnDescription(slugOrTitle) {
  if (!slugOrTitle) return null;
  const key = String(slugOrTitle).toLowerCase();
  if (MOD_CN_DESC[key]) return MOD_CN_DESC[key];
  const compact = key.replace(/\s+/g, '-');
  return MOD_CN_DESC[compact] || null;
}

/**
 * 中文别名表：社区口语叫法 -> 候选 slug。
 * 有些模组在 Modrinth 上叫英文名、在国内被叫成完全不同的中文名，
 * 光靠 MOD_CN 的反向索引匹配不上，这里做显式映射。
 */
export const CN_ALIASES = {
  '连锁挖矿': ['veinminer', 'ultimine-rewind', 'ultimine-unchained', 'excavate'],
  '连锁破坏': ['veinminer', 'ultimine-rewind', 'ultimine-unchained', 'excavate'],
  '连锁采集': ['veinminer', 'ore-excavation'],
  '连锁': ['veinminer', 'ultimine-rewind', 'ultimine-unchained'],
  '矿脉矿工': ['veinminer'],
  '一键砍树': ['fallingtree', 'veinminer'],
  '砍树': ['fallingtree'],
  '物品管理器': ['jei', 'roughly-enough-items', 'emi'],
  '小地图': ['xaeros-minimap', 'journeymap'],
  '地图': ['xaeroworldmap', 'journeymap', 'xaeros-minimap'],
  '光影': ['iris', 'oculus', 'complementary-reimagined', 'bsl-shaders'],
  '优化': ['sodium', 'lithium', 'embeddium', 'modernfix'],
  '性能优化': ['sodium', 'lithium', 'krypton', 'ferrite-core'],
  '科技': ['mekanism', 'thermal-expansion', 'immersiveengineering'],
  '魔法': ['botania', 'ars-nouveau', 'blood-magic'],
  '农业': ['farmers-delight', 'pams-harvestcraft'],
  '储物': ['refined-storage', 'appliedenergistics2', 'sophisticated-storage'],
  '背包': ['sophisticated-backpacks', 'travelers-backpack'],
  '墓碑': ['corail-tombstone', 'gravestone-mod'],
  '传送': ['waystones'],
  '语音': ['simple-voice-chat'],
  '汉化': ['i18nupdatemod', 'i18nautoupdatemod'],
};

/** 反向索引：中文关键词 -> [slug...] */
const REVERSE = (() => {
  const map = new Map();
  for (const [slug, cn] of Object.entries(MOD_CN)) {
    const keys = new Set([cn]);
    // 拆出括号前的主名，例如 "钠 · 扩展" -> "钠"
    keys.add(cn.split(/[·（(]/)[0].trim());
    for (const k of keys) {
      if (!k || k.length < 1) continue;
      const arr = map.get(k) || [];
      if (!arr.includes(slug)) arr.push(slug);
      map.set(k, arr);
    }
  }
  return map;
})();

/**
 * 把中文查询词转成英文检索词。
 * 返回 { query, matched: [中文命中], translated: bool }
 */
export function translateQuery(raw) {
  const q = String(raw || '').trim();
  if (!q) return { query: '', matched: [], translated: false };
  if (!/[\u4e00-\u9fa5]/.test(q)) return { query: q, matched: [], translated: false };

  const hits = [];
  const slugs = new Set();

  // 0) 先查中文别名表（"连锁破坏" 这种口语叫法）
  for (const [alias, arr] of Object.entries(CN_ALIASES)) {
    if (q === alias || q.includes(alias) || alias.includes(q)) {
      hits.push(alias === q ? alias : q);
      for (const s of arr) slugs.add(s);
    }
  }

  // 1) 精确/包含匹配反向表
  for (const [cn, arr] of REVERSE) {
    if (cn.includes(q) || q.includes(cn)) {
      hits.push(cn);
      for (const s of arr) slugs.add(s);
    }
  }

  if (!slugs.size) return { query: q, matched: [], translated: false, allSlugs: [] };

  // 2) 只取最相关的一个词去检索。
  //    Modrinth 的搜索是 AND 语义——把多个 slug 拼起来（"veinminer ultimine rewind ..."）
  //    反而一个都匹配不到。剩余的候选交给模糊兜底去补。
  const all = [...slugs];
  const primary = all[0].replace(/-/g, ' ');
  return {
    query: primary,
    matched: hits.slice(0, 5),
    translated: true,
    allSlugs: all,
  };
}

/** 取中文名（没有则返回 null） */
export function cnName(slugOrTitle) {
  if (!slugOrTitle) return null;
  const key = String(slugOrTitle).toLowerCase();
  if (MOD_CN[key]) return MOD_CN[key];
  // 尝试用标题模糊匹配
  const compact = key.replace(/\s+/g, '-');
  return MOD_CN[compact] || null;
}

/* --------------------------------------------------------------- 外部链接 */

/** MC百科搜索（中英文都能搜） */
export function mcmodSearchUrl(nameOrSlug) {
  return `https://search.mcmod.cn/s?key=${encodeURIComponent(nameOrSlug || '')}`;
}

/** Modrinth 项目页 */
export function modrinthUrl(slugOrId) {
  return `https://modrinth.com/project/${encodeURIComponent(slugOrId || '')}`;
}

/**
 * 为一个内容项生成可用链接。
 * item: { slug, projectId, title, cn, sourceUrl, wikiUrl }
 */
export function buildLinks(item = {}) {
  const label = item.cn || item.title || item.slug || '';
  const wikiKey = item.cn || item.title || item.slug || '';
  const mcm = item.wikiUrl || (wikiKey ? mcmodSearchUrl(wikiKey) : null);
  const mr = item.slug ? `https://modrinth.com/project/${item.slug}`
    : item.projectId ? `https://modrinth.com/project/${item.projectId}` : null;
  return {
    modrinth: mr,
    source: item.sourceUrl || null,
    mcmod: mcm,
    mcmodEnglish: item.slug ? mcmodSearchUrl(item.slug) : null,
    label,
  };
}

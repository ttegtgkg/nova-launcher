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

  /* ================================================================
   * 以下按 Modrinth 真实 slug 补全（对照下载量前 1000 的模组逐个核对），
   * 目的是让「内容下载」页搜出来的标题直接是中文，而不是一屏英文。
   * 纯品牌名 / 前置库统一译成「XX 前置库」「XX 配置库」这种能看懂的说明，
   * 不做硬翻 —— Konkrete 译成「具体的」只会更让人迷惑。
   * ================================================================ */

  // ---- 优化与修复 ----
  'moreculling': '更多剔除',
  'dynamic-fps': '动态帧率',
  'scalablelux': 'ScalableLux 光照优化',
  'ebeach': '增强方块实体',
  'ebe': '增强方块实体',
  'better-block-entities': '更好的方块实体',
  'threadtweak': '线程优化',
  'asyncparticles': '异步粒子',
  'fastload': '快速加载世界',
  'fastquit': '快速退出',
  'ksyxis': 'Ksyxis 快速加载',
  'lazydfu': '加速启动（LazyDFU）',
  'mru': 'MRU 内存修复',
  'neruina': 'Neruina 实体卡顿修复',
  'notenoughcrashes': '崩溃不退出',
  'crash-assistant': '崩溃助手',
  'mixin-trace': 'Mixin 诊断',
  'mixintrace': 'Mixin 诊断',
  'packet-fixer': '数据包修复',
  'badpackets': 'bad packets 网络优化',
  'zfastnoise': '快速噪声',
  'fast-paintings': '快速画作',
  'fast-ip-ping': '快速 IP 延迟',
  'clumps': '经验球合并',
  'vmp-fabric': '超多玩家优化',
  'servercore': 'ServerCore 服务端优化',
  'ai-improvements': 'AI 性能优化',
  'c2me': 'C2ME 多线程区块',
  'noisium': '噪声优化',
  'gtew': '全局实体剔除',

  // ---- 画面与声音 ----
  'not-enough-animations': '动画不够',
  'eating-animation': '进食动画',
  'chatanimation': '聊天动画',
  'visuality': '视觉效果',
  'enhancedvisuals': '增强视觉',
  'particle-rain': '粒子雨',
  'particular': 'Particular 粒子',
  'subtle-effects': '细微效果',
  'sound-physics-remastered': '声音物理重制',
  'presence-footsteps': '临场脚步声',
  'ambientsounds': '环境音效',
  'ambient-environment': '环境氛围',
  'sound': 'Sounds 音效控制',
  'immersive-melodies': '沉浸式乐器',
  'fallingleaves': '落叶',
  'particle-core': '粒子核心库',
  'blur-plus': '背景模糊',
  'blur': '背景模糊',
  'animatica': 'Animatica 动画材质',
  'cit-resewn': 'CIT 重制',
  'optigui': 'OptiGUI 界面自定义',
  'polytone': 'Polytone 方块调色',
  'continuity': '连接材质',
  'fusion-connected-textures': 'Fusion 连接材质',
  'athena-ctm': 'Athena 连接材质',
  'model-gap-fix': '模型缝隙修复',
  'modelfix': '模型缝隙修复',
  'bettergrassify': '更好的草皮',
  'sodium-shadowy-path-blocks': '钠 · 阴影路径方块',
  'sodium-dynamic-lights': '钠 · 动态光源',
  'lambdynamiclights': 'Lamb 动态光源',
  'reeses-sodium-options': 'Reese 的钠设置',
  'sodium-options-api': '钠 · 设置 API',
  'sodium-extras': '钠 · 附加',
  'chloride': 'Chloride 钠附属',
  'sodium-extra-features': '钠 · 附加特性',
  'euphoria-patches': 'Euphoria 光影补丁',
  'iris-shaders': '鸢尾花光影',
  'photon': 'Photon 光影',
  'makeup-ultra-fast-shader': 'MakeUp 极致流畅光影',

  // ---- 界面与 HUD ----
  'betterf3': '更好的 F3',
  'better-stats': '更好的统计界面',
  'better-advancements': '更好的进度界面',
  'paginatedadvancements': '分页进度界面',
  'advancement-plaques': '进度弹窗',
  'legendary-tooltips': '传说提示框',
  'durability-tooltip': '耐久提示',
  'tooltipfix': '提示框修复',
  'item-highlighter': '物品高亮',
  'pick-up-notifier': '拾取提示',
  'overflowing-bars': '溢出状态条',
  'better-mount-hud': '更好的骑乘 HUD',
  'ukus-armor-hud': 'uku 的护甲 HUD',
  'inventoryhudplus': '背包信息 HUD',
  'neat': 'Neat 血条',
  'dynamiccrosshair': '动态准星',
  'better-ping-display-fabric': '更好的延迟显示',
  'ping-wheel': '标记轮盘',
  'chat-heads': '聊天头像',
  'morechathistory': '更多聊天记录',
  'no-chat-reports': '关闭聊天举报',
  'smooth-scroll': '平滑滚动',
  'resourcify': '资源包管理',
  'respackopts': '资源包选项',
  'resource-pack-overrides': '资源包覆盖',
  'no-resource-pack-warnings': '关闭资源包警告',
  'globalpacks': '全局资源包',
  'rrls': '移除重载界面',
  'drippy-loading-screen': '滴落加载界面',
  'main-menu-credits': '主菜单制作名单',
  'fancymenu': '精致菜单',
  'drippy': '滴落加载界面',
  'modern-ui': 'Modern UI 界面框架',
  'better-mods-button': '更好的模组按钮',
  'modmenu': '模组菜单',
  'tips': '加载提示',
  'travelers-titles': '旅行者标题',
  'almanac': '年鉴',
  'just-zoom': '简单缩放',
  'zume': 'Zume 缩放',
  'xaero-zoomout': 'Xaero 视野缩放',
  'freecam': '自由视角',
  'better-third-person': '更好的第三人称',
  'shoulder-surfing-reloaded': '越肩视角',
  'first-person-model': '第一人称模型',
  'do-a-barrel-roll': '桶滚机动',
  'boat-item-view': '船中查看物品',
  'invmove': '背包中移动',
  'controlify': '手柄支持',
  'rebind-narrator': '重绑旁白键',
  'gamma-utils': '亮度调节',
  'cubes-without-borders': '无边框区块',
  'borderless-mining': '无边框挖矿',
  'cut-through': '穿透渲染',
  'hide-armor': '隐藏护甲',
  'imblocker-original': '输入法冲突修复',
  'justenoughcharacters': '中文输入支持',
  'language-reload': '语言热重载',
  'crash-assistant-tooltip': '崩溃助手',
  'dungeons-and-taverns': '地牢与酒馆',

  // ---- 前置库 / 配置库（品牌名保留，后面加说明）----
  'fabric-api': 'Fabric API',
  'forgified-fabric-api': 'Forge 版 Fabric API',
  'fabric-language-kotlin': 'Fabric Kotlin 语言支持',
  'kotlin-for-forge': 'Forge Kotlin 支持',
  'architectury': 'Architectury API',
  'yacl': 'YACL 配置库',
  'yet-another-config-lib': 'YACL 配置库',
  'fzzy-config': 'Fzzy 配置库',
  'midnightlib': 'MidnightLib 配置库',
  'supermartijn642s-config-lib': 'SuperMartijn642 配置库',
  'supermartijn642s-core-lib': 'SuperMartijn642 核心库',
  'resourceful-lib': 'Resourceful 前置库',
  'resourceful-config': 'Resourceful 配置库',
  'bookshelf-lib': 'Bookshelf 前置库',
  'moonlight': 'Moonlight 前置库',
  'puzzles-lib': 'Puzzles 前置库',
  'konkrete': 'Konkrete 前置库',
  'balm': 'Balm 前置库',
  'collective': 'Collective 共享库',
  'iceberg': 'Iceberg 前置库',
  'prism-lib': 'Prism 前置库',
  'cristel-lib': 'Cristel Lib 前置库',
  'prickle': 'Prickle 前置库',
  'nuit': 'Nuit 前置库',
  'nuit-interop': 'Nuit 互操作',
  'platfom': 'Platform 前置库',
  'platform': 'Platform 前置库',
  'zeta': 'Zeta 前置库',
  'cicada': 'CICADA 前置库',
  'corgilib': 'CorgiLib 前置库',
  'kiwi': 'Kiwi 前置库',
  'azurelib': 'AzureLib 前置库',
  'geckolib': 'GeckoLib 动画库',
  'citadel': 'Citadel 前置库',
  'glitchcore': 'GlitchCore 前置库',
  'coroutil': 'CoroUtil 前置库',
  'jamlib': 'JamLib 前置库',
  'txnilib': 'TxniLib 前置库',
  'ukulib': 'ukuLib 前置库',
  'unilib': 'UniLib 前置库',
  'stendhal': 'Stendhal 前置库',
  'libjf': 'LibJF 前置库',
  'libipn': 'libIPN 背包库',
  'shatterbyte-lib': 'OctoLib 前置库',
  'bclib': 'BCLib 前置库',
  'lithostitched': 'Lithostitched 地形库',
  'terrablender': 'TerraBlender 地形调配',
  'tcdcommons': 'TCDCommons 通用库',
  'owo-lib': 'oωo 前置库',
  'cardinal-components-api': 'Cardinal 组件 API',
  'placeholder-api': '文本占位符 API',
  'necronomicon': 'Necronomicon API',
  'obscure-api': 'Obscure API',
  'searchables': 'Searchables 搜索库',
  'playeranimator': '玩家动画库',
  'puzzle': 'Puzzle 前置库',
  'melody': 'Melody 音乐库',
  'creativecore': 'CreativeCore 前置库',
  'athena': 'Athena 连接材质',
  'connector': 'Sinytra 连接器',
  'connector-extras': 'Sinytra 连接器扩展',
  'forge-config-api-port': 'Forge 配置 API 移植',
  'forge-config-screens': 'Forge 配置界面',
  'rhino': 'Rhino JS 引擎',
  'kubejs-js': 'KubeJS 脚本',
  'lootjs': 'LootJS 战利品脚本',
  'yosbr': '你的设置会被尊重',
  'default-options': '默认设置同步',
  'lmft': '标签加载修复',

  // ---- 界面 / 显示（热门榜前 400 补全）----
  'entitytexturefeatures': '[ETF] 实体纹理特性',
  'entity-model-features': '[EMF] 实体模型特性',
  '3dskinlayers': '3D 皮肤层',
  'zoomify': 'Zoomify 缩放',
  'mouse-tweaks': '鼠标微调',
  'enchantment-descriptions': '附魔描述',
  'cherished-worlds': '珍藏世界',
  'litematica': '投影（Litematica）',
  'natures-compass': '自然指南针',
  'rei': 'REI 物品管理器',
  'visual-workbench': '可视化工作台',
  'capes': '披风',
  'customskinloader': '自定义皮肤加载',
  'wavey-capes': '飘动披风',
  'item-borders': '物品边框',
  'smooth-swapping': '平滑交换',
  'enhanced-attack-indicator': '增强攻击指示器',
  'fogoverrides': '雾效覆盖',
  'better-beds': '更好的床',
  'just-enough-effect-descriptions-jeed': 'JEED 效果描述',
  'notenoughrecipebook': '合成书修复',
  'highlight': 'Highlight 高亮',
  'skyboxify': '自定义天空盒',
  'fabrishot': '高分辨率截图',
  'e4mc': 'e4mc 内网联机',
  'debugify': 'Debugify 修复',
  'yeetus-experimentus': 'Yeetus 关闭实验提示',
  'attributefix': '属性上限修复',
  'lmd': '允许消失',
  'log-begone': '隐藏日志',
  'leaves-be-gone': '隐藏树叶',
  'cull-leaves': '剔除树叶',
  'no-teleport-hunger': '传送不消耗饱食度',

  // ---- 实用工具 ----
  'essential': 'Essential 联机模组',
  'malilib': 'MaLiLib 前置库',
  'polymorph': '多态合成',
  'netherportalfix': '下界传送门修复',
  'trinkets': '饰品栏',
  'accessories': '饰品栏（Accessories）',
  'physicsmod': '物理模组',
  'spark': 'spark 性能分析',
  'lootr': 'Lootr 独立战利品',
  'open-parties-and-claims': '开放队伍与领地',
  'bobby': 'Bobby 区块缓存',
  'travelersbackpack': '旅行者背包',
  'toms-storage': 'Tom 的简易存储',
  'amendments': '补充与改进',
  'chunky': 'Chunky 预生成区块',
  'replaymod': '回放模组',
  'easy-anvils': '便捷铁砧',
  'easy-magic': '便捷附魔台',
  'rightclickharvest': '右键收获',
  'fallingtree': '一键砍树',
  'gravestone-mod': '墓碑',
  'explorers-compass': '探险家指南针',
  'worldedit': '世界编辑器',
  'axiom': 'Axiom 建筑工具',
  'pehkui': 'Pehkui 体型缩放',
  'hardcore-revival': '极限模式复活',
  'charm-of-undying': '不死图腾护符',
  'carpet': 'Carpet 地毯',
  'paxi': 'Paxi 数据包加载',
  'trading-post': '交易站',
  'double-doors': '双开门',
  'starter-kit': '初始套装',
  'client-tweaks': '客户端微调',
  'crafting-tweaks': '合成微调',
  'magnum-torch': '巨型火把',
  'animal_feeding_trough': '动物喂食槽',
  'structure-layout-optimizer': '结构布局优化',
  'sparsestructures': '稀疏结构',
  'noxesium': 'Noxesium 网络优化',
  'bisect-mod': 'BisectHosting 服务器菜单',
  'modernfix-mvus': 'ModernFix mVUS',
  'ixaeris': 'Ixeris 优化',
  'ixeris': 'Ixeris 优化',
  'geckoanimfix': 'Iris/GeckoLib 兼容修复',
  'caelus': 'Caelus API',
  'alternate-current': '交流电红石',
  'veinminer-client': '矿脉矿工快捷键',
  'veinminer-enchantment': '矿脉矿工附魔',
  'vein-mining': '矿脉挖掘',
  'zombie-awareness': '僵尸感知',

  // ---- 内容与玩法 ----
  'biomes-o-plenty': '超多生物群系',
  'cobblemon': 'Cobblemon 宝可梦',
  'timeless-and-classics-zero': '[TaCZ] 经典与永恒：零',
  'handcrafted': '手工家具',
  'another-furniture': '更多家具',
  'deeperdarker': '更深更暗',
  'what-are-they-up-to': '他们在干嘛',
  'alexs-mobs': 'Alex 的生物',
  'alexs-caves': 'Alex 的洞穴',
  'immersive-aircraft': '沉浸式飞行器',
  'exposure': '摄影',
  'repurposed-structures-fabric': '结构重制',
  'elytra-slot': '鞘翅槽位',
  'artifacts': '遗物',
  'bad-wither-no-cookie': '凋灵爆炸保护',
  'make_bubbles_pop': '气泡破裂',
  'dynamictrees': '动态树木',
  'dynamictreesplus': '动态树木扩展',
  'dynamic-trees-biomes-o-plenty': '动态树木：超多生物群系',
  'dynamic-trees-quark': '动态树木：夸克',
  'guard-villagers': '村民守卫',
  'villagersplus': 'VillagersPlus 村民扩展',
  'villager-names-serilum': '村民名字',
  'create-steam-n-rails': '机械动力：蒸汽与铁轨',
  'create-fabric': '机械动力（Fabric）',
  'create-aeronautics': '机械动力：航空学',
  'copycats': '机械动力：仿制品',
  'mmmmmmmmmmmm': 'MmmMmmMmmMmm 假人',
  'spartan-weaponry': '斯巴达武器',
  'spartan-shields': '斯巴达盾牌',
  'simply-swords': '简易刀剑',
  'better-combat': '更好的战斗',
  'incendium': '炼狱',
  'flashback': 'Flashback 录像',
  'cobblemon-mega-showdown': 'Cobblemon：超级进化',
  'navas-zamega': 'Navas 宝可梦超级进化',
  'cobbreeding': 'Cobblemon 培育',
  'cobblemon-additions': 'Cobblemon 附加',
  'cobblemon-pokenav': 'Cobblemon 宝可梦导航',
  'rctmod': 'Cobblemon 训练家',
  'smarter-farmers-farmers-replant': '智能农民补种',
  'emiffect': 'EMIffect 药水效果',
  'emi-loot': 'EMI 战利品',
  'emi-enchanting': 'EMI 附魔',
  'lets-do-vinery': "[Let's Do] 葡萄酒庄",
  'lets-do-herbalbrews': "[Let's Do] 草药酿造",
  'lets-do-beachparty': "[Let's Do] 海滩派对",
  'trek': 'Trek 旅行',
  'friends-and-foes': '朋友与敌人',
  'naturalist': '自然主义者',
  'species': 'Species 生物',
  'mowzies-mobs': 'Mowzie 的生物',
  'touhou-little-maid': '东方小女仆',
  'aquamirae': '深海迷航',
  'yes-steve-model': 'Yes Steve Model 模型',
  'natures-spirit': '自然之灵',
  'stonesworks': '石工作坊',
  'stoneworks': '石工作坊',
  'rechiseled': '重铸方块',
  'chipped': '变体方块',
  'macaws-windows': 'Macaw 的窗户',
  'macaws-fences-and-walls': 'Macaw 的栅栏与围墙',
  'macaws-bridges': 'Macaw 的桥梁',
  'diagonal-fences': '斜向栅栏',
  'advanced-netherite': '进阶下界合金',
  'iron-furnaces': '铁熔炉',
  'beautify-refabricated': '美化（重制）',
  'vanillabackport': '原版内容回移植',
  'fabric-seasons': 'Fabric 季节',
  'farmers-delight-refabricated': '农夫乐事（Fabric 重制）',
  'chefs-delight': '厨师乐事',
  'ends-delight': '末地乐事',
  'oceans-delight': '海洋乐事',
  'the-bumblezone-fabric': '蜂巢领域',
  'towns-and-towers': '城镇与塔楼',
  'when-dungeons-arise': '地牢崛起之时',
  'mes-moogs-end-structures': 'Moog 的末地结构',
  'moogs-voyager-structures': 'Moog 的远行结构',
  'geophilic': '地质爱好者',
  'ct-overhaul-village': '村庄大改',
  'villages-and-pillages': '村庄与掠夺者',
  'creeper-overhaul': '苦力怕大改',
  'regions-unexplored': '未探索地域',
  'explorify': '探索发现',
  'structory': 'Structory 结构',
  'structory-towers': 'Structory 塔楼',
  'philips-ruins': 'Philips 遗迹',
  'adorabuild-structures': 'AdoraBuild 建筑',
  'oh-the-biomes-weve-gone': '我们的生物群系',
  'l_enders-cataclysm': "L_Ender 的灾变",

  // ---- YUNG 系列 ----
  'yungs-api': "YUNG's API",
  'yungs-better-nether-fortresses': "YUNG's 更好的下界要塞",
  'yungs-better-dungeons': "YUNG's 更好地牢",
  'yungs-better-ocean-monuments': "YUNG's 更好的海底神殿",
  'yungs-better-jungle-temples': "YUNG's 更好的丛林神庙",
  'yungs-better-end-island': "YUNG's 更好的末地岛",
  'yungs-better-strongholds': "YUNG's 更好的要塞",
  'yungs-better-witch-huts': "YUNG's 更好的女巫小屋",
  'yungs-better-desert-temples': "YUNG's 更好的沙漠神殿",
  'yungs-bridges': "YUNG's 桥梁",
  'yungs-extras': "YUNG's 附加内容",
  'yungs-better-mineshafts': "YUNG's 更好的废弃矿井",

  // ---- Sophisticated 系列 ----
  'sophisticated-core': 'Sophisticated 核心库',
  'sophisticated-core-unofficial-fabric-port': 'Sophisticated 核心库（Fabric 移植）',
  'sophisticated-backpacks-unoffical-fabric-port': 'Sophisticated 背包（Fabric 移植）',
  'sophisticated-storage-unofficial-fabric-port': 'Sophisticated 存储（Fabric 移植）',
  'sophisticated-storage': 'Sophisticated 存储',

  // ---- 杂项与兼容 ----
  'starlight-forge': '星光（Forge 版）',
  'rubidium-extra': '铷 · 扩展',
  'xaeroplus': 'XaeroPlus 地图增强',
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

/* ==================================================================
 * 逐词意译：词典没收录的标题，尽量把它变中文
 * ==================================================================
 * 为什么需要这一层：Modrinth 的相关度排序会把长尾模组顶上来，
 * 搜「magic」出来的 30 条里可能一个热门榜模组都没有 —— 靠扩充词典
 * 永远追不上 8 万个模组。所以再加一条保守的逐词翻译：
 *
 *   1. 只翻高置信度的常见词（背包 / 存储 / 护甲 / 地牢 …）
 *   2. 认不出的词原样保留（品牌名、作者名不硬翻）
 *   3. 实词命中率不到一半就整体放弃，宁可显示英文
 *      —— 「Slice and Dice」翻成「切片 与 骰子」还不如不翻
 *
 * 这样「More Backpack Upgrades」→「更多 背包 升级」，
 * 而「Library Ferret」这种只有一半认识的，保持原样。
 */
const WORD_CN = {
  // 容器 / 物品
  backpack: '背包', backpacks: '背包', storage: '存储', storages: '存储',
  drawers: '抽屉', drawer: '抽屉', inventory: '背包', inventories: '背包',
  item: '物品', items: '物品', block: '方块', blocks: '方块',
  tool: '工具', tools: '工具', sword: '剑', swords: '剑', shield: '盾牌', shields: '盾牌',
  bow: '弓', bows: '弓', arrow: '箭', arrows: '箭', axe: '斧', axes: '斧',
  pickaxe: '镐', hoe: '锄', shovel: '锹', armor: '护甲', armors: '护甲', armour: '护甲',
  weapon: '武器', weapons: '武器', weaponry: '武器', gear: '装备', equipment: '装备',
  slot: '槽位', slots: '槽位', upgrade: '升级', upgrades: '升级',
  // 世界
  world: '世界', worlds: '世界', chunk: '区块', chunks: '区块', biome: '生物群系',
  biomes: '生物群系', cave: '洞穴', caves: '洞穴', dungeon: '地牢', dungeons: '地牢',
  structure: '结构', structures: '结构', village: '村庄', villages: '村庄',
  tower: '塔楼', towers: '塔楼', ruin: '遗迹', ruins: '遗迹', temple: '神殿',
  temples: '神殿', fortress: '要塞', portal: '传送门', portals: '传送门',
  nether: '下界', end: '末地', overworld: '主世界', ocean: '海洋', sea: '海洋',
  island: '岛屿', islands: '岛屿', mountain: '山峰', mountains: '山峰',
  forest: '森林', jungle: '丛林', desert: '沙漠', swamp: '沼泽', tundra: '苔原',
  river: '河流', lake: '湖泊', sky: '天空', dimension: '维度', dimensions: '维度',
  map: '地图', maps: '地图', minimap: '小地图', compass: '指南针', waypoint: '路径点',
  waypoints: '路径点', teleport: '传送', spawn: '生成', despawn: '消失',
  generation: '生成', generator: '生成器', terrain: '地形', decoration: '装饰',
  // 玩法
  magic: '魔法', spell: '法术', spells: '法术', potion: '药水', potions: '药水',
  effect: '效果', effects: '效果', enchant: '附魔', enchanted: '附魔',
  enchantment: '附魔', enchantments: '附魔', enchanting: '附魔',
  farm: '农场', farming: '农场', food: '食物', foods: '食物', crop: '作物',
  crops: '作物', seed: '种子', seeds: '种子', tree: '树木', trees: '树木',
  wood: '木头', woods: '木头', stone: '石头', ore: '矿石', ores: '矿石',
  mining: '挖掘', mine: '挖掘', craft: '合成', crafting: '合成', recipe: '配方',
  recipes: '配方', smelting: '熔炼', trading: '交易', trade: '交易',
  quest: '任务', quests: '任务', party: '队伍', parties: '队伍',
  claim: '领地', claims: '领地', economy: '经济', shop: '商店',
  combat: '战斗', damage: '伤害', attack: '攻击', defense: '防御', defence: '防御',
  health: '生命', hunger: '饥饿', experience: '经验', xp: '经验', level: '等级',
  levels: '等级', skill: '技能', skills: '技能', stat: '属性', stats: '属性',
  attribute: '属性', attributes: '属性', ability: '能力', abilities: '能力',
  // 生物
  mob: '生物', mobs: '生物', entity: '实体', entities: '实体', animal: '动物',
  animals: '动物', monster: '怪物', monsters: '怪物', villager: '村民',
  villagers: '村民', player: '玩家', players: '玩家', boss: 'Boss',
  dragon: '龙', dragons: '龙', zombie: '僵尸', skeleton: '骷髅',
  creeper: '苦力怕', slime: '史莱姆', bee: '蜜蜂', bees: '蜜蜂',
  // 技术 / 界面
  client: '客户端', server: '服务器', network: '网络', packet: '数据包',
  packets: '数据包', data: '数据', save: '存档', saves: '存档', backup: '备份',
  api: 'API', library: '库', lib: '库', config: '配置', configuration: '配置',
  core: '核心', util: '工具', utils: '工具', utilities: '工具', helper: '助手',
  manager: '管理器', loader: '加载器', integration: '集成', compat: '兼容',
  compatibility: '兼容', addon: '附加', addons: '附加', extension: '扩展',
  extensions: '扩展', patch: '补丁', patches: '补丁', fix: '修复', fixes: '修复',
  tweak: '微调', tweaks: '微调', mod: '模组', mods: '模组', plugin: '插件',
  ui: 'UI', gui: '界面', hud: 'HUD', menu: '菜单', menus: '菜单',
  screen: '界面', screens: '界面', overlay: '覆盖层', tooltip: '提示框',
  tooltips: '提示框', notification: '通知', chat: '聊天', message: '消息',
  messages: '消息', keybind: '按键', keybinds: '按键', hotkey: '快捷键',
  key: '键', keys: '键', mouse: '鼠标', keyboard: '键盘', controller: '手柄',
  sound: '声音', sounds: '声音', music: '音乐', particle: '粒子', particles: '粒子',
  texture: '纹理', textures: '纹理', model: '模型', models: '模型',
  animation: '动画', animations: '动画', shader: '光影', shaders: '光影',
  render: '渲染', rendering: '渲染', fps: '帧率', performance: '性能',
  optimization: '优化', optimizations: '优化', memory: '内存', thread: '线程',
  threads: '线程', cache: '缓存', lighting: '光照', light: '光照', lights: '光照',
  glow: '发光', shadow: '阴影', fog: '雾效', zoom: '缩放',
  // 修复 / 崩溃
  crash: '崩溃', crashes: '崩溃', error: '错误', errors: '错误', debug: '调试',
  log: '日志', logs: '日志', info: '信息', description: '描述',
  descriptions: '描述', name: '名字', names: '名字', title: '标题', titles: '标题',
  screenshot: '截图', screenshots: '截图', replay: '回放', recording: '录制',
  // 形容词 / 程度
  more: '更多', extra: '扩展', extras: '扩展', plus: '增强', better: '更好的',
  best: '最佳', advanced: '进阶', simple: '简易', simply: '简易', easy: '便捷',
  dynamic: '动态', immersive: '沉浸式', modern: '现代', vanilla: '原版',
  classic: '经典', new: '新', old: '旧', big: '大', large: '大',
  small: '小', tiny: '迷你', mini: '迷你', ultimate: '终极', legendary: '传说',
  epic: '史诗', infinite: '无限', unlimited: '无限', automatic: '自动',
  manual: '手动', fast: '快速', quick: '快速', smooth: '平滑', smart: '智能',
  random: '随机', colorful: '彩色', coloured: '彩色', colored: '彩色',
  dark: '黑暗', bright: '明亮', deep: '深渊', deeper: '更深',
  darker: '更暗', higher: '更高', lower: '更低', extended: '扩展',
  expanded: '扩展', enhanced: '增强', improved: '改良', additional: '额外',
  connected: '连接', placeable: '可放置', ranged: '远程',
  melee: '近战', detailed: '细节', detail: '细节',
  stacking: '堆叠', stack: '堆叠', merged: '合并',
  // 虚词：翻成中文连接词；只由虚词构成的标题不会触发意译
  and: '与', or: '或', of: '的', the: '', a: '', an: '', for: '', with: '',
  in: '', on: '', to: '', from: '', at: '', by: '', is: '',
  // 补一批高频尾词
  replacer: '替换器', master: '大师', bar: '状态条', bars: '状态条',
  reconstructed: '重构版', rebuilt: '重制版', remastered: '重制版',
  reloaded: '重制版', revived: '复兴版', refabricated: 'Fabric 重制版',
  charm: '护符', charms: '护符', glass: '玻璃', borders: '边框',
  border: '边框', loading: '加载', screens_: '界面',
  edition: '版', version: '版本', pack: '包', packs: '包', modpack: '整合包',
  resourcepack: '资源包', shaderpack: '光影包', datapack: '数据包',
  controls: '控制', control: '控制',
  settings: '设置', setting: '设置', options: '选项', option: '选项',
  difficulty: '难度', temperature: '温度', thirst: '口渴', sanity: '理智',
  seasons: '季节', season: '季节', weather: '天气', time: '时间',
  day: '白天', night: '夜晚', moon: '月亮', sun: '太阳', star: '星星',
  stars: '星星', cloud: '云', clouds: '云', rain: '雨', snow: '雪',
  water: '水', lava: '熔岩', fire: '火焰', ice: '冰', frost: '冰霜',
  storm: '风暴', wind: '风', earth: '大地', nature: '自然', spirit: '之灵',
  spirits: '之灵', soul: '灵魂', souls: '灵魂', blood: '血', bone: '骨',
  bones: '骨', flesh: '肉', plant: '植物', plants: '植物', flower: '花',
  flowers: '花', herb: '草药', herbs: '草药', mushroom: '蘑菇', slime_: '史莱姆',
  garden: '花园', kitchen: '厨房', brewery: '酿造', brewing: '酿造',
  cooking: '烹饪', cook: '厨师', chef: '厨师', bakery: '烘焙',
  fishing: '钓鱼', hunt: '狩猎', hunting: '狩猎', tame: '驯服',
  breeding: '培育', pet: '宠物', pets: '宠物', mount: '坐骑', mounts: '坐骑',
  vehicle: '载具', vehicles: '载具', aircraft: '飞行器', boat: '船',
  ship: '船', train: '火车', rail: '铁轨', rails: '铁轨', road: '道路',
  bridge: '桥', bridges: '桥', path: '路径', paths: '路径',
  door: '门', doors: '门', window: '窗户', windows: '窗户', fence: '栅栏',
  fences: '栅栏', wall: '围墙', walls: '围墙', stair: '楼梯', stairs: '楼梯',
  roof: '屋顶', roofs: '屋顶', furniture: '家具', decor: '装饰',
  decoration: '装饰', decorations: '装饰', building: '建筑', builder: '建造',
  lamp: '灯', lantern: '灯笼', lanterns: '灯笼',
  glider: '滑翔翼', elytra: '鞘翅', chest: '箱子',
  chests: '箱子', barrel: '木桶', hopper: '漏斗',
  furnace: '熔炉', furnaces: '熔炉', anvil: '铁砧', anvils: '铁砧',
  workbench: '工作台', station: '台',
  stations: '台', machine: '机器', machines: '机器', machinery: '机械',
  energy: '能源', power: '能量', electricity: '电力', fluid: '流体',
  fluids: '流体', liquid: '液体', pipe: '管道', pipes: '管道',
  cable: '线缆', cables: '线缆', wire: '电线', wires: '电线',
  reactor: '反应堆', turbine: '涡轮', engine: '引擎',
  smelter: '熔炉', crusher: '粉碎机', grinder: '研磨机', compressor: '压缩机',
  // 第三批：按关键词实测补的缺口
  technology: '科技', technologies: '科技', tech: '科技',
  generators: '发电机', diesel: '柴油',
  age: '时代', ages: '时代', central: '中央', modular: '模块化',
  bell: '铃铛', bells: '铃铛', whistle: '哨子', whistles: '哨子',
  tavern: '酒馆', taverns: '酒馆', ancient: '远古', city: '城市',
  cities: '城市', overhaul: '大改', overhauls: '大改',
  folder: '文件夹', folders: '文件夹', industry: '工业', industrial: '工业',
  engineering: '工程', engineer: '工程师', slash: '斩击',
  smithing: '锻造', blacksmith: '铁匠', tinker: '工匠', tinkers: '工匠',
  factory: '工厂', factories: '工厂', automation: '自动化',
  frontier: '边境', frontiers: '边境', survey: '勘测', uncharted: '未探索',
  soulslike: '魂系', reforged: '重铸', reborn: '重生',
  expand: '扩展', packed: '打包', delicious: '美味', delight: '乐事',
  knife: '小刀', knives: '小刀', colorful: '彩色', coloured: '彩色',
  decorated: '装饰', alchemy: '炼金', alchemist: '炼金术士',
  ritual: '仪式', rituals: '仪式', altar: '祭坛', totem: '图腾',
  rune: '符文', runes: '符文', crystal: '水晶', crystals: '水晶',
  gem: '宝石', gems: '宝石', jewel: '珠宝', jewels: '珠宝',
  coin: '硬币', coins: '硬币', currency: '货币', market: '市场',
  bank: '银行', chestplate: '胸甲', helmet: '头盔', boots: '靴子',
  leggings: '护腿', ring: '戒指', rings: '戒指', amulet: '护符',
  necklace: '项链', bracelet: '手镯', compass_: '指南针',
  radar: '雷达', scanner: '扫描仪', detector: '探测器', detector_: '探测器',
  timer: '计时器', clock: '时钟', hourglass: '沙漏',
  bonus: '额外奖励', reward: '奖励', rewards: '奖励', loot: '战利品',
  treasure: '宝藏', treasures: '宝藏', box: '盒子', boxes: '盒子',
  crate: '板条箱', crates: '板条箱', sack: '袋子', pouch: '小袋',
  bag: '袋子', bags: '袋子', case: '箱子', cases: '箱子',
  // 知名内容模组的品牌词，作为单词出现在标题里时也翻
  sodium: '钠', pixelmon: '像素宝可梦', botania: '植物魔法',
  addition: '附加', additions: '附加', generations: '世代', legacy: '传承版',
  chronicles: '编年史', origins: '起源', odyssey: '远征', expedition: '远征',
  adventure: '冒险', adventures: '冒险', journey: '旅程', journeys: '旅程',
  realm: '领域', realms: '领域', kingdom: '王国', kingdoms: '王国',
  empire: '帝国', dynasty: '王朝', saga: '传说', chronicle: '编年史',
};

/** 虚词集合：不参与「实词命中率」计算 */
const FUNC_WORDS = new Set(['and', 'or', 'of', 'the', 'a', 'an', 'for', 'with',
  'in', 'on', 'to', 'from', 'at', 'by', 'is']);

/**
 * 系列品牌词：原样保留，也不计入实词分母。
 * 「Create Big Cannons」里只有 Big / Cannons 是真需要翻译的部分，
 * 把 Create 算进分母会把它拉到 33%，直接判死。
 */
const BRAND_WORDS = new Set(['create', 'cobblemon', 'yungs', 'yung', 'macaws',
  'macaw', 'alexs', 'alex', 'sophisticated', 'lets', 'let', 'do', 'pams',
  'abnormals', 'abnormalscore', 'fabric', 'forge', 'neoforge', 'quilt', 'minecraft']);

const SPLIT_RE = /(\s+|[:：\-–—&/|,，、()（）[\]"'’]+)/;

/** 标题里允许原样保留的前缀标签，如 `[ETF]`、`[TaCZ]` */
const TAG_RE = /^(\[[^\]]{1,14}\])\s*/;

const _wordCache = new Map();

function wordTranslate(title) {
  const src = String(title || '').trim();
  if (!src) return null;
  if (_wordCache.has(src)) return _wordCache.get(src);

  let prefix = '';
  let body = src;
  const tag = TAG_RE.exec(body);
  if (tag) { prefix = tag[1] + ' '; body = body.slice(tag[0].length); }

  const parts = body.split(SPLIT_RE);
  let hit = 0;          // 实词命中数
  let substantive = 0;  // 实词总数
  const out = [];

  for (const p of parts) {
    if (!p) continue;
    if (SPLIT_RE.test(p)) { out.push(p); SPLIT_RE.lastIndex = 0; continue; }
    const low = p.toLowerCase();
    if (FUNC_WORDS.has(low)) { out.push(WORD_CN[low] ?? p); continue; }
    // 纯数字 / 符号原样保留，不计入统计
    if (!/[a-z\u4e00-\u9fa5]/i.test(low)) { out.push(p); continue; }
    // 已经是中文（国产模组标题）直接算命中
    if (/[\u4e00-\u9fa5]/.test(p)) { substantive++; hit++; out.push(p); continue; }
    // 系列品牌词：保留原文，不进分母
    if (BRAND_WORDS.has(low)) { out.push(p); continue; }
    substantive++;
    // 词表里映射到英文自身的（ui→UI）不算命中，否则「OPAC-UI」会被判成 50% 全中
    const mapped = WORD_CN[low];
    if (mapped && mapped !== p) { hit++; out.push(mapped); }
    else out.push(p);
  }

  // 实词一个都没命中，或命中率不到一半 → 放弃，别产出半土不洋的名字
  if (!hit || substantive === 0 || hit / substantive < 0.5) {
    _wordCache.set(src, null);
    return null;
  }

  let text = prefix + out.join('');
  text = text.replace(/\s{2,}/g, ' ')
    .replace(/\s+([:：\-–—&/|,，、)）])/g, '$1')
    // 中文和中文之间的空格要去掉，否则会得到「更多 背包 升级」
    .replace(/([\u4e00-\u9fa5])\s+(?=[\u4e00-\u9fa5])/g, '$1')
    // 两侧都是中文时，& 读作「与」
    .replace(/([\u4e00-\u9fa5])\s*&\s*(?=[\u4e00-\u9fa5])/g, '$1与')
    .trim();
  if (!text || text === src) { _wordCache.set(src, null); return null; }
  // 至少得有一个汉字：「L2 库」这种也算（实词命中率已经把关过了）
  if (!/[\u4e00-\u9fa5]/.test(text)) { _wordCache.set(src, null); return null; }

  _wordCache.set(src, text);
  return text;
}

/**
 * 取中文名（没有则返回 null）。
 * 顺序：精确词典 → 标题里的括号缩写（`Just Enough Items (JEI)` 靠 JEI 命中）
 *      → 逐词意译（保守，认不全宁可返回 null）
 */
export function cnName(slugOrTitle) {
  if (!slugOrTitle) return null;
  const raw = String(slugOrTitle).trim();
  const key = raw.toLowerCase();
  // 1. 精确词典
  if (MOD_CN[key]) return MOD_CN[key];
  const compact = key.replace(/\s+/g, '-').replace(/['’‘`]/g, '');
  if (MOD_CN[compact]) return MOD_CN[compact];

  // 2. 标题带括号缩写的，直接拿缩写去查（JEI / REI / EMI / ETF 这类很常见）
  const br = /^(.+?)\s*[(（]\s*([^)）]{1,24})\s*[)）]/.exec(raw);
  if (br) {
    if (MOD_CN[br[2].trim().toLowerCase()]) return MOD_CN[br[2].trim().toLowerCase()];
    // 去掉括号后的主体再试一次（`Zoomify (Zoom)` 的主体是 zoomify）
    if (MOD_CN[br[1].trim().toLowerCase()]) return MOD_CN[br[1].trim().toLowerCase()];
  }

  // 3. 逐词意译
  return wordTranslate(raw);
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

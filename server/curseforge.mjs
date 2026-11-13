// curseforge.mjs —— CurseForge 官方 API 接入（可选，需要申请 API Key）
//
// 说明：
//   CurseForge 的 API 必须带 x-api-key，key 由 Overwolf 团队人工审核发放
//   （申请入口 https://console.curseforge.com/）。
//   没有 key 时这个模块的所有调用都会抛错，上层会自动隐藏相关入口。
//
// 另一个现实约束：作者可以在项目设置里关闭「第三方下载」，
// 这类文件 API 返回的 downloadUrl 会是 null —— 这时只能跳网页下载，不能直连。
import { httpGet } from './core.mjs';
import { cnName } from './i18n.mjs';

const BASE = 'https://api.curseforge.com/v1';
const GAME_ID = 432;               // Minecraft

export const CF_CLASS = {
  mod: 6, modpack: 4471, resourcepack: 12, shader: 6552, datapack: 6945, world: 17,
};
/** classId → 我们这边的 kind（搜索结果的 projectType 要用真实类别，不能一律写 mod） */
const CF_KIND_BY_CLASS = Object.fromEntries(
  Object.entries(CF_CLASS).map(([k, v]) => [v, k]));
export const CF_LOADER = { forge: 1, fabric: 4, quilt: 5, neoforge: 6 };

async function cfGet(apiKey, path, query = null) {
  if (!apiKey) throw new Error('没有配置 CurseForge API Key');
  let url = BASE + path;
  if (query) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v === null || v === undefined || v === '') continue;
      qs.set(k, String(v));
    }
    const s = qs.toString();
    if (s) url += '?' + s;
  }
  const res = await httpGet(url, {
    idleMs: 20000, connectMs: 12000, totalMs: 40000,
    headers: { 'x-api-key': apiKey, Accept: 'application/json' },
  });
  if (!res.ok) {
    if (res.status === 403) throw new Error('CurseForge 拒绝访问（API Key 无效、未通过审核或被限流）');
    if (res.status === 404) throw new Error('CurseForge 上没有这个项目');
    throw new Error('CurseForge 返回 HTTP ' + res.status);
  }
  return JSON.parse(res.buf.toString('utf8'));
}

/* --------------------------------------------------------------- 搜索 */

/** 把 CurseForge 的搜索结果转成和 Modrinth 一致的形状，方便前端复用 */
function toHit(m) {
  const links = m.links || {};
  const slug = String(m.slug || m.id);
  // CurseForge 不提供中文名，但中文名词典是按 slug / 标题建的，
  // 两个平台的热门模组高度重合，直接查同一份词典就能覆盖大部分。
  // slug 优先（更精确），标题兜底（CF 的 slug 有时是 `just-enough-items`，
  // 而词典里记的是 `jei`，这时靠标题里的括号缩写命中）。
  const cn = cnName(slug) || cnName(m.name) || null;
  return {
    id: String(m.id),
    slug,
    title: m.name,
    description: m.summary || '',
    cn,
    author: (m.authors && m.authors[0] && m.authors[0].name) || '',
    downloads: m.downloadCount || 0,
    follows: m.thumbsUpCount || 0,
    icon: (m.logo && m.logo.thumbnailUrl) || null,
    categories: (m.categories || []).map(c => c.name),
    versions: [],
    projectType: CF_KIND_BY_CLASS[m.classId] || 'mod',
    updated: m.dateModified || m.dateCreated || null,
    source: links.websiteUrl || null,
    license: null,
    sourceKind: 'curseforge',
  };
}

export async function cfSearch(apiKey, {
  query = '', kind = 'mod', mcVersion = '', loader = '',
  offset = 0, limit = 20,
} = {}) {
  // CurseForge 的搜索接口对中文是「静默忽略」：传中文等于没传 searchFilter，
  // 它会按人气把全部内容倒序吐回来（totalCount 顶到 10000），看着像搜到了，
  // 其实一个都不相关。翻译不出英文名就别去搜，交给上层说明情况。
  if (query && /[\u4e00-\u9fa5]/.test(query)) {
    return { total: 0, hits: [], sourceKind: 'curseforge', chineseUnsupported: true };
  }

  const data = await cfGet(apiKey, '/mods/search', {
    gameId: GAME_ID,
    classId: CF_CLASS[kind] || CF_CLASS.mod,
    searchFilter: query || undefined,
    gameVersion: mcVersion || undefined,
    modLoaderType: loader && CF_LOADER[loader] ? CF_LOADER[loader] : undefined,
    sortField: 2,        // 2 = Popularity
    sortOrder: 'desc',
    index: offset,
    pageSize: Math.min(50, limit),
  });
  return {
    total: (data.pagination && data.pagination.totalCount) || 0,
    hits: (data.data || []).map(toHit),
    sourceKind: 'curseforge',
  };
}

/* ------------------------------------------------------------ 项目详情 */

export async function cfProject(apiKey, modId) {
  const data = await cfGet(apiKey, '/mods/' + encodeURIComponent(modId));
  const m = data.data || {};
  const links = m.links || {};
  const slug = String(m.slug || m.id);
  return {
    id: String(m.id),
    slug,
    title: m.name,
    cn: cnName(slug) || cnName(m.name) || null,
    description: m.summary || '',
    cnDescription: null,
    body: '',
    projectType: CF_KIND_BY_CLASS[m.classId] || 'mod',
    classId: m.classId || null,
    categories: (m.categories || []).map(c => c.name),
    loaders: [],
    gameVersions: [],
    downloads: m.downloadCount || 0,
    followers: m.thumbsUpCount || 0,
    license: null,
    iconUrl: (m.logo && m.logo.thumbnailUrl) || null,
    sourceUrl: links.sourceUrl || null,
    issuesUrl: links.issuesUrl || null,
    wikiUrl: links.wikiUrl || null,
    authors: (m.authors || []).map(a => ({ name: a.name, role: '' })),
    published: m.dateCreated || null,
    updated: m.dateModified || null,
    sourceKind: 'curseforge',
    links: {
      modrinth: null,
      source: links.sourceUrl || null,
      mcmod: 'https://search.mcmod.cn/s?key=' + encodeURIComponent(m.name || ''),
      curseforge: links.websiteUrl || null,
      label: m.name || '',
    },
  };
}

/* ------------------------------------------------------------ 文件列表 */

export async function cfFiles(apiKey, modId, { mcVersion = '', loader = '', limit = 60 } = {}) {
  const data = await cfGet(apiKey, `/mods/${encodeURIComponent(modId)}/files`, {
    gameVersion: mcVersion || undefined,
    modLoaderType: loader && CF_LOADER[loader] ? CF_LOADER[loader] : undefined,
    pageSize: limit,
  });
  const files = data.data || [];
  return files.map(f => ({
    id: String(f.id),
    displayName: f.displayName,
    fileName: f.fileName,
    // 作者关闭第三方下载时这里是 null
    downloadUrl: f.downloadUrl || null,
    fileLength: f.fileLength || 0,
    gameVersions: f.gameVersions || [],
    releaseType: f.releaseType,        // 1=release 2=beta 3=alpha
    fileDate: f.fileDate || null,
    hashes: f.hashes || [],
    dependencies: f.dependencies || [],
  }));
}

/** 查一个文件的下载地址（含作者是否允许第三方下载） */
export async function cfFileUrl(apiKey, modId, fileId) {
  const data = await cfGet(apiKey, `/mods/${encodeURIComponent(modId)}/files/${encodeURIComponent(fileId)}/download-url`);
  return data.data || null;   // string（可下载）或 null（作者禁止第三方分发）
}

/**
 * 查单个文件的元信息：大小 + 下载地址。
 *
 * 用来做「下载前先摸清总量」：整合包 manifest 只给 projectID/fileID，
 * 不给文件大小。不预先扫一遍的话，进度条的分母会在下载途中不断变大
 * （下完 63 MB 的整合包显示 100%，一开始下 mod 又掉回 62%）。
 * 顺便把下载地址一起拿回来，真正下载时就能少打一次 API。
 */
export async function cfFileMeta(apiKey, modId, fileId) {
  const data = await cfGet(apiKey, `/mods/${encodeURIComponent(modId)}/files/${encodeURIComponent(fileId)}`);
  const f = data.data || {};
  return {
    id: String(f.id || fileId),
    fileName: f.fileName || null,
    size: Number(f.fileLength) || 0,
    downloadUrl: f.downloadUrl || null,
  };
}

/* --------------------------------------------------- 按 modId 反查项目 */

// 用来把连写的 modId 拆成词。覆盖不到的就真拆不开了，宁可搜不到也别乱认。
const SPLIT_WORDS = [
  'spellbooks', 'spells', 'features', 'texture', 'delight', 'library', 'config',
  'trees', 'grow', 'forest', 'twilight', 'puzzles', 'survival', 'dragon', 'entity',
  'bookshelf', 'books', 'shelf', 'farmers', 'farmer', 'cloth', 'irons', 'iron',
  'biomes', 'weve', 'gone', 'the', 'oh', 'youll', 'and', 'api', 'lib', 'core',
];

/** 贪心把连写串拆成词：ohthetreesyoullgrow → [oh, the, trees, youll, grow] */
function tokenize(flat) {
  const words = [...SPLIT_WORDS].sort((a, b) => b.length - a.length);
  const out = [];
  let i = 0;
  while (i < flat.length) {
    const w = words.find(x => flat.startsWith(x, i));
    if (w) { out.push(w); i += w.length; }
    else { out.push(flat[i]); i += 1; }
  }
  return out;
}

/**
 * 把一个 modId 变成几种可能被 CF 搜到的写法，**按命中概率排序**。
 *
 * CurseForge 的搜索对标点很敏感：`farmersdelight` 搜不到 "Farmer's Delight"，
 * `cloth_config` 也搜不到 "Cloth Config API"，得把下划线换成空格再试。
 *
 * 注意每个变体都是一次真实 API 请求：不排序、不限量的话，
 * `ohthetreesyoullgrow` 这种长名字能生成 20 多个变体，
 * 一次补全就能打出上百个请求，白白撞人家的限流。
 */
function queryVariants(modId) {
  const base = String(modId || '').toLowerCase().trim();
  if (!base) return [];
  const flat = base.replace(/[_-]/g, '');

  const tier1 = [base, base.replace(/[_-]/g, ' '), base.replace(/[_-]/g, '-')];   // 最高
  const joined = tokenize(flat).join(' ');
  const tier2 = joined.includes(' ') ? [joined, joined.replace(/ /g, '-')] : [];   // 拆词
  const tier3 = [];                                                                // 单词位置切分
  for (const w of [...SPLIT_WORDS].sort((a, b) => b.length - a.length)) {
    const idx = flat.indexOf(w);
    if (idx <= 0) continue;
    const seg = [flat.slice(0, idx), w, flat.slice(idx + w.length)].filter(Boolean);
    tier3.push(seg.join(' '), seg.join('-'));
  }
  const out = [];
  const push = (v) => { if (v && !out.includes(v)) out.push(v); };
  for (const v of [...tier1, ...tier2]) push(v);
  // 「the xxx」/「xxx」两种写法各试一次，放在拆词之后
  for (const v of [...out]) push(v.startsWith('the ') ? v.slice(4) : 'the ' + v);
  for (const v of tier3) push(v);

  return out.slice(0, 8);   // 上限：8 次请求还找不到就认了，别硬撞限流
}

/**
 * 用 modId 去 CurseForge 找一个能装的项目。
 * 只在「slug 或标题规范化后完全一致」时才认，避免把前置猜成某个附属模组。
 * @returns {Promise<{id, slug, title, file}|null>}
 */
export async function cfFindByModId(apiKey, modId, { mcVersion = '', loader = '' } = {}) {
  const want = String(modId || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!want) return null;
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  for (const q of queryVariants(modId)) {
    let hits = [];
    try { hits = (await cfSearch(apiKey, { query: q, kind: 'mod', limit: 20 })).hits || []; } catch { continue; }

    /*
     * 匹配放宽到三种情况，都只在「整串对得上」时才算：
     *   1. 完全一致                    bookshelf = bookshelf
     *   2. 带/不带 the 前缀             twilightforest ~ the-twilight-forest
     *   3. 标题是「正主 + 后缀」        ftblibrary ~ ftb-library-forge
     * 第三种容易误伤（farmersdelight 会撞上 Farmers Delight Extended），
     * 所以要求正主名字至少 8 个字符，且候选不能带 Extended/Addon/Plus 这类后缀。
     */
    const BAD = /extended|addon|plus|compat|integration|patch|tweak|fork|revival/i;
    const wantTokens = tokenize(want).filter(t => t.length > 1);
    const hit = hits.find(h => norm(h.slug) === want)
      || hits.find(h => norm(h.title) === want)
      || hits.find(h => {
        const s = norm(h.slug), t = norm(h.title);
        return s === 'the' + want || t === 'the' + want
          || s === want + 'the' || t === want + 'the';
      })
      || (want.length >= 8 ? hits.find(h => {
        const s = norm(h.slug), t = norm(h.title);
        if (BAD.test(String(h.title || '')) || BAD.test(String(h.slug || ''))) return false;
        // 只认「正主在前、后面多一截」的情况，反过来容易认成附属
        return s.startsWith(want) || t.startsWith(want) || s.endsWith(want) || t.endsWith(want);
      }) : null)
      // 「Iron's Spells 'n Spellbooks」这种：英文名里插了 'n / and 之类的连接词，
      // 整串对不上，但正主的每个词都在标题里 —— 词都在就算匹配
      || (wantTokens.length >= 2 ? hits.find(h => {
        if (BAD.test(String(h.title || ''))) return false;
        const got = new Set(tokenize(norm(h.title)).filter(x => x.length > 1));
        return wantTokens.every(t => got.has(t));
      }) : null);
    if (!hit) continue;

    let files = [];
    try { files = await cfFiles(apiKey, hit.id, { mcVersion, loader }); } catch { }
    const file = files.find(f => /release/i.test(String(f.displayName || '')) || true) || files[0];
    if (!file) continue;
    return { id: hit.id, slug: hit.slug, title: hit.title, file };
  }
  return null;
}

/** 探活：确认 key 是否可用 */
export async function cfPing(apiKey) {
  try {
    await cfGet(apiKey, '/games/' + GAME_ID);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

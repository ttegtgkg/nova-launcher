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

const BASE = 'https://api.curseforge.com/v1';
const GAME_ID = 432;               // Minecraft

export const CF_CLASS = {
  mod: 6, modpack: 4471, resourcepack: 12, shader: 6552, datapack: 6945, world: 17,
};
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
  return {
    id: String(m.id),
    slug: String(m.slug || m.id),
    title: m.name,
    description: m.summary || '',
    cn: null,
    author: (m.authors && m.authors[0] && m.authors[0].name) || '',
    downloads: m.downloadCount || 0,
    follows: m.thumbsUpCount || 0,
    icon: (m.logo && m.logo.thumbnailUrl) || null,
    categories: (m.categories || []).map(c => c.name),
    versions: [],
    projectType: 'mod',
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
  return {
    id: String(m.id),
    slug: String(m.slug || m.id),
    title: m.name,
    cn: null,
    description: m.summary || '',
    cnDescription: null,
    body: '',
    projectType: 'mod',
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

/** 探活：确认 key 是否可用 */
export async function cfPing(apiKey) {
  try {
    await cfGet(apiKey, '/games/' + GAME_ID);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

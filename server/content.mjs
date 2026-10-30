// content.mjs —— 实例管理 + Mod/资源包/光影/整合包 + Modrinth
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  P, INSTANCES, CACHE, exists, existsSync, readJson, writeJson, httpJson,
  downloadOne, downloadBatch, tlog, tstage, tprogress, taddFile, addBytes, zipEntries, zipRead,
  zipExtractAll, safeName, dirSize,
} from './core.mjs';
import { cnName, cnDescription, buildLinks, MOD_CN, CFPA_MODS } from './i18n.mjs';
import { fuzzyLookup, needsFuzzy } from './search.mjs';

/* --------------------------------------------------------------- 实例管理 */

export const KINDS = {
  mod: { dir: 'mods', ext: ['.jar'], label: '模组' },
  resourcepack: { dir: 'resourcepacks', ext: ['.zip'], label: '资源包' },
  shader: { dir: 'shaderpacks', ext: ['.zip'], label: '光影包' },
  datapack: { dir: 'datapacks', ext: ['.zip'], label: '数据包' },
  world: { dir: 'saves', ext: [], label: '存档' },
};

const INST_FILES = ['mods', 'resourcepacks', 'shaderpacks', 'datapacks', 'saves', 'logs', 'screenshots', 'config', 'crash-reports'];

export async function ensureInstanceDirs(dir) {
  for (const d of INST_FILES) await fsp.mkdir(path.join(dir, d), { recursive: true });
}

export function instanceDir(id) { return P.instance(id); }

export async function listInstances() {
  const out = [];
  let dirs = [];
  try { dirs = await fsp.readdir(INSTANCES, { withFileTypes: true }); } catch { return out; }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const meta = await readJson(path.join(INSTANCES, d.name, 'instance.json'), null);
    if (!meta) continue;
    const dir = path.join(INSTANCES, d.name);
    out.push({
      ...meta,
      id: d.name,
      dir,
      size: await dirSize(path.join(dir, 'mods')).catch(() => 0),
      exists: existsSync(path.join(dir, 'instance.json')),
    });
  }
  return out.sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));
}

export async function createInstance({ name, version, loader = 'vanilla', loaderVersion, versionId, memory, jvmPreset }) {
  const id = `${safeName(name).replace(/\s+/g, '-') || 'instance'}-${crypto.randomBytes(3).toString('hex')}`;
  const dir = path.join(INSTANCES, id);
  await fsp.mkdir(dir, { recursive: true });
  await ensureInstanceDirs(dir);
  const meta = {
    id, name: name || '新实例',
    version: version || versionId,
    loader, loaderVersion: loaderVersion || null,
    versionId: versionId || version,
    memory: memory || null,
    jvmPreset: jvmPreset || 'aikar',
    autoOptimize: true,          // 默认开启启动时自动内存优化
    javaPath: 'auto',
    extraJvmArgs: '',
    width: 854, height: 480,
    icon: null,
    notes: '',
    created: Date.now(), lastPlayed: 0, playtimeSec: 0,
  };
  await writeJson(path.join(dir, 'instance.json'), meta);
  // 简单 options.txt 预置（提升首启体验）
  const optPath = path.join(dir, 'options.txt');
  if (!existsSync(optPath)) {
    await fsp.writeFile(optPath, [
      'version:1', 'autoJump:false', 'gamma:0.5',
      'renderDistance:8', 'maxFps:120', 'enableVsync:false',
      'graphicsMode:0', 'ao:true', 'guiScale:0', 'lang:zh_cn',
    ].join('\n') + '\n', 'utf8');
  }
  return { ...meta, dir };
}

export async function getInstance(id) {
  const meta = await readJson(path.join(INSTANCES, id, 'instance.json'), null);
  if (!meta) return null;
  return { ...meta, id, dir: path.join(INSTANCES, id) };
}

export async function updateInstance(id, patch) {
  const meta = await getInstance(id);
  if (!meta) throw new Error('实例不存在');
  const next = { ...meta, ...patch, id };
  delete next.dir; delete next.size; delete next.exists;
  await writeJson(path.join(INSTANCES, id, 'instance.json'), next);
  return next;
}

export async function deleteInstance(id) {
  const dir = path.join(INSTANCES, id);
  if (!dir.startsWith(INSTANCES)) throw new Error('非法实例路径');
  await fsp.rm(dir, { recursive: true, force: true });
  return { ok: true };
}

export async function duplicateInstance(id, newName) {
  const src = await getInstance(id);
  if (!src) throw new Error('实例不存在');
  const n = await createInstance({
    name: newName || (src.name + ' 副本'), version: src.version, loader: src.loader,
    loaderVersion: src.loaderVersion, versionId: src.versionId,
    memory: src.memory, jvmPreset: src.jvmPreset,
  });
  const srcDir = path.join(INSTANCES, id);
  const dstDir = path.join(INSTANCES, n.id);
  for (const sub of ['mods', 'resourcepacks', 'shaderpacks', 'config', 'saves']) {
    await fsp.cp(path.join(srcDir, sub), path.join(dstDir, sub), { recursive: true }).catch(() => { });
  }
  return n;
}

/* ------------------------------------------------------------- 内容扫描 */

const metaCache = new Map(); // file -> { key, meta }

function isDisabled(name) { return /\.disabled$/i.test(name); }

/* ------------------------------------------------ 内容来源（用于链接跳转） */

const SOURCES_FILE = 'nova-sources.json';

async function readSources(instanceId) {
  return (await readJson(path.join(INSTANCES, instanceId, SOURCES_FILE), {})) || {};
}

async function writeSource(instanceId, kind, filename, info) {
  const file = path.join(INSTANCES, instanceId, SOURCES_FILE);
  const db = (await readJson(file, {})) || {};
  db[`${KINDS[kind].dir}/${filename}`] = info;
  await writeJson(file, db);
}

/** 查某个文件的来源（忽略 .disabled 后缀） */
function lookupSource(sources, kind, filename) {
  const base = filename.replace(/\.disabled$/i, '');
  const dir = KINDS[kind]?.dir || kind;
  return sources[`${dir}/${base}`] || sources[`${dir}/${filename}`] || null;
}

/** 从 jar 里读模组元数据（只解出小文本条目） */
async function readJarMeta(file) {
  const st = await fsp.stat(file);
  const key = `${st.size}:${st.mtimeMs}`;
  const hit = metaCache.get(file);
  if (hit && hit.key === key) return hit.meta;

  let meta = {
    name: path.basename(file).replace(/\.(jar|zip)(\.disabled)?$/i, ''),
    id: null, version: null, authors: [], description: '', icon: null, loader: null,
  };
  try {
    const buf = await fsp.readFile(file);
    const entries = zipEntries(buf);
    const find = (n) => entries.find(e => e.name === n);
    const readText = (e) => zipRead(buf, e).toString('utf8');

    const fmj = find('fabric.mod.json');
    const qmj = find('quilt.mod.json');
    const toml = find('META-INF/mods.toml') || find('META-INF/neoforge.mods.toml');
    const mcmod = find('mcmod.info');
    const pmeta = find('pack.mcmeta');

    if (fmj || qmj) {
      const j = JSON.parse(readText(fmj || qmj));
      const q = qmj && !fmj ? (j.quilt_loader?.metadata || j) : j;
      meta.loader = fmj ? 'fabric' : 'quilt';
      meta.id = q.id || null;
      meta.name = q.name || meta.name;
      meta.version = q.version || null;
      meta.description = typeof q.description === 'string' ? q.description : (q.description?.en_us || '');
      const au = q.authors;
      meta.authors = Array.isArray(au) ? au.map(a => typeof a === 'string' ? a : a.name).filter(Boolean)
        : au ? [String(au)] : [];
      if (q.icon && typeof q.icon === 'string') meta.icon = q.icon;
    } else if (toml) {
      const t = readText(toml);
      meta.loader = /neoforge/i.test(t) ? 'neoforge' : 'forge';
      const grab = (re) => { const m = re.exec(t); return m ? m[1].trim() : null; };
      meta.id = grab(/^\s*modId\s*=\s*"([^"]*)"/m) || grab(/^\s*modId\s*=\s*'([^']*)'/m) || null;
      meta.name = grab(/^\s*displayName\s*=\s*"([^"]*)"/m) || grab(/^\s*displayName\s*=\s*'([^']*)'/m) || meta.name;
      meta.version = grab(/^\s*version\s*=\s*"([^"]*)"/m) || grab(/^\s*version\s*=\s*'([^']*)'/m);
      meta.authors = [grab(/^\s*authors\s*=\s*"([^"]*)"/m)].filter(Boolean);
      meta.description = grab(/^\s*description\s*=\s*"([^"]*)"/m) || '';
    } else if (mcmod) {
      const arr = JSON.parse(readText(mcmod));
      const j = Array.isArray(arr) ? arr[0] : arr.modList?.[0] || arr;
      if (j) {
        meta.id = j.modid || null;
        meta.name = j.name || meta.name;
        meta.version = j.version || null;
        meta.authors = j.authorList || (j.author ? [j.author] : []);
        meta.description = j.description || '';
        meta.loader = 'forge';
      }
    } else if (pmeta) {
      try {
        const j = JSON.parse(readText(pmeta));
        const d = j.pack?.description;
        meta.description = typeof d === 'string' ? d : (d?.text || '');
        meta.name = path.basename(file).replace(/\.(zip|jar)(\.disabled)?$/i, '');
      } catch { }
    }
  } catch { /* 损坏或非 zip，用文件名 */ }

  metaCache.set(file, { key, meta });
  return meta;
}

export async function listContents(instanceId, kind) {
  const k = KINDS[kind];
  if (!k) throw new Error('未知类型: ' + kind);
  const dir = path.join(INSTANCES, instanceId, k.dir);
  await fsp.mkdir(dir, { recursive: true });
  const sources = await readSources(instanceId).catch(() => ({}));
  const out = [];
  const items = await fsp.readdir(dir, { withFileTypes: true });
  for (const it of items) {
    const fp = path.join(dir, it.name);
    if (it.isDirectory()) {
      if (kind === 'world') {
        const st = await fsp.stat(fp).catch(() => null);
        out.push({
          name: it.name, file: it.name, isDir: true, enabled: true,
          size: await dirSize(fp), mtime: st?.mtimeMs || 0, meta: { name: it.name }, source: null,
        });
      }
      continue;
    }
    if (!/\.(jar|zip|mcworld)(\.disabled)?$/i.test(it.name)) continue;
    const st = await fsp.stat(fp).catch(() => null);
    const enabled = !isDisabled(it.name);
    const meta = kind === 'mod' || kind === 'resourcepack' || kind === 'shader'
      ? await readJarMeta(fp).catch(() => ({ name: it.name }))
      : { name: it.name.replace(/\.(zip|mcworld)$/i, '') };

    // 来源：优先用安装时记录的信息；没有记录时用 jar 里的 mod id 兜底推断
    let source = lookupSource(sources, kind, it.name);
    if (!source && meta.id) {
      source = {
        inferred: true,
        slug: meta.id,
        title: meta.name || meta.id,
        cn: cnName(meta.id) || cnName(meta.name),
        sourceUrl: null,
      };
    } else if (source && !source.cn) {
      source = { ...source, cn: cnName(source.slug) || cnName(source.title) || null };
    }

    out.push({
      name: it.name, file: it.name, isDir: false, enabled,
      size: st?.size || 0, mtime: st?.mtimeMs || 0,
      meta, source,
    });
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

export async function toggleContent(instanceId, kind, name) {
  const k = KINDS[kind];
  const dir = path.join(INSTANCES, instanceId, k.dir);
  let src = path.join(dir, name);
  // 宽容处理：传基名或带 .disabled 的名字都能找到目标文件
  if (!existsSync(src)) {
    const alt = isDisabled(name) ? name.replace(/\.disabled$/i, '') : name + '.disabled';
    const altPath = path.join(dir, alt);
    if (existsSync(altPath)) { src = altPath; name = alt; }
  }
  if (!existsSync(src)) throw new Error('文件不存在: ' + name);
  const disabled = isDisabled(name);
  const dst = path.join(dir, disabled ? name.replace(/\.disabled$/i, '') : name + '.disabled');
  await fsp.rename(src, dst);
  metaCache.delete(src);
  return { file: path.basename(dst), enabled: disabled };
}

export async function deleteContent(instanceId, kind, name) {
  const k = KINDS[kind];
  const dir = path.join(INSTANCES, instanceId, k.dir);
  const fp = path.join(dir, path.basename(name));
  if (!fp.startsWith(dir)) throw new Error('非法路径');
  await fsp.rm(fp, { recursive: true, force: true });
  return { ok: true };
}

export async function importContent(instanceId, kind, srcPath) {
  const k = KINDS[kind];
  const dir = path.join(INSTANCES, instanceId, k.dir);
  await fsp.mkdir(dir, { recursive: true });
  const base = path.basename(srcPath);
  const dst = path.join(dir, base);
  await fsp.copyFile(srcPath, dst);
  return { file: base };
}

/* --------------------------------------------------------------- Modrinth */

const MR = 'https://api.modrinth.com/v2';
const MR_TYPE = { mod: 'mod', resourcepack: 'resourcepack', shader: 'shader', modpack: 'modpack', datapack: 'datapack', world: 'world' };

const LOADER_TAGS = {
  fabric: 'fabric', quilt: 'quilt', forge: 'forge', neoforge: 'neoforge', vanilla: null,
};

export async function mrSearch({ query = '', kind = 'mod', mcVersion = '', loader = '', offset = 0, limit = 20 } = {}) {
  const facets = [[`project_type:${MR_TYPE[kind] || 'mod'}`]];
  if (mcVersion) facets.push([`versions:${mcVersion}`]);
  if (loader && LOADER_TAGS[loader] && kind === 'mod') facets.push([`categories:${LOADER_TAGS[loader]}`]);
  const url = `${MR}/search?query=${encodeURIComponent(query)}&limit=${limit}&offset=${offset}`
    + `&facets=${encodeURIComponent(JSON.stringify(facets))}&index=relevance`;
  const data = await httpJson(url, { source: 'official', timeout: 25000 });
  const hits = (data.hits || []).map(h => ({
    id: h.project_id, slug: h.slug, title: h.title, description: h.description,
    cn: cnName(h.slug) || cnName(h.title) || null,
    author: h.author, downloads: h.downloads, follows: h.follows,
    icon: h.icon_url, categories: h.categories, versions: h.versions,
    projectType: h.project_type, updated: h.date_modified, source: h.source_url,
    license: h.license,
  }));

  // 搜得不好时，用本地索引做相似名兜底（拼错、"soduim"、"rey" 这类）
  let fuzzyAdded = 0;
  if (offset === 0 && needsFuzzy(query, hits.length)) {
    try {
      const cands = await fuzzyLookup(query, {
        limit: 8,
        types: [MR_TYPE[kind] || 'mod'],
        preferSlugs: hits.map(h => h.slug),
      });
      const have = new Set(hits.map(h => h.slug));
      for (const c of cands) {
        if (fuzzyAdded >= 4) break;
        if (have.has(c.slug)) continue;
        try {
          const proj = await httpJson(`${MR}/project/${encodeURIComponent(c.slug)}`, {
            source: 'official', timeout: 15000,
          });
          // 只在它确实支持该 MC 版本/加载器时才补
          const gv = proj.game_versions || [];
          const lds = proj.loaders || [];
          if (mcVersion && gv.length && !gv.includes(mcVersion)) continue;
          if (loader && LOADER_TAGS[loader] && lds.length && !lds.includes(LOADER_TAGS[loader])) continue;
          hits.push({
            id: proj.id, slug: proj.slug, title: proj.title, description: proj.description,
            cn: cnName(proj.slug) || cnName(proj.title) || null,
            author: (proj.team ? '' : ''),
            downloads: proj.downloads, follows: proj.followers, icon: proj.icon_url,
            categories: proj.categories, versions: (proj.game_versions || []).slice(0, 8),
            projectType: proj.project_type, updated: proj.updated,
            source: proj.source_url, license: proj.license,
            fuzzy: true,            // 前端可以标「相似结果」
            score: c.score,
          });
          have.add(c.slug);
          fuzzyAdded++;
        } catch { /* 单个补充失败不影响整体 */ }
      }
    } catch { /* 索引还没建好就跳过 */ }
  }

  return {
    total: data.total_hits + fuzzyAdded,
    hits,
    fuzzyAdded,
  };
}

export async function mrVersions(projectId, { mcVersion = '', loader = '' } = {}) {
  let url = `${MR}/project/${encodeURIComponent(projectId)}/version`;
  const q = [];
  if (mcVersion) q.push(`game_versions=${encodeURIComponent(JSON.stringify([mcVersion]))}`);
  if (loader && LOADER_TAGS[loader]) q.push(`loaders=${encodeURIComponent(JSON.stringify([LOADER_TAGS[loader]]))}`);
  if (q.length) url += '?' + q.join('&');
  const data = await httpJson(url, { source: 'official', timeout: 25000 });
  return data.map(v => ({
    id: v.id, name: v.name, versionNumber: v.version_number,
    gameVersions: v.game_versions, loaders: v.loaders,
    channel: v.version_type || null,
    datePublished: v.date_published, downloads: v.downloads,
    files: (v.files || []).map(f => ({
      url: f.url, filename: f.filename, primary: f.primary,
      size: f.size, sha1: f.hashes?.sha1,
    })),
    dependencies: v.dependencies || [],
    changelog: (v.changelog || '').slice(0, 800),
  }));
}

/** 项目详情（用于详情面板：作者、简介、链接、许可、版本范围） */
export async function mrProject(projectIdOrSlug) {
  const proj = await httpJson(`${MR}/project/${encodeURIComponent(projectIdOrSlug)}`, {
    source: 'official', timeout: 20000,
  });

  // 作者列表要单独请求团队成员
  let authors = [];
  try {
    if (proj.team) {
      const members = await httpJson(`${MR}/team/${encodeURIComponent(proj.team)}/members`, {
        source: 'official', timeout: 15000,
      });
      authors = (members || [])
        .sort((a, b) => (b.role === 'Owner' ? 1 : 0) - (a.role === 'Owner' ? 1 : 0))
        .map(m => ({ name: m.user?.username || m.user?.name || '未知', role: m.role || '' }))
        .filter(a => a.name);
    }
  } catch { /* 拿不到作者就算了 */ }

  const slug = proj.slug || null;
  const cn = (slug && cnName(slug)) || cnName(proj.title) || null;

  return {
    id: proj.id, slug, title: proj.title, cn,
    description: proj.description || '',
    cnDescription: (slug && cnDescription(slug)) || null,
    body: (proj.body || '').slice(0, 4000),
    projectType: proj.project_type,
    categories: [...(proj.categories || []), ...(proj.additional_categories || [])],
    loaders: proj.loaders || [],
    gameVersions: proj.game_versions || [],
    downloads: proj.downloads || 0,
    followers: proj.followers || 0,
    license: proj.license ? {
      id: proj.license.id,
      name: proj.license.name || proj.license.id,   // 有些项目 name 为空，用 id 兜底
      url: proj.license.url,
    } : null,
    iconUrl: proj.icon_url || null,
    sourceUrl: proj.source_url || null,
    issuesUrl: proj.issues_url || null,
    wikiUrl: proj.wiki_url || null,
    authors,
    published: proj.published, updated: proj.updated,
    links: buildLinks({ slug, projectId: proj.id, title: proj.title, cn }),
  };
}

/** 下载某个 Modrinth 版本文件到实例对应目录，并递归拉取必需依赖 */
export async function mrInstall(instanceId, kind, projectId, { versionId = null, mcVersion, loader, withDeps = true, task } = {}) {
  const k = KINDS[kind];
  if (!k) throw new Error('未知类型: ' + kind);
  const dir = path.join(INSTANCES, instanceId, k.dir);
  await fsp.mkdir(dir, { recursive: true });

  // 项目元信息：用于显示中文名 + 生成官网/MC百科跳转
  let proj = null;
  try { proj = await httpJson(`${MR}/project/${encodeURIComponent(projectId)}`, { source: 'official', timeout: 20000 }); } catch { }
  const slug = proj?.slug || null;
  const title = proj?.title || null;
  const cn = (slug && cnName(slug)) || (title && cnName(title)) || null;

  const versions = await mrVersions(projectId, { mcVersion, loader });
  if (!versions.length) throw new Error('该版本/加载器下没有可用的文件');
  const ver = versionId ? versions.find(v => v.id === versionId) : versions[0];
  if (!ver) throw new Error('找不到指定版本文件');

  const file = ver.files.find(f => f.primary) || ver.files[0];
  if (!file) throw new Error('该版本没有文件');

  const dest = path.join(dir, safeName(file.filename));
  const shown = cn ? `${cn}（${title}）` : (title || file.filename);
  tlog(task, `下载 ${shown} · ${file.filename} (${(file.size / 1048576).toFixed(1)} MB)`);
  if (task) task.bytesTotal = (task.bytesTotal || 0) + (file.size || 0);
  let lastBytes = 0;
  const dl = await downloadOne(file.url, dest, {
    source: 'official', sha1: file.sha1, size: file.size, timeout: 180000, idleMs: 25000,
    onProgress: (got) => {
      if (!task) return;
      if (got < lastBytes) lastBytes = 0;
      if (got > lastBytes) { addBytes(task, got - lastBytes); lastBytes = got; }
    },
  });
  if (dl?.skipped) {
    tlog(task, '已存在且校验通过，跳过下载');
    if (task) task.bytesTotal = Math.max(0, (task.bytesTotal || 0) - (file.size || 0));
  } else if (task) {
    task.fileDone = (task.fileDone || 0) + 1;
    task.fileCount = (task.fileCount || 0) + 1;
  }
  tprogress(task, 1, file.filename);

  // 记录来源，之后本地列表也能显示中文名并跳转官网/MC百科
  await writeSource(instanceId, kind, path.basename(dest), {
    projectId, slug, title, cn,
    sourceUrl: proj?.source_url || null,
    iconUrl: proj?.icon_url || null,
    versionName: ver.name, versionId: ver.id,
    installedAt: Date.now(),
  }).catch(() => { });

  const installed = [{ file: file.filename, projectId, kind, slug, title, cn }];
  if (withDeps && kind === 'mod') {
    for (const dep of ver.dependencies) {
      if (dep.dependency_type !== 'required' || !dep.project_id) continue;
      try {
        const r = await mrInstall(instanceId, kind, dep.project_id, { mcVersion, loader, withDeps: false, task });
        installed.push(...r.installed);
      } catch (e) { tlog(task, `依赖 ${dep.project_id} 安装失败: ${e.message}`); }
    }
  }
  return { installed, version: ver };
}

/* -------------------------------------------------------------- 整合包安装 */

export async function installMrpack(mrpackPath, { task, source = 'auto', concurrency = 12, instanceName } = {}) {
  const buf = await fsp.readFile(mrpackPath);
  const entries = zipEntries(buf);
  const idxEntry = entries.find(e => e.name === 'modrinth.index.json');
  if (!idxEntry) throw new Error('不是有效的 .mrpack 整合包（缺少 modrinth.index.json）');
  // 去掉可能的 UTF-8 BOM（有些打包工具会写进去）
  const index = JSON.parse(zipRead(buf, idxEntry).toString('utf8').replace(/^\uFEFF/, ''));

  tlog(task, `整合包: ${index.name} (${index.versionId})`);
  const deps = index.dependencies || {};
  const mcVersion = deps.minecraft;
  const loaderKey = Object.keys(deps).find(k => /loader|forge|fabric|quilt/i.test(k));
  let loader = 'vanilla', loaderVersion = null;
  if (loaderKey) {
    loader = /fabric/i.test(loaderKey) ? 'fabric' : /quilt/i.test(loaderKey) ? 'quilt'
      : /neoforge/i.test(loaderKey) ? 'neoforge' : 'forge';
    loaderVersion = deps[loaderKey];
  }
  tlog(task, `需要 Minecraft ${mcVersion} / ${loader} ${loaderVersion || ''}`);

  return { index, mcVersion, loader, loaderVersion, buf, entries };
}

/** 把整合包的全部文件下载并展开到实例 */
export async function materializeMrpack(instanceId, parsed, { task, source = 'auto', concurrency = 12 } = {}) {
  const { index, buf, entries } = parsed;
  const dir = path.join(INSTANCES, instanceId);

  // 1) files
  const files = (index.files || []).filter(f => !f.env?.client || f.env.client !== 'unsupported');
  tstage(task, `整合包内容 (${files.length})`, files.length);
  const items = [];
  for (const f of files) {
    const rel = f.path.replace(/^\.?\//, '');
    const dest = path.resolve(dir, rel);
    if (!dest.startsWith(path.resolve(dir))) continue;
    const url = (f.downloads || [])[0];
    if (!url) continue;
    items.push({ url, dest, sha1: f.hashes?.sha1, size: f.hashes?.size || 0, label: path.basename(rel) });
  }
  const res = await downloadBatch(items, { concurrency, task });
  if (res.failed.length) tlog(task, `⚠ ${res.failed.length} 个文件下载失败`);

  // 2) overrides
  tstage(task, '解压覆盖文件', 1);
  let n = 0;
  for (const prefix of ['overrides/', 'client-overrides/']) {
    const sub = entries.filter(e => e.name.startsWith(prefix) && !e.isDir);
    for (const e of sub) {
      const rel = e.name.slice(prefix.length);
      if (rel.startsWith('mods/') && /\.disabled$/i.test(rel)) { /* 保留 */ }
      const dest = path.resolve(dir, rel);
      if (!dest.startsWith(path.resolve(dir))) continue;
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      await fsp.writeFile(dest, zipRead(buf, e));
      n++;
    }
  }
  tlog(task, `解压 ${n} 个覆盖文件`);
  tprogress(task, 1);

  // 3) 整合包元信息
  await writeJson(path.join(dir, 'nova.mrpack.json'), {
    name: index.name, versionId: index.versionId, dependencies: index.dependencies,
    installedAt: Date.now(),
  });
  return { overrides: n, files: items.length, failed: res.failed.length };
}

/** 普通 zip 整合包：把 mods/ 与其余内容直接展开 */
export async function materializeZipPack(instanceId, zipPath, { task } = {}) {
  const buf = await fsp.readFile(zipPath);
  const entries = zipEntries(buf);
  const dir = path.join(INSTANCES, instanceId);
  tstage(task, '解压整合包', entries.length);
  let n = 0;
  // CurseForge 风格：manifest.json + overrides/
  const hasOverrides = entries.some(e => e.name.startsWith('overrides/'));
  for (const e of entries) {
    if (e.isDir) continue;
    let rel = e.name;
    if (hasOverrides) {
      if (rel.startsWith('overrides/')) rel = rel.slice('overrides/'.length);
      else if (rel === 'manifest.json' || rel === 'modlist.html') { tprogress(task, 1); continue; }
      else { tprogress(task, 1); continue; }
    }
    // 去掉顶层单目录
    const dest = path.resolve(dir, rel);
    if (!dest.startsWith(path.resolve(dir))) { tprogress(task, 1); continue; }
    if (/\.(jar|zip)$/i.test(rel) || rel.includes('/')) {
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      await fsp.writeFile(dest, zipRead(buf, e));
      n++;
    }
    tprogress(task, 1, rel);
  }
  tlog(task, `解压 ${n} 个文件`);
  return { files: n, usedOverrides: hasOverrides };
}

/* ---------------------------------------------------------- 中文汉化安装 */

/**
 * 一键安装 CFPA 简体中文语言包（通过 I18nUpdateMod 系列模组自动下载更新）。
 * 按顺序尝试多个候选，哪个有适配当前 MC 版本 + 加载器的版本就用哪个。
 */
export async function installCfpaMod(instanceId, { mcVersion, loader, task } = {}) {
  if (!loader || loader === 'vanilla') {
    throw new Error('当前实例是原版（未装模组加载器），无法使用模组形式的汉化包。请先创建 Fabric/Forge 实例。');
  }
  tstage(task, '查找适配的汉化模组', CFPA_MODS.length);
  const reasons = [];
  for (const m of CFPA_MODS) {
    try {
      const vs = await mrVersions(m.id, { mcVersion, loader });
      if (!vs.length) { reasons.push(`${m.name}: 无 ${mcVersion}/${loader} 版本`); tprogress(task, 1); continue; }
      tlog(task, `使用 ${m.name}（${vs[0].name}）`);
      const r = await mrInstall(instanceId, 'mod', m.id, { mcVersion, loader, withDeps: true, task });
      tprogress(task, 1);
      return { mod: m, ...r };
    } catch (e) {
      reasons.push(`${m.name}: ${e.message}`);
      tprogress(task, 1);
    }
  }
  throw new Error('没有找到适配当前版本与加载器的汉化模组。\n' + reasons.join('\n'));
}

/** 检查实例里是否已装汉化模组 */
export async function cfpaStatus(instanceId) {
  const items = await listContents(instanceId, 'mod').catch(() => []);
  const hit = items.find(it => {
    const s = it.source;
    if (s && CFPA_MODS.some(m => m.id === s.projectId || m.slug === s.slug)) return true;
    return /i18n(update|autoupdate)?mod/i.test(it.name);
  });
  return {
    installed: Boolean(hit),
    enabled: hit ? hit.enabled : false,
    file: hit ? hit.name : null,
    candidates: CFPA_MODS,
  };
}

/* ---------------------------------------------------------- 图标/头像缓存 */

export async function cacheIcon(url, key) {
  if (!url) return null;
  const ext = path.extname(new URL(url).pathname) || '.png';
  const dest = path.join(CACHE, 'icons', safeName(key) + ext);
  try {
    if (!existsSync(dest)) await downloadOne(url, dest, { source: 'official', timeout: 15000, retries: 1 });
    return dest;
  } catch { return null; }
}

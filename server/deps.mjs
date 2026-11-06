/**
 * 模组前置依赖扫描。
 *
 * 为什么不能只信 Modrinth 的 `dependencies` 元数据：
 * 有些模组的元数据没写全（例如「精妙背包 × 机械动力 集成」在 Modrinth 上
 * 没把 create 标成必需），启动器照着装完，游戏一起来就报
 *   Missing or unsupported mandatory dependencies: Mod ID: 'create'
 * 而这时候用户已经点了启动，只能自己对着日志找原因。
 *
 * 所以这里改成读 **jar 里的真实依赖声明**（mods.toml / neoforge.mods.toml /
 * fabric.mod.json），跟实际装着的模组对账 —— 这才是 FML 判断依赖时看的东西。
 *
 * 两个必须处理的坑，否则会误报：
 *   1. jar 套 jar（jar-in-jar）：JEI 内嵌 mezz_config、Xaero 内嵌 xaerolib，
 *      这些是自带的，不算缺。要顺着 META-INF/jarjar/metadata.json 递归进去。
 *   2. [[dependencies.x]] 块里的 modId 是「被依赖者」，不是「我提供的」。
 *      早先用全文正则抓 modId，把依赖也当成自己提供的，缺失检查直接失灵。
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import { INSTANCES, zipEntries, zipRead } from './core.mjs';

/** 游戏 / 加载器自带，永远不可能是「缺失的模组」 */
const BUILTIN = new Set([
  'minecraft', 'java', 'fabricloader', 'fabric-loader', 'fabric_loader',
  'forge', 'neoforge', 'quilt_loader', 'quilt-loader', 'forge_gradle',
]);

const MAX_EMBED_DEPTH = 3;      // jar 套 jar 最多挖 3 层
const MAX_JAR_BYTES = 96 * 1024 * 1024;

/** 解析结果缓存：path -> { key, data } */
const jarCache = new Map();

/* ------------------------------------------------------------------ 单个 jar */

function parseFabricJson(text) {
  let j; try { j = JSON.parse(text); } catch { return null; }
  const meta = j.quilt_loader?.metadata || j;
  const ids = new Set();
  if (meta.id) ids.add(String(meta.id).toLowerCase());
  // provides 是「我也能顶替这些 id」的声明
  const prov = meta.provides;
  if (Array.isArray(prov)) {
    for (const p of prov) {
      const v = typeof p === 'string' ? p : (p && p.id);
      if (v) ids.add(String(v).toLowerCase());
    }
  }
  const deps = [];
  const bag = j.depends || j.quilt_loader?.depends || {};
  for (const [k, v] of Object.entries(bag)) {
    deps.push({ modId: String(k).toLowerCase(), range: typeof v === 'string' ? v : '', type: 'required' });
  }
  return { ids, deps };
}

function parseToml(text) {
  const ids = new Set();
  const deps = [];

  // 只认 [[mods]] 段里声明的 modId
  for (const seg of text.split(/^\[\[mods\]\]/m).slice(1)) {
    const stop = seg.search(/^\[\[/m);
    const body = stop >= 0 ? seg.slice(0, stop) : seg;
    const m = /^\s*modId\s*=\s*["']([^"']+)["']/m.exec(body);
    if (m) ids.add(m[1].toLowerCase());
  }

  // [[dependencies.<owner>]] 每段一个被依赖者
  const blocks = [];
  const headRe = /^\[\[([^\]]+)\]\]/gm;
  let h;
  while ((h = headRe.exec(text))) blocks.push({ head: h[1], start: h.index, bodyStart: headRe.lastIndex });
  for (let i = 0; i < blocks.length; i++) {
    if (!/^dependencies\./i.test(blocks[i].head)) continue;
    const body = text.slice(blocks[i].bodyStart, i + 1 < blocks.length ? blocks[i + 1].start : text.length);
    const depMod = /^\s*modId\s*=\s*["']([^"']+)["']/m.exec(body);
    const type = /^\s*type\s*=\s*["']([^"']+)["']/m.exec(body);
    const range = /^\s*versionRange\s*=\s*["']([^"']*)["']/m.exec(body);
    if (!depMod) continue;
    deps.push({
      modId: depMod[1].toLowerCase(),
      range: range?.[1] || '',
      type: (type?.[1] || 'required').toLowerCase(),
      owner: blocks[i].head.replace(/^dependencies\./i, '').toLowerCase(),
    });
  }
  return { ids, deps };
}

/**
 * 解析一个 jar（含内嵌的 jar）提供了哪些 modId、需要哪些前置。
 * 结果按 size+mtime 缓存，反复检查不会重复解压。
 */
async function parseJar(file, depth = 0) {
  let st;
  try { st = await fsp.stat(file); } catch { return { ids: new Set(), deps: [] }; }
  if (st.size > MAX_JAR_BYTES) return { ids: new Set(), deps: [] };

  const key = `${st.size}:${st.mtimeMs}`;
  const hit = jarCache.get(file);
  if (hit && hit.key === key) return hit.data;

  const ids = new Set();
  const deps = [];
  try {
    const buf = await fsp.readFile(file);
    const entries = zipEntries(buf);
    const find = (n) => entries.find(e => e.name === n);

    // ---- 本体的声明 ----
    for (const name of ['fabric.mod.json', 'quilt.mod.json']) {
      const e = find(name);
      if (!e) continue;
      const r = parseFabricJson(zipRead(buf, e).toString('utf8'));
      if (r) { for (const id of r.ids) ids.add(id); deps.push(...r.deps); }
      break;
    }
    const tomlEntry = find('META-INF/neoforge.mods.toml') || find('META-INF/mods.toml');
    if (tomlEntry) {
      const r = parseToml(zipRead(buf, tomlEntry).toString('utf8'));
      for (const id of r.ids) ids.add(id);
      deps.push(...r.deps);
    }

    // ---- 内嵌 jar（jar-in-jar）：它们提供的东西也算已存在 ----
    const embedded = new Set();
    const metaEntry = find('META-INF/jarjar/metadata.json');
    if (metaEntry) {
      try {
        const j = JSON.parse(zipRead(buf, metaEntry).toString('utf8'));
        for (const it of (j.jars || [])) if (it.path) embedded.add(it.path);
      } catch { }
    }
    // Fabric 的内嵌 jar 放在 META-INF/jars/ 下，靠 fabric.mod.json 的 jars 字段索引
    const fj = find('fabric.mod.json');
    if (fj) {
      try {
        const j = JSON.parse(zipRead(buf, fj).toString('utf8'));
        if (Array.isArray(j.jars)) {
          for (const e of entries) if (/^META-INF\/jars\/.+\.jar$/i.test(e.name)) embedded.add(e.name);
        }
      } catch { }
    }
    if (depth < MAX_EMBED_DEPTH) {
      for (const rel of embedded) {
        const e = find(rel);
        if (!e) continue;
        try {
          const innerBuf = zipRead(buf, e);           // 内嵌 jar 本身是完整 zip
          const inner = zipEntries(innerBuf);
          for (const nm of ['fabric.mod.json', 'quilt.mod.json']) {
            const ie = inner.find(x => x.name === nm);
            if (!ie) continue;
            const r = parseFabricJson(zipRead(innerBuf, ie).toString('utf8'));
            if (r) { for (const id of r.ids) ids.add(id); deps.push(...r.deps); }
            break;
          }
          const it = inner.find(x => x.name === 'META-INF/neoforge.mods.toml' || x.name === 'META-INF/mods.toml');
          if (it) {
            const r = parseToml(zipRead(innerBuf, it).toString('utf8'));
            for (const id of r.ids) ids.add(id);
            deps.push(...r.deps);
          }
        } catch { /* 内嵌 jar 坏了就算了 */ }
      }
    }
  } catch { /* 不是 zip / 读不了，当空 */ }

  const data = { ids, deps };
  jarCache.set(file, { key, data });
  return data;
}

/* ------------------------------------------------------------ 整个实例 */

const KIND_DIR = { mod: 'mods', resourcepack: 'resourcepacks', shader: 'shaderpacks', datapack: 'datapacks' };

/**
 * 扫描实例的 mods 目录，对账出缺失的必需前置。
 * 返回 { scanned, provided: [modId], missing: [{ modId, range, neededBy: [文件名] }], issues }
 */
export async function checkInstanceDeps(instanceId, { kind = 'mod' } = {}) {
  const dir = path.join(INSTANCES, instanceId, KIND_DIR[kind] || 'mods');
  let files = [];
  try {
    files = (await fsp.readdir(dir)).filter(f => /\.jar$/i.test(f) && !/\.disabled$/i.test(f));
  } catch {
    return { scanned: 0, provided: [], missing: [], dir, issues: [] };
  }

  const provided = new Map();   // modId -> 文件名
  const allNeeds = [];
  const issues = [];

  for (const f of files) {
    const r = await parseJar(path.join(dir, f));
    for (const id of r.ids) if (!provided.has(id)) provided.set(id, f);
    for (const d of r.deps) allNeeds.push({ ...d, jar: f });
    if (!r.ids.size) issues.push(f);       // 没解析出 modId 的（可能是纯库 / 特殊结构）
  }

  const missingMap = new Map();
  for (const n of allNeeds) {
    if (n.type && n.type !== 'required') continue;
    if (!n.modId || BUILTIN.has(n.modId)) continue;
    if (provided.has(n.modId)) continue;
    if (!missingMap.has(n.modId)) missingMap.set(n.modId, { modId: n.modId, range: n.range, neededBy: [] });
    const rec = missingMap.get(n.modId);
    if (!rec.neededBy.includes(n.jar)) rec.neededBy.push(n.jar);
    if (!rec.range && n.range) rec.range = n.range;
  }

  return {
    scanned: files.length,
    dir,
    provided: [...provided.keys()].sort(),
    missing: [...missingMap.values()],
    issues: issues.slice(0, 20),
  };
}

/** 把缺失列表拼成一句人话，给 toast / 日志用 */
export function describeMissing(missing) {
  if (!missing || !missing.length) return '';
  return missing.map(m => `${m.modId}${m.range ? ` ${m.range}` : ''}`).join('、');
}

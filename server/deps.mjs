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
import { P, readJson, zipEntries, zipRead } from './core.mjs';

/** 游戏 / 加载器自带，永远不可能是「缺失的模组」 */
const BUILTIN = new Set([
  'minecraft', 'java', 'fabricloader', 'fabric-loader', 'fabric_loader',
  'forge', 'neoforge', 'quilt_loader', 'quilt-loader', 'forge_gradle',
]);

const MAX_EMBED_DEPTH = 3;      // jar 套 jar 最多挖 3 层
const MAX_JAR_BYTES = 96 * 1024 * 1024;

/**
 * 解析结果缓存：path -> { key, data }。
 * 缓存的是「两套元数据都留着」的原始结果，和加载器无关 ——
 * 同一个 jar 在不同加载器的实例里要取不同的那份，过滤放到 checkInstanceDeps 里做。
 */
const jarCache = new Map();

/* ------------------------------------------------------- 版本号比较 */

/**
 * 版本号比较：13.0.8 vs 13.0.11 → -1；21.1.219 vs 21.1.221 → -1。
 *
 * 只接受「纯数字点分」的版本号。模组生态里的版本串花样太多 ——
 *   2.0-beta.15               预发布标记
 *   1.5.0-neoforge+mc1.21.1   版本 + 加载器 + MC 版本拼在一起
 *   1.21.1-3.15.4             MC 版本 + mod 自己的版本
 * 这三种的 `-` 含义完全不同，硬拆只会得出「1.5.0 比 1.3.8 旧」这种荒唐结论。
 * 判断不了就不判 —— 误报比漏报更让人不信任。
 */
const SIMPLE_VER = /^\d+(\.\d+)*$/;

function cmpVer(a, b) {
  const seg = (v) => String(v || '').split('.').filter(Boolean).map(Number);
  const sa = seg(a), sb = seg(b);
  const n = Math.max(sa.length, sb.length);
  for (let i = 0; i < n; i++) {
    const x = sa[i] === undefined ? 0 : sa[i];
    const y = sb[i] === undefined ? 0 : sb[i];
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * 判断 actual 是否落在 Maven 风格的 range 里。
 * 支持：[1.0,2.0)  (1.0,2.0]  [1.0,)  (,2.0]  *  空  以及裸版本号（当作 >= 处理）。
 *
 * 任何一侧不是纯数字点分版本就直接放行（见 cmpVer 的注释）。
 */
function inRange(actual, range) {
  const r = String(range || '').trim();
  if (!r || r === '*') return true;
  const av = String(actual || '').trim();
  if (!av) return true;
  if (!SIMPLE_VER.test(av)) return true;      // 实际版本是复合写法，不比

  // 裸版本号：NeoForge 里写 "1.2.8" 意思是「至少这个版本」
  if (!/^[\[(]/.test(r)) {
    if (!SIMPLE_VER.test(r)) return true;
    return cmpVer(av, r) >= 0;
  }

  const m = /^([\[(])\s*([^,\])]*)\s*,\s*([^,\])]*)\s*([\])])$/.exec(r);
  if (!m) {
    // 「[1.0]」这种单点精确匹配
    const one = /^[\[(]\s*([^,\])]+)\s*[\])]$/.exec(r);
    if (one) return !SIMPLE_VER.test(one[1]) ? true : cmpVer(av, one[1]) === 0;
    return true;
  }
  const [, loOpen, lo, hi, hiClose] = m;
  if (lo) {
    if (!SIMPLE_VER.test(lo)) return true;
    const c = cmpVer(av, lo);
    if (loOpen === '[' ? c < 0 : c <= 0) return false;
  }
  if (hi) {
    if (!SIMPLE_VER.test(hi)) return true;
    const c = cmpVer(av, hi);
    if (hiClose === ']' ? c > 0 : c >= 0) return false;
  }
  return true;
}

/* ------------------------------------------------------------------ 单个 jar */

/** 解析结果里除了 ids，还要带上「每个 id 的版本号」—— 光有 id 判不出够不够新 */
function parseFabricJson(text) {
  let j; try { j = JSON.parse(text); } catch { return null; }
  const meta = j.quilt_loader?.metadata || j;
  const ids = new Set();
  const versions = new Map();
  if (meta.id) {
    const id = String(meta.id).toLowerCase();
    ids.add(id);
    if (meta.version) versions.set(id, String(meta.version));
  }
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
  return { ids, versions, deps };
}

function parseToml(text) {
  const ids = new Set();
  const versions = new Map();
  const deps = [];

  // 只认 [[mods]] 段里声明的 modId（和它的 version）
  for (const seg of text.split(/^\[\[mods\]\]/m).slice(1)) {
    const stop = seg.search(/^\[\[/m);
    const body = stop >= 0 ? seg.slice(0, stop) : seg;
    const m = /^\s*modId\s*=\s*["']([^"']+)["']/m.exec(body);
    if (!m) continue;
    const id = m[1].toLowerCase();
    ids.add(id);
    const vm = /^\s*version\s*=\s*["']([^"']*)["']/m.exec(body);
    if (vm && vm[1] && !vm[1].includes('${')) versions.set(id, vm[1]);
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
  return { ids, versions, deps };
}

/**
 * 解析一个 jar（含内嵌的 jar）提供了哪些 modId、需要哪些前置。
 * 结果按 size+mtime 缓存，反复检查不会重复解压。
 *
 * Fabric 段和 Forge/NeoForge 段的依赖**分开返回**，不要在这里合并：
 * 好多模组（比如 Collective、Infinite Trading）把三套元数据塞进同一个 jar，
 * 在 NeoForge 实例里读 fabric.mod.json 的 depends 会凭空读出个 fabric-api，
 * 报「缺少必需前置」，而那段代码在 NeoForge 下压根不会被加载。
 */
async function parseJar(file, depth = 0) {
  let st;
  try { st = await fsp.stat(file); } catch { return emptyJar(); }
  if (st.size > MAX_JAR_BYTES) return emptyJar();

  const key = `${st.size}:${st.mtimeMs}`;
  const hit = jarCache.get(file);
  if (hit && hit.key === key) return hit.data;

  const ids = new Set();
  const versions = new Map();
  const fabricDeps = [];
  const tomlDeps = [];
  let hasFabric = false;
  let hasToml = false;
  try {
    const buf = await fsp.readFile(file);
    const entries = zipEntries(buf);
    const find = (n) => entries.find(e => e.name === n);

    // ---- Fabric / Quilt 段 ----
    for (const name of ['fabric.mod.json', 'quilt.mod.json']) {
      const e = find(name);
      if (!e) continue;
      const r = parseFabricJson(zipRead(buf, e).toString('utf8'));
      if (r) { for (const id of r.ids) ids.add(id); for (const [k, vv] of (r.versions || [])) versions.set(k, vv); fabricDeps.push(...r.deps); hasFabric = true; }
      break;
    }
    // ---- Forge / NeoForge 段 ----
    const tomlEntry = find('META-INF/neoforge.mods.toml') || find('META-INF/mods.toml');
    if (tomlEntry) {
      const r = parseToml(zipRead(buf, tomlEntry).toString('utf8'));
      for (const id of r.ids) ids.add(id);
      for (const [k, vv] of (r.versions || [])) versions.set(k, vv);
      tomlDeps.push(...r.deps);
      hasToml = true;
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
            if (r) { for (const id of r.ids) ids.add(id); for (const [k, vv] of (r.versions || [])) versions.set(k, vv); fabricDeps.push(...r.deps); hasFabric = true; }
            break;
          }
          const it = inner.find(x => x.name === 'META-INF/neoforge.mods.toml' || x.name === 'META-INF/mods.toml');
          if (it) {
            const r = parseToml(zipRead(innerBuf, it).toString('utf8'));
            for (const id of r.ids) ids.add(id);
            for (const [k, vv] of (r.versions || [])) versions.set(k, vv);
            tomlDeps.push(...r.deps);
            hasToml = true;
          }
        } catch { /* 内嵌 jar 坏了就算了 */ }
      }
    }
  } catch { /* 不是 zip / 读不了，当空 */ }

  const data = { ids, versions, fabricDeps, tomlDeps, hasFabric, hasToml };
  jarCache.set(file, { key, data });
  return data;
}

function emptyJar() {
  return { ids: new Set(), versions: new Map(), fabricDeps: [], tomlDeps: [], hasFabric: false, hasToml: false };
}

/* ------------------------------------------------------------ 整个实例 */

const KIND_DIR = { mod: 'mods', resourcepack: 'resourcepacks', shader: 'shaderpacks', datapack: 'datapacks' };

/**
 * 扫描实例的 mods 目录，对账出缺失的必需前置。
 * 返回 { scanned, loader,
 *        provided: [modId],
 *        missing:   [{ modId, range, neededBy }],           // 根本没有
 *        outdated:  [{ modId, need, have, neededBy, file }], // 装了但版本不够
 *        wrongLoader: [文件名], issues }
 *
 * 按实例的加载器只看对应那套元数据。多加载器模组把一个 jar 里塞三份声明，
 * 不区分的话 NeoForge 实例会凭空要求 fabric-api 这种根本装不上的前置。
 *
 * 「装了但版本不够」必须单独报：以前只判 provided.has(modId)，
 * 于是检查器说齐了、NeoForge 却说版本不满足，两边打架。
 */
export async function checkInstanceDeps(instanceId, { kind = 'mod', loader: loaderArg = null } = {}) {
  const dir = path.join(P.instance(instanceId), KIND_DIR[kind] || 'mods');
  let files = [];
  try {
    files = (await fsp.readdir(dir)).filter(f => /\.jar$/i.test(f) && !/\.disabled$/i.test(f));
  } catch {
    return { scanned: 0, loader: loaderArg, provided: [], missing: [], outdated: [], wrongLoader: [], dir, issues: [] };
  }

  let loader = loaderArg;
  let meta = null;
  if (!loader) {
    meta = await readJson(path.join(P.instance(instanceId), 'instance.json'), null);
    loader = meta?.loader || null;
  }
  if (!meta) meta = await readJson(path.join(P.instance(instanceId), 'instance.json'), null);
  const usesFabric = loader === 'fabric' || loader === 'quilt';
  const usesToml = loader === 'forge' || loader === 'neoforge';

  // 加载器本身的版本也算「提供」，否则 neoforge 这种内置依赖永远判成缺失
  const provided = new Map();   // modId -> { file, version }
  const put = (id, file, ver) => {
    if (!provided.has(id)) provided.set(id, { file, version: ver || null });
  };
  if (meta?.loader && meta?.loaderVersion) put(String(meta.loader).toLowerCase(), null, String(meta.loaderVersion));
  if (meta?.version) put('minecraft', null, String(meta.version));

  const allNeeds = [];
  const issues = [];
  const wrongLoader = [];

  for (const f of files) {
    const r = await parseJar(path.join(dir, f));
    // 提供的 id 合并算：多加载器 jar 里 id 一般三份一样，合并不会误伤
    for (const id of r.ids) put(id, f, r.versions ? r.versions.get(id) : null);

    let deps;
    if (usesFabric) deps = r.fabricDeps;
    else if (usesToml) deps = r.tomlDeps;
    else deps = [...r.fabricDeps, ...r.tomlDeps];   // 加载器不明：保守，两套都算
    for (const d of deps) allNeeds.push({ ...d, jar: f });

    if (!r.ids.size) issues.push(f);       // 没解析出 modId 的（可能是纯库 / 特殊结构）
    // 只有对面加载器的元数据 —— 这个 mod 在当前实例里根本不会被加载
    if (usesFabric && r.hasToml && !r.hasFabric) wrongLoader.push(f);
    else if (usesToml && r.hasFabric && !r.hasToml) wrongLoader.push(f);
  }

  const missingMap = new Map();
  const outdatedMap = new Map();
  for (const n of allNeeds) {
    if (n.type && n.type !== 'required') continue;
    if (!n.modId) continue;

    const got = provided.get(n.modId);
    if (!got) {
      // BUILTIN 是游戏/加载器自带的，没装任何 jar 也可能满足（版本已经放进 provided 了）
      if (BUILTIN.has(n.modId)) continue;
      if (!missingMap.has(n.modId)) missingMap.set(n.modId, { modId: n.modId, range: n.range, neededBy: [] });
      const rec = missingMap.get(n.modId);
      if (!rec.neededBy.includes(n.jar)) rec.neededBy.push(n.jar);
      if (!rec.range && n.range) rec.range = n.range;
      continue;
    }

    // 装了，但版本够不够？不判这一步，就会出现「检查说齐了、NeoForge 说版本不满足」
    //
    // 但 minecraft 这一项不判：模组里写的范围五花八门（[1.21,1.21.1)、[1.21]、
    // >=1.21 <=1.21.1），实际版本却是 1.21.1 —— 按数值比全成了「不满足」，
    // 一次报出四条假警报。MC 兼容性交给游戏自己判断。
    if (n.modId === 'minecraft') continue;
    const haveVer = got.version;
    if (haveVer && n.range && !inRange(haveVer, n.range)) {
      const key = `${n.modId}@${n.range}`;
      if (!outdatedMap.has(key)) {
        outdatedMap.set(key, {
          modId: n.modId, need: n.range, have: haveVer,
          file: got.file, neededBy: [],
        });
      }
      const rec = outdatedMap.get(key);
      if (!rec.neededBy.includes(n.jar)) rec.neededBy.push(n.jar);
    }
  }

  return {
    scanned: files.length,
    dir,
    loader,
    provided: [...provided.keys()].sort(),
    missing: [...missingMap.values()],
    outdated: [...outdatedMap.values()],
    wrongLoader,
    issues: issues.slice(0, 20),
  };
}

/** 把缺失列表拼成一句人话，给 toast / 日志用 */
export function describeMissing(missing) {
  if (!missing || !missing.length) return '';
  return missing.map(m => `${m.modId}${m.range ? ` ${m.range}` : ''}`).join('、');
}

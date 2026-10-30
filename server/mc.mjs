// mc.mjs —— Java 探测 / Mojang 版本安装 / 加载器 / 启动参数（含内存优化）
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import {
  P, SHARED, RUNTIME, CACHE, exists, existsSync, readJson, writeJson, httpJson, httpText,
  downloadOne, downloadBatch, tlog, tstage, tprogress, addBytes, taddFile, offlineUuid, sha1File, zipExtractAll,
  zipEntries, zipRead,
} from './core.mjs';

/* --------------------------------------------------------------- Java 探测 */

const JAVA_DIRS = [
  'C:\\Program Files\\Java', 'C:\\Program Files (x86)\\Java',
  'C:\\Program Files\\Eclipse Adoptium', 'C:\\Program Files (x86)\\Eclipse Adoptium',
  'C:\\Program Files\\Microsoft', 'C:\\Program Files\\Zulu', 'C:\\Program Files (x86)\\Zulu',
  'C:\\Program Files\\BellSoft', 'C:\\Program Files\\Amazon Corretto',
  'C:\\Program Files\\Semeru', 'C:\\Program Files\\AdoptOpenJDK',
  path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Eclipse Adoptium'),
  path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Microsoft'),
  path.join(os.homedir(), '.jdks'),
];

function javaMajor(ver) {
  if (!ver) return 0;
  const v = ver.split('.').map(Number);
  if (v[0] === 1) return v[1] || 0;
  return v[0] || 0;
}

/** 读取 exe 的版本信息（快，不启动 JVM），失败返回 null */
export function javaVersionOf(exe) {
  try {
    const r = spawnSync(exe, ['-version'], { encoding: 'utf8', timeout: 8000, windowsHide: true });
    const txt = `${r.stderr || ''}${r.stdout || ''}`;
    const m = txt.match(/version "([^"]+)"/);
    if (!m) return null;
    const full = m[1];
    const major = javaMajor(full);
    const is64 = /64-Bit/.test(txt);
    const vendor = (txt.match(/^(.*?) VM /m)?.[1] || '').trim();
    return { full, major, is64, vendor, raw: txt.trim().split('\n')[0] };
  } catch { return null; }
}

/** 扫描本机所有可用 Java */
export async function detectJavas() {
  const found = new Map(); // exe -> info
  const push = (exe) => {
    const norm = path.resolve(exe);
    if (found.has(norm)) return;
    if (!existsSync(norm)) return;
    const info = javaVersionOf(norm);
    if (!info) return;
    found.set(norm, { path: norm, ...info });
  };

  // 1) 自动下载的 runtime
  try {
    for (const d of await fsp.readdir(RUNTIME, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      for (const sub of ['bin\\java.exe', 'java.exe', 'Contents/Home/bin/java']) {
        const e = path.join(RUNTIME, d.name, sub);
        if (existsSync(e)) push(e);
      }
    }
  } catch { }

  // 2) 常见安装目录
  for (const dir of JAVA_DIRS) {
    if (!existsSync(dir)) continue;
    try {
      for (const d of await fsp.readdir(dir, { withFileTypes: true })) {
        if (!d.isDirectory()) continue;
        const e = path.join(dir, d.name, 'bin', 'java.exe');
        if (existsSync(e)) push(e);
      }
    } catch { }
  }

  // 3) JAVA_HOME
  if (process.env.JAVA_HOME) push(path.join(process.env.JAVA_HOME, 'bin', 'java.exe'));

  // 4) PATH
  try {
    const r = spawnSync('where', ['java'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
    for (const line of (r.stdout || '').split(/\r?\n/)) {
      const t = line.trim();
      if (t && /java\.exe$/i.test(t)) push(t);
    }
  } catch { }

  return [...found.values()].sort((a, b) => a.path.localeCompare(b.path));
}

/** 根据 MC 版本要求挑一个 Java，返回 { java, reason } */
export function pickJava(javas, requiredMajor, preferred = 'auto') {
  if (preferred && preferred !== 'auto') {
    const hit = javas.find(j => j.path === preferred);
    if (hit) return { java: hit, reason: '用户指定' };
  }
  const ok = javas.filter(j => j.major >= requiredMajor).sort((a, b) => a.major - b.major);
  if (ok.length) return { java: ok[0], reason: `满足 Java ${requiredMajor}+` };
  const best = javas.slice().sort((a, b) => b.major - a.major)[0];
  return { java: best || null, reason: best ? `版本偏低（需 ${requiredMajor}）` : '未找到 Java' };
}

/** 版本 → 所需 Java 主版本 */
export function requiredJavaMajor(mcVersion, versionJson) {
  if (versionJson?.javaVersion?.majorVersion) return versionJson.javaVersion.majorVersion;
  const m = /^1\.(\d+)/.exec(mcVersion || '');
  if (!m) return 21;
  const minor = Number(m[1]);
  if (minor <= 16) return 8;
  if (minor === 17) return 16;
  if (minor <= 20) return 17;
  return 21; // 1.20.5+
}

/**
 * JDK 下载源（按实测速度排序）。
 * 实测（本机 2026-10）：Amazon Corretto ≈2.7 MB/s、Microsoft OpenJDK ≈0.46 MB/s、
 * Adoptium API 在国内网络下会超时。所以按「快 → 慢 → 兜底」依次尝试。
 */
const JDK_SOURCES = [
  {
    name: 'Amazon Corretto',
    url: (m) => `https://corretto.aws/downloads/latest/amazon-corretto-${m}-x64-windows-jdk.zip`,
    page: 'https://aws.amazon.com/corretto/',
  },
  {
    name: 'Microsoft Build of OpenJDK',
    url: (m) => `https://aka.ms/download-jdk/microsoft-jdk-${m}-windows-x64.zip`,
    page: 'https://www.microsoft.com/openjdk',
  },
  {
    name: 'Eclipse Adoptium',
    url: (m) => `https://api.adoptium.net/v3/binary/latest/${m}/ga/windows/x64/jdk/hotspot/normal/eclipse`,
    page: 'https://adoptium.net',
  },
];

export { JDK_SOURCES };

/** 已安装的运行时目录里找对应大版本 */
async function findRuntimeJava(major) {
  const dir = path.join(RUNTIME, `jdk-${major}`);
  for (const sub of ['bin\\java.exe', 'java.exe', 'Contents/Home/bin/java']) {
    const exe = path.join(dir, sub);
    if (existsSync(exe)) {
      const info = javaVersionOf(exe);
      if (info) return { path: exe, ...info };
    }
  }
  return null;
}

/**
 * 安装指定大版本的 JDK。多源回退 + 进度上报。
 * 装到 data/runtime/jdk-<major>/，装完自动验证版本。
 */
export async function installJava(major, task) {
  await fsp.mkdir(RUNTIME, { recursive: true });
  const dest = path.join(RUNTIME, `jdk-${major}`);
  const zipPath = path.join(RUNTIME, `_jdk-${major}.zip`);
  const errors = [];

  for (const src of JDK_SOURCES) {
    const url = src.url(major);
    try {
      tlog(task, `从 ${src.name} 下载 JDK ${major} ...`);
      tstage(task, `下载 JDK ${major}（${src.name}）`, 1);
      let lastBytes = 0;
      await downloadOne(url, zipPath, {
        source: 'official', timeout: 600000, retries: 1, idleMs: 30000,
        onProgress: (got, total) => {
          if (!task) return;
          if (got < lastBytes) lastBytes = 0;
          if (got > lastBytes) { addBytes(task, got - lastBytes); lastBytes = got; }
          if (total) task.bytesTotal = Math.max(task.bytesTotal || 0, total);
        },
      });
      taddFile(task, 0);
      tprogress(task, 1, '下载完成');
      tlog(task, `下载完成（${(await fsp.stat(zipPath)).size / 1048576 | 0} MB），开始解压`);

      tstage(task, '解压 JDK', 2);
      const buf = await fsp.readFile(zipPath);
      const tmp = dest + '.tmp';
      await fsp.rm(tmp, { recursive: true, force: true }).catch(() => { });
      await fsp.mkdir(tmp, { recursive: true });
      await zipExtractAll(buf, tmp);
      tprogress(task, 1, '解压完成');

      // zip 顶层通常是单个目录（如 amazon-corretto-17.x.x-windows-x64），抹平一层
      const tops = await fsp.readdir(tmp, { withFileTypes: true });
      const rootDir = (tops.length === 1 && tops[0].isDirectory()) ? path.join(tmp, tops[0].name) : tmp;
      await fsp.rm(dest, { recursive: true, force: true }).catch(() => { });
      await fsp.rename(rootDir, dest);
      await fsp.rm(tmp, { recursive: true, force: true }).catch(() => { });
      await fsp.rm(zipPath, { force: true }).catch(() => { });
      tprogress(task, 1, '完成');

      const info = await findRuntimeJava(major);
      if (!info) throw new Error('解压后没有找到 java.exe，安装包结构可能变了');
      if (info.major < major) throw new Error(`安装到的版本是 Java ${info.major}，低于需要的 ${major}`);
      tlog(task, `已安装 Java ${info.full}: ${info.path}`);
      return info;
    } catch (e) {
      errors.push(`${src.name}: ${e.message}`);
      tlog(task, `${src.name} 失败：${e.message}`);
      await fsp.rm(zipPath, { force: true }).catch(() => { });
      await fsp.rm(dest + '.tmp', { recursive: true, force: true }).catch(() => { });
    }
  }

  throw new Error(`所有下载源都失败了，请手动安装 Java ${major}：\n` + errors.join('\n'));
}

/**
 * 确保本机有 >= needMajor 的 Java，没有就自动装。
 * @returns {{java: object, installed: boolean, reason: string}}
 */
export async function ensureJava(needMajor, { task = null, autoInstall = true, preferred = 'auto' } = {}) {
  let javas = await detectJavas();
  let pick = pickJava(javas, needMajor, preferred);

  if (pick.java && pick.java.major >= needMajor) {
    return { java: pick.java, installed: false, reason: pick.reason };
  }

  if (!autoInstall) {
    return { java: pick.java || null, installed: false, reason: '缺少 Java 且已关闭自动安装' };
  }

  // 先看看运行时目录里是不是已经装过（避免重复下载）
  const cached = await findRuntimeJava(needMajor);
  if (cached && cached.major >= needMajor) {
    return { java: cached, installed: false, reason: '使用已下载的运行时' };
  }

  if (task) {
    tlog(task, `未找到可用的 Java ${needMajor}，开始自动安装 …`);
  }
  const java = await installJava(needMajor, task);

  javas = await detectJavas();
  pick = pickJava(javas, needMajor, 'auto');
  const final = pick.java && pick.java.major >= needMajor ? pick.java : java;
  return { java: final, installed: true, reason: `已自动安装 Java ${final.major}` };
}

/* ------------------------------------------------------ Mojang 版本元数据 */

const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
let manifestCache = null;

export async function getManifest(source = 'auto', force = false) {
  if (manifestCache && !force && Date.now() - manifestCache.at < 1000 * 60 * 10) return manifestCache.data;
  // 磁盘缓存：重启后 10 分钟内不必再拉一次
  const diskPath = path.join(CACHE, 'version_manifest.json');
  if (!force) {
    const disk = await readJson(diskPath, null);
    if (disk?.data?.versions && Date.now() - (disk.at || 0) < 1000 * 60 * 10) {
      manifestCache = { at: disk.at, data: disk.data };
      return disk.data;
    }
  }
  const txt = await httpText(MANIFEST_URL, { source, timeout: 25000 });
  const data = JSON.parse(txt);
  manifestCache = { at: Date.now(), data };
  writeJson(diskPath, { at: Date.now(), data }).catch(() => { });
  return data;
}

/** 版本元数据（含 inheritsFrom 递归合并） */
export async function getVersionJson(versionId, source = 'auto') {
  const own = await readJson(path.join(P.versions, versionId, `${versionId}.json`), null);
  if (own) return mergeInherits(own, source);
  // 本地没有 → 从清单取（仅原版）
  const man = await getManifest(source);
  const v = man.versions.find(x => x.id === versionId);
  if (!v) throw new Error('未知版本: ' + versionId);
  const txt = await httpText(v.url, { source });
  return mergeInherits(JSON.parse(txt), source);
}

function mergeWeights(base, child) {
  const out = { ...base, ...child };
  out.libraries = [...(base.libraries || []), ...(child.libraries || [])];
  const bArgs = base.arguments || {};
  const cArgs = child.arguments || {};
  if (base.arguments || child.arguments) {
    out.arguments = {
      game: [...(bArgs.game || []), ...(cArgs.game || [])],
      jvm: [...(bArgs.jvm || []), ...(cArgs.jvm || [])],
    };
  }
  if (!child.minecraftArguments && base.minecraftArguments) out.minecraftArguments = base.minecraftArguments;
  if (!child.assetIndex && base.assetIndex) out.assetIndex = base.assetIndex;
  if (!child.assets && base.assets) out.assets = base.assets;
  if (!child.downloads && base.downloads) out.downloads = base.downloads;
  if (!child.javaVersion && base.javaVersion) out.javaVersion = base.javaVersion;
  if (!child.logging && base.logging) out.logging = base.logging;
  out.id = child.id || base.id;
  return out;
}

async function mergeInherits(vj, source) {
  if (!vj.inheritsFrom) {
    vj.__resolvedFrom = [vj.id];
    return vj;
  }
  const chain = [vj.id];
  let parent = await loadRawVersion(vj.inheritsFrom, source);
  let depth = 0;
  while (parent?.inheritsFrom && depth++ < 5) {
    chain.push(parent.id);
    parent = await loadRawVersion(parent.inheritsFrom, source);
  }
  if (parent) chain.push(parent.id);
  let merged = parent ? mergeWeights(parent, vj) : vj;
  merged.__resolvedFrom = chain;
  return merged;
}

async function loadRawVersion(id, source) {
  const local = await readJson(path.join(P.versions, id, `${id}.json`), null);
  if (local) return local;
  const man = await getManifest(source);
  const meta = man.versions.find(x => x.id === id);
  if (!meta) throw new Error('缺少父版本元数据: ' + id);
  return JSON.parse(await httpText(meta.url, { source }));
}

/* --------------------------------------------------------------- 规则求值 */

const OS_NAME = 'windows';
const OS_ARCH = process.arch === 'x64' ? 'x86_64' : process.arch === 'ia32' ? 'x86' : process.arch;

function ruleMatches(rule, features) {
  if (rule.os) {
    if (rule.os.name && rule.os.name !== OS_NAME) return false;
    if (rule.os.arch) {
      const want = rule.os.arch;
      const ok = want === OS_ARCH || (want === 'x86' && OS_ARCH === 'x86') || (want === 'x86_64' && OS_ARCH === 'x86_64');
      if (!ok) return false;
    }
    if (rule.os.version) {
      try { if (!new RegExp(rule.os.version).test(os.release())) return false; } catch { }
    }
  }
  if (rule.features) {
    for (const [k, v] of Object.entries(rule.features)) {
      if (Boolean(features[k]) !== Boolean(v)) return false;
    }
  }
  return true;
}

export function rulesAllow(rules, features = {}) {
  if (!rules || rules.length === 0) return true;
  let allow = false;
  for (const r of rules) if (ruleMatches(r, features)) allow = r.action === 'allow';
  return allow;
}

/* --------------------------------------------------- 库 / 资源 文件规划 */

function mavenPath(name) {
  // group:artifact:version[:classifier][@ext]
  const [coord, extRaw] = name.split('@');
  const parts = coord.split(':');
  const [group, artifact, version, classifier] = parts;
  const ext = extRaw || 'jar';
  const gp = group.replace(/\./g, '/');
  const file = `${artifact}-${version}${classifier ? '-' + classifier : ''}.${ext}`;
  return { path: `${gp}/${artifact}/${version}/${file}`, file, group, artifact, version, classifier, ext };
}

/** 计算某版本需要的 library 下载项 + natives 解压项 */
export function planLibraries(vj, features = {}) {
  const downloads = [];
  const classpath = [];
  const natives = [];

  for (const lib of vj.libraries || []) {
    if (!rulesAllow(lib.rules, features)) continue;
    const dl = lib.downloads || {};
    let added = false;

    if (dl.artifact?.path && dl.artifact?.url) {
      downloads.push({
        url: dl.artifact.url, dest: path.join(P.libraries, dl.artifact.path),
        sha1: dl.artifact.sha1, size: dl.artifact.size, label: path.basename(dl.artifact.path),
      });
      classpath.push(path.join(P.libraries, dl.artifact.path));
      added = true;
    } else if (lib.name) {
      // Fabric/Quilt 风格：只有 maven 坐标 + repo url
      const mp = mavenPath(lib.name);
      const base = (lib.url || 'https://libraries.minecraft.net/').replace(/\/+$/, '');
      downloads.push({
        url: `${base}/${mp.path}`, dest: path.join(P.libraries, mp.path), label: mp.file,
      });
      classpath.push(path.join(P.libraries, mp.path));
      added = true;
    }

    // natives（老版本 classifiers 方式）
    const cls = dl.classifiers || {};
    const wantKeys = [`natives-windows-${OS_ARCH}`, 'natives-windows'];
    let picked = null;
    for (const k of wantKeys) {
      if (cls[k]) { picked = cls[k]; break; }
    }
    if (!picked) {
      for (const k of Object.keys(cls)) if (k.startsWith('natives-windows')) { picked = cls[k]; break; }
    }
    if (picked?.path) {
      const ex = lib.extract?.exclude || ['META-INF/'];
      downloads.push({
        url: picked.url, dest: path.join(P.libraries, picked.path),
        sha1: picked.sha1, size: picked.size, label: path.basename(picked.path),
      });
      natives.push({ jar: path.join(P.libraries, picked.path), exclude: ex });
    }
    if (!added && !picked) continue;
  }
  return { downloads, classpath, natives };
}

/** 计算 assets 下载项 */
export async function planAssets(vj, source, task) {
  const idx = vj.assetIndex;
  if (!idx?.url) return { downloads: [], indexId: 'legacy', virtualDir: null };
  tlog(task, `获取资源索引 ${idx.id} ...`);
  const txt = await httpText(idx.url, { source });
  const data = JSON.parse(txt);
  const indexDir = path.join(P.assets, 'indexes');
  await fsp.mkdir(indexDir, { recursive: true });
  await fsp.writeFile(path.join(indexDir, `${idx.id}.json`), txt, 'utf8');

  const downloads = [];
  const SUB = 48; // 资源文件都是几十 KB 的小文件，高并发才快
  for (const [name, obj] of Object.entries(data.objects || {})) {
    const sub = obj.hash.slice(0, 2);
    downloads.push({
      url: `https://resources.download.minecraft.net/${sub}/${obj.hash}`,
      dest: path.join(P.assets, 'objects', sub, obj.hash),
      sha1: obj.hash, size: obj.size, label: name,
      officialFirst: true, timeout: 25000,
    });
  }
  return { downloads, indexId: idx.id, virtual: data.virtual || false, mapToResources: data.map_to_resources || false, concurrency: SUB };
}

/* ------------------------------------------------------------ 安装一个版本 */

export async function installVersion(versionId, { source = 'auto', concurrency = 12, task } = {}) {
  const vdir = path.join(P.versions, versionId);
  await fsp.mkdir(vdir, { recursive: true });

  tstage(task, '获取版本元数据', 1);
  const meta0 = await getManifest(source).then(m => m.versions.find(v => v.id === versionId)).catch(() => null);
  const localJsonPath = path.join(vdir, `${versionId}.json`);
  let vj = await readJson(localJsonPath, null);
  if (vj && vj.downloads && !vj.inheritsFrom) {
    tlog(task, '使用本地版本元数据（跳过下载）');
  } else {
    if (!meta0) throw new Error('官方清单中没有版本 ' + versionId);
    const txt = await httpText(meta0.url, { source });
    vj = JSON.parse(txt);
    await fsp.writeFile(localJsonPath, txt, 'utf8');
  }
  tprogress(task, 1, versionId);
  tlog(task, `版本 ${versionId} (${vj.type || meta0?.type || 'release'}) 元数据就绪`);

  // 1) client jar
  tstage(task, '游戏本体 jar', 1);
  const jarPath = path.join(vdir, `${versionId}.jar`);
  if (vj.downloads?.client?.url) {
    let lastBytes = 0;
    await downloadOne(vj.downloads.client.url, jarPath, {
      source, sha1: vj.downloads.client.sha1, size: vj.downloads.client.size, timeout: 180000,
      onProgress: (got) => {
        if (!task) return;
        if (got < lastBytes) lastBytes = 0;
        if (got > lastBytes) { addBytes(task, got - lastBytes); lastBytes = got; }
      },
    });
    taddFile(task, 0);
    tprogress(task, 1, path.basename(jarPath));
    tlog(task, '客户端 jar 完成');
  }

  // 2) logging config
  if (vj.logging?.client?.file?.url) {
    const lp = path.join(vdir, 'logging', vj.logging.client.file.id);
    await downloadOne(vj.logging.client.file.url, lp, {
      source, sha1: vj.logging.client.file.sha1, size: vj.logging.client.file.size,
    }).catch(e => tlog(task, '日志配置下载失败(可忽略): ' + e.message));
  }

  // 3) libraries + natives
  const plan = planLibraries(vj);
  tstage(task, `依赖库 (${plan.downloads.length})`, plan.downloads.length);
  tlog(task, `需要下载 ${plan.downloads.length} 个依赖库`);
  const libRes = await downloadBatch(plan.downloads, { concurrency, task });
  if (libRes.cancelled) throw new Error('任务已取消');
  if (libRes.failed.length) {
    tlog(task, `⚠ ${libRes.failed.length} 个依赖库失败: ` + libRes.failed.slice(0, 5).map(f => f.file).join(', '));
  }

  // 4) natives 解压
  if (plan.natives.length) {
    tstage(task, '解压 natives', plan.natives.length);
    const ndir = path.join(vdir, 'natives');
    await fsp.rm(ndir, { recursive: true, force: true }).catch(() => { });
    await fsp.mkdir(ndir, { recursive: true });
    for (const n of plan.natives) {
      if (!existsSync(n.jar)) { tprogress(task, 1); continue; }
      try {
        const buf = await fsp.readFile(n.jar);
        await zipExtractAll(buf, ndir, (name) => {
          if (name.endsWith('/')) return false;
          if (/^META-INF\//.test(name)) return false;
          if (/\.(sha1|git|md|txt|MF)$/i.test(name)) return false;
          for (const ex of n.exclude) if (ex && name.startsWith(ex)) return false;
          return true;
        });
      } catch (e) { tlog(task, 'natives 解压失败: ' + e.message); }
      tprogress(task, 1, path.basename(n.jar));
    }
  }

  // 5) assets
  const assets = await planAssets(vj, source, task);
  if (assets.downloads.length) {
    tstage(task, `资源文件 (${assets.downloads.length})`, assets.downloads.length);
    tlog(task, `开始下载 ${assets.downloads.length} 个资源文件（较慢，请耐心等待）`);
    const assetConc = Math.max(assets.concurrency || 32, concurrency * 3);
    const res = await downloadBatch(assets.downloads, { concurrency: assetConc, task });
    if (res.cancelled) throw new Error('任务已取消');
    if (res.failed.length) {
      tlog(task, `⚠ ${res.failed.length} 个资源文件失败，改用备用源重试 ...`);
      const retry = assets.downloads.filter(d => !existsSync(d.dest));
      const r2 = await downloadBatch(retry.map(d => ({ ...d, officialFirst: !d.officialFirst, timeout: 40000 })),
        { concurrency: Math.min(assetConc, 24), task });
      tlog(task, `备用源重试完成，仍失败 ${r2.failed.length} 个`);
    }
  }
  // legacy virtual/map_to_resources
  if (assets.virtual || assets.mapToResources) {
    const target = assets.virtual ? path.join(P.assets, 'virtual', assets.indexId) : path.join(P.assets, 'virtual', 'legacy');
    tlog(task, '构建 legacy 资源目录 ...');
    try {
      const idx = JSON.parse(await fsp.readFile(path.join(P.assets, 'indexes', `${assets.indexId}.json`), 'utf8'));
      const outDir = path.join(P.assets, 'indexes', assets.indexId, 'virtual'); // 旧版要求
      for (const [name, obj] of Object.entries(idx.objects || {})) {
        const src = path.join(P.assets, 'objects', obj.hash.slice(0, 2), obj.hash);
        const dst = path.join(outDir, name);
        await fsp.mkdir(path.dirname(dst), { recursive: true });
        if (existsSync(src)) await fsp.copyFile(src, dst).catch(() => { });
      }
    } catch (e) { tlog(task, 'legacy 资源构建失败: ' + e.message); }
  }

  tlog(task, `版本 ${versionId} 安装完成`);
  await writeJson(path.join(vdir, '.nova-complete'), {
    id: versionId, at: Date.now(),
    assetIndex: assets.indexId || null,
    jar: existsSync(jarPath),
  }).catch(() => { });
  return { id: versionId, type: vj.type || meta0?.type || 'release', json: vj };
}

/** 版本是否已完整安装（快速判断，避免每次启动都全量校验） */
export async function isVersionReady(versionId) {
  const vdir = path.join(P.versions, versionId);
  if (!existsSync(path.join(vdir, `${versionId}.json`))) return false;
  const mark = await readJson(path.join(vdir, '.nova-complete'), null);
  if (!mark) return false;
  if (!existsSync(path.join(vdir, `${versionId}.jar`))) return false;
  if (mark.assetIndex && !existsSync(path.join(P.assets, 'indexes', `${mark.assetIndex}.json`))) return false;
  return true;
}

/* -------------------------------------------------------------- 加载器安装 */

/* ------------------------------------------------- 加载器 Maven 仓库解析 */

/**
 * Forge / NeoForge 的 Maven 仓库候选。
 * 实测：maven.neoforged.net 在本机网络下 TCP 443 完全不通（Cloudflare 后面），
 * 而 BMCLAPI 提供了完整的 maven 镜像（NeoForge 1852 个版本、Forge 5094 个版本）。
 * 所以策略是「先试官方，不通自动换中转」。
 */
const MAVEN_CANDIDATES = {
  neoforge: [
    { name: '官方 maven.neoforged.net', base: 'https://maven.neoforged.net/releases', path: 'net/neoforged/neoforge' },
    { name: 'BMCLAPI 中转', base: 'https://bmclapi2.bangbang93.com/maven', path: 'net/neoforged/neoforge' },
  ],
  forge: [
    { name: '官方 maven.minecraftforge.net', base: 'https://maven.minecraftforge.net', path: 'net/minecraftforge/forge' },
    { name: 'BMCLAPI 中转', base: 'https://bmclapi2.bangbang93.com/maven', path: 'net/minecraftforge/forge' },
  ],
};

const mavenCache = {};   // kind -> { base, path, name, at }

/** 选一个当前可达的 maven 仓库，结果缓存 10 分钟 */
async function resolveMavenBase(kind, { task = null, force = false } = {}) {
  const cached = mavenCache[kind];
  if (!force && cached && Date.now() - cached.at < 10 * 60 * 1000) return cached;

  const list = MAVEN_CANDIDATES[kind] || [];
  const errors = [];
  for (const c of list) {
    const metaUrl = `${c.base}/${c.path}/maven-metadata.xml`;
    try {
      const txt = await httpText(metaUrl, { source: 'official', timeout: 15000 });
      if (!txt || txt.indexOf('<metadata') < 0) throw new Error('不是有效的 maven-metadata');
      const entry = { base: c.base, path: c.path, name: c.name, metaUrl, at: Date.now() };
      if (cached && cached.base === c.base) entry.at = cached.at;   // 命中同一源就别重置计时
      mavenCache[kind] = entry;
      if (task) tlog(task, `${kind} 仓库 → ${c.name}`);
      return entry;
    } catch (e) {
      errors.push(`${c.name}: ${e.message}`);
      if (task) tlog(task, `${c.name} 不可达，换下一个源…`);
    }
  }
  throw new Error(`${kind} 的所有仓库都连不上（官方和中转都试过了）：\n` + errors.join('\n'));
}

function parseMavenVersions(xml) {
  const out = [];
  const re = /<version>([^<]+)<\/version>/g;
  let m;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}

/** 简单的版本倒序比较（按数字段） */
function versionCmp(a, b) {
  const pa = String(a).split(/[.\-+]/).map(x => parseInt(x, 10) || 0);
  const pb = String(b).split(/[.\-+]/).map(x => parseInt(x, 10) || 0);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const d = (pb[i] || 0) - (pa[i] || 0);   // 倒序
    if (d) return d;
  }
  return String(b).localeCompare(String(a));
}

/* ------------------------------------------------------------- 加载器安装 */

export async function listLoaders(loader, mcVersion) {
  if (loader === 'fabric') {
    const data = await httpJson(`https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(mcVersion)}`, { source: 'official' });
    return data.map(d => ({ version: d.loader.version, stable: d.loader.stable }));
  }
  if (loader === 'quilt') {
    const data = await httpJson(`https://meta.quiltmc.org/v3/versions/loader/${encodeURIComponent(mcVersion)}`, { source: 'official' });
    return data.map(d => ({ version: d.loader.version, stable: true }));
  }
  if (loader === 'forge' || loader === 'neoforge') {
    const mv = await resolveMavenBase(loader);
    const txt = await httpText(mv.metaUrl, { source: 'official', timeout: 20000 });
    const all = parseMavenVersions(txt);
    let versions;
    if (loader === 'neoforge') {
      // NeoForge 的主版本号有两套规则：
      //   1.20.1 是从 Forge 47 分叉的，版本号是 47.x.y（不是 20.1.x）
      //   1.20.2 起才改成跟随 MC 版本：20.2.x / 20.4.x / 21.0.x / 26.2.x
      let prefix;
      if (String(mcVersion) === '1.20.1') prefix = '47.';
      else prefix = String(mcVersion).replace(/^1\./, '') + '.';
      versions = all.filter(v => v.startsWith(prefix));
    } else {
      // Forge 版本号形如 1.20.1-47.2.0，只取后半段
      versions = all.filter(v => v.startsWith(mcVersion + '-')).map(v => v.slice(String(mcVersion).length + 1));
    }
    return versions.sort(versionCmp).map(v => ({ version: v, stable: !/beta|pre/i.test(v) }));
  }
  return [];
}

export async function installFabricLike(loader, mcVersion, loaderVersion, { source = 'auto', task } = {}) {
  const base = loader === 'quilt' ? 'https://meta.quiltmc.org/v3' : 'https://meta.fabricmc.net/v2';
  const txt = await httpText(`${base}/versions/loader/${encodeURIComponent(mcVersion)}/${encodeURIComponent(loaderVersion)}/profile/json`, { source: 'official' });
  const profile = JSON.parse(txt);
  const vid = profile.id || `${loader}-loader-${loaderVersion}-${mcVersion}`;
  const vdir = path.join(P.versions, vid);
  await fsp.mkdir(vdir, { recursive: true });
  await fsp.writeFile(path.join(vdir, `${vid}.json`), JSON.stringify(profile, null, 2), 'utf8');
  tlog(task, `加载器 profile 已写入: ${vid}`);

  const plan = planLibraries(profile);
  tstage(task, `加载器依赖库 (${plan.downloads.length})`, plan.downloads.length);
  const res = await downloadBatch(plan.downloads, { concurrency: 8, task });
  if (res.failed.length) {
    throw new Error('加载器依赖下载失败: ' + res.failed.slice(0, 3).map(f => `${f.file}: ${f.err}`).join('; '));
  }
  tlog(task, `${loader} ${loaderVersion} 安装完成`);
  return { versionId: vid, loader, loaderVersion, mcVersion, profile };
}

/**
 * 预热 installer 依赖。
 * Forge/NeoForge 的 installer 会自己去 maven.neoforged.net 下库，而该域名在国内常常不通。
 * 办法：从 installer jar 里解析 install_profile.json / version.json 的 libraries，
 * 用我们探测到的可达仓库（通常是 BMCLAPI 中转）提前把 jar 下到 libraries/。
 * installer 运行时会校验到文件已存在且 checksum 有效，直接跳过下载。
 */
async function prewarmForgeLibraries(instJar, mavenBase, task) {
  let buf, entries;
  try { buf = await fsp.readFile(instJar); entries = zipEntries(buf); } catch { return 0; }

  const libs = new Map();
  const addLib = (lib) => {
    if (!lib || !lib.name) return;
    const mp = mavenPath(lib.name);
    if (!mp) return;
    let base = (lib.url || '').replace(/\/+$/, '');
    // 指向官方 maven 的地址一律换成本次可达的仓库
    if (!base || /maven\.neoforged\.net|maven\.minecraftforge\.net|files\.minecraftforge\.net/.test(base)) {
      base = mavenBase;
    }
    libs.set(mp.path, base + '/' + mp.path);
  };

  const readJsonEntry = (name) => {
    const e = entries.find(x => x.name === name);
    if (!e) return null;
    try { return JSON.parse(zipRead(buf, e).toString('utf8').replace(/^\uFEFF/, '')); } catch { return null; }
  };

  const profile = readJsonEntry('install_profile.json');
  if (profile) {
    if (Array.isArray(profile.libraries)) profile.libraries.forEach(addLib);
    if (profile.version && typeof profile.version === 'object' && Array.isArray(profile.version.libraries)) {
      profile.version.libraries.forEach(addLib);
    }
  }
  const verJson = readJsonEntry('version.json');
  if (verJson && Array.isArray(verJson.libraries)) verJson.libraries.forEach(addLib);

  const items = [];
  for (const [rel, url] of libs.entries()) {
    items.push({ url, dest: path.join(P.libraries, rel), label: path.basename(rel) });
  }
  if (!items.length) return 0;

  tlog(task, `预热 ${items.length} 个安装器依赖（走可达仓库，避免 installer 直连官方 maven）`);
  const res = await downloadBatch(items, { concurrency: 8, task });
  if (res.failed.length) tlog(task, `⚠ ${res.failed.length} 个依赖预热失败，installer 可能会自己再试`);
  return items.length;
}
export async function installForgeLike(loader, mcVersion, loaderVersion, javaExe, { source = 'auto', task } = {}) {
  if (!loaderVersion) throw new Error(`缺少 ${loader} 版本号`);
  const isNeo = loader === 'neoforge';

  // 先用探测好的可达仓库（官方不通会自动落到 BMCLAPI 中转）
  const mv = await resolveMavenBase(loader, { task });
  const instName = isNeo
    ? `neoforge-${loaderVersion}-installer.jar`
    : `forge-${mcVersion}-${loaderVersion}-installer.jar`;
  const instPath = isNeo
    ? `${mv.base}/${mv.path}/${loaderVersion}/${instName}`
    : `${mv.base}/${mv.path}/${mcVersion}-${loaderVersion}/${instName}`;

  const instDir = path.join(SHARED, '.installers');
  await fsp.mkdir(instDir, { recursive: true });
  const instJar = path.join(instDir, `${loader}-${mcVersion}-${loaderVersion}-installer.jar`);

  tstage(task, '下载安装器', 1);
  tlog(task, '下载 ' + instPath);
  await downloadOne(instPath, instJar, { source: 'official', timeout: 300000, retries: 2 });
  tprogress(task, 1);

  const vid = isNeo ? `neoforge-${loaderVersion}` : `${mcVersion}-forge-${loaderVersion}`;

  // installer 硬性要求目标目录里有官方启动器的配置文件，否则直接退出：
  //   "There is no minecraft launcher profile in ... you need to run the launcher first!"
  // 它其实只需要这个文件存在，内容无关紧要。
  const profilesFile = path.join(SHARED, 'launcher_profiles.json');
  if (!existsSync(profilesFile)) {
    await fsp.writeFile(profilesFile,
      JSON.stringify({ profiles: {}, settings: {}, version: 3 }, null, 2), 'utf8');
    tlog(task, '已生成 launcher_profiles.json（安装器要求）');
  }

  // 先把依赖预热好，installer 才不会卡在连不上的官方 maven
  tstage(task, '预热安装器依赖', 1);
  try { await prewarmForgeLibraries(instJar, mv.base, task); }
  catch (e) { tlog(task, '预热失败（继续尝试直接安装）: ' + e.message); }

  tstage(task, '运行安装器（可能需要几分钟）', 1);
  const args = ['-jar', instJar, '--installClient', SHARED];
  // 官方 maven 不通、走中转时，也要让 installer 自己走同一中转，
  // 否则它会去连 maven.neoforged.net 然后卡死。
  if (/bmclapi/i.test(mv.base)) {
    args.push('--mirror', 'https://bmclapi2.bangbang93.com/maven');
    tlog(task, '安装器将通过 BMCLAPI 中转下载依赖');
  }
  const code = await new Promise((resolve) => {
    const ps = spawn(javaExe, args, {
      cwd: SHARED, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    ps.stdout.on('data', d => d.toString().split(/\r?\n/).filter(Boolean).forEach(l => tlog(task, l.slice(0, 300))));
    ps.stderr.on('data', d => d.toString().split(/\r?\n/).filter(Boolean).forEach(l => tlog(task, l.slice(0, 300))));
    ps.on('exit', c => resolve(c));
    ps.on('error', () => resolve(-1));
    setTimeout(() => { try { ps.kill(); } catch { } }, 1000 * 60 * 15);
  });
  tprogress(task, 1);
  if (code !== 0) throw new Error(`安装器退出码 ${code}，请查看日志。`);
  if (!existsSync(path.join(P.versions, vid, `${vid}.json`))) {
    const dirs = await fsp.readdir(P.versions).catch(() => []);
    const cand = dirs.find(d => d.includes(loaderVersion));
    if (cand) return { versionId: cand, loader, loaderVersion, mcVersion };
    throw new Error('安装器执行完成但未找到版本目录: ' + vid);
  }
  return { versionId: vid, loader, loaderVersion, mcVersion };
}

/* ------------------------------------------------------------ JVM 参数预设 */

export const JVM_PRESETS = {
  aikar: {
    name: 'Aikar 优化（推荐）',
    desc: 'Aikar 公开推荐的 G1GC 参数，Minecraft 社区公认调优方案，显著减少 GC 卡顿。归属: https://mcflags.emc.gs',
    build: (mb) => [
      `-Xms${Math.max(512, Math.floor(mb / 2))}M`, `-Xmx${mb}M`,
      '-XX:+UseG1GC', '-XX:+ParallelRefProcEnabled', '-XX:MaxGCPauseMillis=200',
      '-XX:+UnlockExperimentalVMOptions', '-XX:+DisableExplicitGC', '-XX:+AlwaysPreTouch',
      '-XX:G1NewSizePercent=30', '-XX:G1MaxNewSizePercent=40', '-XX:G1HeapRegionSize=8M',
      '-XX:G1ReservePercent=20', '-XX:G1HeapWastePercent=5', '-XX:G1MixedGCCountTarget=4',
      '-XX:InitiatingHeapOccupancyPercent=15', '-XX:G1MixedGCLiveThresholdPercent=90',
      '-XX:G1RSetUpdatingPauseTimePercent=5', '-XX:SurvivorRatio=32', '-XX:+PerfDisableSharedMem',
      '-XX:MaxTenuringThreshold=1', '-Dusing.aikars.flags=https://mcflags.emc.gs',
      '-Daikars.new.flags=true',
    ],
  },
  balanced: {
    name: '均衡（G1GC 轻量）',
    desc: '在低配机器 / 小内存上更稳，参数少、启动快，省内存。',
    build: (mb) => [
      `-Xms${Math.max(512, Math.floor(mb * 0.4))}M`, `-Xmx${mb}M`,
      '-XX:+UseG1GC', '-XX:MaxGCPauseMillis=120', '-XX:G1HeapRegionSize=4M',
      '-XX:+ParallelRefProcEnabled', '-XX:+UseStringDeduplication',
      '-XX:TieredStopAtLevel=1', '-XX:+UseFastAccessorMethods',
    ],
  },
  memsave: {
    name: '极致省内存',
    desc: '为 8GB 及以下机器设计：串行 GC + 字符串去重 + 延迟类加载，牺牲部分帧数换内存。',
    build: (mb) => [
      `-Xms${Math.max(384, Math.floor(mb * 0.3))}M`, `-Xmx${mb}M`,
      '-XX:+UseSerialGC', '-XX:MaxGCPauseMillis=100',
      '-XX:+UseStringDeduplication', '-XX:+OptimizeStringConcat',
      '-XX:+UseCompressedOops', '-XX:+UseCompressedClassPointers',
      '-XX:ReservedCodeCacheSize=96M', '-XX:MetaspaceSize=128M',
    ],
  },
  smooth: {
    name: '高帧率（ZGC / 低延迟）',
    desc: 'Java 17+ 可用。低停顿 GC，适合大内存机器追求帧数稳定。',
    build: (mb) => [
      `-Xms${mb}M`, `-Xmx${mb}M`,
      '-XX:+UseG1GC', '-XX:MaxGCPauseMillis=50',
      '-XX:+ParallelRefProcEnabled', '-XX:+UseStringDeduplication',
      '-XX:G1NewSizePercent=25', '-XX:G1MaxNewSizePercent=60',
      '-XX:G1HeapRegionSize=16M', '-XX:+AlwaysPreTouch',
      '-XX:+UnlockExperimentalVMOptions',
    ],
  },
  vanilla: {
    name: '原版默认',
    desc: '不做任何优化，仅设置内存。用于排查"是不是参数搞的鬼"。',
    build: (mb) => [`-Xms${Math.floor(mb / 2)}M`, `-Xmx${mb}M`],
  },
};

/** 推荐内存（MB） */
export function recommendMemoryMb() {
  const total = Math.round(os.totalmem() / 1024 / 1024);
  if (total <= 4096) return 1536;
  if (total <= 6144) return 2048;
  if (total <= 8192) return 3072;
  if (total <= 12288) return 4096;
  if (total <= 16384) return 6144;
  if (total <= 24576) return 8192;
  return Math.min(Math.floor(total * 0.4), 16384);
}

/**
 * 启动前自动内存调优（每次启动都重新算）。
 *
 * 思路：不是简单套一个固定值，而是把「这台机器此刻的状态」算进去：
 *  - 物理内存总量决定基础推荐
 *  - 当前可用内存决定上限（别的程序占满了就别逞强，否则系统开始换页更卡）
 *  - 模组数量决定加成（模组多堆要大）
 *  - 最后按 128MB 对齐，并给出人类可读的决策理由
 *
 * 返回的 notes 会写进启动日志，让用户知道「为什么给这么多」。
 */
export function autoTuneMemory({ modCount = 0, loader = 'vanilla', enabledMods = 0 } = {}) {
  const total = Math.round(os.totalmem() / 1024 / 1024);
  const free = Math.round(os.freemem() / 1024 / 1024);
  const notes = [];

  const base = recommendMemoryMb();
  notes.push(`物理内存 ${(total / 1024).toFixed(1)} GB，基础推荐 ${base} MB`);

  // 模组加成
  const n = Math.max(modCount, enabledMods);
  let modBonus = 0;
  if (n >= 150) modBonus = 2048;
  else if (n >= 100) modBonus = 1536;
  else if (n >= 60) modBonus = 1024;
  else if (n >= 30) modBonus = 512;
  else if (n >= 10) modBonus = 256;
  if (modBonus) notes.push(`启用模组 ${n} 个 → +${modBonus} MB`);

  let target = base + modBonus;

  // 上限一：别超过物理内存的 60%（超了系统开始换页，帧数反而崩）
  const byTotal = Math.floor(total * 0.6);
  // 上限二：给系统和其他程序留出余量。这里保底 1536MB，
  // 因为「分配太少」比「轻微换页」更糟：堆太小会直接卡加载、甚至 OOM 崩溃。
  const byFree = Math.max(1536, free - 800);
  const hardMax = Math.max(1024, Math.min(byTotal, byFree));

  if (target > hardMax) {
    notes.push(`当前可用 ${(free / 1024).toFixed(1)} GB → 上限 ${hardMax} MB（再高会让系统换页）`);
    target = hardMax;
  }
  if (target < 1024) {
    target = 1024;
    notes.push('下限抬到 1024 MB（低于此值区块加载会严重卡顿）');
  }
  if (hardMax < base) {
    notes.push('提示：启动前关掉浏览器等占内存的程序，可以分到更多内存');
  }

  // 128MB 对齐（JVM 堆增长更平滑）
  target = Math.max(1024, Math.round(target / 128) * 128);

  // 预设选择
  let preset = 'aikar';
  if (total >= 24576 && target >= 8192) preset = 'smooth';
  else if (total <= 6144 || free < 2200) preset = 'memsave';
  if (preset === 'memsave') notes.push('可用内存偏紧 → 使用「极致省内存」预设');
  else if (preset === 'smooth') notes.push('大内存 → 使用「高帧率」预设');
  else notes.push('使用「Aikar 优化」预设');

  const pressure = free < 1500 ? 'high' : free < 3000 ? 'medium' : 'low';
  if (pressure === 'high') notes.push(`⚠ 当前可用内存仅 ${free} MB，建议先关掉浏览器等程序`);

  return {
    memoryMb: target, preset, notes,
    totalMb: total, freeMb: free, baseMb: base, modBonus,
    hardMaxMb: hardMax, modCount: n, pressure,
  };
}

/* ------------------------------------------------------------- 启动构建 */

export async function buildLaunchCommand(profile, task) {
  const {
    instanceDir, versionId, username, memoryMb, jvmPreset, extraJvmArgs,
    javaPath, width, height, source = 'auto', features = {},
  } = profile;

  const vj = await getVersionJson(versionId, source);

  // natives 目录：加载器版本自身通常没有，需回落到父版本（原版）
  const chainIds = vj.__resolvedFrom || [versionId];
  let nativesDir = path.join(P.versions, versionId, 'natives');
  if (!existsSync(nativesDir)) {
    for (const id of chainIds) {
      const d = path.join(P.versions, id, 'natives');
      if (existsSync(d)) { nativesDir = d; break; }
    }
  }

  // classpath：库 + 各级 inherits 的 jar
  const plan = planLibraries(vj, features);
  const cp = [...plan.classpath];
  for (const id of (vj.__resolvedFrom || [versionId]).slice().reverse()) {
    const jp = path.join(P.versions, id, `${id}.jar`);
    if (existsSync(jp)) cp.push(jp);
  }
  const sep = ';';
  // 去重
  const seen = new Set();
  const classpath = cp.filter(p => { const k = p.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).join(sep);

  const preset = JVM_PRESETS[jvmPreset] || JVM_PRESETS.aikar;
  const mem = Math.max(512, Math.min(memoryMb || recommendMemoryMb(),
    Math.round(os.totalmem() / 1024 / 1024) - 1024));
  let jvmArgs = preset.build(mem);
  if (extraJvmArgs?.trim()) jvmArgs.push(...extraJvmArgs.trim().split(/\s+(?=-)/));

  const uuid = offlineUuid(username || 'Player');
  const repl = {
    natives_directory: nativesDir,
    launcher_name: 'NovaLauncher',
    launcher_version: '1.0.0',
    classpath,
    classpath_separator: sep,
    library_directory: P.libraries,
    version_name: vj.id || versionId,
    auth_player_name: username || 'Player',
    auth_uuid: uuid,
    auth_access_token: '0',
    auth_session: '0',
    user_type: 'legacy',
    version_type: vj.type || 'release',
    game_directory: instanceDir,
    assets_root: P.assets,
    assets_index_name: vj.assetIndex?.id || vj.assets || 'legacy',
    game_assets: path.join(P.assets, 'virtual', 'legacy'),
    user_properties: '{}',
    clientid: 'nova',
    auth_xuid: '0',
    resolution_width: String(width || 854),
    resolution_height: String(height || 480),
  };
  const subst = (s) => String(s).replace(/\$\{([^}]+)\}/g, (_, k) => (k in repl ? repl[k] : ''));

  const expand = (arr) => {
    const out = [];
    for (const a of arr || []) {
      if (typeof a === 'string') out.push(subst(a));
      else if (a && typeof a === 'object' && a.value !== undefined) {
        if (rulesAllow(a.rules, features)) {
          const vals = Array.isArray(a.value) ? a.value : [a.value];
          out.push(...vals.map(subst));
        }
      }
    }
    return out;
  };

  const jvmFromJson = expand(vj.arguments?.jvm);
  const gameFromJson = expand(vj.arguments?.game);

  let gameArgs;
  if (vj.arguments?.game) {
    gameArgs = gameFromJson;
  } else if (vj.minecraftArguments) {
    gameArgs = vj.minecraftArguments.split(/\s+/).map(subst);
  } else {
    gameArgs = ['--username', repl.auth_player_name, '--version', repl.version_name,
      '--gameDir', repl.game_directory, '--assetsDir', repl.assets_root,
      '--assetIndex', repl.assets_index_name, '--uuid', repl.auth_uuid,
      '--accessToken', '0', '--userType', 'legacy', '--versionType', 'release'];
  }

  const mainClass = vj.mainClass || 'net.minecraft.client.main.Main';
  const loggerArg = [];
  if (vj.logging?.client?.argument && vj.logging?.client?.file?.id) {
    const lp = path.join(P.versions, versionId, 'logging', vj.logging.client.file.id);
    if (existsSync(lp)) loggerArg.push(subst(vj.logging.client.argument).replace('${path}', lp));
  }

  const finalJvm = [
    ...jvmArgs,
    `-Djava.library.path=${nativesDir}`,
    ...loggerArg,
    // 若 JSON 里的 jvm 参数含 -Xmx/-Xms 则剔除，避免覆盖用户内存设置
    ...jvmFromJson.filter(a => !/^-Xm[sx]/.test(a)),
    '-cp', classpath,
    mainClass,
    ...gameArgs,
  ];

  return {
    java: javaPath,
    args: finalJvm,
    memoryMb: mem,
    mainClass,
    versionId,
    classpathCount: classpath.split(sep).length,
    resolvedFrom: vj.__resolvedFrom,
    display: `${path.basename(javaPath)} ${finalJvm.slice(0, 6).join(' ')} ...`,
  };
}

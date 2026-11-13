// index.mjs —— Nova Launcher 本地服务：API + 静态资源 + 游戏进程管理
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  ROOT, DATA, SHARED, INSTANCES, RUNTIME, CACHE, P, ensureDirs, loadConfig, saveConfig,
  createTask, taskPublic, listTasks, getTask, tlog, tstage, tprogress, tdone, tfail, redactConfig,
  cancelTask, getHistory, clearHistory, taddFile, addBytes, MARKER_FILE, setExtraGameDirs, getExtraGameDirs, gameRoots,
  httpText, readJson, writeJson, existsSync, exists, downloadOne, totalMemoryMb, freeMemoryMb,
  dirSize, safeName, offlineUuid, httpBinary, zipCreate, collectDirEntries, zipExtractAll, zipEntries, zipRead,
} from './core.mjs';
import {
  detectJavas, javaVersionOf, pickJava, requiredJavaMajor, installJava,
  getManifest, getVersionJson, installVersion, listLoaders, installFabricLike,
  installForgeLike, JVM_PRESETS, recommendMemoryMb, buildLaunchCommand, planLibraries, rulesAllow,
  isVersionReady, autoTuneMemory, ensureJava, JDK_SOURCES,
} from './mc.mjs';
import {
  KINDS, listInstances, getInstance, createInstance, updateInstance, deleteInstance,
  duplicateInstance, listContents, toggleContent, deleteContent, importContent, ensureInstanceDirs,
  mrSearch, mrVersions, mrInstall, installMrpack, materializeMrpack, materializeZipPack,
  instanceDir, installCfpaMod, cfpaStatus, mrProject, autoInstallMissingDeps, writeSource, parseCfPack,
} from './content.mjs';
import { checkInstanceDeps } from './deps.mjs';
import { cryptoStatus } from './secure.mjs';
import { optimizeMemory } from './memory.mjs';
import { translateQuery, cnName, buildLinks, mcmodSearchUrl, MOD_CN, CFPA_MODS } from './i18n.mjs';
import { lookupMcmod, listMcmodCache } from './mcmod.mjs';
import { translateText } from './translate.mjs';
import { buildIndex, indexStatus, fuzzyLookup } from './search.mjs';
import { cfSearch, cfProject, cfFiles, cfFileUrl, cfPing } from './curseforge.mjs';
import { createBackup, listBackups, restoreBackup, deleteBackup, autoBackupIfDue } from './backup.mjs';
import {
  listCustomThemes, parseThemeFile, saveTheme, deleteTheme,
  getWallpaper, setWallpaper, updateWallpaper, clearWallpaper, wallpaperPath, wallpaperPublic,
  WALLPAPER_MIME, THEMES_DIR, WALLPAPER_DIR, THEME_SAMPLE_JSON, THEME_SAMPLE_HTML,
} from './theme.mjs';
import {
  readLevelDat, writeLevelDat, getData, summarizeLevel,
  setInt, setByte, setString, GAME_MODES, DIFFICULTIES,
} from './nbt.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.join(ROOT, 'web');
const PORT = Number(process.env.NOVA_PORT || 7420);
const HOST = '127.0.0.1';

/* ------------------------------------------------------------ 接口鉴权 */
/*
 * 本地 HTTP 服务默认谁都能访问：任何扫到 127.0.0.1:7420 的程序，
 * 或者被诱导的浏览器页面（DNS rebinding），都能直接调 /api/*。
 *
 * 这里加两道闸：
 *   1. **令牌**：桌面外壳启动时生成随机令牌，经环境变量传进来，
 *      再以 ?t= 带给前端；前端之后每个请求都带 X-Nova-Token。
 *      令牌只存在进程内存里，不落盘。
 *   2. **Host 校验**：只接受 127.0.0.1 / localhost 的 Host 头，
 *      挡掉 DNS rebinding（攻击者域名解析到 127.0.0.1 后 Host 仍是他的域名）。
 *
 * 浏览器模式（用户手动开 http://127.0.0.1:7420）没有外壳给的令牌，
 * 那就自己生成一个并打印到控制台，用户照着带参数的地址访问即可。
 */
const TOKEN = process.env.NOVA_TOKEN
  || crypto.randomBytes(18).toString('hex');
const TOKEN_FROM_SHELL = !!process.env.NOVA_TOKEN;

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

/** Host 头必须是本机回环地址 */
function hostOk(req) {
  const h = String(req.headers.host || '');
  if (!h) return true;                       // HTTP/1.0 无 Host，交给令牌拦
  const name = h.replace(/:\d+$/, '').toLowerCase();
  return LOOPBACK_HOSTS.has(name);
}

/* ------------------------------------------------------------ 运行时状态 */

const state = {
  javas: [],
  javasAt: 0,
  running: null,        // { instanceId, pid, startedAt, child }
  gameLog: [],          // { t, line, instanceId }
};

function pushGameLog(instanceId, line) {
  for (const l of String(line).split(/\r?\n/)) {
    if (!l.trim()) continue;
    state.gameLog.push({ t: Date.now(), instanceId, line: l.slice(0, 2000) });
  }
  if (state.gameLog.length > 3000) state.gameLog.splice(0, state.gameLog.length - 3000);
}

async function getJavas(force = false) {
  if (!force && state.javas.length && Date.now() - state.javasAt < 60000) return state.javas;
  state.javas = await detectJavas();
  state.javasAt = Date.now();
  return state.javas;
}

/**
 * 从一个 zip 里导入存档到实例的 saves 目录。
 * 自动识别三种常见结构：
 *   1) 整包就是一个存档（根目录有 level.dat）
 *   2) 包里有多个存档（每个子目录各有 level.dat）
 *   3) 包里是 saves/xxx/level.dat（多套了一层）
 * @returns {Promise<string[]>} 导入后的存档文件夹名
 */
async function importSaveZip(buf, instDir, preferredName) {
  const tmp = path.join(CACHE, 'saveimport', String(Date.now()) + '-' + Math.floor(Math.random() * 1e4));
  try {
    await fsp.mkdir(tmp, { recursive: true });
    const n = await zipExtractAll(buf, tmp);
    if (!n) throw new Error('压缩包里没有文件');

    const found = [];
    async function scan(dir, rel) {
      if (existsSync(path.join(dir, 'level.dat'))) { found.push({ dir, rel }); return; }
      const items = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const it of items) {
        if (it.isDirectory()) await scan(path.join(dir, it.name), rel ? `${rel}/${it.name}` : it.name);
      }
    }
    await scan(tmp, '');
    if (!found.length) throw new Error('压缩包里没找到 level.dat，可能不是 Minecraft 存档');

    const savesDir = path.join(instDir, 'saves');
    await fsp.mkdir(savesDir, { recursive: true });
    const created = [];
    for (const f of found) {
      let base = f.rel ? path.basename(f.rel) : (preferredName || '导入的存档');
      base = safeName(String(base).replace(/\.(zip|mcworld)$/i, '')) || '导入的存档';
      let dest = path.join(savesDir, base);
      let i = 1;
      while (existsSync(dest)) dest = path.join(savesDir, `${base} (${i++})`);
      await fsp.cp(f.dir, dest, { recursive: true });
      await fsp.rm(path.join(dest, 'session.lock'), { force: true }).catch(() => { });
      created.push(path.basename(dest));
    }
    return created;
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true }).catch(() => { });
  }
}

/* --------------------------------------------------------------- HTTP 工具 */

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}
function ok(res, obj = {}) { json(res, 200, { ok: true, ...obj }); }
function fail(res, err, code = 400) { json(res, code, { ok: false, error: String(err?.message || err) }); }

async function readJsonBody(req, limit = 8 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new Error('请求体过大');
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return {}; }
}

/** 收原始字节（壁纸这类要校验文件头的上传） */
async function readAllBytes(req, limit = 24 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new Error(`文件过大（上限 ${Math.round(limit / 1048576)} MB）`);
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
};

async function serveStatic(res, urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';
  const fp = path.join(WEB, path.normalize(rel).replace(/^([/\\])+/, ''));
  if (!fp.startsWith(WEB)) return json(res, 403, { error: 'forbidden' });
  try {
    const st = await fsp.stat(fp);
    if (st.isDirectory()) return json(res, 404, { error: 'not found' });
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size, 'Cache-Control': 'no-cache',
    });
    fs.createReadStream(fp).pipe(res);
  } catch {
    json(res, 404, { error: 'not found: ' + rel });
  }
}

/* -------------------------------------------------------- 版本就绪检查 */

async function versionJsonLocal(id) {
  return readJson(path.join(P.versions, id, `${id}.json`), null);
}

async function ensureVersionReady(versionId, task, source = 'auto') {
  const local = await versionJsonLocal(versionId);
  if (!local) {
    tlog(task, `本地缺少 ${versionId}，开始安装 ...`);
    await installVersion(versionId, { task, source });
    return;
  }
  if (local.inheritsFrom) {
    await ensureVersionReady(local.inheritsFrom, task, source);
    // 补齐加载器自身依赖
    tstage(task, '检查加载器依赖', 1);
    const plan = planLibraries(local);
    const missing = plan.downloads.filter(d => !existsSync(d.dest));
    if (missing.length) {
      tlog(task, `补下 ${missing.length} 个加载器依赖`);
      const r = await downloadBatchSafe(missing, task);
      if (r.failed.length) tlog(task, `⚠ ${r.failed.length} 个加载器依赖失败`);
    }
    tprogress(task, 1);
    // 检查父版本 jar
    const parentJar = path.join(P.versions, local.inheritsFrom, `${local.inheritsFrom}.jar`);
    if (!existsSync(parentJar)) {
      tlog(task, `父版本 jar 缺失，重新安装 ${local.inheritsFrom}`);
      await installVersion(local.inheritsFrom, { task, source });
    }
    return;
  }
  // 原版：已完整安装则跳过（快速路径），否则交给 installVersion 做增量校验
  if (await isVersionReady(versionId)) {
    tlog(task, `${versionId} 完整性标记有效，跳过文件校验`);
    tstage(task, '游戏文件已就绪', 1);
    tprogress(task, 1);
    return;
  }
  await installVersion(versionId, { task, source });
}

async function downloadBatchSafe(items, task, concurrency = 12) {
  const { downloadBatch } = await import('./core.mjs');
  return downloadBatch(items, { concurrency, task });
}

/* ------------------------------------------------------------------- 启动 */

async function doLaunch(instanceId) {
  const inst = await getInstance(instanceId);
  if (!inst) throw new Error('实例不存在');
  if (state.running) throw new Error('已有游戏在运行中，请先关闭');

  const cfg = await loadConfig();
  const task = createTask('launch', `启动 ${inst.name}`);

  (async () => {
    try {
      const source = cfg.source || 'auto';

      // 每次启动前自动备份一次存档 —— 玩崩了还能退回来。
      // 默认备全部实例；设置里可以改成只备当前实例，或者关掉。
      const lb = cfg.launchBackup || 'all';
      if (lb !== 'off') {
        try {
          tstage(task, '备份存档', 1);
          const bk = await createBackup({
            reason: `启动前自动备份（${inst.name}）`,
            kind: 'launch',
            instanceId: lb === 'instance' ? inst.id : null,
          });
          tlog(task, `已备份: ${bk.file}（${(bk.size / 1048576).toFixed(1)} MB）`);
        } catch (e) {
          tlog(task, '启动前备份失败（不影响启动）: ' + e.message);
        }
      }

      tstage(task, '检查游戏文件', 1);
      await ensureVersionReady(inst.versionId, task, source);

      // 启动前把前置补上 —— 缺前置的话游戏起来就是一屏
      // "Missing or unsupported mandatory dependencies"，与其让用户对着
      // 崩溃日志发愣，不如在这里先解决。检测是纯本地读，有缓存，很快。
      tstage(task, '核对前置模组', 1);
      await autoInstallMissingDeps(inst.id, {
        task, mcVersion: inst.version, loader: inst.loader,
      }).catch(e => { tlog(task, '前置检查失败（不影响启动）: ' + e.message); });

      tstage(task, '检测 Java', 1);
      const inst0 = inst;
      const vj = await getVersionJson(inst0.versionId, source);
      const need = requiredJavaMajor(inst0.version, vj);
      const javaRes = await ensureJava(need, {
        task,
        autoInstall: cfg.autoInstallJava !== false,
        preferred: inst0.javaPath || cfg.javaPath,
      });
      const pick = javaRes;
      if (!pick.java) {
        throw new Error(`没有可用的 Java（需要 Java ${need}）。请到「设置 → Java 运行时」手动安装，或确认网络可用。`);
      }
      if (pick.java.major < need) {
        throw new Error(`需要 Java ${need} 或更高，当前最高只有 Java ${pick.java.major}。自动安装未成功，请手动安装。`);
      }
      if (javaRes.installed) tlog(task, `已自动安装并启用 Java ${pick.java.major}: ${pick.java.path}`);
      else tlog(task, `使用 Java: ${pick.java.path} (${pick.java.full})`);
      tprogress(task, 1);

      const memMb = inst.memory || cfg.memory?.customMb || recommendMemoryMb();
      const preset = inst.jvmPreset || cfg.jvmPreset || 'aikar';

      // —— 启动时自动内存优化 ——
      const autoOpt = inst.autoOptimize !== undefined ? inst.autoOptimize : (cfg.autoOptimize !== false);
      let finalMem = memMb;
      let finalPreset = preset;
      if (autoOpt) {
        const mods = await listContents(instanceId, 'mod').catch(() => []);
        const tune = autoTuneMemory({
          modCount: mods.length,
          enabledMods: mods.filter(m => m.enabled).length,
          loader: inst.loader,
        });
        finalMem = tune.memoryMb;
        finalPreset = tune.preset;   // 自动优化开启时，内存与预设都由调优统一决定
        tlog(task, '自动内存优化：');
        tune.notes.forEach(n => tlog(task, '  · ' + n));
        tlog(task, `  → 分配 ${finalMem} MB / ${JVM_PRESETS[finalPreset]?.name || finalPreset}`);
      } else {
        tlog(task, `自动优化已关闭，使用手动设置 ${finalMem} MB / ${finalPreset}`);
      }

      tstage(task, '构建启动参数', 1);
      const cmd = await buildLaunchCommand({
        instanceDir: inst.dir,
        versionId: inst.versionId,
        username: cfg.username || 'Player',
        memoryMb: finalMem,
        jvmPreset: finalPreset,
        extraJvmArgs: inst.extraJvmArgs || '',
        javaPath: pick.java.path,
        width: inst.width || 854,
        height: inst.height || 480,
        source,
      });
      tlog(task, `内存: ${cmd.memoryMb} MB | 类路径 ${cmd.classpathCount} 项 | 主类 ${cmd.mainClass}`);
      tprogress(task, 1);

      tstage(task, '启动游戏', 1);
      state.gameLog = state.gameLog.slice(-200);
      pushGameLog(instanceId, `--- Nova Launcher 启动 ${inst.name} (${inst.versionId}) ---`);
      pushGameLog(instanceId, `Java: ${pick.java.path}`);
      pushGameLog(instanceId, `内存: ${cmd.memoryMb} MB / 预设: ${inst.jvmPreset || cfg.jvmPreset}`);

      // 干净的子进程环境：去掉可能干扰 JVM 的变量
      const childEnv = { ...process.env };
      delete childEnv.JAVA_TOOL_OPTIONS;
      delete childEnv._JAVA_OPTIONS;

      const child = spawn(cmd.java, cmd.args, {
        cwd: inst.dir,
        windowsHide: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: childEnv,
      });
      state.running = { instanceId, pid: child.pid, startedAt: Date.now(), name: inst.name };
      await updateInstance(instanceId, { lastPlayed: Date.now() });
      tdone(task);

      const onData = (d) => pushGameLog(instanceId, d.toString());
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);

      child.on('exit', async (code) => {
        const dur = Math.round((Date.now() - (state.running?.startedAt || Date.now())) / 1000);
        pushGameLog(instanceId, `--- 游戏退出 (code ${code})，运行 ${Math.floor(dur / 60)} 分 ${dur % 60} 秒 ---`);
        state.running = null;
        try {
          const cur = await getInstance(instanceId);
          if (cur) await updateInstance(instanceId, { playtimeSec: (cur.playtimeSec || 0) + dur });
        } catch { }
      });
      child.on('error', (e) => {
        pushGameLog(instanceId, '启动失败: ' + e.message);
        state.running = null;
      });
    } catch (e) {
      tfail(task, e);
      pushGameLog(instanceId, '启动失败: ' + e.message);
    }
  })();

  return task;
}

/* --------------------------------------------------------- 优化建议生成 */

async function buildOptimizeAdvice(instanceId) {
  const cfg = await loadConfig();
  const total = totalMemoryMb();
  const free = freeMemoryMb();
  const rec = recommendMemoryMb();
  const inst = instanceId ? await getInstance(instanceId) : null;
  const cur = inst?.memory || cfg.memory?.customMb || rec;
  const suggestions = [];

  const pct = Math.round((cur / total) * 100);
  if (cur > total * 0.55) {
    suggestions.push({
      level: 'danger', title: `内存分配过高（${cur} MB ≈ 物理内存的 ${pct}%）`,
      detail: '给 Java 的堆超过物理内存一半时，系统本身和显卡驱动会开始换页，游戏反而更卡甚至闪退。',
      action: `建议改为 ${rec} MB`,
      apply: { memory: rec },
    });
  } else if (cur < 1024) {
    suggestions.push({
      level: 'warn', title: `内存分配偏低（${cur} MB）`,
      detail: '低于 1 GB 会让区块加载和 GC 疯狂抖动，主界面都可能卡。',
      action: `建议改为 ${rec} MB`, apply: { memory: rec },
    });
  }
  if ((inst?.jvmPreset || cfg.jvmPreset) === 'vanilla') {
    suggestions.push({
      level: 'info', title: '当前使用原版默认 JVM 参数',
      detail: 'Aikar 的 G1GC 参数能显著降低 GC 停顿（归属: mcflags.emc.gs），是社区公认的调优方案。',
      action: '切换到 Aikar 优化', apply: { jvmPreset: 'aikar' },
    });
  }
  if (total <= 8192) {
    suggestions.push({
      level: 'info', title: `本机内存 ${(total / 1024).toFixed(1)} GB，属于小内存`,
      detail: '建议：渲染距离 8、关闭光影、模组数量控制在 60 个以内；JVM 预设选「极致省内存」或「Aikar 优化」。',
      action: '套用小内存方案', apply: { memory: Math.min(rec, 3072), jvmPreset: 'aikar' },
    });
  }
  if (free < 1500) {
    suggestions.push({
      level: 'warn', title: `当前可用内存仅 ${free} MB`,
      detail: '启动前建议关掉浏览器等其他占内存的程序，否则游戏会被迫使用交换分区。',
      action: null,
    });
  }
  if (inst) {
    const mods = (await listContents(instanceId, 'mod').catch(() => [])).filter(m => m.enabled);
    if (mods.length > 100) {
      suggestions.push({
        level: 'warn', title: `启用中的模组有 ${mods.length} 个`,
        detail: '模组越多，内存与启动时间呈超线性增长。建议精简或临时禁用不用的模组。',
        action: null,
      });
    }
    const shaders = (await listContents(instanceId, 'shader').catch(() => [])).filter(m => m.enabled);
    if (shaders.length && total <= 8192) {
      suggestions.push({
        level: 'info', title: '启用了光影包',
        detail: '光影吃显卡不吃内存，但会显著降低帧数。若卡顿可先在游戏内关掉光影再比较。',
        action: null,
      });
    }
  }
  return {
    totalMemMb: total, freeMemMb: free, recommendedMb: rec, currentMb: cur,
    presets: Object.entries(JVM_PRESETS).map(([k, v]) => ({ key: k, name: v.name, desc: v.desc })),
    suggestions,
  };
}



/* ------------------------------------------------------- 双源同时搜索 */
/**
 * Modrinth 和 CurseForge 同时查，合并成一份结果。
 *
 * 为什么要合并：两边内容不重合。FTB Ultimine、大量国产模组只在 CurseForge；
 * 光影/资源包生态则在 Modrinth 更全。以前只能在「数据源」下拉里二选一，
 * 搜不到就得自己切过去再搜一遍。
 *
 * 合并规则：
 *   - 同名（规范化后）只留一条，取下载量高的，另一来源记在 alsoOn 里
 *   - 排序先按「和关键词的匹配程度」分层（完全一致 > 前缀 > 包含 > 其他），
 *     同层内按下载量降序 —— 纯按下载量排会让冷门精确匹配沉底，
 *     纯按来源交替又会把热门挤下去
 *   - 某个源挂了不影响另一个，降级返回并在 sources 里说明
 */
/**
 * 把用户输入的中文查词变成「真的能搜到东西」的英文词。
 *
 * 为什么需要：CurseForge 的搜索接口对中文是静默忽略的（传中文 = 没传搜索词，
 * 会把全站热门倒序吐回来），Modrinth 也没有中文项目名。
 * 顺序：本地词典 → MC百科 → 原样。
 */
async function resolveQuery(raw) {
  const q0 = String(raw || '').trim();
  if (!q0) return { query: '', from: 'empty', original: '' };

  // 1) 本地词典（MOD_CN / CN_ALIASES / PACK_ALIAS）
  const t = translateQuery(q0);
  if (t.translated && t.query && !/[\u4e00-\u9fa5]/.test(t.query)) {
    return { query: t.query, from: 'dict', original: q0, cn: t.pack ? q0 : null };
  }

  // 2) 词典没有 → 问 MC百科。它的搜索结果条目就是「化龍 (BeLoong)」这种形式，
  //    中文名和官方英文名一次拿到，不用再点进项目页
  if (/[\u4e00-\u9fa5]/.test(q0)) {
    try {
      const m = await lookupMcmod(q0);
      if (m && m.en) return { query: m.en, from: 'mcmod', original: q0, cn: m.cn, url: m.url };
    } catch { /* 查不到就往下走 */ }
  }

  // 3) 都没辙：原样返回（Modrinth 偶尔能搜到，CurseForge 那边会被 cfSearch 挡掉）
  return { query: t.query || q0, from: 'raw', original: q0 };
}

/**
 * 看压缩包里有什么，判断它到底是模组、资源包还是光影。
 * CurseForge 整合包的 manifest 不区分类型（只有 projectID/fileID），
 * 有些包会把资源包也列进 files[]，全丢进 mods 只会让游戏报
 * “not a valid mod file”，东西也白下。
 */
async function sniffContentKind(file) {
  try {
    const buf = await fsp.readFile(file);
    const names = zipEntries(buf).map(e => e.name);
    if (names.some(n => /^(META-INF\/neoforge\.mods\.toml|META-INF\/mods\.toml|fabric\.mod\.json|quilt\.mod\.json|mcmod\.info)$/i.test(n))) return 'mod';
    if (names.some(n => /^shaders\//.test(n))) return 'shader';
    if (names.some(n => /^assets\//.test(n) || n === 'pack.mcmeta')) return 'resourcepack';
    return 'mod';
  } catch { return 'mod'; }
}

async function searchAllSources({ query = '', kind = 'mod', mcVersion = '', loader = '', offset = 0, limit = 30 } = {}) {
  const cfg = await loadConfig();
  const cfKey = (cfg.curseforgeApiKey || '').trim();
  const useCf = !!cfKey;

  // 两边各取一半，凑够一页；只有一个源时全给它
  const perSource = useCf ? Math.max(6, Math.ceil(limit / 2)) : limit;
  const out = { mr: null, cf: null, errors: {} };

  const jobs = [
    mrSearch({ query, kind, mcVersion, loader, offset, limit: perSource })
      .then(r => { out.mr = r; })
      .catch(e => { out.errors.modrinth = e.message; }),
  ];
  if (useCf) {
    jobs.push(
      cfSearch(cfKey, { query, kind, mcVersion, loader, offset, limit: perSource })
        .then(r => { out.cf = r; })
        .catch(e => { out.errors.curseforge = e.message; }),
    );
  }
  await Promise.all(jobs);

  // 去重用的规范化：去掉括号里的平台后缀再做比较 ——
  // 「Cloth Config API」和「Cloth Config API (Fabric/Forge/NeoForge)」
  // 是同一个东西，不处理的话两边各出现一次
  const norm = (s) => String(s || '')
    .replace(/[（(][^)）]*[)）]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]/g, '');
  const all = [
    ...(out.mr?.hits || []).map(h => ({ ...h, sourceKind: 'modrinth' })),
    ...(out.cf?.hits || []).map(h => ({ ...h, sourceKind: 'curseforge' })),
  ];

  // 同名合并
  const groups = new Map();
  for (const h of all) {
    const k = norm(h.title) || ('#' + h.id);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(h);
  }
  const hits = [...groups.values()].map((list) => {
    list.sort((a, b) => (b.downloads || 0) - (a.downloads || 0));
    const keep = { ...list[0] };
    if (list.length > 1) keep.alsoOn = [...new Set(list.slice(1).map(x => x.sourceKind))];
    return keep;
  });

  // 排序分两步：
  //   ① 按「和关键词的匹配程度」分层（完全一致 > 前缀 > 包含 > 其他）
  //   ② 同层内**按源交错**，而不是比下载量
  //
  // 为什么不比下载量：Modrinth 的 downloads 和 CurseForge 的 downloadCount
  // 统计口径不一样（CF 是老平台，累计量普遍高一个数量级），直接比会让
  // CF 的结果把 MR 的全挤到后面 —— 双源搜索就名存实亡了。
  const q = norm(query);

  /**
   * 分出「本体 / 附属变体 / 其他」。
   *
   * 用户提的经验：模组名相对原模组多出一截后缀（`xxx-kots`、`xxx_revived`、
   * `xxx-fabric`）时，九成五是附属、移植版或同功能的不同实现，不是本体。
   * 搜「建筑权杖」时下面挂着一串 `建筑权杖-kots`「建筑权杖复兴版」就是这情况。
   *
   * 中文名和英文原名都拿来比对 —— 中文用户看中文名，英文名更接近 slug，
   * 两边都可能带上后面那截。
   */
  const matchType = (h) => {
    if (!q) return 'other';
    for (const s of [h.cn, h.title]) {
      const t = norm(s);
      if (!t) continue;
      if (t === q) return 'exact';                     // 本体
      if (t.length > q.length && (t.startsWith(q) || t.endsWith(q))) return 'variant';
    }
    return 'other';
  };
  const TYPE_RANK = { exact: 0, variant: 1, other: 2 };

  const tiers = new Map();
  for (const h of hits) {
    h.matchType = matchType(h);
    const r = TYPE_RANK[h.matchType];
    if (!tiers.has(r)) tiers.set(r, []);
    tiers.get(r).push(h);
  }
  const ordered = [];
  for (const r of [...tiers.keys()].sort((a, b) => a - b)) {
    const list = tiers.get(r);
    // 每个源内部保持原顺序（各自已按相关度/热度排好），再交替取出
    const queues = new Map();
    for (const h of list) {
      const k = h.sourceKind || 'modrinth';
      if (!queues.has(k)) queues.set(k, []);
      queues.get(k).push(h);
    }
    const arrs = [...queues.values()];
    for (let i = 0; arrs.some(a => i < a.length); i++) {
      for (const a of arrs) if (i < a.length) ordered.push(a[i]);
    }
  }

  return {
    hits: ordered.slice(0, limit),
    total: (out.mr?.total || 0) + (out.cf?.total || 0),
    queryInfo: out.mr?.queryInfo || null,
    sources: [
      { id: 'modrinth', label: 'Modrinth', ok: !!out.mr, total: out.mr?.total || 0, error: out.errors.modrinth || null },
      ...(useCf
        ? [{ id: 'curseforge', label: 'CurseForge', ok: !!out.cf, total: out.cf?.total || 0, error: out.errors.curseforge || null }]
        : [{ id: 'curseforge', label: 'CurseForge', ok: false, total: 0, error: '未配置 API Key，只搜了 Modrinth' }]),
    ],
  };
}

/* ------------------------------------------------------------------ 路由 */
async function handleApi(req, res, url) {
  const p = url.pathname;
  const q = url.searchParams;

  // 鉴权：令牌不匹配就拒绝。健康检查类路由放行，方便排查端口问题。
  //
  // 除了请求头，也认 `?t=` 查询参数 —— 因为 `<img src>` 和 CSS 的 url()
  // 是浏览器自己发起的请求，带不了自定义头。图标、截图、壁纸全靠这条路径，
  // 只认 header 的话它们在界面上会全是空白。
  if (p !== '/api/ping') {
    const got = String(req.headers['x-nova-token'] || '') || String(q.get('t') || '');
    if (got !== TOKEN) {
      return json(res, 401, { ok: false, error: '未授权的请求（缺少或错误的 X-Nova-Token）' });
    }
  }

  // 这几个路由的 body 是原始二进制/文件流，绝不能被 JSON 预读吃掉。
  // 它们需要的参数一律走 query string。
  const BINARY_ROUTES = ['/api/content/upload', '/api/pack/upload', '/api/saves/import', '/api/import/auto',
    '/api/wallpaper/upload'];
  const isBinary = BINARY_ROUTES.indexOf(p) >= 0;
  const body = (!isBinary && req.method === 'POST')
    ? await readJsonBody(req).catch(() => ({}))
    : {};

  /* ---- 系统 ---- */
  if (p === '/api/ping') {
    return ok(res, { alive: true, port: PORT, shell: TOKEN_FROM_SHELL });
  }
  if (p === '/api/status') {
    const cfg = await loadConfig();
    const javas = await getJavas();
    return ok(res, {
      version: '1.0.0', name: 'Nova Launcher',
      os: `${os.type()} ${os.release()}`, arch: process.arch,
      totalMemMb: totalMemoryMb(), freeMemMb: freeMemoryMb(),
      cpuCount: os.cpus().length, cpu: os.cpus()[0]?.model || '',
      javas, config: cfg,
      running: state.running ? { ...state.running, child: undefined } : null,
      dataDir: DATA,
    });
  }
  if (p === '/api/config') {
    if (req.method === 'POST') {
      // 前端拿到的是打码值；用户没动它就别用打码串覆盖真实 Key
      const patch = { ...body };
      if (typeof patch.curseforgeApiKey === 'string' && patch.curseforgeApiKey.includes('••')) {
        delete patch.curseforgeApiKey;
      }
      const saved = await saveConfig(patch);
      return ok(res, { config: redactConfig(saved) });
    }
    return ok(res, { config: redactConfig(await loadConfig()) });
  }
  if (p === '/api/config/crypto') {
    return ok(res, await cryptoStatus());
  }
  if (p === '/api/tasks') return ok(res, { tasks: listTasks() });

  /* ---- 自定义主题 ---- */
  if (p === '/api/themes') {
    const cfg = await loadConfig();
    return ok(res, { themes: await listCustomThemes(), active: cfg.theme || 'nova', dir: THEMES_DIR });
  }
  if (p === '/api/themes/import' && req.method === 'POST') {
    // 前端把文件读成文本发过来（.json / .html / .css 都行）
    const rec = parseThemeFile(body.filename, body.text);
    // 同名视作「更新」，复用原 id，避免改一次就多出一张卡片
    const same = (await listCustomThemes()).find(t => t.name === rec.name);
    if (same) { rec.id = same.id; rec.createdAt = same.createdAt; }
    await saveTheme(rec);
    if (body.apply !== false) await saveConfig({ theme: rec.id });
    return ok(res, { theme: rec, updated: !!same, applied: body.apply !== false });
  }
  if (p === '/api/themes/save' && req.method === 'POST') {
    // 直接存一份（供「从内置主题派生并微调」用）
    const name = String(body.name || '我的主题').slice(0, 24);
    const same = (await listCustomThemes()).find(t => t.name === name);
    const id = same ? same.id : 'custom-' + crypto.createHash('sha1')
      .update(name + Date.now()).digest('hex').slice(0, 10);
    const rec = {
      id, name,
      desc: String(body.desc || '手动创建').slice(0, 60),
      vars: body.vars || {}, css: String(body.css || ''),
      builtin: false, createdAt: same ? same.createdAt : Date.now(), source: '手动',
    };
    await saveTheme(rec);
    if (body.apply !== false) await saveConfig({ theme: rec.id });
    return ok(res, { theme: rec });
  }
  if (p === '/api/themes/delete' && req.method === 'POST') {
    return ok(res, await deleteTheme(body.id));
  }
  if (p === '/api/themes/open' && req.method === 'POST') {
    await fsp.mkdir(THEMES_DIR, { recursive: true });
    spawn('explorer.exe', [THEMES_DIR], { detached: true, stdio: 'ignore' }).unref();
    return ok(res, { dir: THEMES_DIR });
  }
  if (p === '/api/themes/sample' && req.method === 'GET') {
    return ok(res, { json: THEME_SAMPLE_JSON, html: THEME_SAMPLE_HTML });
  }
  // 示例模板直接写到数据目录，不用浏览器的 Blob 下载 ——
  // 那会触发 WebView2 的下载栏、存到系统「下载」里，不是桌面应用该有的行为。
  if (p === '/api/themes/sample' && req.method === 'POST') {
    const dir = path.join(DATA, 'theme-samples');
    await fsp.mkdir(dir, { recursive: true });
    const files = [
      { name: '示例主题-熔岩.json', body: THEME_SAMPLE_JSON },
      { name: '示例主题-极光.html', body: THEME_SAMPLE_HTML },
    ];
    const written = [];
    for (const f of files) {
      const fp = path.join(dir, f.name);
      await fsp.writeFile(fp, f.body, 'utf8');
      written.push({ name: f.name, path: fp });
    }
    spawn('explorer.exe', [dir], { detached: true, stdio: 'ignore' }).unref();
    return ok(res, { dir, files: written });
  }

  /* ---- 自定义壁纸 ---- */
  if (p === '/api/wallpaper') {
    return ok(res, await getWallpaper());
  }
  if (p === '/api/wallpaper/file') {
    const wp = await getWallpaper();
    const fp = wp.file ? await wallpaperPath(wp.file) : null;
    if (!fp) return json(res, 404, { error: 'no wallpaper' });
    const st = await fsp.stat(fp);
    res.writeHead(200, {
      'Content-Type': WALLPAPER_MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(fp).pipe(res);
    return;
  }
  if (p === '/api/wallpaper/upload' && req.method === 'POST') {
    const name = q.get('name') || req.headers['x-filename'] || 'wallpaper.png';
    const buf = await readAllBytes(req, 24 * 1024 * 1024);
    return ok(res, await setWallpaper(buf, decodeURIComponent(String(name))));
  }
  if (p === '/api/wallpaper/config' && req.method === 'POST') {
    return ok(res, await updateWallpaper(body));
  }
  if (p === '/api/wallpaper/clear' && req.method === 'POST') {
    return ok(res, await clearWallpaper());
  }
  if (p === '/api/wallpaper/open' && req.method === 'POST') {
    await fsp.mkdir(WALLPAPER_DIR, { recursive: true });
    spawn('explorer.exe', [WALLPAPER_DIR], { detached: true, stdio: 'ignore' }).unref();
    return ok(res, { dir: WALLPAPER_DIR });
  }

  /* ---- 数据快照（自动备份 / 恢复） ---- */
  if (p === '/api/backup/list') return ok(res, await listBackups());
  if (p === '/api/backup/now' && req.method === 'POST') {
    const item = await createBackup({ reason: body.reason || '手动' });
    return ok(res, { item });
  }
  if (p === '/api/backup/restore' && req.method === 'POST') {
    const r = await restoreBackup(body.file, { confirm: !!body.confirm });
    return ok(res, r);
  }
  if (p === '/api/backup/delete' && req.method === 'POST') {
    return ok(res, await deleteBackup(body.file));
  }
  if (p === '/api/backup/open' && req.method === 'POST') {
    const { dir } = await listBackups();
    await fsp.mkdir(dir, { recursive: true });
    spawn('explorer.exe', [dir], { detached: true, stdio: 'ignore' }).unref();
    return ok(res, { dir });
  }

  /* ---- 下载管理中心 ---- */
  if (p === '/api/tasks/cancel' && req.method === 'POST') {
    const done = cancelTask(body.id);
    return done ? ok(res) : fail(res, '任务不存在或已经结束');
  }
  if (p === '/api/downloads/history') {
    const history = await getHistory();
    const running = listTasks().filter(t => t.status === 'running');
    return ok(res, { history, running });
  }
  if (p === '/api/downloads/clear-history' && req.method === 'POST') {
    await clearHistory();
    return ok(res);
  }

  if (p.startsWith('/api/tasks/')) {
    const t = getTask(p.slice('/api/tasks/'.length));
    if (!t) return fail(res, '任务不存在', 404);
    return ok(res, { task: taskPublic(t) });
  }
  if (p === '/api/about') {
    try {
      const md = await fsp.readFile(path.join(ROOT, '开源归属与致谢.md'), 'utf8');
      return ok(res, { markdown: md });
    } catch (e) { return fail(res, e); }
  }
  if (p === '/api/optimize') {
    return ok(res, await buildOptimizeAdvice(q.get('instance') || null));
  }

  /* ---- 手动内存优化（游戏未启动时） ---- */
  if (p === '/api/optimize/apply' && req.method === 'POST') {
    if (state.running) return fail(res, '游戏正在运行，请先关闭游戏再优化', 409);
    const instId = body.instance || null;
    const inst = instId ? await getInstance(instId) : null;
    const beforeCfg = inst
      ? { memory: inst.memory ?? null, jvmPreset: inst.jvmPreset ?? null }
      : null;

    // ① 真正去腾内存：清僵尸 java 进程 + 压缩本启动器各进程的工作集
    //    （只压自己的进程，绝不碰游戏 —— 压缩游戏只会让它更卡）
    const mem = await optimizeMemory({
      dataDir: DATA,
      instanceDir: inst ? inst.dir || P.instance(inst.id) : "",
      runningPid: state.running?.pid || null,
    }).catch(e => ({ error: e.message, orphans: { found: 0, killed: 0, freedMb: 0 }, trimmed: { count: 0, freedMb: 0 }, freedMb: 0 }));

    // ② 按「此刻」的内存与模组数重算
    const mods = inst ? (await listContents(inst.id, 'mod').catch(() => [])).filter(m => m.enabled) : [];
    const tuned = autoTuneMemory({
      modCount: mods.length, enabledMods: mods.length, loader: inst?.loader || 'vanilla',
    });

    // ③ 写回实例（没指定实例就只给建议，不动配置）
    if (inst) await updateInstance(inst.id, { memory: tuned.memoryMb, jvmPreset: tuned.preset });

    const after = inst ? { memory: tuned.memoryMb, jvmPreset: tuned.preset } : null;
    return ok(res, {
      instance: inst ? { id: inst.id, name: inst.name } : null,
      before: beforeCfg, after, tuned, mem,
      changed: !!(beforeCfg && (beforeCfg.memory !== after.memory || beforeCfg.jvmPreset !== after.jvmPreset)),
    });
  }
  /* ---- 数据目录（自选存储位置） ---- */
  if (p === '/api/system/data-dir' && req.method === 'GET') {
    let marker = null;
    try { marker = (await fsp.readFile(MARKER_FILE(), 'utf8')).trim(); } catch { }
    return ok(res, {
      dir: DATA,
      defaultDir: path.join(ROOT, 'data'),
      root: ROOT,
      markerFile: MARKER_FILE(),
      marker,
      fromEnv: !!process.env.NOVA_DATA_DIR,     // 安装版由外壳传环境变量，此时改标记文件无效
    });
  }
  // 弹系统文件夹选择框。前端拿不到真实路径（浏览器安全限制），只能后端弹。
  if (p === '/api/system/pick-dir' && req.method === 'POST') {
    const picked = await new Promise((resolve) => {
      const start = String(body.startPath || '').replace(/'/g, "''");
      const script = `
Add-Type -AssemblyName System.Windows.Forms | Out-Null
$d = New-Object System.Windows.Forms.FolderBrowserDialog
$d.Description = '选择 Nova Launcher 的数据目录（存档、模组、下载的游戏都放这里）'
$d.ShowNewFolderButton = $true
${start ? `try { $d.SelectedPath = '${start}' } catch { }` : ''}
if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write('<<<' + $d.SelectedPath + '>>>') }
`;
      let ps;
      try {
        ps = spawn('powershell', ['-NoProfile', '-STA', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
          { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
      } catch { return resolve(null); }
      let out = '';
      const timer = setTimeout(() => { try { ps.kill(); } catch { } resolve(null); }, 180000);
      ps.stdout.on('data', d => { out += d; });
      ps.on('close', () => {
        clearTimeout(timer);
        const m = /<<<([\s\S]*?)>>>/.exec(out);
        resolve(m ? m[1].trim() : null);
      });
      ps.on('error', () => { clearTimeout(timer); resolve(null); });
    });
    if (!picked) return fail(res, '已取消', 400);
    return ok(res, { dir: picked });
  }
  if (p === '/api/system/data-dir' && req.method === 'POST') {
    const raw = String(body.dir || '').trim();
    if (!raw) return fail(res, '缺少目录');
    const dir = path.resolve(raw);
    if (dir === path.resolve(DATA)) return fail(res, '这就是当前目录');
    if (dir === path.resolve(ROOT)) return fail(res, '不能选程序目录本身');

    // 系统目录一律拒绝：把数据写进 Windows / Program Files 会污染系统，
    // 而且这些位置往往需要管理员权限，之后启动器自己都可能读不回来
    const sysRoots = [process.env.SystemRoot, process.env.windir,
      process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.ProgramData]
      .filter(Boolean).map(s => path.resolve(s).toLowerCase());
    const low = dir.toLowerCase();
    const hit = sysRoots.find(s => low === s || low.startsWith(s + '\\'));
    if (hit) return fail(res, `不能放在系统目录（${hit}）里，换一个自己的文件夹`);
    // 盘符根目录也不行，会把整盘根目录变成数据目录
    if (/^[a-z]:\\?$/i.test(dir)) return fail(res, '不能直接选盘符根目录，请建一个子文件夹');

    try {
      const st = await fsp.stat(dir).catch(() => null);
      if (st && !st.isDirectory()) return fail(res, '目标是一个文件，不是文件夹');
      await fsp.mkdir(dir, { recursive: true });
      await fsp.access(dir, fs.constants.W_OK);
    } catch (e) {
      return fail(res, '这个目录不可写: ' + e.message);
    }

    await fsp.writeFile(MARKER_FILE(), dir, 'utf8');

    // 可选：把现有数据搬过去（后台任务，大目录会跑很久）
    let task = null;
    if (body.migrate) {
      task = createTask('instance', `迁移数据到 ${path.basename(dir)}`);
      const from = DATA;
      const t2 = task;
      (async () => {
        try {
          tstage(t2, '统计文件', 1);
          const files = await collectDirEntries(from);
          // 别把 webview2 缓存也搬过去，那是外壳自己的东西，换目录后会重建
          const list = files.filter(f => !/^webview2[\\/]/i.test(f.name));
          tstage(t2, '复制文件', list.length);
          let done = 0;
          for (const f of list) {
            const dest = path.join(dir, f.name);
            await fsp.mkdir(path.dirname(dest), { recursive: true });
            await fsp.writeFile(dest, f.data);
            taddFile(t2, f.data.length);
            tprogress(t2, 1, f.name);
            if (++done % 100 === 0) tlog(t2, `已复制 ${done}/${list.length}`);
          }
          tlog(t2, '复制完成。旧目录不会自动删除，确认新的能用之后再手动清理。');
          tdone(t2, { from, to: dir, files: list.length });
        } catch (e) { tfail(t2, e); }
      })();
    }
    return ok(res, {
      dir,
      previous: DATA,
      restartRequired: true,
      task: task ? taskPublic(task) : null,
    });
  }

  /* ---- 游戏目录（实例可以分散在多个盘） ---- */
  if (p === '/api/system/game-dirs' && req.method === 'GET') {
    const extra = getExtraGameDirs();
    const stat = async (dir, isDefault) => {
      let n = 0;
      try {
        const items = await fsp.readdir(dir, { withFileTypes: true });
        for (const it of items) {
          if (!it.isDirectory()) continue;
          if (existsSync(path.join(dir, it.name, 'instance.json'))) n++;
        }
      } catch { /* 目录不在了 */ }
      return { path: dir, isDefault: !!isDefault, instances: n, exists: existsSync(dir) };
    };
    const rows = [await stat(INSTANCES, true)];
    for (const d of extra) rows.push(await stat(d, false));
    return ok(res, { defaultDir: INSTANCES, dirs: rows });
  }
  if (p === '/api/system/game-dirs' && req.method === 'POST') {
    const action = String(body.action || 'add');
    const extra = getExtraGameDirs();

    if (action === 'add') {
      const raw = String(body.dir || '').trim();
      if (!raw) return fail(res, '缺少目录');
      const dir = path.resolve(raw);
      if (dir === path.resolve(INSTANCES)) return fail(res, '这就是默认游戏目录');
      if (extra.includes(dir)) return fail(res, '这个目录已经添加过了');

      // 和「数据目录」同一套规矩：系统目录、盘符根目录一律拒绝
      const sysRoots = [process.env.SystemRoot, process.env.windir,
        process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.ProgramData]
        .filter(Boolean).map(s => path.resolve(s).toLowerCase());
      const low = dir.toLowerCase();
      const hit = sysRoots.find(s => low === s || low.startsWith(s + '\\'));
      if (hit) return fail(res, `不能放在系统目录（${hit}）里，换一个自己的文件夹`);
      if (/^[a-z]:\\?$/i.test(dir)) return fail(res, '不能直接选盘符根目录，请建一个子文件夹');
      if (dir === path.resolve(ROOT) || dir === path.resolve(DATA)) return fail(res, '不能选程序目录或数据目录本身');

      try {
        const st = await fsp.stat(dir).catch(() => null);
        if (st && !st.isDirectory()) return fail(res, '目标是一个文件，不是文件夹');
        await fsp.mkdir(dir, { recursive: true });
        await fsp.access(dir, fs.constants.W_OK);
      } catch (e) { return fail(res, '这个目录不可写: ' + e.message); }

      const next = [...extra, dir];
      await saveConfig({ gameDirs: next });
      setExtraGameDirs(next);
      await listInstances().catch(() => []);
      return ok(res, { dirs: next, added: dir });
    }

    if (action === 'remove') {
      const dir = path.resolve(String(body.dir || '').trim());
      const next = extra.filter(d => d !== dir);
      if (next.length === extra.length) return fail(res, '这个目录不在列表里');
      // 只取消登记，不动磁盘上的游戏 —— 万一用户只是想换个入口，文件不该被牵连
      await saveConfig({ gameDirs: next });
      setExtraGameDirs(next);
      await listInstances().catch(() => []);
      return ok(res, { dirs: next, removed: dir });
    }

    return fail(res, '未知操作: ' + action);
  }

  if (p === '/api/system/open' && req.method === 'POST') {
    const map = { data: DATA, shared: SHARED, cache: CACHE, root: ROOT, runtime: RUNTIME, instances: INSTANCES };
    const dir = map[body.target];
    if (!dir) return fail(res, '未知目录: ' + body.target);
    await fsp.mkdir(dir, { recursive: true }).catch(() => { });
    spawn('explorer.exe', [dir], { detached: true, stdio: 'ignore' }).unref();
    return ok(res, { dir });
  }

  /* ---- 外部链接跳转（官网 / MC百科） ---- */
  if (p === '/api/system/open-url' && req.method === 'POST') {
    const url = String(body.url || '');
    if (!/^https?:\/\//i.test(url)) return fail(res, '只允许 http/https 链接');
    // 走 rundll32 而不是 cmd/start，避免 URL 里的特殊字符被 shell 解析
    spawn('rundll32', ['url.dll,FileProtocolHandler', url], {
      detached: true, stdio: 'ignore', windowsHide: true,
    }).unref();
    return ok(res, { url });
  }

  /* ---- 自动内存优化预览 ---- */
  if (p === '/api/autotune') {
    const cfg = await loadConfig();
    const inst = q.get('instance') ? await getInstance(q.get('instance')) : null;
    let modCount = 0, enabledMods = 0, shaders = 0;
    if (inst) {
      const mods = await listContents(inst.id, 'mod').catch(() => []);
      modCount = mods.length;
      enabledMods = mods.filter(m => m.enabled).length;
      shaders = (await listContents(inst.id, 'shader').catch(() => [])).filter(s => s.enabled).length;
    }
    const tune = autoTuneMemory({ modCount, enabledMods, loader: inst?.loader });
    const autoOptimize = inst
      ? (inst.autoOptimize !== undefined ? inst.autoOptimize : cfg.autoOptimize !== false)
      : (cfg.autoOptimize !== false);
    return ok(res, {
      ...tune, shaders, autoOptimize,
      manualMemoryMb: inst?.memory || cfg.memory?.customMb || null,
      presets: Object.entries(JVM_PRESETS).map(([k, v]) => ({ key: k, name: v.name, desc: v.desc })),
    });
  }

  /* ---- 中文汉化包 ---- */
  if (p === '/api/i18n/status') {
    const inst = q.get('instance');
    if (!inst) return fail(res, '缺少 instance');
    return ok(res, await cfpaStatus(inst));
  }
  if (p === '/api/i18n/install' && req.method === 'POST') {
    const inst = await getInstance(body.instance);
    if (!inst) return fail(res, '实例不存在');
    const task = createTask('download', '安装中文汉化包', {
      retrySpec: { api: '/api/i18n/install', body: { instance: body.instance } },
    });
    (async () => {
      try {
        tstage(task, '准备安装', 1);
        const r = await installCfpaMod(inst.id, { mcVersion: inst.version, loader: inst.loader, task });
        tdone(task, { file: r.installed?.[0]?.file, mod: r.mod });
      } catch (e) { tfail(task, e); }
    })();
    return ok(res, { task: taskPublic(task) });
  }
  if (p === '/api/i18n/dict') {
    return ok(res, { dict: MOD_CN, cfpa: CFPA_MODS });
  }

  if (p === '/api/system/clear-cache' && req.method === 'POST') {
    await fsp.rm(path.join(CACHE, 'icons'), { recursive: true, force: true }).catch(() => { });
    return ok(res);
  }
  if (p === '/api/system/server-log') {
    try {
      const txt = await fsp.readFile(path.join(DATA, 'server.out.log'), 'utf8');
      const lines = txt.split(/\r?\n/).filter(Boolean).slice(-120).join('\n');
      return ok(res, { log: lines || '(暂无输出)' });
    } catch { return ok(res, { log: '(暂无服务日志)' }); }
  }

  /* ---- Java ---- */
  if (p === '/api/java') {
    const javas = await getJavas(q.get('refresh') === '1');
    return ok(res, { javas, recommended: recommendMemoryMb() });
  }
  /** Java 体检：本机有哪些 Java、每个实例缺不缺、建议装什么 */
  if (p === '/api/java/check') {
    const cfg = await loadConfig();
    const javas = await getJavas(q.get('refresh') === '1');
    const instances = await listInstances();
    const rows = [];
    const missing = new Set();
    for (const inst of instances) {
      // 只按版本号推算所需 Java，避免为每个实例都去请求版本 JSON
      const need = requiredJavaMajor(inst.version, null);
      const pick = pickJava(javas, need, inst.javaPath || cfg.javaPath);
      const satisfied = Boolean(pick.java && pick.java.major >= need);
      if (!satisfied) missing.add(need);
      rows.push({
        id: inst.id, name: inst.name, version: inst.version, loader: inst.loader,
        needMajor: need, satisfied,
        java: pick.java ? { major: pick.java.major, path: pick.java.path } : null,
      });
    }
    return ok(res, {
      javas,
      instances: rows,
      missingMajors: [...missing].sort((a, b) => a - b),
      autoInstallJava: cfg.autoInstallJava !== false,
      hasAnyJava: javas.length > 0,
      sources: JDK_SOURCES.map(s => ({ name: s.name, page: s.page })),
    });
  }
  /** 批量安装所有缺失的 Java 版本 */
  if (p === '/api/java/install-missing' && req.method === 'POST') {
    const majors = Array.isArray(body.majors) && body.majors.length
      ? body.majors.map(Number).filter(n => n > 0)
      : null;
    const cfg = await loadConfig();
    const javas = await getJavas(true);
    const need = new Set();
    if (majors) need.add(...majors);
    else {
      for (const inst of await listInstances()) {
        const n = requiredJavaMajor(inst.version, null);
        const pick = pickJava(javas, n, inst.javaPath || cfg.javaPath);
        if (!pick.java || pick.java.major < n) need.add(n);
      }
    }
    const list = [...need].sort((a, b) => a - b);
    if (!list.length) return ok(res, { task: null, message: '没有缺少的 Java' });
    const task = createTask('java', `自动安装 Java ${list.join(' / ')}`, {
      retrySpec: { api: '/api/java/install-missing', body: { majors: list } },
    });
    (async () => {
      try {
        tstage(task, `安装 ${list.length} 个 Java 版本`, list.length);
        for (const m of list) {
          await installJava(m, task);
          tprogress(task, 1, `Java ${m} 完成`);
        }
        await getJavas(true);
        tdone(task, { installed: list });
      } catch (e) { tfail(task, e); }
    })();
    return ok(res, { task: taskPublic(task), majors: list });
  }
  if (p === '/api/java/install' && req.method === 'POST') {
    const major = Number(body.major || 17);
    const task = createTask('java', `安装 Java ${major}`, {
      retrySpec: { api: '/api/java/install', body: { major } },
    });
    (async () => {
      try { tdone(task, await installJava(major, task)); await getJavas(true); }
      catch (e) { tfail(task, e); }
    })();
    return ok(res, { task: taskPublic(task) });
  }

  /* ---- 版本 ---- */
  if (p === '/api/versions') {
    try {
      const cfg = await loadConfig();
      const man = await getManifest(cfg.source, q.get('refresh') === '1');
      const installed = new Set();
      try {
        for (const d of await fsp.readdir(P.versions, { withFileTypes: true })) {
          if (d.isDirectory()) installed.add(d.name);
        }
      } catch { }
      const list = man.versions
        .filter(v => q.get('snapshots') === '1' || v.type === 'release' || v.type === 'old_beta' || v.type === 'old_alpha')
        .filter(v => q.get('snapshots') === '1' || v.type === 'release')
        .map(v => ({ id: v.id, type: v.type, releaseTime: v.releaseTime, installed: installed.has(v.id) }));
      return ok(res, { latest: man.latest, versions: list, total: list.length });
    } catch (e) { return fail(res, '获取版本清单失败: ' + e.message, 502); }
  }
  if (p === '/api/versions/installed') {
    const out = [];
    try {
      for (const d of await fsp.readdir(P.versions, { withFileTypes: true })) {
        if (!d.isDirectory()) continue;
        const jp = path.join(P.versions, d.name, `${d.name}.json`);
        const vj = await readJson(jp, null);
        if (!vj) continue;
        const jar = path.join(P.versions, d.name, `${d.name}.jar`);
        out.push({
          id: d.name, type: vj.type || 'custom',
          inheritsFrom: vj.inheritsFrom || null,
          hasJar: existsSync(jar), size: await dirSize(path.join(P.versions, d.name)).catch(() => 0),
        });
      }
    } catch { }
    return ok(res, { versions: out.sort((a, b) => a.id.localeCompare(b.id)) });
  }
  if (p === '/api/versions/install' && req.method === 'POST') {
    const id = body.id;
    if (!id) return fail(res, '缺少版本 id');
    const cfg = await loadConfig();
    const task = createTask('install', `安装 Minecraft ${id}`, {
      retrySpec: { api: '/api/versions/install', body: { id } },
    });
    (async () => {
      try { tdone(task, await installVersion(id, { source: cfg.source, concurrency: cfg.downloadConcurrency, task })); }
      catch (e) { tfail(task, e); }
    })();
    return ok(res, { task: taskPublic(task) });
  }
  if (p === '/api/loaders' && req.method === 'POST') {
    try {
      const list = await listLoaders(body.loader, body.mcVersion);
      return ok(res, { loaders: list });
    } catch (e) { return fail(res, '获取加载器版本失败: ' + e.message, 502); }
  }
  if (p === '/api/versions/install-loader' && req.method === 'POST') {
    const { loader, mcVersion, loaderVersion } = body;
    if (!loader || !mcVersion) return fail(res, '缺少参数');
    const cfg = await loadConfig();
    const task = createTask('install', `安装 ${loader} ${loaderVersion || ''} (${mcVersion})`, {
      retrySpec: { api: '/api/versions/install-loader', body: { loader, mcVersion, loaderVersion } },
    });
    (async () => {
      try {
        tstage(task, '安装原版', 1);
        await installVersion(mcVersion, { source: cfg.source, concurrency: cfg.downloadConcurrency, task });
        let res1;
        if (loader === 'fabric' || loader === 'quilt') {
          let lv = loaderVersion;
          if (!lv) {
            const ls = await listLoaders(loader, mcVersion);
            if (!ls.length) throw new Error(`${loader} 不支持 ${mcVersion}`);
            lv = ls[0].version;
          }
          tstage(task, `安装 ${loader} ${lv}`, 1);
          res1 = await installFabricLike(loader, mcVersion, lv, { source: cfg.source, task });
        } else if (loader === 'forge' || loader === 'neoforge') {
          let lv = loaderVersion;
          if (!lv) {
            let ls = [];
            try { ls = await listLoaders(loader, mcVersion); } catch (e) {
              throw new Error(`获取 ${loader} 版本列表失败（网络问题）：${e.message}`);
            }
            if (!ls.length) throw new Error(`${loader} 目前没有适配 Minecraft ${mcVersion} 的版本`);
            lv = ls[0].version;
            tlog(task, `${loader} 未指定版本，自动选用 ${lv}`);
          }
          const javas = await getJavas();
          const pick = pickJava(javas, 17, 'auto');
          if (!pick.java) throw new Error('安装 Forge 需要 Java 17+');
          res1 = await installForgeLike(loader, mcVersion, lv, pick.java.path, { source: cfg.source, task });
        } else {
          res1 = { versionId: mcVersion, loader: 'vanilla', mcVersion };
        }
        tdone(task, res1);
      } catch (e) { tfail(task, e); }
    })();
    return ok(res, { task: taskPublic(task) });
  }
  if (p === '/api/versions/delete' && req.method === 'POST') {
    const id = body.id;
    if (!id) return fail(res, '缺少 id');
    const dir = path.join(P.versions, id);
    if (!dir.startsWith(P.versions)) return fail(res, '非法路径');
    await fsp.rm(dir, { recursive: true, force: true });
    return ok(res);
  }
  if (p === '/api/versions/repair' && req.method === 'POST') {
    const id = body.id;
    if (!id) return fail(res, '缺少 id');
    const cfg = await loadConfig();
    const task = createTask('repair', `修复 ${id}`, {
      retrySpec: { api: '/api/versions/repair', body: { id } },
    });
    (async () => {
      try {
        await fsp.rm(path.join(P.versions, id, `${id}.json`), { force: true }).catch(() => { });
        await fsp.rm(path.join(P.versions, id, '.nova-complete'), { force: true }).catch(() => { });
        tdone(task, await installVersion(id, { source: cfg.source, concurrency: cfg.downloadConcurrency, task }));
      } catch (e) { tfail(task, e); }
    })();
    return ok(res, { task: taskPublic(task) });
  }

  /* ---- 实例 ---- */
  if (p === '/api/instances') {
    if (req.method === 'POST') {
      const { name, mcVersion, loader, loaderVersion, install, versionId: explicitVid, rootDir } = body;
      const cfg = await loadConfig();

      // 直接用一个已安装的版本建实例（含 Fabric/Forge 等加载器版本）
      if (explicitVid) {
        const localVj = await versionJsonLocal(explicitVid);
        if (!localVj) return fail(res, '版本未安装: ' + explicitVid);
        const parent = localVj.inheritsFrom || explicitVid;
        let ldr = 'vanilla', lver = null;
        if (localVj.inheritsFrom) {
          if (/^fabric/i.test(explicitVid)) ldr = 'fabric';
          else if (/^quilt/i.test(explicitVid)) ldr = 'quilt';
          else if (/neoforge/i.test(explicitVid)) ldr = 'neoforge';
          else ldr = 'forge';
          const loaderPatterns = {
            fabric: /fabric-loader-([\d.]+)/i,
            quilt: /quilt-loader-([\d.]+)/i,
            neoforge: /neoforge-([\d.]+)/i,
            forge: /-forge-([\d.]+)/i,
          };
          lver = (loaderPatterns[ldr]?.exec(explicitVid) || [])[1] || null;
        }
        const task = createTask('instance', `创建实例 ${name || explicitVid}`, {
          retrySpec: { api: '/api/instances', body: { name, versionId: explicitVid } },
        });
        (async () => {
          try {
            const inst = await createInstance({
              name: name || explicitVid, version: parent, loader: ldr,
              loaderVersion: lver, versionId: explicitVid,
              memory: recommendMemoryMb(), jvmPreset: 'aikar',
              rootDir: rootDir || null,
            });
            await saveConfig({ lastInstance: inst.id });
            tdone(task, inst);
          } catch (e) { tfail(task, e); }
        })();
        return ok(res, { task: taskPublic(task) });
      }

      if (!name || !mcVersion) return fail(res, '缺少实例名或版本');
      const task = createTask('instance', `创建实例 ${name}`, {
        retrySpec: { api: '/api/instances', body: { name, mcVersion, loader, loaderVersion } },
      });
      (async () => {
        try {
          let vid = mcVersion, lver = null;
          if (loader && loader !== 'vanilla') {
            tstage(task, `安装 ${loader}`, 1);
            await installVersion(mcVersion, { source: cfg.source, concurrency: cfg.downloadConcurrency, task });
            if (loader === 'fabric' || loader === 'quilt') {
              let lv = loaderVersion;
              if (!lv) {
                const ls = await listLoaders(loader, mcVersion);
                if (!ls.length) throw new Error(`${loader} 没有适配 ${mcVersion} 的版本`);
                lv = ls[0].version;
              }
              lver = lv;
              const r = await installFabricLike(loader, mcVersion, lv, { source: cfg.source, task });
              vid = r.versionId;
            } else {
              // Forge / NeoForge：没指定版本时也要自动取最新，否则安装器 URL 会是 undefined
              let lv = loaderVersion;
              if (!lv) {
                let ls = [];
                try { ls = await listLoaders(loader, mcVersion); } catch (e) {
                  throw new Error(`获取 ${loader} 版本列表失败（网络问题）：${e.message}`);
                }
                if (!ls.length) throw new Error(`${loader} 目前没有适配 Minecraft ${mcVersion} 的版本，可以换 Fabric，或等上游更新`);
                lv = ls[0].version;
                tlog(task, `${loader} 未指定版本，自动选用 ${lv}`);
              }
              const javas = await getJavas();
              const pick = pickJava(javas, 17, 'auto');
              if (!pick.java) throw new Error('安装 Forge/NeoForge 需要 Java 17+，请先到「设置 → Java 运行时」安装');
              const r = await installForgeLike(loader, mcVersion, lv, pick.java.path, { source: cfg.source, task });
              vid = r.versionId; lver = lv;
            }
          } else if (install !== false) {
            tstage(task, '安装原版', 1);
            await installVersion(mcVersion, { source: cfg.source, concurrency: cfg.downloadConcurrency, task });
          }
          const inst = await createInstance({
            name, version: mcVersion, loader: loader || 'vanilla',
            loaderVersion: lver, versionId: vid,
            memory: recommendMemoryMb(), jvmPreset: 'aikar',
            rootDir: rootDir || null,
          });
          await saveConfig({ lastInstance: inst.id });
          tdone(task, inst);
        } catch (e) { tfail(task, e); }
      })();
      return ok(res, { task: taskPublic(task) });
    }
    return ok(res, { instances: await listInstances() });
  }
  if (p === '/api/instances/update' && req.method === 'POST') {
    const { id, ...patch } = body;
    if (!id) return fail(res, '缺少 id');
    return ok(res, { instance: await updateInstance(id, patch) });
  }
  if (p === '/api/instances/delete' && req.method === 'POST') {
    if (!body.id) return fail(res, '缺少 id');
    return ok(res, await deleteInstance(body.id));
  }
  if (p === '/api/instances/duplicate' && req.method === 'POST') {
    if (!body.id) return fail(res, '缺少 id');
    return ok(res, { instance: await duplicateInstance(body.id, body.name) });
  }
  /** 给已有实例更换模组加载器（原版 / Fabric / Forge / NeoForge / Quilt） */
  if (p === '/api/instances/change-loader' && req.method === 'POST') {
    const inst = await getInstance(body.id);
    if (!inst) return fail(res, '实例不存在');
    if (state.running) return fail(res, '游戏正在运行，请先退出游戏再更换加载器');
    const loader = String(body.loader || 'vanilla');
    const cfg = await loadConfig();
    const task = createTask('install', `更换加载器 → ${loader === 'vanilla' ? '原版' : loader}`, {
      retrySpec: { api: '/api/instances/change-loader', body: { id: inst.id, loader, loaderVersion: body.loaderVersion } },
    });
    (async () => {
      try {
        let vid = inst.version;
        let lver = null;
        tstage(task, '确保原版完整', 1);
        await installVersion(inst.version, { source: cfg.source, concurrency: cfg.downloadConcurrency, task });

        if (loader !== 'vanilla') {
          if (loader === 'fabric' || loader === 'quilt') {
            let lv = body.loaderVersion;
            if (!lv) {
              const ls = await listLoaders(loader, inst.version);
              if (!ls.length) throw new Error(loader + ' 没有适配 Minecraft ' + inst.version + ' 的版本');
              lv = ls[0].version;
            }
            tstage(task, '安装 ' + loader + ' ' + lv, 1);
            const r = await installFabricLike(loader, inst.version, lv, { source: cfg.source, task });
            vid = r.versionId; lver = lv;
          } else {
            let lv = body.loaderVersion;
            if (!lv) {
              let ls = [];
              try { ls = await listLoaders(loader, inst.version); } catch (e) {
                throw new Error('获取 ' + loader + ' 版本列表失败：' + e.message);
              }
              if (!ls.length) throw new Error(loader + ' 没有适配 Minecraft ' + inst.version + ' 的版本');
              lv = ls[0].version;
            }
            const javas = await getJavas();
            const pick = pickJava(javas, 17, 'auto');
            if (!pick.java) throw new Error('安装 Forge/NeoForge 需要 Java 17+');
            tstage(task, '安装 ' + loader + ' ' + lv, 1);
            const r = await installForgeLike(loader, inst.version, lv, pick.java.path, { source: cfg.source, task });
            vid = r.versionId; lver = lv;
          }
        }

        await updateInstance(inst.id, { loader, loaderVersion: lver, versionId: vid });
        tlog(task, '实例「' + inst.name + '」现在使用 ' + (loader === 'vanilla' ? '原版' : loader + ' ' + lver));
        if (loader !== (inst.loader || 'vanilla')) tlog(task, '提示：换加载器后原有模组可能不兼容，建议到「模组」页检查');
        tdone(task, { versionId: vid, loader, loaderVersion: lver });
      } catch (e) { tfail(task, e); }
    })();
    return ok(res, { task: taskPublic(task) });
  }
  if (p === '/api/instances/open' && req.method === 'POST') {
    const inst = await getInstance(body.id);
    if (!inst) return fail(res, '实例不存在');
    spawn('explorer.exe', [inst.dir], { detached: true, stdio: 'ignore' }).unref();
    return ok(res);
  }

  /* ---- 一键跳转到实例的某个子文件夹 ---- */
  if (p === '/api/instance/open-folder' && req.method === 'POST') {
    const inst = await getInstance(body.id);
    if (!inst) return fail(res, '实例不存在');
    const sub = String(body.kind || 'root');
    const map = {
      root: '', mods: 'mods', resourcepacks: 'resourcepacks', shaderpacks: 'shaderpacks',
      datapacks: 'datapacks', saves: 'saves', screenshots: 'screenshots',
      config: 'config', logs: 'logs', crash: 'crash-reports',
    };
    if (!Object.prototype.hasOwnProperty.call(map, sub)) return fail(res, '未知目录: ' + sub);
    const dir = path.join(inst.dir, map[sub]);
    await fsp.mkdir(dir, { recursive: true }).catch(() => { });
    spawn('explorer.exe', [dir], { detached: true, stdio: 'ignore' }).unref();
    return ok(res, { dir });
  }

  /* ---- 游戏截图 ---- */
  if (p === '/api/screenshots') {
    const inst = await getInstance(q.get('instance'));
    if (!inst) return fail(res, '实例不存在');
    const dir = path.join(inst.dir, 'screenshots');
    await fsp.mkdir(dir, { recursive: true }).catch(() => { });
    const items = [];
    try {
      for (const f of await fsp.readdir(dir, { withFileTypes: true })) {
        if (!f.isFile() || !/\.(png|jpe?g)$/i.test(f.name)) continue;
        const fp = path.join(dir, f.name);
        const st = await fsp.stat(fp).catch(() => null);
        items.push({ name: f.name, size: st?.size || 0, mtime: st?.mtimeMs || 0 });
      }
    } catch { }
    items.sort((a, b) => b.mtime - a.mtime);
    return ok(res, { items, dir });
  }
  if (p === '/api/screenshot/file') {
    const inst = await getInstance(q.get('instance'));
    if (!inst) return fail(res, '实例不存在');
    const dir = path.join(inst.dir, 'screenshots');
    const fp = path.join(dir, path.basename(String(q.get('file') || '')));
    if (!fp.startsWith(dir) || !existsSync(fp)) return fail(res, '文件不存在', 404);
    const st = await fsp.stat(fp);
    const ext = path.extname(fp).toLowerCase();
    res.writeHead(200, {
      'Content-Type': ext === '.png' ? 'image/png' : 'image/jpeg',
      'Content-Length': st.size,
      'Cache-Control': 'no-cache',
    });
    return fs.createReadStream(fp).pipe(res);
  }
  if (p === '/api/screenshots/delete' && req.method === 'POST') {
    const inst = await getInstance(body.instance);
    if (!inst) return fail(res, '实例不存在');
    const dir = path.join(inst.dir, 'screenshots');
    const fp = path.join(dir, path.basename(String(body.file || '')));
    if (!fp.startsWith(dir)) return fail(res, '非法路径');
    await fsp.rm(fp, { force: true });
    return ok(res);
  }
  if (p === '/api/screenshot/reveal' && req.method === 'POST') {
    const inst = await getInstance(body.instance);
    if (!inst) return fail(res, '实例不存在');
    const dir = path.join(inst.dir, 'screenshots');
    const fp = path.join(dir, path.basename(String(body.file || '')));
    if (existsSync(fp)) spawn('explorer.exe', ['/select,', fp], { detached: true, stdio: 'ignore' }).unref();
    else spawn('explorer.exe', [dir], { detached: true, stdio: 'ignore' }).unref();
    return ok(res);
  }

  /* ---- 游戏存档 ---- */
  if (p === '/api/saves') {
    const inst = await getInstance(q.get('instance'));
    if (!inst) return fail(res, '实例不存在');
    const dir = path.join(inst.dir, 'saves');
    await fsp.mkdir(dir, { recursive: true }).catch(() => { });
    const items = [];
    let dirs = [];
    try { dirs = await fsp.readdir(dir, { withFileTypes: true }); } catch { }
    for (const d of dirs) {
      if (!d.isDirectory()) continue;
      const worldDir = path.join(dir, d.name);
      const levelFile = path.join(worldDir, 'level.dat');
      if (!existsSync(levelFile)) continue;
      const st = await fsp.stat(levelFile).catch(() => null);
      let info = null;
      let error = null;
      try {
        const buf = await fsp.readFile(levelFile);
        const root = readLevelDat(buf);
        info = summarizeLevel(getData(root));
      } catch (e) { error = e.message; }
      items.push({
        name: d.name,
        path: worldDir,
        size: await dirSize(worldDir).catch(() => 0),
        mtime: st?.mtimeMs || 0,
        info, error,
      });
    }
    items.sort((a, b) => b.mtime - a.mtime);
    return ok(res, { items, dir });
  }
  if (p === '/api/saves/edit' && req.method === 'POST') {
    const inst = await getInstance(body.instance);
    if (!inst) return fail(res, '实例不存在');
    if (state.running && state.running.instanceId === inst.id) {
      return fail(res, '游戏正在运行，请先退出游戏再修改存档');
    }
    const world = path.basename(String(body.world || ''));
    if (!world || world === '.' || world === '..') return fail(res, '存档名无效');
    const levelFile = path.join(inst.dir, 'saves', world, 'level.dat');
    if (!existsSync(levelFile)) return fail(res, '找不到 level.dat', 404);

    try {
      const patch = body.patch || {};
      const raw = await fsp.readFile(levelFile);
      const root = readLevelDat(raw);
      const data = getData(root);
      const changed = [];

      if (patch.gameType !== undefined) {
        const v = Number(patch.gameType);
        if (v < 0 || v > 3) return fail(res, '游戏模式取值 0-3');
        setInt(data, 'GameType', v);
        changed.push('游戏模式 → ' + GAME_MODES[v]);
      }
      if (patch.hardcore !== undefined) {
        setByte(data, 'hardcore', patch.hardcore ? 1 : 0);
        changed.push('极限模式 → ' + (patch.hardcore ? '开' : '关'));
      }
      if (patch.difficulty !== undefined) {
        const v = Number(patch.difficulty);
        if (v < 0 || v > 3) return fail(res, '难度取值 0-3');
        setByte(data, 'Difficulty', v);
        changed.push('难度 → ' + DIFFICULTIES[v]);
      }
      if (patch.difficultyLocked !== undefined) {
        setByte(data, 'DifficultyLocked', patch.difficultyLocked ? 1 : 0);
        changed.push('锁定难度 → ' + (patch.difficultyLocked ? '是' : '否'));
      }
      if (patch.allowCommands !== undefined) {
        setByte(data, 'allowCommands', patch.allowCommands ? 1 : 0);
        changed.push('允许作弊 → ' + (patch.allowCommands ? '是' : '否'));
      }
      if (patch.levelName !== undefined) {
        const nm = String(patch.levelName).slice(0, 64);
        setString(data, 'LevelName', nm);
        changed.push('存档名 → ' + nm);
      }
      if (patch.day !== undefined) {
        const day = Math.max(0, Math.min(1000000, Math.floor(Number(patch.day))));
        setInt(data, 'DayTime', day * 24000);
        changed.push('日期 → 第 ' + day + ' 天');
      }

      if (!changed.length) return fail(res, '没有要修改的字段');

      // 先备份，再写回
      await fsp.writeFile(levelFile + '.nova-bak', raw).catch(() => { });
      const out = writeLevelDat(root);
      await fsp.writeFile(levelFile, out);

      const root2 = readLevelDat(await fsp.readFile(levelFile));
      return ok(res, { changed, info: summarizeLevel(getData(root2)) });
    } catch (e) {
      return fail(res, '修改存档失败: ' + e.message, 500);
    }
  }
  if (p === '/api/saves/delete' && req.method === 'POST') {
    const inst = await getInstance(body.instance);
    if (!inst) return fail(res, '实例不存在');
    if (state.running && state.running.instanceId === inst.id) {
      return fail(res, '游戏正在运行，请先退出游戏');
    }
    const world = path.basename(String(body.world || ''));
    const dir = path.join(inst.dir, 'saves', world);
    if (!world || !dir.startsWith(path.join(inst.dir, 'saves'))) return fail(res, '非法路径');
    await fsp.rm(dir, { recursive: true, force: true });
    return ok(res);
  }
  if (p === '/api/saves/backup' && req.method === 'POST') {
    const inst = await getInstance(body.instance);
    if (!inst) return fail(res, '实例不存在');
    const world = path.basename(String(body.world || ''));
    const src = path.join(inst.dir, 'saves', world);
    if (!existsSync(src)) return fail(res, '存档不存在', 404);
    const backupRoot = path.join(inst.dir, 'saves-backup');
    await fsp.mkdir(backupRoot, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const dest = path.join(backupRoot, `${world}-${stamp}`);
    await fsp.cp(src, dest, { recursive: true });
    spawn('explorer.exe', [backupRoot], { detached: true, stdio: 'ignore' }).unref();
    return ok(res, { dest });
  }

  /* ---- 拖拽自动导入：识别压缩包类型并直接处理 ---- */
  if (p === '/api/import/auto') {
    const inst = await getInstance(q.get('instance'));
    if (!inst) return fail(res, '请先打开一个实例再拖入文件');
    const filename = decodeURIComponent(req.headers['x-filename'] || 'import.zip');
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > 1024 * 1024 * 1024) return fail(res, '文件超过 1GB，请手动放进对应目录');
      chunks.push(c);
    }
    if (!chunks.length) return fail(res, '没有收到文件内容');
    const buf = Buffer.concat(chunks);

    // 判断类型
    let kind = 'unknown';
    try {
      const entries = zipEntries(buf);
      const names = entries.map(e => e.name.replace(/\\/g, '/'));
      const hasFile = (f) => names.some(n => n === f || n.endsWith('/' + f));
      if (hasFile('modrinth.index.json')) kind = 'modpack-mrpack';
      else if (hasFile('manifest.json')) kind = 'modpack-curseforge';
      else if (hasFile('level.dat')) kind = 'save';
      else if (hasFile('pack.mcmeta')) {
        kind = names.some(n => /(^|\/)shaders\//.test(n)) ? 'shader'
          : (names.some(n => /(^|\/)data\//.test(n)) ? 'datapack' : 'resourcepack');
      } else if (names.some(n => n.toLowerCase().endsWith('.jar'))) kind = 'modpack-raw';
    } catch {
      return fail(res, '这不是有效的 zip 压缩包');
    }

    // 整合包分两种：
    //   .mrpack 自带 mc 版本/加载器元数据 -> 新建实例
    //   普通 zip（含 mods/ 或 manifest.json）没有元数据 -> 直接展开到当前实例
    if (kind === 'modpack-mrpack' || kind === 'modpack-curseforge' || kind === 'modpack-raw') {
      const isMrpack = (kind === 'modpack-mrpack');
      const tmpDir = path.join(CACHE, 'packs');
      await fsp.mkdir(tmpDir, { recursive: true });
      const stamp2 = Date.now();
      const safe = safeName(filename.replace(/\.(zip|mrpack)$/i, '')) || 'pack';
      const packPath = path.join(tmpDir, `${stamp2}-${safe}.zip`);
      await fsp.writeFile(packPath, buf);

      const cfg2 = await loadConfig();
      const task = createTask('pack', `安装整合包 ${safe}`, {
        retrySpec: { api: '/api/pack/install', body: { path: packPath, name: safe } },
      });
      (async () => {
        try {
          if (!isMrpack) {
            // 普通 zip 整合包没有版本元数据：沿用当前实例的 MC 版本/加载器，
            // 但为它单独开一个实例，实例名直接用整合包的名字。
            tlog(task, '普通 zip 整合包 → 单独创建实例');
            tstage(task, '创建整合包实例', 1);
            const newInst = await createInstance({
              name: safe,
              version: inst.version,
              loader: inst.loader || 'vanilla',
              loaderVersion: inst.loaderVersion || null,
              versionId: inst.versionId || inst.version,
              memory: recommendMemoryMb(), jvmPreset: 'aikar',
            });
            tlog(task, `已创建实例「${newInst.name}」（MC ${newInst.version} / ${newInst.loader}）`);
            tstage(task, '解压整合包内容', 1);
            const r2 = await materializeZipPack(newInst.id, packPath, { task });
            tlog(task, `解压 ${r2.files} 个文件${r2.usedOverrides ? '（overrides 结构）' : ''}`);
            tdone(task, { instance: newInst, ...r2, mode: 'new-instance' });
            return;
          }
          const parsed = await installMrpack(packPath, { task, source: cfg2.source });
          let vid = parsed.mcVersion;
          tstage(task, '安装游戏版本', 1);
          await installVersion(parsed.mcVersion, { source: cfg2.source, concurrency: cfg2.downloadConcurrency, task });
          if (parsed.loader !== 'vanilla' && parsed.loaderVersion) {
            if (parsed.loader === 'fabric' || parsed.loader === 'quilt') {
              const rr = await installFabricLike(parsed.loader, parsed.mcVersion, parsed.loaderVersion, { source: cfg2.source, task });
              vid = rr.versionId;
            } else {
              const javas = await getJavas();
              const pk = pickJava(javas, 17, 'auto');
              if (!pk.java) throw new Error('需要 Java 17+');
              const rr = await installForgeLike(parsed.loader, parsed.mcVersion, parsed.loaderVersion, pk.java.path, { source: cfg2.source, task });
              vid = rr.versionId;
            }
          }
          tstage(task, '创建实例', 1);
          const newInst = await createInstance({
            name: safe, version: parsed.mcVersion, loader: parsed.loader,
            loaderVersion: parsed.loaderVersion, versionId: vid,
            memory: recommendMemoryMb(), jvmPreset: 'aikar',
          });
          await materializeMrpack(newInst.id, parsed, { task, source: cfg2.source, concurrency: cfg2.downloadConcurrency });
          tdone(task, { instance: newInst });
        } catch (e) { tfail(task, e); }
      })();
      return ok(res, { kind, action: 'task', task: taskPublic(task), mode: isMrpack ? 'new-instance' : 'current-instance' });
    }

    // 存档
    if (kind === 'save') {
      try {
        const created = await importSaveZip(buf, inst.dir, filename);
        return ok(res, { kind, action: 'imported', created });
      } catch (e) { return fail(res, e.message, 400); }
    }

    // 资源包 / 光影 / 数据包：整体存成 zip 放对应目录
    if (kind === 'resourcepack' || kind === 'shader' || kind === 'datapack') {
      const dirMap = { resourcepack: 'resourcepacks', shader: 'shaderpacks', datapack: 'datapacks' };
      const dir = path.join(inst.dir, dirMap[kind]);
      await fsp.mkdir(dir, { recursive: true });
      let base = safeName(filename.replace(/\.zip$/i, '')) || kind;
      let dest = path.join(dir, `${base}.zip`);
      let i = 1;
      while (existsSync(dest)) dest = path.join(dir, `${base} (${i++}).zip`);
      await fsp.writeFile(dest, buf);
      return ok(res, { kind, action: 'imported', created: [path.basename(dest)] });
    }

    return fail(res, '没认出这个压缩包是什么（既不是存档，也不是资源包/光影/整合包）', 400);
  }

  /* ---- 存档导入（本地文件 / 链接）与导出 ---- */
  if (p === '/api/saves/import') {
    const inst = await getInstance(q.get('instance'));
    if (!inst) return fail(res, '实例不存在');
    const filename = decodeURIComponent(req.headers['x-filename'] || 'save.zip');
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > 800 * 1024 * 1024) return fail(res, '文件超过 800MB，建议手动解压到 saves 目录');
      chunks.push(c);
    }
    if (!chunks.length) return fail(res, '没有收到文件内容');
    try {
      const created = await importSaveZip(Buffer.concat(chunks), inst.dir, filename);
      return ok(res, { created });
    } catch (e) { return fail(res, e.message, 400); }
  }
  if (p === '/api/saves/import-url' && req.method === 'POST') {
    const inst = await getInstance(body.instance);
    if (!inst) return fail(res, '实例不存在');
    const url = String(body.url || '').trim();
    if (!/^https?:\/\//i.test(url)) return fail(res, '只支持 http/https 链接');
    const task = createTask('download', '下载存档', {
      retrySpec: { api: '/api/saves/import-url', body: { instance: body.instance, url } },
    });
    (async () => {
      try {
        const tmpDir = path.join(CACHE, 'saves-dl');
        await fsp.mkdir(tmpDir, { recursive: true });
        const guess = (url.split('/').pop() || 'save.zip').split('?')[0];
        const tmpFile = path.join(tmpDir, safeName(guess) || 'save.zip');
        tstage(task, '下载存档文件', 1);
        tlog(task, '下载 ' + url);
        let lastBytes = 0;
        await downloadOne(url, tmpFile, {
          source: 'official', timeout: 600000, retries: 2, idleMs: 30000,
          onProgress: (got) => {
            if (!task) return;
            if (got < lastBytes) lastBytes = 0;
            if (got > lastBytes) { addBytes(task, got - lastBytes); lastBytes = got; }
          },
        });
        taddFile(task, 0);
        tprogress(task, 1, '下载完成');

        tstage(task, '解压存档', 1);
        const buf = await fsp.readFile(tmpFile);
        const created = await importSaveZip(buf, inst.dir, guess);
        await fsp.rm(tmpFile, { force: true }).catch(() => { });
        tlog(task, '已导入: ' + created.join(', '));
        tdone(task, { created });
      } catch (e) { tfail(task, e); }
    })();
    return ok(res, { task: taskPublic(task) });
  }
  if (p === '/api/saves/export-file' && req.method === 'POST') {
    // 桌面应用场景：打包到实例的 saves-backup 目录并打开文件夹，
    // 比走浏览器下载更符合「我的文件」直觉，也能避开 WebView2 的下载 UI。
    const inst = await getInstance(body.instance);
    if (!inst) return fail(res, '实例不存在');
    const world = path.basename(String(body.world || ''));
    const dir = path.join(inst.dir, 'saves', world);
    if (!world || !dir.startsWith(path.join(inst.dir, 'saves')) || !existsSync(dir)) {
      return fail(res, '存档不存在', 404);
    }
    try {
      const entries = await collectDirEntries(dir);
      if (!entries.length) return fail(res, '存档目录是空的', 400);
      const buf = zipCreate(entries);
      const outDir = path.join(inst.dir, 'saves-backup');
      await fsp.mkdir(outDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const outPath = path.join(outDir, `${safeName(world)}-${stamp}.zip`);
      await fsp.writeFile(outPath, buf);
      spawn('explorer.exe', [outDir], { detached: true, stdio: 'ignore' }).unref();
      return ok(res, { path: outPath, size: buf.length });
    } catch (e) {
      return fail(res, '导出失败: ' + e.message, 500);
    }
  }
  if (p === '/api/saves/export') {
    const inst = await getInstance(q.get('instance'));
    if (!inst) return fail(res, '实例不存在');
    const world = path.basename(String(q.get('world') || ''));
    const dir = path.join(inst.dir, 'saves', world);
    if (!world || !dir.startsWith(path.join(inst.dir, 'saves')) || !existsSync(dir)) {
      return fail(res, '存档不存在', 404);
    }
    try {
      const entries = await collectDirEntries(dir);
      if (!entries.length) return fail(res, '存档目录是空的', 400);
      const buf = zipCreate(entries);
      const fname = encodeURIComponent(world + '.zip');
      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="save.zip"; filename*=UTF-8''${fname}`,
        'Content-Length': buf.length,
      });
      return res.end(buf);
    } catch (e) {
      return fail(res, '打包失败: ' + e.message, 500);
    }
  }

  /* ---- 启动 ---- */
  if (p === '/api/launch' && req.method === 'POST') {
    if (!body.id) return fail(res, '缺少实例 id');
    const task = await doLaunch(body.id);
    return ok(res, { task: taskPublic(task) });
  }
  if (p === '/api/kill' && req.method === 'POST') {
    if (!state.running) return fail(res, '没有正在运行的游戏');
    try {
      spawn('taskkill', ['/pid', String(state.running.pid), '/f'], { windowsHide: true });
    } catch { }
    return ok(res);
  }
  if (p === '/api/game/log') {
    const since = Number(q.get('since') || 0);
    const inst = q.get('instance');
    const logs = state.gameLog.filter(l => l.t > since && (!inst || l.instanceId === inst));
    return ok(res, { logs, serverTime: Date.now(), running: state.running ? { ...state.running, child: undefined } : null });
  }
  if (p === '/api/game/clear-log' && req.method === 'POST') {
    state.gameLog = [];
    return ok(res);
  }

  /* ---- 内容管理 ---- */
  if (p === '/api/content') {
    const kind = q.get('kind') || 'mod';
    if (!body.instance && !q.get('instance')) return fail(res, '缺少 instance');
    const inst = body.instance || q.get('instance');
    return ok(res, { kind, items: await listContents(inst, kind) });
  }
  if (p === '/api/content/toggle' && req.method === 'POST') {
    return ok(res, await toggleContent(body.instance, body.kind, body.file));
  }
  if (p === '/api/content/delete' && req.method === 'POST') {
    return ok(res, await deleteContent(body.instance, body.kind, body.file));
  }
  if (p === '/api/content/import' && req.method === 'POST') {
    const results = [];
    for (const f of body.files || []) results.push(await importContent(body.instance, body.kind, f));
    return ok(res, { results });
  }
  if (p === '/api/content/upload') {
    // 原始字节上传：X-Filename + query(instance, kind)
    const inst = q.get('instance'), kind = q.get('kind');
    const filename = decodeURIComponent(req.headers['x-filename'] || 'upload.bin');
    if (!inst || !kind) return fail(res, '缺少 instance/kind');
    const k = KINDS[kind];
    if (!k) return fail(res, '未知类型');
    const dir = path.join(P.instance(inst), k.dir);
    await fsp.mkdir(dir, { recursive: true });
    const dest = path.join(dir, safeName(filename));
    await new Promise((resolve, reject) => {
      const ws = fs.createWriteStream(dest);
      req.pipe(ws);
      ws.on('finish', resolve);
      ws.on('error', reject);
      req.on('error', reject);
    });
    return ok(res, { file: path.basename(dest), size: (await fsp.stat(dest)).size });
  }
  if (p === '/api/content/preview') {
    // 返回文件在前端的可访问 URL：直接 open 目录
    const inst = await getInstance(q.get('instance'));
    if (!inst) return fail(res, '实例不存在');
    const k = KINDS[q.get('kind')];
    const fp = path.join(inst.dir, k.dir, path.basename(q.get('file')));
    if (!existsSync(fp)) return fail(res, '文件不存在', 404);
    const st = await fsp.stat(fp);
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': st.size });
    return fs.createReadStream(fp).pipe(res);
  }
  if (p === '/api/instance/size') {
    const inst = await getInstance(q.get('id'));
    if (!inst) return fail(res, '实例不存在');
    return ok(res, { size: await dirSize(inst.dir), mods: await dirSize(path.join(inst.dir, 'mods')) });
  }

  /* ---- Modrinth ---- */
  /* ---- CurseForge（需要 API Key，没配就整块隐藏） ---- */
  if (p === '/api/cf/status') {
    const cfg = await loadConfig();
    const key = (cfg.curseforgeApiKey || '').trim();
    if (!key) return ok(res, { configured: false, ok: false });
    // 探活最多 10 秒，失败也别卡住界面
    const ping = await Promise.race([
      cfPing(key),
      new Promise(r => setTimeout(() => r({ ok: false, error: '探活超时' }), 10000)),
    ]);
    return ok(res, {
      configured: true,
      ok: ping.ok,
      error: ping.error || null,
      keyHint: key.length > 8 ? key.slice(0, 4) + '****' + key.slice(-4) : '****',
    });
  }
  if (p === '/api/cf/search') {
    const cfg = await loadConfig();
    const key = (cfg.curseforgeApiKey || '').trim();
    if (!key) return fail(res, '还没有配置 CurseForge API Key，请到「设置 → 内容源」填写', 400);
    try {
      // 中文要先翻成英文：CurseForge 不吃中文，原样传过去等于没传搜索词
      const rq = await resolveQuery(q.get('query') || '');
      const r = await cfSearch(key, {
        query: rq.query,
        kind: q.get('kind') || 'mod',
        mcVersion: q.get('mcVersion') || '',
        loader: q.get('loader') || '',
        offset: Number(q.get('offset') || 0),
        limit: Number(q.get('limit') || 20),
      });
      return ok(res, r);
    } catch (e) { return fail(res, e.message, 502); }
  }
  if (p === '/api/cf/project') {
    const cfg = await loadConfig();
    const key = (cfg.curseforgeApiKey || '').trim();
    if (!key) return fail(res, '还没有配置 CurseForge API Key', 400);
    try { return ok(res, { project: await cfProject(key, q.get('id')) }); }
    catch (e) { return fail(res, e.message, 502); }
  }
  if (p === '/api/cf/files') {
    const cfg = await loadConfig();
    const key = (cfg.curseforgeApiKey || '').trim();
    if (!key) return fail(res, '还没有配置 CurseForge API Key', 400);
    try {
      const files = await cfFiles(key, q.get('id'), {
        mcVersion: q.get('mcVersion') || '', loader: q.get('loader') || '',
      });
      return ok(res, { files });
    } catch (e) { return fail(res, e.message, 502); }
  }
  if (p === '/api/cf/install' && req.method === 'POST') {
    const cfg = await loadConfig();
    const key = (cfg.curseforgeApiKey || '').trim();
    if (!key) return fail(res, '还没有配置 CurseForge API Key', 400);
    const inst = await getInstance(body.instance);
    if (!inst) return fail(res, '实例不存在');
    const kind = body.kind || 'mod';
    const k = KINDS[kind];
    if (!k) return fail(res, '未知类型');
    const task = createTask('download', `安装 CurseForge ${kind}`, {
      retrySpec: { api: '/api/cf/install', body },
    });
    (async () => {
      try {
        tstage(task, '获取文件信息', 1);
        let url = null;
        let fileName = body.fileName || null;
        let size = body.fileSize || 0;
        // 优先用前端传下来的（它能拿到作者是否允许第三方下载）
        if (body.downloadUrl) { url = body.downloadUrl; }
        if (!url) {
          url = await cfFileUrl(key, body.modId, body.fileId);
        }
        if (!url) {
          throw new Error('作者关闭了第三方下载（CurseForge 只允许官方客户端下载这个文件）。\n'
            + '请到网页版手动下载后拖进启动器。');
        }
        if (!fileName) fileName = `cf-${body.modId}-${body.fileId}.jar`;
        const dir = path.join(inst.dir, k.dir);
        await fsp.mkdir(dir, { recursive: true });
        const dest = path.join(dir, safeName(fileName));
        tstage(task, `下载 ${fileName}`, 1);
        tlog(task, `下载 ${fileName}`);
        let last = 0;
        await downloadOne(url, dest, {
          source: 'official', timeout: 300000, retries: 2, idleMs: 30000,
          onProgress: (got) => {
            if (!task) return;
            if (got < last) last = 0;
            if (got > last) { addBytes(task, got - last); last = got; }
          },
        });
        taddFile(task, 0);
        tprogress(task, 1, '完成');
        await writeSource(inst.id, kind, path.basename(dest), {
          slug: body.slug || null,
          title: body.title || null,
          // CurseForge 自己不给中文名，用同一份词典按 slug / 标题查
          cn: cnName(body.slug || '') || cnName(body.title || '') || body.cn || null,
          sourceUrl: body.websiteUrl || null,
          sourceKind: 'curseforge',
          modId: String(body.modId || ''),
          fileId: String(body.fileId || ''),
          installedAt: Date.now(),
        }).catch(() => { });
        tdone(task, { file: path.basename(dest) });
      } catch (e) { tfail(task, e); }
    })();
    return ok(res, { task: taskPublic(task) });
  }

  /* ---- 本地模糊索引（用于拼错/近似名兜底） ---- */
  if (p === '/api/search/index/status') {
    return ok(res, await indexStatus());
  }
  if (p === '/api/search/index/build' && req.method === 'POST') {
    const task = createTask('download', '构建本地搜索索引');
    (async () => {
      try {
        tstage(task, '拉取热门内容', 20);
        let n = 0;
        const data = await buildIndex((msg) => {
          n++;
          tprogress(task, 1, msg);
          tlog(task, msg);
        });
        tdone(task, { count: data.items.length });
      } catch (e) { tfail(task, e); }
    })();
    return ok(res, { task: taskPublic(task) });
  }

  if (p === '/api/search/all') {
    try {
      const rq = await resolveQuery(q.get('query') || '');
      const r = await searchAllSources({
        query: rq.query,
        kind: q.get('kind') || 'mod',
        mcVersion: q.get('mcVersion') || '',
        loader: q.get('loader') || '',
        offset: Number(q.get('offset') || 0),
        limit: Number(q.get('limit') || 30),
      });
      return ok(res, { ...r, queryInfo: rq });
    } catch (e) { return fail(res, '双源搜索失败: ' + e.message, 502); }
  }
  if (p === '/api/mr/search') {
    try {
      const rawQuery = q.get('query') || '';
      // 索引还没建过就后台建一份，供拼写纠错用（不阻塞本次搜索）
      indexStatus().then(st => {
        if (!st.ready && !st.building) buildIndex(() => { }).catch(() => { });
      }).catch(() => { });
      // 中文关键词自动转成英文检索词（例如「钠」→ sodium，「化龙」→ BeLoong）
      const rq = await resolveQuery(rawQuery);
      const r = await mrSearch({
        query: rq.query, kind: q.get('kind') || 'mod',
        mcVersion: q.get('mcVersion') || '', loader: q.get('loader') || '',
        offset: Number(q.get('offset') || 0), limit: Number(q.get('limit') || 20),
      });
      return ok(res, {
        ...r,
        queryInfo: {
          ...rq,
          original: rawQuery, used: rq.query,
          fuzzyAdded: r.fuzzyAdded || 0,
        },
      });
    } catch (e) { return fail(res, '搜索失败（可能是网络问题）: ' + e.message, 502); }
  }
  if (p === '/api/mr/versions') {
    try {
      const vs = await mrVersions(q.get('project'), { mcVersion: q.get('mcVersion') || '', loader: q.get('loader') || '' });
      return ok(res, { versions: vs });
    } catch (e) { return fail(res, '获取版本失败: ' + e.message, 502); }
  }
  if (p === '/api/mr/project') {
    const id = q.get('id');
    if (!id) return fail(res, '缺少 id');
    try {
      return ok(res, { project: await mrProject(id) });
    } catch (e) { return fail(res, '获取项目详情失败（可能是网络问题）: ' + e.message, 502); }
  }
  if (p === '/api/translate' && req.method === 'POST') {
    const text = String(body.text || '').slice(0, 8000);
    if (!text.trim()) return fail(res, '没有要翻译的内容');
    try {
      return ok(res, await translateText(text, body.to || 'zh-CN'));
    } catch (e) {
      return fail(res, '翻译失败: ' + e.message, 502);
    }
  }
  if (p === '/api/mr/install' && req.method === 'POST') {
    const { instance, kind, project, versionId, mcVersion, loader, withDeps } = body;
    if (!instance || !project) return fail(res, '缺少参数');
    const task = createTask('download', `安装 ${kind || 'mod'}`, {
      retrySpec: { api: '/api/mr/install', body },
    });
    (async () => {
      try {
        tstage(task, '解析版本', 1);
        const r = await mrInstall(instance, kind || 'mod', project, {
          versionId, mcVersion, loader, withDeps: withDeps !== false, task,
        });
        // Modrinth 的依赖元数据不一定写全（「精妙背包 × 机械动力 集成」就没把 create
        // 标成必需），装完再按 jar 里的真实声明对一次账，缺的当场补。
        let deps = null;
        if ((kind || 'mod') === 'mod') {
          tstage(task, '核对前置模组', 1);
          deps = await autoInstallMissingDeps(instance, { task, mcVersion, loader }).catch(() => null);
        }
        tdone(task, { ...r, deps });
      } catch (e) { tfail(task, e); }
    })();
    return ok(res, { task: taskPublic(task) });
  }

  /* ---- 前置依赖检查 / 一键补齐 ---- */
  if (p === '/api/content/deps') {
    const inst = q.get('instance');
    if (!inst) return fail(res, '缺少 instance');
    try { return ok(res, await checkInstanceDeps(inst)); }
    catch (e) { return fail(res, e); }
  }
  if (p === '/api/content/deps/fix' && req.method === 'POST') {
    const instId = body.instance;
    if (!instId) return fail(res, '缺少 instance');
    const inst = await getInstance(instId);
    if (!inst) return fail(res, '实例不存在');
    const task = createTask('download', `补齐 ${inst.name} 的前置模组`, {
      retrySpec: { api: '/api/content/deps/fix', body },
    });
    (async () => {
      try {
        const r = await autoInstallMissingDeps(instId, {
          task, mcVersion: inst.version, loader: inst.loader,
        });
        const nFixed = r.fixed.length, nFailed = r.failed.length, nLeft = (r.remaining || []).length;
        if (nFailed) {
          tlog(task, `以下前置需要手动处理：${r.failed.map(f => `${f.modId}（${f.reason}）`).join('；')}`);
          if (r.failed.some(f => f.unsupported)) {
            tlog(task, '补不上的前置多半是根本没有适配当前版本的发行版，卸掉需要它的模组才是正解');
          }
        }
        // 别一律报「成功」：没补齐就得说清楚，否则任务列表和上面的警告条在互相打脸
        let stage = '已完成', warning = null;
        if (nFailed) {
          stage = nFixed ? `补齐 ${nFixed} 个，${nFailed} 个补不上` : `${nFailed} 个前置补不上`;
          warning = `${nFailed} 个前置无法自动补齐`;
          if (nLeft) warning += `，仍有 ${nLeft} 个缺失`;
        } else if (!nFixed && (r.remaining || []).length) {
          stage = '没有可自动补齐的前置';
          warning = '仍有前置缺失';
        }
        tdone(task, r, { stage, warning });
      } catch (e) { tfail(task, e); }
    })();
    return ok(res, { task: taskPublic(task) });
  }

  /* ---- 整合包 ---- */
  if (p === '/api/pack/install' && req.method === 'POST') {
    // body: { path } 或 { projectSlug, versionId }
    const cfg = await loadConfig();
    const task = createTask('pack', `安装整合包 ${body.name || ''}`, {
      retrySpec: { api: '/api/pack/install', body },
    });

    (async () => {
      try {
        let mrpackPath = body.path;
        if (!mrpackPath && body.project) {
          tstage(task, '获取整合包信息', 1);
          const vs = await mrVersions(body.project, { mcVersion: body.mcVersion });
          const ver = body.versionId ? vs.find(v => v.id === body.versionId) : vs[0];
          if (!ver) throw new Error('未找到整合包版本');
          const f = ver.files.find(x => x.primary) || ver.files[0];
          const tmpDir = path.join(CACHE, 'packs');
          await fsp.mkdir(tmpDir, { recursive: true });
          mrpackPath = path.join(tmpDir, safeName(f.filename));
          tlog(task, `下载 ${f.filename}`);
          await downloadOne(f.url, mrpackPath, { source: 'official', sha1: f.sha1, size: f.size, timeout: 300000, idleMs: 25000 });
          taddFile(task, f.size || 0);
          tprogress(task, 1);
        }
        if (!mrpackPath || !existsSync(mrpackPath)) throw new Error('整合包文件不存在');

        tstage(task, '解析整合包', 1);
        const parsed = await installMrpack(mrpackPath, { task, source: cfg.source, concurrency: cfg.downloadConcurrency });

        // 准备目标版本（MC + loader）
        let vid = parsed.mcVersion;
        tstage(task, '安装游戏版本', 1);
        await installVersion(parsed.mcVersion, { source: cfg.source, concurrency: cfg.downloadConcurrency, task });
        if (parsed.loader !== 'vanilla' && parsed.loaderVersion) {
          if (parsed.loader === 'fabric' || parsed.loader === 'quilt') {
            const r = await installFabricLike(parsed.loader, parsed.mcVersion, parsed.loaderVersion, { source: cfg.source, task });
            vid = r.versionId;
          } else {
            const javas = await getJavas();
            const pick = pickJava(javas, 17, 'auto');
            if (!pick.java) throw new Error('需要 Java 17+ 安装 Forge/NeoForge');
            const r = await installForgeLike(parsed.loader, parsed.mcVersion, parsed.loaderVersion, pick.java.path, { source: cfg.source, task });
            vid = r.versionId;
          }
        }

        tstage(task, '创建实例', 1);
        const inst = await createInstance({
          name: body.name || parsed.index.name || '整合包实例',
          version: parsed.mcVersion, loader: parsed.loader,
          loaderVersion: parsed.loaderVersion, versionId: vid,
          memory: recommendMemoryMb(), jvmPreset: 'aikar',
        });
        tlog(task, `实例已创建: ${inst.name} (${inst.id})`);

        const mat = await materializeMrpack(inst.id, parsed, {
          task, source: cfg.source, concurrency: cfg.downloadConcurrency,
        });
        const cnt = { mod: 0, resourcepack: 0, shader: 0 };
        for (const kk of ['mod', 'resourcepack', 'shader']) {
          cnt[kk] = (await listContents(inst.id, kk)).length;
        }
        tlog(task, `模组 ${cnt.mod} / 资源包 ${cnt.resourcepack} / 光影 ${cnt.shader}`);
        await saveConfig({ lastInstance: inst.id });
        tdone(task, { instance: inst, ...mat, counts: cnt });
      } catch (e) { tfail(task, e); }
    })();
    return ok(res, { task: taskPublic(task) });
  }
  /* ---- CurseForge 整合包：zip + manifest.json ---- */
  if (p === '/api/cf/pack/install' && req.method === 'POST') {
    const cfg = await loadConfig();
    const key = (cfg.curseforgeApiKey || '').trim();
    if (!key) return fail(res, '还没有配置 CurseForge API Key', 400);
    if (!body.modId || !body.fileId) return fail(res, '缺少 modId / fileId', 400);
    const task = createTask('pack', `安装整合包 ${body.name || ''}`, {
      retrySpec: { api: '/api/cf/pack/install', body },
    });

    (async () => {
      try {
        tstage(task, '获取下载地址', 1);
        let url = body.downloadUrl || null;
        if (!url) url = await cfFileUrl(key, body.modId, body.fileId);
        if (!url) {
          throw new Error('作者关闭了第三方下载，只能到 CurseForge 网页手动下载后再拖进启动器');
        }
        const tmpDir = path.join(CACHE, 'packs');
        await fsp.mkdir(tmpDir, { recursive: true });
        const zipPath = path.join(tmpDir, safeName(`cf-${body.modId}-${body.fileId}.zip`));
        tlog(task, `下载整合包 ${body.fileName || ''}`);
        let last = 0;
        await downloadOne(url, zipPath, {
          source: 'official', timeout: 900000, idleMs: 30000, retries: 2,
          onProgress: (got) => {
            if (!task) return;
            if (got < last) last = 0;
            if (got > last) { addBytes(task, got - last); last = got; }
          },
        });
        taddFile(task, 0);

        tstage(task, '解析整合包', 1);
        const parsed = await parseCfPack(zipPath);
        if (!parsed.mcVersion) throw new Error('manifest.json 里没有 Minecraft 版本');
        tlog(task, `MC ${parsed.mcVersion} · ${parsed.loader}${parsed.loaderVersion ? ' ' + parsed.loaderVersion : ''} · ${parsed.files.length} 个模组`);

        // 整合包自带游戏本体：MC 版本和加载器都要先装好，不能当普通模组塞进某个实例
        let vid = parsed.mcVersion;
        tstage(task, '安装游戏版本', 1);
        await installVersion(parsed.mcVersion, { source: cfg.source, concurrency: cfg.downloadConcurrency, task });
        if (parsed.loader !== 'vanilla' && parsed.loaderVersion) {
          if (parsed.loader === 'fabric' || parsed.loader === 'quilt') {
            const r = await installFabricLike(parsed.loader, parsed.mcVersion, parsed.loaderVersion, { source: cfg.source, task });
            vid = r.versionId;
          } else {
            const javas = await getJavas();
            const pick = pickJava(javas, 17, 'auto');
            if (!pick.java) throw new Error('需要 Java 17+ 才能安装 Forge/NeoForge，请先到「设置 → Java 运行时」装一个');
            const r = await installForgeLike(parsed.loader, parsed.mcVersion, parsed.loaderVersion, pick.java.path, { source: cfg.source, task });
            vid = r.versionId;
          }
        }

        tstage(task, '创建实例', 1);
        const inst = await createInstance({
          name: body.name || parsed.name || '整合包实例',
          version: parsed.mcVersion, loader: parsed.loader,
          loaderVersion: parsed.loaderVersion, versionId: vid,
          memory: recommendMemoryMb(), jvmPreset: 'aikar',
          rootDir: body.rootDir || null,
        });
        tlog(task, `实例已创建: ${inst.name} (${inst.id})`);

        // overrides/ 里的配置、资源包、存档先铺好
        tstage(task, '展开整合包文件', 1);
        await materializeZipPack(inst.id, zipPath, { task });

        // manifest 只给 projectID/fileID，模组得一个个按号去要
        tstage(task, '下载模组', parsed.files.length);
        const rootDir = P.instance(inst.id);
        const modsDir = path.join(rootDir, 'mods');
        await fsp.mkdir(modsDir, { recursive: true });
        let got = 0, missed = 0, moved = 0;
        for (const f of parsed.files) {
          if (task?._cancel) break;
          try {
            const u = await cfFileUrl(key, f.modId, f.fileId);
            if (!u) { missed++; continue; }
            let name = decodeURIComponent((u.split('?')[0].split('/').pop() || '').trim());
            if (!/\.jar$/i.test(name)) name = `cf-${f.modId}-${f.fileId}.jar`;
            // 先落到 mods 再按内容挑目录：manifest 里不区分类型，
            // 有些整合包会把资源包也列进来，一股脑丢 mods 只会让
            // 游戏报 “not a valid mod file”，东西也白下
            const tmpDest = path.join(modsDir, safeName(name));
            await downloadOne(u, tmpDest, {
              source: 'official', timeout: 300000, idleMs: 30000, retries: 1,
            });
            const actual = await sniffContentKind(tmpDest);
            if (actual !== 'mod') {
              const dstDir = path.join(rootDir, actual === 'shader' ? 'shaderpacks' : 'resourcepacks');
              await fsp.mkdir(dstDir, { recursive: true });
              const dst = path.join(dstDir, safeName(name).replace(/\.jar$/i, '.zip'));
              await fsp.rename(tmpDest, dst).catch(() => { });
              moved++;
            }
            addBytes(task, 0);
            got++;
          } catch { missed++; }
          tprogress(task, 1, `${got + missed}/${parsed.files.length}`);
        }
        if (missed) tlog(task, `⚠ ${missed} 个内容没能下载（作者限制第三方分发或已删除），可以进实例里手动补`);
        if (moved) tlog(task, `${moved} 个文件其实是资源包/光影，已放进对应目录`);

        // manifest 只列直接内容，前置得靠对账补：NeoForge 那边缺了会整片模组失效
        tstage(task, '补全前置模组', 1);
        let depReport = null;
        try {
          depReport = await autoInstallMissingDeps(inst.id, {
            task, mcVersion: parsed.mcVersion, loader: parsed.loader,
          });
          if (depReport.fixed.length) tlog(task, `自动补上 ${depReport.fixed.length} 个前置`);
          if (depReport.failed.length) {
            tlog(task, `⚠ ${depReport.failed.length} 个前置没能补上：`
              + depReport.failed.map(x => `${x.modId}（${x.reason}）`).join('；'));
          }
        } catch (e) {
          tlog(task, '前置对账失败（不影响已装内容）: ' + e.message);
        }

        const cnt = { mod: 0, resourcepack: 0, shader: 0 };
        for (const kk of ['mod', 'resourcepack', 'shader']) cnt[kk] = (await listContents(inst.id, kk)).length;
        tlog(task, `模组 ${cnt.mod} / 资源包 ${cnt.resourcepack} / 光影 ${cnt.shader}`);
        await saveConfig({ lastInstance: inst.id });
        const stillMissing = (depReport && depReport.failed.length) || 0;
        tdone(task, { instance: inst, counts: cnt, missed, deps: depReport },
          (missed || stillMissing)
            ? {
              stage: `已安装${missed ? `，${missed} 个内容需手动补` : ''}${stillMissing ? `，${stillMissing} 个前置缺` : ''}`,
              warning: `${missed ? `${missed} 个内容作者限制第三方下载` : ''}${missed && stillMissing ? '；' : ''}${stillMissing ? `${stillMissing} 个前置无法自动补齐` : ''}`,
            }
            : {});
      } catch (e) { tfail(task, e); }
    })();
    return ok(res, { task: taskPublic(task) });
  }
  if (p === '/api/pack/upload') {
    const filename = decodeURIComponent(req.headers['x-filename'] || 'pack.zip');
    const tmpDir = path.join(CACHE, 'packs');
    await fsp.mkdir(tmpDir, { recursive: true });
    const tmp = path.join(tmpDir, `${Date.now()}-${safeName(filename)}`);
    await new Promise((resolve, reject) => {
      const ws = fs.createWriteStream(tmp);
      req.pipe(ws); ws.on('finish', resolve); ws.on('error', reject); req.on('error', reject);
    });
    return ok(res, { path: tmp, name: filename.replace(/\.(zip|mrpack)$/i, '') });
  }
  if (p === '/api/pack/import-zip' && req.method === 'POST') {
    const { path: zipPath, name } = body;
    const task = createTask('pack', `导入整合包 ${name || ''}`);
    (async () => {
      try {
        tstage(task, '创建实例', 1);
        const inst = await createInstance({
          name: name || '导入的整合包', version: 'unknown', loader: 'vanilla',
          versionId: body.mcVersion || null, memory: recommendMemoryMb(), jvmPreset: 'aikar',
        });
        const r = await materializeZipPack(inst.id, zipPath, { task });
        tdone(task, { instance: inst, ...r });
      } catch (e) { tfail(task, e); }
    })();
    return ok(res, { task: taskPublic(task) });
  }

  /* ---- 图片代理（Modrinth 图标，避免前端跨域） ---- */
  if (p === '/api/proxy') {
    const target = q.get('url');
    if (!target || !/^https:\/\//.test(target)) return fail(res, '非法 url');
    try {
      const { buf, contentType } = await httpBinary(target);
      res.writeHead(200, {
        'Content-Type': contentType || 'application/octet-stream',
        'Cache-Control': 'public, max-age=86400',
        'Content-Length': buf.length,
      });
      return res.end(buf);
    } catch (e) { return fail(res, e, 502); }
  }

  return json(res, 404, { ok: false, error: 'API 不存在: ' + p });
}

/* --------------------------------------------------------------- 启动服务 */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  try {
    // 先挡 DNS rebinding：如果 Host 不是本机回环，说明请求是被某个域名
    // 解析到 127.0.0.1 带过来的，直接拒掉。
    if (!hostOk(req)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Host 不被允许');
    }
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
    } else {
      await serveStatic(res, url.pathname);
    }
  } catch (e) {
    console.error('[API 错误]', url.pathname, e);
    if (!res.headersSent) fail(res, e, 500);
    else try { res.end(); } catch { }
  }
});

async function main() {
  await ensureDirs();
  // 先把用户配置的额外游戏目录装进内存，再扫一遍把 id→目录 映射建起来，
  // 否则第一批请求会把别的盘上的实例当成不存在
  {
    const cfg = await loadConfig();
    setExtraGameDirs(cfg.gameDirs || []);
    await listInstances().catch(() => []);
  }
  await getJavas();
  server.listen(PORT, HOST, () => {
    const line = `  Nova Launcher 已启动  →  http://${HOST}:${PORT}`;
    console.log('\n' + '─'.repeat(52));
    console.log(line);
    console.log(`  数据目录: ${DATA}`);
    console.log(`  物理内存: ${totalMemoryMb()} MB | CPU 核心: ${os.cpus().length}`);
    if (!TOKEN_FROM_SHELL) {
      // 浏览器模式：外壳没给令牌，这里打出来，用户照着带参数的地址访问
      console.log(`  本次会话令牌: ${TOKEN}`);
      console.log(`  请用这个地址打开: http://${HOST}:${PORT}/?t=${TOKEN}`);
    }
    console.log('─'.repeat(52) + '\n');
    // 每日自动数据快照：后台悄悄跑，失败不影响使用
    setTimeout(() => { autoBackupIfDue().catch(() => { }); }, 6000);
    if (process.env.NOVA_NO_OPEN !== '1') {
      setTimeout(() => {
        spawn('cmd', ['/c', 'start', '', `http://${HOST}:${PORT}/?t=${TOKEN}`],
          { detached: true, stdio: 'ignore', windowsHide: true })
          .on('error', () => { }).unref();
      }, 400);
    }
  });
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.error(`端口 ${PORT} 被占用。设置环境变量 NOVA_PORT 换一个端口，例如: set NOVA_PORT=7500`);
    } else console.error(e);
    process.exit(1);
  });
}

process.on('unhandledRejection', (e) => console.error('[未处理拒绝]', e?.message || e));
process.on('uncaughtException', (e) => console.error('[未捕获异常]', e?.message || e));

main();

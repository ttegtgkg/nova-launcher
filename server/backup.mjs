/**
 * 数据快照 —— 把「改了就没了」的东西自动存一份。
 *
 * 为什么不全量备份：data/ 里 99% 的体积是 libs / assets / mods，这些都能重下；
 * 真正丢了就找不回来的只有四样：
 *   1. config.json          —— 启动器设置、Java 路径、每个实例的内存/窗口参数
 *   2. instance.json        —— 实例本身（名字、加载器、版本、图标）
 *   3. nova-sources.json    —— 每个模组是从哪下的（决定详情页能不能跳转）
 *   4. saves/ + options.txt —— 存档和键位，玩家最心疼的部分
 * 所以快照只抓这几样，一份通常几 MB，能放心每天存。
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import { DATA, P, gameRoots, CONFIG_FILE, readJson, writeJson, exists, zipCreate, zipEntries, zipRead } from './core.mjs';

const BACKUP_DIR = path.join(DATA, 'backups');
const META_FILE = path.join(BACKUP_DIR, 'index.json');
const KEEP = 10;                       // 每日/手动快照最多留 10 份，超出删最老
const KEEP_LAUNCH = 6;                 // 启动前自动备份单独算，留最近 6 份
const PER_FILE_CAP = 128 * 1024 * 1024; // 单个文件超 128MB 跳过（超大存档不硬扛）
const WALL_BACKUP_CAP = 8 * 1024 * 1024; // 壁纸超过 8MB 就不进快照
const AUTO_INTERVAL_MS = 24 * 3600 * 1000;

let running = null;   // 正在跑的备份 Promise
let lastError = null;

const stamp = (d = new Date()) => {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

async function readIndex() {
  return (await readJson(META_FILE, { items: [] })) || { items: [] };
}

async function writeIndex(db) {
  await fsp.mkdir(BACKUP_DIR, { recursive: true });
  await writeJson(META_FILE, db);
}

/* ------------------------------------------------------------ 采集 */

async function pushFile(entries, absPath, zipName, stats) {
  try {
    const st = await fsp.stat(absPath);
    if (!st.isFile()) return;
    if (st.size > PER_FILE_CAP) { stats.skipped++; return; }
    entries.push({ name: zipName, data: await fsp.readFile(absPath) });
    stats.files++;
    stats.bytes += st.size;
  } catch { /* 文件不在就算了 */ }
}

async function collectDir(entries, dir, zipPrefix, stats, depth = 0) {
  if (depth > 6) return;
  let items = [];
  try { items = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const it of items) {
    const fp = path.join(dir, it.name);
    const zn = `${zipPrefix}/${it.name}`;
    if (it.isDirectory()) {
      await collectDir(entries, fp, zn, stats, depth + 1);
    } else {
      await pushFile(entries, fp, zn, stats);
    }
  }
}

/** 列出所有游戏目录下的实例 id（多游戏目录时会有好几个根） */
async function listInstanceDirs() {
  const out = [];
  for (const root of gameRoots()) {
    let items = [];
    try { items = await fsp.readdir(root, { withFileTypes: true }); } catch { continue; }
    for (const it of items) if (it.isDirectory()) out.push(it.name);
  }
  return out;
}

/* ------------------------------------------------------------ 备份 */

/**
 * @param reason    写进快照说明的原因
 * @param instanceId 只备份这一个实例（启动前自动备份用）；不传就备份全部
 * @param kind      launch | daily | manual —— 决定轮转时算进哪一类
 */
async function doBackup({ reason = '手动', instanceId = null, kind = null } = {}) {
  const entries = [];
  const stats = { files: 0, bytes: 0, skipped: 0, instances: 0 };
  const only = instanceId || null;
  const k = kind || (only ? 'launch' : 'manual');

  // 只备一个实例时，全局配置/主题/壁纸跟这次备份无关，别塞进去撑体积
  if (!only) {
    await pushFile(entries, CONFIG_FILE, 'config.json', stats);
    await pushFile(entries, path.join(DATA, 'downloads-history.json'), 'downloads-history.json', stats);
  }

  const ids = await listInstanceDirs();
  for (const id of (only ? ids.filter(x => x === only) : ids)) {
    const dir = P.instance(id);
    const prefix = `instances/${id}`;
    let any = false;
    for (const f of ['instance.json', 'nova-sources.json', 'options.txt', 'servers.dat']) {
      const before = stats.files;
      await pushFile(entries, path.join(dir, f), `${prefix}/${f}`, stats);
      if (stats.files > before) any = true;
    }
    const savesDir = path.join(dir, 'saves');
    if (await exists(savesDir)) {
      const before = stats.files;
      await collectDir(entries, savesDir, `${prefix}/saves`, stats);
      if (stats.files > before) any = true;
    }
    if (any) stats.instances++;
  }

  if (!only) {
    // 自定义主题：几 KB，但丢了得重写，必须进快照
    await collectDir(entries, path.join(DATA, 'themes'), 'themes', stats);

    // 壁纸只存当前在用的那一张，且太大的跳过（图片能重新选，不值当撑爆快照）
    const cfg = (await readJson(CONFIG_FILE, {})) || {};
    const wallFile = cfg.wallpaper && cfg.wallpaper.file;
    if (wallFile && /^wall-[a-f0-9]{8,20}\.\w+$/i.test(wallFile)) {
      const fp = path.join(DATA, 'wallpapers', wallFile);
      try {
        const st = await fsp.stat(fp);
        if (st.size <= WALL_BACKUP_CAP) {
          entries.push({ name: 'wallpapers/' + wallFile, data: await fsp.readFile(fp) });
          stats.files++;
          stats.bytes += st.size;
        } else {
          stats.skipped++;
        }
      } catch { /* 图片不在就算了 */ }
    }
  }

  // 全是空的就别产出垃圾文件
  if (!stats.files) throw new Error('没有可备份的数据（实例和存档都是空的）');

  entries.push({
    name: 'nova-backup.txt',
    data: Buffer.from(
      `Nova Launcher 数据快照\n创建时间: ${new Date().toLocaleString('zh-CN')}\n` +
      `原因: ${reason}\n文件数: ${stats.files}\n实例数: ${stats.instances}\n`, 'utf8'),
  });

  const buf = zipCreate(entries);
  await fsp.mkdir(BACKUP_DIR, { recursive: true });
  // 时间戳只到秒，同一秒内连打两次会互相覆盖（启动前备份很容易撞上），加个序号避开
  let file = `snapshot-${stamp()}.zip`;
  for (let n = 1; await exists(path.join(BACKUP_DIR, file)); n++) {
    file = `snapshot-${stamp()}-${n}.zip`;
  }
  await fsp.writeFile(path.join(BACKUP_DIR, file), buf);

  const db = await readIndex();
  db.items.unshift({
    file, size: buf.length, time: Date.now(), reason, kind: k,
    files: stats.files, instances: stats.instances, skipped: stats.skipped,
    scope: only || 'all',
  });
  // 轮转分两类算：启动前备份很频繁，不该把每日快照挤掉
  const launch = db.items.filter(it => it.kind === 'launch');
  while (launch.length > KEEP_LAUNCH) {
    const dead = launch.pop();
    db.items = db.items.filter(x => x.file !== dead.file);
    try { await fsp.unlink(path.join(BACKUP_DIR, dead.file)); } catch { }
  }
  while (db.items.length > KEEP) {
    const dead = db.items.pop();
    try { await fsp.unlink(path.join(BACKUP_DIR, dead.file)); } catch { }
  }
  await writeIndex(db);
  return db.items[0];
}

/** 创建快照（同一时刻只允许一个） */
export async function createBackup(opts = {}) {
  if (running) return running;
  running = doBackup(opts)
    .then(r => { lastError = null; return r; })
    .catch(e => { lastError = e.message; throw e; })
    .finally(() => { running = null; });
  return running;
}

export function backupRunning() { return !!running; }

/** 列表（以磁盘为准，index 丢了也能列出来） */
export async function listBackups() {
  const db = await readIndex();
  const known = new Map(db.items.map(it => [it.file, it]));
  let files = [];
  try { files = await fsp.readdir(BACKUP_DIR); } catch { /* 目录还没有 */ }
  const out = [];
  for (const f of files) {
    if (!/^snapshot-.*\.zip$/i.test(f)) continue;
    let size = 0;
    try { size = (await fsp.stat(path.join(BACKUP_DIR, f))).size; } catch { continue; }
    const meta = known.get(f) || {};
    out.push({
      file: f,
      size,
      time: meta.time || Number((f.match(/-(\d{8})-(\d{6})(?:-\d+)?\.zip$/) || []).slice(1, 3).join('')) || 0,
      reason: meta.reason || '未知',
      kind: meta.kind || null,
      scope: meta.scope || null,
      files: meta.files ?? null,
      instances: meta.instances ?? null,
    });
  }
  out.sort((a, b) => b.file.localeCompare(a.file));
  return { dir: BACKUP_DIR, items: out, keep: KEEP, autoIntervalHours: AUTO_INTERVAL_MS / 3600000, lastError };
}

/* ------------------------------------------------------------ 恢复 */

const RESTORE_ALLOW = /^(config\.json|downloads-history\.json|nova-backup\.txt|themes\/[\w.-]+\.json|wallpapers\/wall-[a-f0-9]{8,20}\.\w+|instances\/[^/]+\/(instance\.json|nova-sources\.json|options\.txt|servers\.dat)|instances\/[^/]+\/saves\/.+)$/;

/** 恢复指定快照。恢复前先自动打一份当前状态，反悔有路。 */
export async function restoreBackup(file, { confirm = false } = {}) {
  if (!/^snapshot-[\w.-]+\.zip$/i.test(file)) throw new Error('快照文件名不合法');
  const abs = path.join(BACKUP_DIR, file);
  if (!(await exists(abs))) throw new Error('快照不存在: ' + file);

  const buf = await fsp.readFile(abs);
  const entries = zipEntries(buf);
  const usable = entries.filter(e => RESTORE_ALLOW.test(e.name.replace(/\\/g, '/')));

  const plan = {
    file, total: usable.length,
    config: usable.some(e => e.name === 'config.json'),
    themes: usable.filter(e => /^themes\//.test(e.name)).length,
    wallpaper: usable.some(e => /^wallpapers\//.test(e.name)),
    instances: [...new Set(usable.map(e => (e.name.match(/^instances\/([^/]+)\//) || [])[1]).filter(Boolean))],
    saves: usable.filter(e => /\/saves\//.test(e.name)).length,
  };
  if (!confirm) return { dryRun: true, plan };

  // 先给当前状态留一份退路
  let safety = null;
  try { safety = (await createBackup({ reason: '恢复前自动存档' })).file; } catch { /* 空数据就算了 */ }

  let done = 0;
  for (const e of usable) {
    const rel = e.name.replace(/\\/g, '/');
    const dest = path.resolve(DATA, rel);
    if (!dest.startsWith(path.resolve(DATA) + path.sep)) continue;   // 防目录穿越
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.writeFile(dest, zipRead(buf, e));
    done++;
  }
  return { ok: true, restored: done, plan, safety };
}

/** 删除一份快照 */
export async function deleteBackup(file) {
  if (!/^snapshot-[\w.-]+\.zip$/i.test(file)) throw new Error('快照文件名不合法');
  try { await fsp.unlink(path.join(BACKUP_DIR, file)); } catch { }
  const db = await readIndex();
  db.items = db.items.filter(it => it.file !== file);
  await writeIndex(db);
  return { ok: true };
}

/* ------------------------------------------------------------ 自动备份 */

/** 启动时调用：超过 24 小时没备份就悄悄补一份，失败不打扰用户 */
export async function autoBackupIfDue() {
  const cfg = (await readJson(CONFIG_FILE, {})) || {};
  if (cfg.autoBackup === false) return null;
  const db = await readIndex();
  const latest = db.items[0]?.time || 0;
  if (Date.now() - latest < AUTO_INTERVAL_MS) return null;
  try {
    const r = await createBackup({ reason: '自动（每日一次）' });
    return r;
  } catch (e) {
    lastError = e.message;
    return null;
  }
}

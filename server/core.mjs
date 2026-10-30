// core.mjs —— 路径 / 配置 / 任务队列 / ZIP / 并发下载器
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import os from 'node:os';
import https from 'node:https';
import httpMod from 'node:http';
import dns from 'node:dns';
import { fileURLToPath } from 'node:url';

// 部分网络环境下 IPv6 不通但 DNS 会返回 AAAA，优先 IPv4 避免连接卡死
try { dns.setDefaultResultOrder('ipv4first'); } catch { }

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------------ 路径 */

export const ROOT = path.resolve(__dirname, '..');

/**
 * 数据目录解析优先级：
 *   1. 环境变量 NOVA_DATA_DIR（临时覆盖）
 *   2. 程序目录下的 .nova-data-dir 标记文件（安装版由安装器写入 "..\data"）
 *   3. 默认 <程序目录>/data（开发时就是项目根下的 data）
 * 安装版把数据放在程序目录之外，卸载/覆盖安装程序文件不会碰到游戏数据。
 */
function resolveDataDir() {
  if (process.env.NOVA_DATA_DIR) return path.resolve(process.env.NOVA_DATA_DIR);
  try {
    const marker = fs.readFileSync(path.join(ROOT, '.nova-data-dir'), 'utf8').trim();
    if (marker) return path.resolve(ROOT, marker);
  } catch { /* 没有标记文件，用默认 */ }
  return path.join(ROOT, 'data');
}

export const DATA = resolveDataDir();
export const SHARED = path.join(DATA, 'shared');      // 共享 versions / libraries / assets
export const INSTANCES = path.join(DATA, 'instances'); // 每个实例一个 gameDir
export const RUNTIME = path.join(DATA, 'runtime');     // 自动下载的 java
export const CACHE = path.join(DATA, 'cache');         // 图标等缓存
export const CONFIG_FILE = path.join(DATA, 'config.json');

export const P = {
  versions: path.join(SHARED, 'versions'),
  libraries: path.join(SHARED, 'libraries'),
  assets: path.join(SHARED, 'assets'),
  instance: (id) => path.join(INSTANCES, id),
};

export async function ensureDirs() {
  for (const d of [DATA, SHARED, INSTANCES, RUNTIME, CACHE, P.versions, P.libraries, P.assets]) {
    await fsp.mkdir(d, { recursive: true });
  }
}

export async function exists(p) {
  try { await fsp.access(p); return true; } catch { return false; }
}
export function existsSync(p) {
  try { fs.accessSync(p); return true; } catch { return false; }
}

export async function readJson(p, fallback = null) {
  try { return JSON.parse(await fsp.readFile(p, 'utf8')); } catch { return fallback; }
}
export async function writeJson(p, obj) {
  await fsp.mkdir(path.dirname(p), { recursive: true });
  await fsp.writeFile(p, JSON.stringify(obj, null, 2), 'utf8');
}

/* ------------------------------------------------------------------ 配置 */

export const DEFAULTS = {
  source: 'auto',            // auto | official | mirror
  downloadConcurrency: 12,
  javaPath: 'auto',
  lastInstance: null,
  window: { width: 1280, height: 800 },
  memory: { preset: 'auto', customMb: 0 },
  jvmPreset: 'aikar',
  autoOptimize: true,        // 启动时自动内存优化
  autoInstallJava: true,     // 缺少合适的 Java 时自动下载安装
  autoBackup: true,          // 每天自动打一份数据快照
  curseforgeApiKey: '',      // CurseForge 官方 API Key（可选，申请后填这里）
  closeLauncherOnPlay: false,
  showSnapshots: false,
  theme: 'nova',             // 内置主题 key 或自定义主题 id（custom-xxxxxxxxxx）
  wallpaper: {               // 自定义壁纸（file 为 null 表示没设）
    file: null, opacity: 1, blur: 0, dim: 55, fit: 'cover', pos: 'center', updatedAt: 0,
  },
};

export async function loadConfig() {
  const c = await readJson(CONFIG_FILE, {}) || {};
  return {
    ...DEFAULTS, ...c,
    memory: { ...DEFAULTS.memory, ...(c.memory || {}) },
    wallpaper: { ...DEFAULTS.wallpaper, ...(c.wallpaper || {}) },
  };
}
export async function saveConfig(patch) {
  const cur = await loadConfig();
  const next = {
    ...cur, ...patch,
    memory: { ...cur.memory, ...(patch.memory || {}) },
    wallpaper: { ...cur.wallpaper, ...(patch.wallpaper || {}) },
  };
  await writeJson(CONFIG_FILE, next);
  return next;
}

/* --------------------------------------------------------- 任务队列/进度 */

const tasks = new Map();
let taskSeq = 0;

export function createTask(type, title, opts = {}) {
  const id = `t${++taskSeq}-${Date.now().toString(36)}`;
  const t = {
    id, type, title,
    status: 'running',          // running | done | error | cancelled
    stage: '',
    total: 0, done: 0, percent: 0,
    detail: '',
    logs: [],
    result: null,
    error: null,
    createdAt: Date.now(),
    finishedAt: null,
    // 下载统计（下载管理中心用）
    bytesTotal: 0, bytesDone: 0, speedBps: 0, fileCount: 0, fileDone: 0,
    retrySpec: null,            // { api, body } —— 失败后一键重试
    _cancel: false,
    _samples: [],
    ...opts,
  };
  tasks.set(id, t);
  // 只保留最近 40 个任务
  if (tasks.size > 40) {
    const old = [...tasks.values()].filter(x => x.status !== 'running').sort((a, b) => a.createdAt - b.createdAt);
    for (const o of old.slice(0, tasks.size - 40)) tasks.delete(o.id);
  }
  return t;
}

export function taskPublic(t) {
  if (!t) return null;
  const { _cancel, _samples, ...rest } = t;
  return { ...rest, logs: t.logs.slice(-60) };
}
export function listTasks() {
  return [...tasks.values()].sort((a, b) => b.createdAt - a.createdAt).map(taskPublic);
}
export function getTask(id) { return tasks.get(id); }

/** 请求取消（下载批次会在下一个文件前停下） */
export function cancelTask(id) {
  const t = tasks.get(id);
  if (!t || t.status !== 'running') return false;
  t._cancel = true;
  tlog(t, '收到取消请求 ...');
  return true;
}

export function tlog(t, msg) {
  if (!t) return;
  t.logs.push(`[${new Date().toLocaleTimeString('zh-CN')}] ${msg}`);
  if (t.logs.length > 500) t.logs.splice(0, t.logs.length - 500);
}
export function tstage(t, stage, total = 0) {
  if (!t) return;
  t.stage = stage;
  t.total = total; t.done = 0; t.percent = 0;
  t.detail = '';
  t.speedBps = 0;
  t._samples = [];
}

/** 记录已下载字节数并计算滑动窗口速率 */
export function addBytes(t, n) {
  if (!t || !n) return;
  t.bytesDone += n;
  const now = Date.now();
  t._samples.push({ t: now, n });
  const cutoff = now - 3000;
  while (t._samples.length && t._samples[0].t < cutoff) t._samples.shift();
  const sum = t._samples.reduce((a, b) => a + b.n, 0);
  const span = Math.max(1000, now - (t._samples[0]?.t ?? now));
  t.speedBps = Math.round(sum / (span / 1000));
}

export function tprogress(t, addDone = 0, detail = '') {
  if (!t) return;
  t.done += addDone;
  if (t.total > 0) t.percent = Math.min(100, Math.round((t.done / t.total) * 100));
  if (detail) t.detail = detail;
}

/** 单个文件下载完成后记账（用于不经过 downloadBatch 的直接下载） */
export function taddFile(t, size = 0) {
  if (!t) return;
  if (size > 0) { t.bytesTotal += size; addBytes(t, size); }
  t.fileDone = (t.fileDone || 0) + 1;
  t.fileCount = (t.fileCount || 0) + 1;
}

/* --------------------------------------------------- 下载历史（持久化） */

const HISTORY_FILE = path.join(DATA, 'downloads-history.json');

async function persistHistory(t) {
  try {
    const list = (await readJson(HISTORY_FILE, [])) || [];
    list.unshift({
      id: t.id, type: t.type, title: t.title, status: t.status,
      createdAt: t.createdAt, finishedAt: t.finishedAt || Date.now(),
      bytes: t.bytesDone || 0, files: t.fileCount || t.total || 0,
      stage: t.stage,
      error: t.error ? String(t.error).split('\n')[0].slice(0, 400) : null,
      retrySpec: t.retrySpec || null,
      logs: t.logs.slice(-40),
    });
    await writeJson(HISTORY_FILE, list.slice(0, 300));
  } catch { /* 历史写失败不影响主流程 */ }
}

export async function getHistory() {
  return (await readJson(HISTORY_FILE, [])) || [];
}
export async function clearHistory() {
  await writeJson(HISTORY_FILE, []);
}

export function tdone(t, result = null) {
  if (!t) return;
  t.status = 'done'; t.percent = 100; t.result = result; t.finishedAt = Date.now();
  t.stage = '已完成';
  t.speedBps = 0;
  persistHistory(t);
}
export function tfail(t, err) {
  if (!t) return;
  if (t._cancel) {   // 主动取消，不算错误
    t.status = 'cancelled'; t.finishedAt = Date.now(); t.stage = '已取消';
    t.speedBps = 0;
    persistHistory(t);
    return;
  }
  t.status = 'error';
  t.error = String(err?.stack || err?.message || err);
  t.finishedAt = Date.now();
  t.stage = '失败';
  t.speedBps = 0;
  tlog(t, '错误: ' + (err?.message || err));
  persistHistory(t);
}
/** 标记为已取消（非异常路径） */
export function tcancel(t) {
  if (!t) return;
  t._cancel = true;
  t.status = 'cancelled'; t.finishedAt = Date.now(); t.stage = '已取消';
  t.speedBps = 0;
  tlog(t, '任务已取消');
  persistHistory(t);
}

/* --------------------------------------------------------------- ZIP 读取 */

/** 解析 zip 中央目录，返回条目表（不解压内容） */
export function zipEntries(buf) {
  // 从尾部搜索 EOCD
  let eocd = -1;
  const min = Math.max(0, buf.length - 66560);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效的 ZIP 文件（未找到 EOCD）');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);

  const out = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const flags = buf.readUInt16LE(off + 8);
    const method = buf.readUInt16LE(off + 10);
    const csize = buf.readUInt32LE(off + 20);
    const usize = buf.readUInt32LE(off + 24);
    const nlen = buf.readUInt16LE(off + 28);
    const elen = buf.readUInt16LE(off + 30);
    const clen = buf.readUInt16LE(off + 32);
    const lho = buf.readUInt32LE(off + 42);
    const rawName = buf.subarray(off + 46, off + 46 + nlen);
    let name;
    if (flags & 0x800) name = rawName.toString('utf8');
    else {
      const u = rawName.toString('utf8');
      name = u.includes('\uFFFD') ? new (await_TextDecoder)('gbk').decode(rawName) : u;
    }
    out.push({ name: name.replace(/\\/g, '/'), method, csize, usize, lho, isDir: name.endsWith('/') });
    off += 46 + nlen + elen + clen;
  }
  return out;
}
// TextDecoder 需要在本模块加载时就绪（sync 上下文）
const await_TextDecoder = globalThis.TextDecoder;

/** 解出单个条目内容 */
export function zipRead(buf, entry) {
  const lho = entry.lho;
  if (buf.readUInt32LE(lho) !== 0x04034b50) throw new Error('本地头损坏: ' + entry.name);
  const nlen = buf.readUInt16LE(lho + 26);
  const elen = buf.readUInt16LE(lho + 28);
  const start = lho + 30 + nlen + elen;
  const data = buf.subarray(start, start + entry.csize);
  if (entry.method === 0) return Buffer.from(data);
  if (entry.method === 8) return zlib.inflateRawSync(data);
  throw new Error('不支持的压缩方式 ' + entry.method + ': ' + entry.name);
}

/** 安全解压到目标目录（防 zip-slip） */
export async function zipExtractAll(buf, destDir, filter = null) {
  const entries = zipEntries(buf);
  let n = 0;
  for (const e of entries) {
    if (filter && !filter(e.name)) continue;
    const rel = e.name.replace(/^\/+/, '');
    const target = path.resolve(destDir, rel);
    if (!target.startsWith(path.resolve(destDir))) continue; // 防越权
    if (e.isDir) { await fsp.mkdir(target, { recursive: true }); continue; }
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, zipRead(buf, e));
    n++;
  }
  return n;
}

/* ------------------------------------------------------------- 网络/下载 */

const MIRROR_RULES = [
  ['https://piston-meta.mojang.com', 'https://bmclapi2.bangbang93.com'],
  ['https://piston-data.mojang.com', 'https://bmclapi2.bangbang93.com'],
  ['https://launchermeta.mojang.com', 'https://bmclapi2.bangbang93.com'],
  ['https://launcher.mojang.com', 'https://bmclapi2.bangbang93.com'],
  ['https://resources.download.minecraft.net', 'https://bmclapi2.bangbang93.com/assets'],
  ['https://libraries.minecraft.net', 'https://bmclapi2.bangbang93.com/maven'],
];

export function toMirror(url) {
  for (const [from, to] of MIRROR_RULES) if (url.startsWith(from)) return to + url.slice(from.length);
  return url;
}

const UA = { 'User-Agent': 'NovaLauncher/1.0 (local; +https://localhost)' };

// 连接复用（并发下载同一个 CDN 时省掉重复握手）
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 64, keepAliveMsecs: 2000 });
const httpAgent = new httpMod.Agent({ keepAlive: true, maxSockets: 32, keepAliveMsecs: 2000 });

/**
 * 带「空闲超时」的整包下载（基于 node:https，不用内置 fetch）。
 *
 * 为什么不用 fetch：Node 内置 fetch(undici) 有硬编码的 10 秒「连接超时」，
 * 而 cdn.modrinth.com / 部分 Mojang CDN 在国内可能几十秒才连上，
 * 会直接 UND_ERR_CONNECT_TIMEOUT 失败；且它的 abort 只覆盖响应头阶段。
 * 自己用 http(s).request 可以精确控制：连接由系统决定、空闲由 socket timeout 管、总量由兜底定时器管。
 *
 * idleMs:  多久没收到数据就放弃（默认 25s）
 * totalMs: 整体上限（默认 15min）
 */
function httpGet(url, { idleMs = 25000, connectMs = 15000, totalMs = 900000, headers = {}, redirects = 6, onData = null } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch { return reject(new Error('URL 无效: ' + url)); }
    const mod = u.protocol === 'http:' ? httpMod : https;

    let settled = false;
    let totalTimer = null, connectTimer = null;
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(totalTimer); clearTimeout(connectTimer);
      fn(arg);
    };

    const req = mod.request({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || undefined,
      path: u.pathname + u.search,
      method: 'GET',
      agent: u.protocol === 'http:' ? httpAgent : httpsAgent,
      headers: { ...UA, 'Accept-Encoding': 'identity', ...headers },
    }, (res) => {
      // 重定向
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume();
        const next = new URL(res.headers.location, url).href;
        return httpGet(next, { idleMs, connectMs, totalMs, headers, redirects: redirects - 1, onData })
          .then(r => finish(resolve, r), e => finish(reject, e));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return finish(resolve, { ok: false, status: res.statusCode });
      }
      const chunks = [];
      let bytes = 0;
      const declared = Number(res.headers['content-length'] || 0);
      res.on('data', (c) => {
        chunks.push(c);
        bytes += c.length;
        if (onData) { try { onData(bytes, declared); } catch { /* 进度回调异常不影响下载 */ } }
      });
      res.on('end', () => {
        let buf = Buffer.concat(chunks);
        const enc = (res.headers['content-encoding'] || '').toLowerCase();
        try {
          if (enc === 'gzip') buf = zlib.gunzipSync(buf);
          else if (enc === 'deflate') buf = zlib.inflateSync(buf);
          else if (enc === 'br') buf = zlib.brotliDecompressSync(buf);
        } catch { /* 解压失败就用原始字节 */ }
        finish(resolve, { ok: true, status: 200, buf, contentType: res.headers['content-type'] || '', bytes });
      });
      res.on('error', e => finish(reject, e));
    });

    // 连接超时：socket timeout 只在连上之后才生效，连不上时必须单独兜底
    connectTimer = setTimeout(() => {
      req.destroy(new Error(`连接超时（${Math.round(connectMs / 1000)}s 未建立连接）`));
    }, connectMs);
    req.on('socket', (s) => {
      if (!s.connecting) { clearTimeout(connectTimer); return; }   // keep-alive 复用，已连接
      s.once('connect', () => clearTimeout(connectTimer));
      s.once('secureConnect', () => clearTimeout(connectTimer));
    });

    // socket 空闲超时（连上后，长时间没有数据就断开）
    req.setTimeout(idleMs, () => {
      req.destroy(new Error(`下载空闲超时（${Math.round(idleMs / 1000)}s 无数据）`));
    });
    // 兜底总超时
    totalTimer = setTimeout(() => {
      req.destroy(new Error(`下载总超时（${Math.round(totalMs / 60000)}min）`));
    }, totalMs);

    req.on('error', e => finish(reject, e));
    req.end();
  });
}

/** 统一入口：返回 { ok, status, buf } */
async function fetchBuffer(url, opts = {}) {
  return httpGet(url, opts);
}

export { httpGet };

/** 二进制内容（图片等）代理获取 */
export async function httpBinary(url, opts = {}) {
  const r = await httpGet(url, { idleMs: 15000, totalMs: 60000, ...opts });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return { buf: r.buf, contentType: r.contentType };
}

/** 带镜像回退的 GET -> text */
export async function httpText(url, { source = 'auto', timeout = 30000 } = {}) {
  const targets = source === 'official' ? [url]
    : source === 'mirror' ? [toMirror(url)]
    : [toMirror(url), url];
  let lastErr;
  for (const u of new Set(targets)) {
    try {
      const r = await httpGet(u, { idleMs: Math.min(timeout, 15000), totalMs: timeout });
      if (!r.ok) { lastErr = new Error(`HTTP ${r.status} ${u}`); continue; }
      return r.buf.toString('utf8');
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('请求失败: ' + url);
}

export async function httpJson(url, opts) {
  const txt = await httpText(url, opts);
  return JSON.parse(txt);
}

export function sha1File(p) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha1');
    const s = fs.createReadStream(p);
    s.on('data', d => h.update(d));
    s.on('end', () => resolve(h.digest('hex')));
    s.on('error', reject);
  });
}

/** 原子下载：先写 .part 再改名
 *  officialFirst: auto 模式下改为官方源优先（资源文件 CDN 实测比镜像快时使用） */
export async function downloadOne(url, dest, { source = 'auto', sha1 = null, size = 0, timeout = 60000, retries = 3, officialFirst = false, idleMs = 25000, onProgress = null } = {}) {
  if (await exists(dest)) {
    if (!sha1) return { skipped: true };
    try { if ((await sha1File(dest)) === sha1) return { skipped: true }; } catch { /* 重下 */ }
  }
  // auto: 默认镜像优先（国内快），失败回落官方；officialFirst 时反过来
  const m = toMirror(url);
  const targets = source === 'official' ? [url]
    : source === 'mirror' ? [m]
    : officialFirst ? [...new Set([url, m])] : [...new Set([m, url])];
  let lastErr;
  for (let attempt = 0; attempt < retries; attempt++) {
    for (const u of targets) {
      const tmp = dest + '.part';
      try {
        await fsp.mkdir(path.dirname(dest), { recursive: true });
        if (onProgress) onProgress(0, size);   // 每次尝试重新开始，通知调用方重置计数
        const res = await fetchBuffer(u, {
          idleMs, totalMs: Math.max(timeout, 180000),
          onData: (got, declared) => { if (onProgress) onProgress(got, size || declared); },
        });
        if (!res.ok) { lastErr = new Error(`HTTP ${res.status}`); continue; }
        const buf = res.buf;
        if (size && buf.length !== size) {
          lastErr = new Error(`大小不符 ${buf.length}/${size}`);
          // 大小不符时仍可能可用（镜像偶发），继续尝试下一目标
          continue;
        }
        if (sha1) {
          const got = crypto.createHash('sha1').update(buf).digest('hex');
          if (got !== sha1) { lastErr = new Error('SHA1 校验失败'); continue; }
        }
        await fsp.writeFile(tmp, buf);
        await fsp.rename(tmp, dest);
        return { bytes: buf.length };
      } catch (e) {
        lastErr = e;
        try { await fsp.unlink(dest + '.part'); } catch { }
      }
    }
    if (attempt < retries - 1) await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
  }
  throw new Error(`下载失败 ${path.basename(dest)}: ${lastErr?.message || 'unknown'} (${url})`);
}

/** 并发下载一批任务 */
export async function downloadBatch(items, { concurrency = 12, task = null, onOne = null } = {}) {
  let idx = 0;
  const failed = [];
  const total = items.length;
  if (task) {
    // 不重置 stage，只对齐总数并累计字节规模
    if (task.total !== total) { task.total = total; task.done = 0; task.percent = 0; }
    task.fileCount = (task.fileCount || 0) + total;
    task.bytesTotal = (task.bytesTotal || 0) + items.reduce((a, b) => a + (b.size || 0), 0);
  }

  async function worker() {
    while (idx < total) {
      if (task?._cancel) return;
      const i = idx++;
      const it = items[i];
      let lastBytes = 0;
      try {
        const r = await downloadOne(it.url, it.dest, {
          ...it,
          onProgress: (got) => {
            if (!task) return;
            if (got < lastBytes) lastBytes = 0;      // 重试导致从头开始
            if (got > lastBytes) { addBytes(task, got - lastBytes); lastBytes = got; }
          },
        });
        if (task) task.fileDone = (task.fileDone || 0) + 1;
        if (onOne) onOne(it, true, null);
      } catch (e) {
        failed.push({ file: path.basename(it.dest), err: e.message });
        if (onOne) onOne(it, false, e);
      }
      if (task) tprogress(task, 1, `${task.done}/${total} ${path.basename(it.dest)}`);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, total || 1) }, worker);
  await Promise.all(workers);
  return { total, failed, cancelled: Boolean(task?._cancel) };
}

/* --------------------------------------------------------------- ZIP 写入 */

/**
 * 创建 ZIP。entries: [{ name, data: Buffer }]
 * 用 deflateRaw 压缩；文件名统一 UTF-8 并设置 flag bit 11，中文名不乱码。
 */
export function zipCreate(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const e of entries) {
    const nameBuf = Buffer.from(e.name.replace(/\\/g, '/'), 'utf8');
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data);
    let comp = raw;
    let method = 0;
    // 小文件才值得压；.mca 之类的 region 文件本身已是 zlib 压缩，再压纯浪费时间
    if (raw.length > 0 && raw.length <= 512 * 1024) {
      try {
        const def = zlib.deflateRawSync(raw, { level: 6 });
        if (def.length < raw.length) { comp = def; method = 8; }
      } catch { /* 压不动就原样存储 */ }
    }

    const crc = crc32(raw);
    const flags = 0x0800;   // UTF-8 文件名
    const dosTime = 0, dosDate = 0x21;  // 1980-01-01，固定值即可

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);            // version needed
    lh.writeUInt16LE(flags, 6);
    lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(dosTime, 10);
    lh.writeUInt16LE(dosDate, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);
    locals.push(lh, nameBuf, comp);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(flags, 8);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt16LE(dosTime, 12);
    ch.writeUInt16LE(dosDate, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt16LE(0, 30);   // extra
    ch.writeUInt16LE(0, 32);   // comment
    ch.writeUInt16LE(0, 34);   // disk
    ch.writeUInt16LE(0, 36);   // internal attr
    ch.writeUInt32LE(0, 38);   // external attr
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, nameBuf);

    offset += lh.length + nameBuf.length + comp.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralBuf, eocd]);
}

let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

/** 递归收集目录下所有文件为 zip 条目 */
export async function collectDirEntries(dir, prefix = '') {
  const out = [];
  let items = [];
  try { items = await fsp.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const it of items) {
    const fp = path.join(dir, it.name);
    const name = prefix ? `${prefix}/${it.name}` : it.name;
    if (it.isDirectory()) {
      out.push(...await collectDirEntries(fp, name));
    } else {
      try {
        const data = await fsp.readFile(fp);
        out.push({ name, data });
      } catch { }
    }
  }
  return out;
}

/* ----------------------------------------------------------------- 杂项 */

export function offlineUuid(name) {
  // 与官方离线 UUID 一致: md5("OfflinePlayer:"+name) 设置 version/variant 位
  const md5 = crypto.createHash('md5').update('OfflinePlayer:' + name, 'utf8').digest();
  md5[6] = (md5[6] & 0x0f) | 0x30;
  md5[8] = (md5[8] & 0x3f) | 0x80;
  const h = md5.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function totalMemoryMb() {
  return Math.round(os.totalmem() / 1024 / 1024);
}
export function freeMemoryMb() {
  return Math.round(os.freemem() / 1024 / 1024);
}

export async function dirSize(p) {
  let sum = 0;
  try {
    const items = await fsp.readdir(p, { withFileTypes: true });
    for (const it of items) {
      const fp = path.join(p, it.name);
      if (it.isDirectory()) sum += await dirSize(fp);
      else { try { sum += (await fsp.stat(fp)).size; } catch { } }
    }
  } catch { }
  return sum;
}

export function safeName(s) {
  return String(s).replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
}

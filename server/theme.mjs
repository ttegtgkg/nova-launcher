/**
 * 自定义主题与壁纸。
 *
 * 主题的作法：整套配色本来就是一组 CSS 变量（见 style.css 的 :root），
 * 所以「自定义主题」本质就是「一组变量覆盖值」。内置主题写在 CSS 里，
 * 自定义主题存在 data/themes/*.json，运行时动态注入一条
 *   :root[data-theme="custom-xxx"] { ... }
 * 两者走完全相同的选择器路径，因此热切换、渐变过渡、预览色块全部天然一致。
 *
 * 支持两种文件格式，用户写哪种都行：
 *   .json —— {"name":"...","vars":{"--bg":"#111","--accent":"#f0f"}}
 *            也接受扁平写法 {"name":"...","bg":"#111","accent":"#f0f"}
 *   .html —— 里面写 <style>:root{--bg:#111}</style>，主题名从
 *            <meta name="nova-theme" content="..."> 或 <title> 取
 *   .css  —— 直接就是 CSS 文本
 *
 * 壁纸则是把用户选的图片复制进 data/wallpapers/，前端用一层 fixed 的
 * div 铺底，再叠一层跟随主题的背景色遮罩（保证文字永远读得清）。
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA, readJson, writeJson, exists, loadConfig, saveConfig } from './core.mjs';

const THEME_DIR = path.join(DATA, 'themes');
const WALL_DIR = path.join(DATA, 'wallpapers');

/* ============================================================ 主题 */

/** 允许被主题覆盖的变量名（防止往页面里塞奇怪的东西） */
const VAR_NAME = /^--[a-z0-9-]{1,40}$/i;
/** 变量值的清洗：不许出现能提前结束声明或注入的字符 */
const VAR_VALUE_OK = (v) => typeof v === 'string'
  && v.length > 0 && v.length <= 400
  && !/[;{}<>\\]/.test(v)
  && !/expression|javascript:/i.test(v);

/** 常用简写 → 真实变量名，方便手写 */
const SHORTHAND = {
  bg: '--bg', background: '--bg', accent: '--accent', accent2: '--accent-2',
  text: '--text', dim: '--text-dim', mute: '--text-mute',
  ok: '--ok', warn: '--warn', danger: '--danger',
  panel: '--panel', panel2: '--panel-2', card: '--card', stroke: '--stroke',
  gradA: '--grad-a', gradB: '--grad-b', glowA: '--glow-a', glowB: '--glow-b',
};

function normalizeVarName(k) {
  const s = String(k).trim();
  if (VAR_NAME.test(s)) return s;
  if (SHORTHAND[s]) return SHORTHAND[s];
  const guess = '--' + s.replace(/^--/, '').replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/_/g, '-').toLowerCase();
  return VAR_NAME.test(guess) ? guess : null;
}

/** 从任意对象里捞变量，支持 vars 嵌套和扁平两种写法 */
function collectVars(obj, out = {}) {
  if (!obj || typeof obj !== 'object') return out;
  const bag = (obj.vars && typeof obj.vars === 'object') ? obj.vars : obj;
  for (const [k, v] of Object.entries(bag)) {
    if (['name', 'desc', 'description', 'vars', 'css', 'base', 'author', 'version'].includes(k)) continue;
    if (typeof v !== 'string') continue;
    const name = normalizeVarName(k);
    if (name && VAR_VALUE_OK(v.trim())) out[name] = v.trim();
  }
  return out;
}

/** 从一段 CSS 里抠出 `--xxx: value;` */
function varsFromCss(css) {
  const out = {};
  const re = /(--[a-z0-9-]{1,40})\s*:\s*([^;{}]+)/gi;
  let m;
  while ((m = re.exec(css))) {
    const name = m[1].toLowerCase();
    const val = m[2].trim();
    if (VAR_NAME.test(name) && VAR_VALUE_OK(val)) out[name] = val;
  }
  return out;
}

/**
 * 清洗用户 CSS：本项目主打完全离线，所以顺手挡掉 @import 和外链资源，
 * 免得一个"主题文件"把联网请求带进启动器。
 */
function sanitizeCss(css) {
  if (!css || typeof css !== 'string') return '';
  return css
    .replace(/<\/?style[^>]*>/gi, '')
    .replace(/@import[^;]*;?/gi, '')
    .replace(/url\(\s*['"]?(?:https?:)?\/\/[^)]*\)/gi, 'none')
    .replace(/expression\s*\(/gi, '(')
    .replace(/<\/?\w+/g, '')
    .slice(0, 40000)
    .trim();
}

/** 从 <style> 里取内容 */
function stylesFromHtml(html) {
  const out = [];
  const re = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return out.join('\n');
}

function metaName(html) {
  const m = /<meta[^>]+name=["']nova-theme["'][^>]+content=["']([^"']+)["']/i.exec(html)
    || /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']nova-theme["']/i.exec(html)
    || /<title[^>]*>([^<]+)<\/title>/i.exec(html);
  return m ? m[1].trim() : null;
}

const safeId = (s) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 10);

/**
 * 把用户给的文件解析成一条主题记录。
 * 不抛异常给用户看 JSON 报错，而是尽量猜：先试 JSON，再试 HTML，最后当 CSS。
 */
export function parseThemeFile(filename, text) {
  const name0 = path.basename(String(filename || 'theme')).replace(/\.(json|html?|css|txt)$/i, '');
  let raw = String(text || '').replace(/^\uFEFF/, '').trim();
  if (!raw) throw new Error('文件是空的');

  const lower = String(filename || '').toLowerCase();
  let vars = {};
  let css = '';
  let name = null;
  let desc = '';

  const tryJson = () => {
    // 有些编辑器会存成带注释的 json，先剥掉 // 行注释再试一次
    const candidates = [raw, raw.replace(/^\s*\/\/.*$/gm, '')];
    for (const c of candidates) {
      try {
        const j = JSON.parse(c);
        if (j && typeof j === 'object') return j;
      } catch { }
    }
    return null;
  };

  const json = (lower.endsWith('.json') || /^[[{]/.test(raw)) ? tryJson() : null;

  if (json) {
    vars = collectVars(json);
    name = typeof json.name === 'string' ? json.name.trim() : null;
    desc = typeof json.desc === 'string' ? json.desc.trim()
      : (typeof json.description === 'string' ? json.description.trim() : '');
    css = sanitizeCss(typeof json.css === 'string' ? json.css : '');
  } else {
    // HTML / CSS
    const isHtml = /<style|<html|<meta|<title/i.test(raw) || lower.endsWith('.html') || lower.endsWith('.htm');
    if (isHtml) {
      css = sanitizeCss(stylesFromHtml(raw));
      name = metaName(raw);
      if (!css && /--[a-z0-9-]+\s*:/i.test(raw)) css = sanitizeCss(raw);   // 没写 style 标签也认
    } else {
      css = sanitizeCss(raw);
    }
    vars = varsFromCss(css);
    if (!css) throw new Error('文件里既没有主题变量，也没有可用的 CSS');
  }

  if (!Object.keys(vars).length && !css) {
    throw new Error('没解析出任何主题内容（至少要有一个 --变量: 值）');
  }
  // 一个变量都没抠出来时，剩下的 CSS 必须真的像 CSS，
  // 否则随便一段文字也会被当成主题存进去。
  if (!Object.keys(vars).length && !/[^{}]+\{[^{}]*\}/.test(css)) {
    throw new Error('没找到主题变量，也没有可用的 CSS 规则（至少要有一个 --变量: 值）');
  }

  name = (name || name0 || '未命名主题').slice(0, 24);
  desc = (desc || `来自 ${path.basename(String(filename || '文件'))}`).slice(0, 60);

  const id = 'custom-' + safeId(name + '|' + JSON.stringify(vars).slice(0, 200));
  return {
    id, name, desc, vars, css,
    builtin: false,
    createdAt: Date.now(),
    source: path.basename(String(filename || '')),
  };
}

export async function listCustomThemes() {
  await fsp.mkdir(THEME_DIR, { recursive: true });
  let files = [];
  try { files = await fsp.readdir(THEME_DIR); } catch { return []; }
  const out = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const rec = await readJson(path.join(THEME_DIR, f), null);
    if (rec && rec.id) out.push(rec);
  }
  out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return out;
}

export async function saveTheme(rec) {
  await fsp.mkdir(THEME_DIR, { recursive: true });
  await writeJson(path.join(THEME_DIR, rec.id + '.json'), rec);
  return rec;
}

export async function deleteTheme(id) {
  if (!/^custom-[a-z0-9]{6,20}$/i.test(String(id || ''))) throw new Error('主题 id 不合法');
  const f = path.join(THEME_DIR, id + '.json');
  if (await exists(f)) await fsp.unlink(f);
  const cfg = await loadConfig();
  if (cfg.theme === id) await saveConfig({ theme: 'nova' });
  return { ok: true, theme: 'nova' };
}

/* ============================================================ 壁纸 */

const WALL_EXT = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp', '.avif': 'image/avif' };
const WALL_MAX = 24 * 1024 * 1024;

const clampNum = (v, lo, hi, dflt) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
};

/** 只保留该落盘的字段，别把 has/url/mime 这些派生值写进 config.json */
function persistable(w = {}) {
  return {
    file: w.file || null,
    opacity: clampNum(w.opacity, 0.05, 1, 1),
    blur: clampNum(w.blur, 0, 24, 0),
    dim: clampNum(w.dim, 0, 92, 55),
    fit: ['cover', 'contain', 'auto'].includes(w.fit) ? w.fit : 'cover',
    pos: typeof w.pos === 'string' ? w.pos : 'center',
    updatedAt: w.updatedAt || 0,
  };
}

export function wallpaperPublic(cfg) {
  const w = { ...(cfg.wallpaper || {}) };
  const has = !!(w.file && WALL_EXT[path.extname(w.file).toLowerCase()]);
  return {
    has,
    file: has ? w.file : null,
    url: has ? `/api/wallpaper/file?v=${encodeURIComponent(w.updatedAt || 0)}` : null,
    mime: has ? WALL_EXT[path.extname(w.file).toLowerCase()] : null,
    opacity: clampNum(w.opacity, 0.05, 1, 1),
    blur: clampNum(w.blur, 0, 24, 0),
    dim: clampNum(w.dim, 0, 92, 55),
    fit: ['cover', 'contain', 'auto'].includes(w.fit) ? w.fit : 'cover',
    pos: typeof w.pos === 'string' ? w.pos : 'center',
    updatedAt: w.updatedAt || 0,
  };
}

export async function getWallpaper() {
  return wallpaperPublic(await loadConfig());
}

export async function setWallpaper(buf, filename) {
  if (!buf || !buf.length) throw new Error('没收到图片数据');
  if (buf.length > WALL_MAX) throw new Error(`图片超过 ${Math.round(WALL_MAX / 1048576)} MB，换小一点的`);
  const ext = path.extname(String(filename || '')).toLowerCase();
  if (!WALL_EXT[ext]) throw new Error('只支持 jpg / png / webp / gif / bmp / avif');

  // 认一下文件头，别把改了扩展名的 zip 塞进来
  const head = buf.slice(0, 16);
  const isJpg = head[0] === 0xFF && head[1] === 0xD8;
  const isPng = head.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]));
  const isGif = head.slice(0, 3).toString('latin1') === 'GIF';
  const isWebp = head.slice(0, 4).toString('latin1') === 'RIFF' && head.slice(8, 12).toString('latin1') === 'WEBP';
  const isBmp = head.slice(0, 2).toString('latin1') === 'BM';
  if (!(isJpg || isPng || isGif || isWebp || isBmp)) throw new Error('这不是一张图片（文件头对不上）');

  await fsp.mkdir(WALL_DIR, { recursive: true });
  const file = `wall-${crypto.createHash('sha1').update(buf).digest('hex').slice(0, 12)}${ext}`;
  await fsp.writeFile(path.join(WALL_DIR, file), buf);

  const cfg = await loadConfig();
  const next = { ...persistable(cfg.wallpaper), file, updatedAt: Date.now() };
  // 换图后清掉旧图，别越攒越多
  const old = cfg.wallpaper?.file;
  if (old && old !== file && /^wall-[a-f0-9]{8,20}\.\w+$/i.test(old)) {
    try { await fsp.unlink(path.join(WALL_DIR, old)); } catch { }
  }
  await saveConfig({ wallpaper: next });
  return (await getWallpaper());
}

export async function updateWallpaper(patch) {
  const cfg = await loadConfig();
  const cur = persistable(cfg.wallpaper);
  const next = {
    ...cur,
    opacity: clampNum(patch.opacity ?? cur.opacity, 0.05, 1, 1),
    blur: clampNum(patch.blur ?? cur.blur, 0, 24, 0),
    dim: clampNum(patch.dim ?? cur.dim, 0, 92, 55),
    fit: ['cover', 'contain', 'auto'].includes(patch.fit) ? patch.fit : (cur.fit || 'cover'),
    pos: typeof patch.pos === 'string' && patch.pos.length < 30 ? patch.pos : (cur.pos || 'center'),
  };
  await saveConfig({ wallpaper: next });
  return (await getWallpaper());
}

export async function clearWallpaper() {
  const cfg = await loadConfig();
  const old = cfg.wallpaper?.file;
  if (old && /^wall-[a-f0-9]{8,20}\.\w+$/i.test(old)) {
    try { await fsp.unlink(path.join(WALL_DIR, old)); } catch { }
  }
  await saveConfig({ wallpaper: { ...persistable(cfg.wallpaper), file: null, updatedAt: Date.now() } });
  return (await getWallpaper());
}

export async function wallpaperPath(file) {
  if (!/^wall-[a-f0-9]{8,20}\.\w+$/i.test(String(file || ''))) return null;
  const p = path.join(WALL_DIR, file);
  return (await exists(p)) ? p : null;
}

export const WALLPAPER_MIME = WALL_EXT;
export const THEMES_DIR = THEME_DIR;
export const WALLPAPER_DIR = WALL_DIR;

/* ============================================================ 示例模板 */

/** 「下载示例模板」用的两份文件内容 */
export const THEME_SAMPLE_JSON = `{
  "name": "示例 · 熔岩",
  "desc": "深黑底 + 熔岩橙，红蓝对比",
  "vars": {
    "--bg": "#0b0604",
    "--panel": "#140c08",
    "--panel-2": "#1a100a",
    "--accent": "#ff6b1a",
    "--accent-2": "#ffd166",
    "--grad-a": "#ff4d00",
    "--grad-b": "#ffb703",
    "--text": "#fdf2e6",
    "--text-dim": "#bda78f",
    "--text-mute": "#7a6653",
    "--glow-a": "#c2410c",
    "--glow-b": "#a16207",
    "--glow-c": "#7f1d1d",
    "--glow-opacity": "0.45",
    "--glow-c-opacity": "0.2"
  }
}
`;

export const THEME_SAMPLE_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <!-- 主题名写在这里，启动器会读出来 -->
  <meta name="nova-theme" content="示例 · 极光">
  <title>示例 · 极光</title>
  <style>
    :root {
      --bg: #04070c;
      --panel: #081019;
      --panel-2: #0b1622;
      --accent: #2dd4bf;
      --accent-2: #a78bfa;
      --grad-a: #14b8a6;
      --grad-b: #8b5cf6;
      --text: #e6f7f5;
      --text-dim: #86a5a8;
      --text-mute: #52706f;
    }
    /* 除了改配色，也能加自己的样式（纯本地，不会联网） */
    .btn { border-radius: 12px; }
  </style>
</head>
<body></body>
</html>
`;

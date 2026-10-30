// translate.mjs —— 简介翻译（MyMemory 免费接口 + 本地缓存）
//
// 为什么用 MyMemory：
//   - Google translate 的 gtx 端点在当前网络下不可达（实测超时）
//   - 微软 Edge 翻译端点需要授权（实测 401）
//   - MyMemory 免费、无需 key、支持 en->zh-CN，实测 2 秒返回且译文质量可用
// 限制：单次请求约 500 字符，匿名有每日配额，所以这里做「分段 + 磁盘缓存」。
import crypto from 'node:crypto';
import path from 'node:path';
import { CACHE, readJson, writeJson, httpText } from './core.mjs';

const CACHE_FILE = path.join(CACHE, 'translations.json');
const MAX_LEN = 450;          // 单次请求安全长度
const MAX_TOTAL = 6000;       // 单条文本最多翻这么多字符，超出的直接截断

let memCache = null;          // 内存缓存（避免每次读盘）

async function loadCache() {
  if (memCache) return memCache;
  memCache = (await readJson(CACHE_FILE, {})) || {};
  return memCache;
}

let saveTimer = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    try { await writeJson(CACHE_FILE, memCache || {}); } catch { }
  }, 1500);
}

function cacheKey(text, to) {
  return crypto.createHash('sha1').update(to + '|' + text, 'utf8').digest('hex').slice(0, 24);
}

/** 按句子切分成 <= MAX_LEN 的片段 */
function splitChunks(text) {
  const clean = String(text).replace(/\s+/g, ' ').trim();
  if (clean.length <= MAX_LEN) return [clean];

  const parts = [];
  // 先按句末标点切
  const sentences = clean.split(/(?<=[.!?。！？;；])\s+/);
  let buf = '';
  for (const s of sentences) {
    if ((buf + ' ' + s).trim().length <= MAX_LEN) {
      buf = (buf ? buf + ' ' : '') + s;
      continue;
    }
    if (buf) parts.push(buf);
    if (s.length <= MAX_LEN) { buf = s; continue; }
    // 单句仍超长：按空格硬切
    const words = s.split(' ');
    let w = '';
    for (const word of words) {
      if ((w + ' ' + word).trim().length <= MAX_LEN) w = (w ? w + ' ' : '') + word;
      else { if (w) parts.push(w); w = word; }
    }
    buf = w;
  }
  if (buf) parts.push(buf);
  return parts.filter(Boolean);
}

async function translateChunk(chunk, to) {
  const url = 'https://api.mymemory.translated.net/get'
    + '?q=' + encodeURIComponent(chunk)
    + '&langpair=' + encodeURIComponent('en|' + to);
  const txt = await httpText(url, { source: 'official', timeout: 20000 });
  const j = JSON.parse(txt);
  const status = Number(j.responseStatus);
  if (status !== 200) {
    const msg = j.responseDetails || ('翻译服务返回 ' + status);
    throw new Error(String(msg).slice(0, 160));
  }
  const out = j.responseData && j.responseData.translatedText;
  if (!out) throw new Error('翻译服务没有返回内容');
  // MyMemory 在超配额时会把提示塞进 translatedText
  if (/MYMEMORY WARNING|QUERY LENGTH LIMIT|YOU USED ALL AVAILABLE FREE/i.test(out)) {
    throw new Error('翻译服务今日配额已用完，请明天再试');
  }
  return out;
}

/**
 * 翻译一段文本。
 * @returns {Promise<{text:string, cached:boolean, engine:string, truncated:boolean}>}
 */
export async function translateText(raw, to = 'zh-CN') {
  let text = String(raw || '').trim();
  if (!text) return { text: '', cached: false, engine: 'none', truncated: false };

  let truncated = false;
  if (text.length > MAX_TOTAL) { text = text.slice(0, MAX_TOTAL); truncated = true; }

  const cache = await loadCache();
  const key = cacheKey(text, to);
  if (cache[key]) return { text: cache[key], cached: true, engine: 'MyMemory', truncated };

  const chunks = splitChunks(text);
  const out = [];
  for (const c of chunks) {
    // 每个分片也查缓存
    const ck = cacheKey(c, to);
    if (cache[ck]) { out.push(cache[ck]); continue; }
    const r = await translateChunk(c, to);
    cache[ck] = r;
    out.push(r);
  }
  const joined = out.join(' ').replace(/\s+/g, ' ').trim();
  cache[key] = joined;
  scheduleSave();
  return { text: joined, cached: false, engine: 'MyMemory', truncated };
}

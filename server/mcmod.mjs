// mcmod.mjs —— 中文名 → 平台英文名，来源是 MC百科
//
// 为什么需要它：CurseForge 的搜索接口对中文是「静默忽略」的，传「化龙」过去
// 等于没传搜索词，它会按人气把全部整合包倒序吐回来；Modrinth 那边也没有中文名。
// 想让用户用中文搜到东西，必须先有个中文 → 英文的映射表。
//
// MC百科的搜索结果页里，条目链接的文字就是「化龍 (BeLoong)」这种形式，
// 一次请求就能同时拿到中文名和官方英文名，不需要再点进项目页。
//
// 查到的东西会落到 <数据目录>/mcmod-cn.json —— 既是缓存（少打人家服务器），
// 也是一份可以直接手改的词典。

import path from 'node:path';
import fsp from 'node:fs/promises';
import { DATA, httpText, readJson, writeJson } from './core.mjs';

const CACHE_FILE = path.join(DATA, 'mcmod-cn.json');
const TTL_MS = 30 * 24 * 3600 * 1000;   // 查到了：30 天
// 查不到：只记 10 分钟。之前失败也按 30 天缓存，结果一次网络抖动
// （或抓取逻辑改过）就能把某个词永久钉死在「查不到」上，改代码都不生效。
const NEG_TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 4000;
// MC百科对短时间内连续请求会直接拒绝（实测第二个请求 ~100ms 就失败），
// 所以自己排个队，别把人家服务器跟自己的命中率都搞砸
const MIN_GAP_MS = 1200;
let _lastFetch = 0;

let cache = null;
let loading = null;

async function load() {
  if (cache) return cache;
  if (loading) return loading;
  loading = readJson(CACHE_FILE, {}).then(j => {
    cache = (j && typeof j === 'object') ? j : {};
    return cache;
  }).catch(() => { cache = {}; return cache; });
  return loading;
}

async function persist() {
  try {
    const keys = Object.keys(cache || {});
    if (keys.length > MAX_ENTRIES) {
      // 按时间戳留最近的，别让文件无限长
      keys.sort((a, b) => (cache[b]?.at || 0) - (cache[a]?.at || 0));
      for (const k of keys.slice(MAX_ENTRIES)) delete cache[k];
    }
    await writeJson(CACHE_FILE, cache);
  } catch { /* 写不进去不影响搜索 */ }
}

/** 从「化龍 (BeLoong)」里拆出中文名和英文名 */
function splitTitle(text) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  const m = /^(.+?)\s*[（(]\s*([^()（）]{1,60}?)\s*[)）]\s*$/.exec(s);
  if (m) return { cn: m[1].trim(), en: m[2].trim() };
  return { cn: s, en: null };
}

/**
 * 去 MC百科找一个中文名的官方英文名。
 * @returns {Promise<{cn:string,en:string,url:string}|null>}
 */
export async function lookupMcmod(query) {
  const q = String(query || '').trim();
  if (!q) return null;

  const db = await load();
  const hit = db[q];
  if (hit) {
    const ttl = hit.en ? TTL_MS : NEG_TTL_MS;
    if (Date.now() - (hit.at || 0) < ttl) {
      return hit.en ? { cn: hit.cn, en: hit.en, url: hit.url || null, cached: true } : null;
    }
  }

  try {
    const url = 'https://search.mcmod.cn/s?key=' + encodeURIComponent(q);
    // 节流：两次请求至少隔 MIN_GAP_MS，连点搜索时第二个就不会被人家拒掉
    const wait = Math.max(0, MIN_GAP_MS - (Date.now() - _lastFetch));
    if (wait) await new Promise(r => setTimeout(r, wait));
    _lastFetch = Date.now();
    const html = await httpText(url, { source: 'official', timeout: 12000 });
    // 结果条目形如：
    // <div class="result-item"><div class="head"><a ... href="https://www.mcmod.cn/modpack/1170.html">化龍 (BeLoong)</a>
    // 命中的关键词会被包成 <em>，所以链接文字里可能夹标签
    // （「[AS] <em>星辉</em><em>魔法</em> (Astral Sorcery)」），得先剥掉再解析
    const re = /<a[^>]+href="(https?:\/\/www\.mcmod\.cn\/(?:modpack|class)\/\d+\.html)"[^>]*>([\s\S]{1,300}?)<\/a>/g;
    let m;
    const seen = [];
    while ((m = re.exec(html)) && seen.length < 6) {
      const link = m[1];
      if (seen.some(x => x.url === link)) continue;
      const text = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      const parsed = splitTitle(text);
      if (!parsed) continue;
      seen.push({ url: link, ...parsed });
    }

    // 优先挑带英文名的条目（纯中文名的对搜索没用）
    const withEn = seen.find(x => x.en && /[a-zA-Z]/.test(x.en));
    const pick = withEn || null;

    db[q] = {
      cn: pick?.cn || seen[0]?.cn || q,
      en: pick?.en || null,
      url: pick?.url || seen[0]?.url || null,
      at: Date.now(),
    };
    await persist();

    return pick ? { cn: pick.cn, en: pick.en, url: pick.url } : null;
  } catch {
    // 网络不通 / 页面改版：不要缓存失败，下次还能再试
    return null;
  }
}

/** 只读缓存，不发请求（给需要同步判断的地方用） */
export async function lookupMcmodCached(query) {
  const db = await load();
  const hit = db[String(query || '').trim()];
  if (!hit || !hit.en) return null;
  if (Date.now() - (hit.at || 0) > TTL_MS) return null;
  return { cn: hit.cn, en: hit.en, url: hit.url || null, cached: true };
}
/** 列出已收录的条目（设置页展示 / 用户手改时参考） */
export async function listMcmodCache() {
  const db = await load();
  return Object.entries(db)
    .filter(([, v]) => v && v.en)
    .map(([k, v]) => ({ query: k, cn: v.cn, en: v.en, url: v.url || null, at: v.at || 0 }))
    .sort((a, b) => b.at - a.at);
}

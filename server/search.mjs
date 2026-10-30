// search.mjs —— 本地模糊搜索兜底
//
// 为什么需要它：
//   Modrinth 自己的搜索支持「前缀/部分词」（"sodi" 能找到 Sodium），
//   但**不支持拼写纠错**——实测 "soduim" 返回 0 条。
//   所以这里维护一份热门内容的本地索引，用编辑距离/子序列做近似匹配，
//   搜不到时把"大概是它"的结果补进来。
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { CACHE, readJson, writeJson, httpJson } from './core.mjs';

const INDEX_FILE = path.join(CACHE, 'modrinth-index.json');
const INDEX_TTL = 1000 * 60 * 60 * 12;    // 12 小时
const MAX_PAGES = 20;                      // 20 * 100 = 2000 条热门

let memIndex = null;
let building = null;

/* --------------------------------------------------------------- 索引构建 */

async function loadIndex() {
  if (memIndex) return memIndex;
  const disk = await readJson(INDEX_FILE, null);
  if (disk && Array.isArray(disk.items) && Date.now() - (disk.at || 0) < INDEX_TTL) {
    memIndex = disk;
    return memIndex;
  }
  return null;
}

/**
 * 构建/刷新索引（按下载量取热门内容）。
 * @param {(msg:string)=>void} log
 */
export async function buildIndex(log = () => { }) {
  if (building) return building;
  building = (async () => {
    const items = [];
    const seen = new Set();
    for (let page = 0; page < MAX_PAGES; page++) {
      const offset = page * 100;
      const url = `https://api.modrinth.com/v2/search?limit=100&offset=${offset}&index=downloads`;
      // 首次请求常常卡在 DNS/TLS 上，重试几次比直接放弃靠谱
      let r = null;
      let lastErr = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          r = await httpJson(url, { source: 'official', timeout: 30000 });
          break;
        } catch (e) {
          lastErr = e;
          await new Promise(res => setTimeout(res, 800 * (attempt + 1)));
        }
      }
      if (!r) {
        log(`索引第 ${page + 1} 页失败：${lastErr ? lastErr.message : '未知错误'}`);
        if (page === 0) throw lastErr || new Error('索引第一页就失败了');
        break;
      }
      const hits = r.hits || [];
      for (const h of hits) {
        if (!h.slug || seen.has(h.slug)) continue;
        seen.add(h.slug);
        items.push({
          id: h.project_id, slug: h.slug, title: h.title,
          type: h.project_type, downloads: h.downloads || 0,
          cn: null,   // 中文名由调用方按需补（避免这里依赖 i18n）
        });
      }
      log(`已索引 ${items.length} 条`);
      if (hits.length < 100) break;
    }
    const data = { at: Date.now(), items };
    memIndex = data;
    try { await writeJson(INDEX_FILE, data); } catch { }
    return data;
  })().finally(() => { building = null; });
  return building;
}

export async function indexStatus() {
  const idx = await loadIndex();
  return {
    ready: Boolean(idx),
    count: idx ? idx.items.length : 0,
    builtAt: idx ? idx.at : null,
    building: Boolean(building),
  };
}

/* ------------------------------------------------------------- 模糊匹配 */

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array(b.length + 1);
  let cur = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    const t = prev; prev = cur; cur = t;
  }
  return prev[b.length];
}

/** q 是否是 t 的子序列（如 "sdm" 是 "sodium" 的子序列） */
function isSubsequence(q, t) {
  let i = 0;
  for (let j = 0; j < t.length && i < q.length; j++) if (t[j] === q[i]) i++;
  return i === q.length;
}

/**
 * 给「查询」和「候选名」打分；0 表示不相关。
 * 分值只用于排序，不追求精确。
 */
function score(q, target) {
  const norm = (s) => String(s || '').toLowerCase().replace(/[\s\-_'.]/g, '');
  const a = norm(q);
  const b = norm(target);
  if (!a || !b) return 0;

  // 1) 完全一致 / 前缀 / 包含 —— 最可靠的三类
  if (b === a) return 100;
  if (b.startsWith(a)) return 92;
  if (b.includes(a)) return 84;

  // 2) 词首缩写（"rei" 对 "Roughly Enough Items"）
  const initials = String(target || '').toLowerCase()
    .split(/[\s\-_]+/).filter(Boolean).map(w => w[0]).join('');
  if (initials && initials === a) return 78;

  // 3) 拼写错误：编辑距离。优先于子序列，因为它更能代表"就是它"。
  if (a.length >= 4) {
    const maxLen = Math.max(a.length, b.length);
    const d = levenshtein(a, b);
    const errRate = d / maxLen;
    const allowed = maxLen <= 8 ? 2 : maxLen <= 12 ? 3 : 4;
    // 同时要求「错误数不超过 allowed」且「错误率不超过 35%」，避免短词乱撞
    if (d <= allowed && errRate <= 0.35) {
      return 70 + Math.round((1 - errRate) * 18);
    }
  }

  // 4) 子序列（"sdm" 在 "sodium" 里）。要求够长且覆盖率够，否则噪音太大。
  if (a.length >= 5 && b.length >= a.length && isSubsequence(a, b)) {
    const ratio = a.length / b.length;
    if (ratio >= 0.55) return 52;
    if (ratio >= 0.4) return 44;
  }
  return 0;
}

/**
 * 在本地索引里找近似项。
 * @returns {Promise<Array<{slug,title,type,downloads,score}>>}
 */
export async function fuzzyLookup(query, { limit = 6, types = null, preferSlugs = [] } = {}) {
  const idx = await loadIndex();
  if (!idx || !query) return [];
  const prefer = new Set(preferSlugs);
  const out = [];
  for (const it of idx.items) {
    if (types && types.length && !types.includes(it.type)) continue;
    // slug 和标题都算分，取高的
    const s = Math.max(score(query, it.title), score(query, it.slug));
    if (s <= 0) continue;
    out.push({
      slug: it.slug, title: it.title, type: it.type,
      downloads: it.downloads, id: it.id,
      score: prefer.has(it.slug) ? s + 1 : s,
    });
  }
  // 低于这个分数的就不补了，免得塞一堆无关结果
  const filtered = out.filter(x => x.score >= 50);
  filtered.sort((a, b) => (b.score - a.score) || (b.downloads - a.downloads));
  return filtered.slice(0, limit);
}

/** 名字是否"看起来需要模糊兜底"（很短 / 结果太少） */
export function needsFuzzy(query, hitCount) {
  const q = String(query || '').trim();
  if (!q) return false;
  if (hitCount === 0) return true;
  if (q.length <= 2) return false;       // 太短就别乱猜了
  return hitCount < 3;
}

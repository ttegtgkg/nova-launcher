/* ============================================================
   Nova Launcher · 前端逻辑
   纯原生 JS，无框架、无依赖
   ============================================================ */
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};

/* ------------------------------------------------------------ API */

async function apiGet(url) {
  const r = await fetch(url);
  const j = await r.json().catch(() => ({ ok: false, error: '响应解析失败' }));
  if (!j.ok) throw new Error(j.error || '请求失败');
  return j;
}
async function apiPost(url, body) {
  const r = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
  });
  const j = await r.json().catch(() => ({ ok: false, error: '响应解析失败' }));
  if (!j.ok) throw new Error(j.error || '请求失败');
  return j;
}
function apiUpload(url, file) {
  return fetch(url, {
    method: 'POST',
    headers: { 'X-Filename': encodeURIComponent(file.name) },
    body: file,
  }).then(r => r.json()).then(j => { if (!j.ok) throw new Error(j.error); return j; });
}

/* ------------------------------------------------------------ 状态 */

const S = {
  page: 'home',
  status: null,
  config: {},
  instances: [],
  selected: null,
  versions: [],
  latest: null,
  installed: [],
  kind: 'mod',
  contents: [],
  tasks: [],
  handled: new Set(),
  logSince: 0,
  logs: [],
  running: null,
  mrHits: [],
  mrTotal: 0,
  packHits: [],
  optimize: null,
  dlMode: 'vanilla',
  noticeShown: false,
  dlHistory: [],
  dlRunning: [],
  dlFilter: 'all',
};

const JVM_PRESETS = {};    // 由 /api/optimize 填充

/* ------------------------------------------------------------ 主题 */

const BUILTIN_THEMES = [
  { key: 'nova', name: 'Nova', desc: '深空紫青 · 默认', bg: '#07080d', a: '#7c3aed', b: '#06b6d4', dot: '#22d3ee' },
  { key: 'midnight', name: '极夜', desc: '银灰冷调 · 克制', bg: '#08090a', a: '#475569', b: '#cbd5e1', dot: '#e2e8f0' },
  { key: 'ocean', name: '深海', desc: '蓝青 · 安静专注', bg: '#04090f', a: '#1d4ed8', b: '#06b6d4', dot: '#22d3ee' },
  { key: 'sunset', name: '落日', desc: '橙粉 · 温暖', bg: '#0d0705', a: '#ea580c', b: '#db2777', dot: '#ec4899' },
  { key: 'forest', name: '森野', desc: '绿青柠 · 清爽', bg: '#050a07', a: '#059669', b: '#65a30d', dot: '#a3e635' },
  { key: 'cherry', name: '樱花', desc: '紫粉 · 柔和', bg: '#0b0610', a: '#db2777', b: '#9333ea', dot: '#ec4899' },
  { key: 'light', name: '晨曦', desc: '浅色 · 适合白天', bg: '#eef2f9', a: '#6366f1', b: '#0ea5e9', dot: '#0ea5e9' },
].map(t => ({ ...t, builtin: true }));

/** 自定义主题（从服务端拉，带本地缓存以便首屏就能应用） */
let CUSTOM_THEMES = [];
let THEMES = BUILTIN_THEMES.slice();

/** 把一条自定义主题换算成卡片预览需要的三个颜色 */
function themeSwatches(t) {
  const v = t.vars || {};
  const pick = (...keys) => { for (const k of keys) if (v[k]) return v[k]; return null; };
  return {
    bg: pick('--bg', '--panel') || '#111318',
    a: pick('--grad-a', '--accent') || '#7c3aed',
    b: pick('--grad-b', '--accent-2') || '#06b6d4',
    dot: pick('--accent-2', '--accent') || '#22d3ee',
  };
}

function normalizeCustom(rec) {
  const sw = themeSwatches(rec);
  return {
    key: rec.id, id: rec.id, name: rec.name || '自定义主题',
    desc: rec.desc || '自定义', builtin: false,
    vars: rec.vars || {}, css: rec.css || '',
    bg: sw.bg, a: sw.a, b: sw.b, dot: sw.dot,
  };
}

function rebuildThemeList(list) {
  CUSTOM_THEMES = (list || []).map(normalizeCustom);
  THEMES = BUILTIN_THEMES.concat(CUSTOM_THEMES);
  try { localStorage.setItem('nova.themes', JSON.stringify(CUSTOM_THEMES)); } catch { }
}

/** 注入 / 清空自定义主题的样式表。切换主题时整段替换，不会残留污染别的主题。 */
function injectCustomTheme(t) {
  let st = document.getElementById('nova-custom-theme');
  if (!st) {
    st = document.createElement('style');
    st.id = 'nova-custom-theme';
    document.head.appendChild(st);
  }
  if (!t || t.builtin) { st.textContent = ''; return; }
  const decls = Object.entries(t.vars || {})
    .map(([k, v]) => `${k}:${v};`).join('');
  st.textContent =
    (decls ? `:root[data-theme="${t.key}"]{${decls}}\n` : '') + (t.css || '');
}

function findTheme(key) { return THEMES.find(x => x.key === key) || THEMES[0]; }

function applyTheme(key, announce = false, persist = true) {
  const t = findTheme(key);
  injectCustomTheme(t);
  document.documentElement.dataset.theme = t.key;
  if (persist) {
    try { localStorage.setItem('nova.theme', t.key); } catch { }
    apiPost('/api/config', { theme: t.key }).catch(() => { });
  }
  const cur = $('#themeCurrent');
  if (cur) cur.textContent = t.name;
  $$('.theme-card').forEach(c => c.classList.toggle('active', c.dataset.theme === t.key));
  if (announce) toast('主题已切换', t.name + ' · ' + t.desc, 'ok', 2200);
}

function renderThemeGrid() {
  const grid = $('#themeGrid');
  if (!grid) return;
  const active = document.documentElement.dataset.theme || 'nova';
  grid.innerHTML = THEMES.map(t => `
    <button class="theme-card ${t.key === active ? 'active' : ''}" data-theme="${esc(t.key)}">
      <div class="theme-preview" style="background:${esc(t.bg)}">
        <div class="tp-dot" style="background:${esc(t.dot)}"></div>
        <div class="tp-bar" style="background:linear-gradient(90deg,${esc(t.a)},${esc(t.b)})"></div>
      </div>
      <div class="theme-name"><span>${esc(t.name)}</span><span class="tick">✓</span></div>
      <div class="theme-desc">${esc(t.desc)}</div>
      ${t.builtin ? '' : `<span class="tc-badge">自定义</span>
        <span class="tc-del" data-tdel="${esc(t.key)}" title="删除这个主题">×</span>`}
    </button>`).join('');

  $$('.theme-card', grid).forEach(b => b.onclick = (e) => {
    if (e.target.closest('[data-tdel]')) return;
    applyTheme(b.dataset.theme, true);
  });
  $$('[data-tdel]', grid).forEach(x => x.onclick = async (e) => {
    e.stopPropagation();
    const id = x.dataset.tdel;
    const t = THEMES.find(v => v.key === id);
    openModal(`<h2>删除主题「${esc(t?.name || id)}」？</h2>
      <p class="modal-sub">文件 <code>data/themes/${esc(id)}.json</code> 会被删除，不可恢复。</p>`, {
      okText: '删除', onOk: async () => {
        try {
          const r = await apiPost('/api/themes/delete', { id });
          await loadThemes();
          if (r.theme) applyTheme(r.theme, false);
          toast('主题已删除', '', 'ok');
        } catch (err) { toast('删除失败', err.message, 'error'); }
      },
    });
  });
}

/** 从服务端同步自定义主题列表 */
async function loadThemes() {
  try {
    const r = await apiGet('/api/themes');
    rebuildThemeList(r.themes);
    renderThemeGrid();
    return r;
  } catch {
    return null;
  }
}

/** 导入一个主题文件（文本） */
async function importThemeFile(filename, text) {
  try {
    const r = await apiPost('/api/themes/import', { filename, text, apply: true });
    await loadThemes();
    applyTheme(r.theme.id, false);
    const n = Object.keys(r.theme.vars || {}).length;
    toast('主题已导入并应用', `${r.theme.name} · ${n} 个配色项`, 'ok', 5000);
    return true;
  } catch (e) {
    toast('导入失败', filename + '：' + e.message, 'error', 7000);
    return false;
  }
}

/* ------------------------------------------------------------ 壁纸 */

const WP_DEFAULT = { has: false, url: null, opacity: 1, blur: 0, dim: 55, fit: 'cover', pos: 'center', file: null };
let WP = { ...WP_DEFAULT };

/** 把壁纸设置写成 CSS 变量；这是唯一改画面的地方 */
function applyWallpaper(wp) {
  WP = { ...WP_DEFAULT, ...(wp || {}) };
  const root = document.documentElement;
  if (!WP.has || !WP.url) {
    root.dataset.wallpaper = 'off';
    root.style.setProperty('--wp-image', 'none');
  } else {
    root.dataset.wallpaper = 'on';
    root.style.setProperty('--wp-image', `url("${WP.url}")`);
  }
  root.style.setProperty('--wp-opacity', String(WP.opacity));
  root.style.setProperty('--wp-blur', WP.blur + 'px');
  root.style.setProperty('--wp-dim', WP.dim + '%');
  root.style.setProperty('--wp-size', WP.fit);
  root.style.setProperty('--wp-pos', WP.pos || 'center');
  try { localStorage.setItem('nova.wallpaper', JSON.stringify(WP)); } catch { }
  renderWallpaperPanel();
}

function renderWallpaperPanel() {
  const badge = $('#wallpaperBadge');
  const prev = $('#wallpaperPreview');
  if (!badge || !prev) return;
  badge.textContent = WP.has ? '已启用' : '未设置';
  badge.className = 'badge' + (WP.has ? ' ok' : '');

  if (WP.has && WP.url) {
    prev.classList.remove('empty');
    prev.style.backgroundImage = `url("${WP.url}")`;
    prev.style.backgroundSize = WP.fit;
    $('#wpOverlay').style.display = '';
    $('#wpOverlay').style.setProperty('--wp-dim', WP.dim + '%');
    const tag = $('#wpTag');
    tag.style.display = '';
    tag.textContent = WP.file || '壁纸';
  } else {
    prev.classList.add('empty');
    prev.style.backgroundImage = '';
    $('#wpOverlay').style.display = 'none';
    $('#wpTag').style.display = 'none';
  }

  const set = (id, val, txt) => { const e = $(id); if (e) { e.value = val; } const v = $(id + 'Val'); if (v) v.textContent = txt; };
  set('#wpDim', WP.dim, WP.dim + '%');
  set('#wpOpacity', Math.round(WP.opacity * 100), Math.round(WP.opacity * 100) + '%');
  set('#wpBlur', WP.blur, WP.blur + ' px');
  const fit = $('#wpFit'); if (fit) fit.value = WP.fit;
}

/** 上传一张壁纸图片 */
async function uploadWallpaper(file) {
  if (!file.type.startsWith('image/') && !/\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(file.name)) {
    toast('这不是图片', file.name, 'warn');
    return false;
  }
  try {
    const r = await apiUpload(`/api/wallpaper/upload?name=${encodeURIComponent(file.name)}`, file);
    applyWallpaper(r);
    toast('壁纸已更换', file.name, 'ok');
    return true;
  } catch (e) {
    toast('壁纸设置失败', e.message, 'error', 6000);
    return false;
  }
}

async function loadWallpaper() {
  try {
    const r = await apiGet('/api/wallpaper');
    applyWallpaper(r);
    return r;
  } catch { return null; }
}


/* ------------------------------------------------------------ 工具 */

const fmtSize = (b) => {
  if (!b) return '0 B';
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
  return (b / 1073741824).toFixed(2) + ' GB';
};
const fmtTime = (t) => {
  if (!t) return '从未';
  const d = new Date(t), now = Date.now(), diff = now - t;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
  if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
  if (diff < 86400000 * 30) return Math.floor(diff / 86400000) + ' 天前';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const fmtDur = (sec) => {
  if (!sec) return '0 分钟';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return h ? `${h} 小时 ${m} 分` : `${m} 分钟`;
};
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const loaderName = (l) => ({ fabric: 'Fabric', forge: 'Forge', neoforge: 'NeoForge', quilt: 'Quilt', vanilla: '原版' }[l] || l || '原版');
const kindName = (k) => ({ mod: '模组', resourcepack: '资源包', shader: '光影包', datapack: '数据包', world: '存档' }[k] || k);

/* ------------------------------------------------------------ Toast */

function toast(title, msg = '', type = 'info', ms = 4200) {
  const t = el('div', `toast ${type}`);
  t.innerHTML = `<span class="t-dot"></span><div class="t-body">
    <div class="t-title">${esc(title)}</div>${msg ? `<div class="t-msg">${esc(msg)}</div>` : ''}</div>`;
  $('#toasts').appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 240); }, ms);
}

/* ------------------------------------------------------------ Modal */

let modalOk = null;
function openModal(html, { onOk, okText = '确定', cancelText = '取消', wide = false } = {}) {
  const box = $('#modalBox');
  box.style.width = wide ? 'min(860px, 94vw)' : '';
  box.innerHTML = html + `<div class="modal-actions">
      <button class="btn btn-ghost" id="mCancel">${esc(cancelText)}</button>
      ${onOk ? `<button class="btn btn-primary" id="mOk">${esc(okText)}</button>` : ''}
    </div>`;
  $('#modalRoot').classList.remove('hidden');
  modalOk = onOk || null;
  $('#mCancel').onclick = closeModal;
  $('#modalMask').onclick = closeModal;
  if (onOk) $('#mOk').onclick = async () => {
    const btn = $('#mOk'); btn.disabled = true;
    try {
      const keep = await onOk(box);
      if (keep !== false) closeModal();
    } catch (e) {
      toast('操作失败', e.message || String(e), 'error', 6000);
    } finally {
      if (document.body.contains(btn)) btn.disabled = false;
    }
  };
  return box;
}
function closeModal() { $('#modalRoot').classList.add('hidden'); $('#modalBox').innerHTML = ''; modalOk = null; }
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

/* ------------------------------------------------------------ 页面切换 */

const PAGE_META = {
  home: ['启动', '选择一个实例开始游戏'],
  download: ['下载游戏', '安装原版 Minecraft 或模组加载器'],
  store: ['内容下载', '搜索模组、光影、资源包与整合包，装进指定实例'],
  downloads: ['下载管理', '实时速度、进度与历史记录'],
  instances: ['实例', '每个实例独立管理自己的模组、存档、截图与设置'],
  settings: ['设置', '主题、内存、Java 与下载源配置'],
};

function switchPage(name) {
  S.page = name;
  $$('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + name));
  $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.page === name));
  const [t, s] = PAGE_META[name] || ['', ''];
  $('#pageTitle').textContent = t;
  $('#pageSub').textContent = s;
  if (name === 'download' && !S.versions.length) loadVersions();
  if (name === 'download') { loadInstalledVersions(); fillLoaderMcVersions(); }
  if (name === 'store') renderStoreInit();
  if (name === 'downloads') loadDownloads();
  if (name === 'instances') renderInstancesPage();
  if (name === 'settings') renderSettings();
  if (name === 'home') { renderHome(); renderOptimize(); }
}

/* ------------------------------------------------------------ 状态栏 */

function renderStatus() {
  const st = S.status;
  if (!st) return;
  const used = st.totalMemMb - st.freeMemMb;
  const pct = Math.round((used / st.totalMemMb) * 100);
  $('#memVal').textContent = `${(st.freeMemMb / 1024).toFixed(1)} / ${(st.totalMemMb / 1024).toFixed(1)} GB 空闲`;
  $('#memFill').style.width = pct + '%';
  $('#memFill').style.background = pct > 88
    ? 'linear-gradient(90deg,#fb7185,#fbbf24)'
    : 'linear-gradient(90deg,var(--accent),var(--accent-2))';

  const jp = $('#pillJava');
  const javas = [...(st.javas || [])].sort((a, b) => b.major - a.major);
  const j = javas[0];
  jp.className = 'pill' + (javas.length ? '' : ' bad');
  jp.innerHTML = `<span class="pill-dot"></span><span>${javas.length
    ? `Java ${j.major}` + (javas.length > 1 ? ` 等 ${javas.length} 个` : '')
    : '未检测到 Java'}</span>`;

  const rp = $('#pillRam');
  rp.innerHTML = `<span class="pill-dot"></span><span>${(st.totalMemMb / 1024).toFixed(1)} GB 内存</span>`;

  S.running = st.running;
  const rb = $('#runningBadge');
  rb.classList.toggle('hidden', !st.running);
  if (st.running) {
    const sec = Math.floor((Date.now() - st.running.startedAt) / 1000);
    $('#runningText').textContent = `运行中 ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  }
  $('#btnKillGame').style.display = st.running ? '' : 'none';
}

/* ------------------------------------------------------------ 主页 */

function renderHome() {
  const grid = $('#instanceGrid');
  grid.innerHTML = '';

  $('#firstRun').classList.toggle('hidden', S.instances.length > 0);
  if (!S.instances.length) {
    $('#firstRun').innerHTML = `
      <h2>欢迎使用 Nova Launcher</h2>
      <p>三步就能开始玩：</p>
      <div class="fr-steps">
        <div class="fr-step"><div class="fr-num">1</div><div class="fr-t">下载游戏版本</div>
          <div class="fr-d">去「下载游戏」装一个原版版本，或直接选加载器一次装好。</div></div>
        <div class="fr-step"><div class="fr-num">2</div><div class="fr-t">创建实例</div>
          <div class="fr-d">每个实例是独立的存档与模组环境，互不干扰。</div></div>
        <div class="fr-step"><div class="fr-num">3</div><div class="fr-t">点启动</div>
          <div class="fr-d">内存会自动按你的电脑推荐；也可在设置里微调。</div></div>
      </div>`;
  }

  if (!S.instances.length) {
    grid.innerHTML = `<div class="empty"><div class="em-ico">◇</div>
      <div class="em-t">还没有任何实例</div>
      <div class="em-d">点右上角「+ 新建实例」开始</div></div>`;
  }

  for (const inst of S.instances) {
    const card = el('div', 'inst-card' + (inst.id === S.selected ? ' selected' : ''));
    const memMb = inst.memory || S.config.memory?.customMb || S.optimize?.recommendedMb || 0;
    card.innerHTML = `
      <div class="inst-top">
        <div class="inst-icon">${esc((inst.name || '?').trim().charAt(0).toUpperCase())}</div>
        <div class="inst-info">
          <div class="inst-name" title="${esc(inst.name)}">${esc(inst.name)}</div>
          <div class="inst-tags">
            <span class="inst-tag">MC ${esc(inst.version || '?')}</span>
            <span class="inst-tag loader">${esc(loaderName(inst.loader))}${inst.loaderVersion ? ' ' + esc(String(inst.loaderVersion).slice(0, 9)) : ''}</span>
            ${memMb ? `<span class="inst-tag">${memMb} MB</span>` : ''}
          </div>
        </div>
      </div>
      <div class="inst-foot">
        <div class="inst-meta">${inst.lastPlayed ? '上次 ' + fmtTime(inst.lastPlayed) : '还没玩过'}${inst.playtimeSec ? ' · ' + fmtDur(inst.playtimeSec) : ''}</div>
        <div class="inst-actions">
          <button class="inst-play" data-play="${inst.id}">
            <svg viewBox="0 0 24 24"><path d="M7 4l13 8-13 8z"/></svg>启动</button>
          <button class="inst-more" data-more="${inst.id}" title="更多">
            <svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>
          </button>
        </div>
      </div>`;
    card.onclick = (e) => {
      if (e.target.closest('[data-play]') || e.target.closest('[data-more]')) return;
      S.selected = inst.id;
      localStorage.setItem('nova.selected', inst.id);
      renderHome(); renderOptimize(); renderHero();
    };
    grid.appendChild(card);
  }

  // 事件委托（限定在当前网格内，避免误绑定其他页面的按钮）
  $$('[data-play]', grid).forEach(b => b.onclick = (e) => { e.stopPropagation(); launch(b.dataset.play); });
  $$('[data-more]', grid).forEach(b => b.onclick = (e) => { e.stopPropagation(); instanceMenu(b.dataset.more); });

  renderHero();
}

function currentInstance() {
  return S.instances.find(i => i.id === S.selected) || null;
}

function renderHero() {
  const inst = currentInstance();
  if (!inst) {
    $('#heroName').textContent = '还没有实例';
    $('#heroMeta').textContent = '去「下载游戏」装一个版本吧';
    $('#heroStats').innerHTML = '';
    $('#btnHeroPlay').disabled = true;
    $('#btnHeroFolder').disabled = true;
    return;
  }
  $('#btnHeroPlay').disabled = false;
  $('#btnHeroFolder').disabled = false;
  $('#heroName').textContent = inst.name;
  $('#heroMeta').textContent = `Minecraft ${inst.version} · ${loaderName(inst.loader)}${inst.loaderVersion ? ' ' + inst.loaderVersion : ''} · 内存 ${inst.memory || '自动'} MB`;
  $('#heroStats').innerHTML = `
    <div class="hero-stat"><span class="v">${inst.memory || (S.optimize?.recommendedMb ?? '—')}</span><span class="k">内存 MB</span></div>
    <div class="hero-stat"><span class="v">${fmtDur(inst.playtimeSec)}</span><span class="k">累计游玩</span></div>
    <div class="hero-stat"><span class="v">${fmtTime(inst.lastPlayed)}</span><span class="k">上次启动</span></div>
    <div class="hero-stat"><span class="v">${fmtSize(inst.size || 0)}</span><span class="k">模组体积</span></div>`;
}

async function renderOptimize() {
  try {
    const r = await apiGet('/api/optimize' + (S.selected ? '?instance=' + encodeURIComponent(S.selected) : ''));
    S.optimize = r;
    r.presets.forEach(p => { JVM_PRESETS[p.key] = p; });
    const body = $('#optimizeBody');
    if (!r.suggestions.length) {
      body.innerHTML = `<div class="opt-empty">配置看起来没问题 ✓</div>`;
    } else {
      body.innerHTML = r.suggestions.map((s, i) => `
        <div class="opt-item ${esc(s.level)}">
          <div style="flex:1">
            <div class="oi-title">${esc(s.title)}</div>
            <div class="oi-detail">${esc(s.detail)}</div>
            ${s.action ? `<button class="oi-apply" data-apply="${i}">${esc(s.action)} →</button>` : ''}
          </div>
        </div>`).join('');
      $$('[data-apply]').forEach(b => b.onclick = async () => {
        const s = r.suggestions[Number(b.dataset.apply)];
        if (!s?.apply) return;
        if (S.selected) {
          await apiPost('/api/instances/update', { id: S.selected, ...s.apply });
        } else {
          await apiPost('/api/config', { memory: { customMb: s.apply.memory }, jvmPreset: s.apply.jvmPreset });
        }
        toast('已应用', s.action, 'ok');
        await refreshAll();
      });
    }
    $('#memRecBadge').textContent = `推荐 ${r.recommendedMb} MB`;
  } catch (e) { console.warn(e); }
}

/* ------------------------------------------------------------ 实例操作 */

function instanceMenu(id) {
  const inst = S.instances.find(i => i.id === id);
  if (!inst) return;
  const memOptions = [1024, 1536, 2048, 3072, 4096, 6144, 8192];
  openModal(`
    <h2>${esc(inst.name)}</h2>
    <p class="modal-sub">Minecraft ${esc(inst.version)} · ${esc(loaderName(inst.loader))} ${esc(inst.loaderVersion || '')} · 版本 ID: ${esc(inst.versionId || '')}</p>
    <div class="form-grid">
      <div class="field"><label>实例名称</label><input type="text" id="miName" value="${esc(inst.name)}"></div>
      <div class="field"><label>分配内存（MB）</label>
        <input type="number" id="miMem" min="512" step="256" value="${inst.memory || S.optimize?.recommendedMb || 3072}"></div>
      <div class="field"><label>JVM 优化预设</label>
        <select id="miPreset">
          ${Object.entries(JVM_PRESETS).map(([k, v]) => `<option value="${k}" ${k === (inst.jvmPreset || 'aikar') ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}
        </select>
      </div>
      <div class="field"><label>Java</label>
        <select id="miJava"><option value="auto">自动选择</option>
          ${(S.status?.javas || []).map(j => `<option value="${esc(j.path)}" ${j.path === inst.javaPath ? 'selected' : ''}>Java ${j.major} · ${esc(j.vendor || '')}</option>`).join('')}
        </select>
      </div>
      <div class="field"><label>窗口宽度</label><input type="number" id="miW" value="${inst.width || 854}"></div>
      <div class="field"><label>窗口高度</label><input type="number" id="miH" value="${inst.height || 480}"></div>
    </div>
    <div class="field" style="margin-top:14px"><label>额外 JVM 参数</label>
      <input type="text" id="miExtra" value="${esc(inst.extraJvmArgs || '')}" placeholder="-XX:+UseZGC"></div>
    <label class="switch-line" style="margin-top:16px">
      <input type="checkbox" id="miAutoOpt" ${inst.autoOptimize !== false ? 'checked' : ''}>
      <span>启动时自动优化内存（按当时的可用内存与模组数动态计算）</span>
    </label>
    <div class="row-gap" style="margin-top:18px">
      <button class="btn btn-soft btn-sm" id="miFolder">打开目录</button>
      <button class="btn btn-soft btn-sm" id="miCopy">复制实例</button>
      <button class="btn btn-danger btn-sm" id="miDel">删除实例</button>
    </div>`,
    {
      okText: '保存', onOk: async (box) => {
        await apiPost('/api/instances/update', {
          id: inst.id,
          name: $('#miName', box).value.trim() || inst.name,
          memory: Number($('#miMem', box).value) || null,
          jvmPreset: $('#miPreset', box).value,
          autoOptimize: $('#miAutoOpt', box).checked,
          javaPath: $('#miJava', box).value,
          width: Number($('#miW', box).value) || 854,
          height: Number($('#miH', box).value) || 480,
          extraJvmArgs: $('#miExtra', box).value,
        });
        toast('已保存', '实例配置已更新', 'ok');
        await refreshAll();
      },
    });

  $('#miFolder').onclick = () => apiPost('/api/instances/open', { id: inst.id }).then(() => closeModal());
  $('#miCopy').onclick = async () => {
    try {
      const r = await apiPost('/api/instances/duplicate', { id: inst.id });
      toast('已复制', r.instance.name, 'ok'); closeModal(); await refreshAll();
    } catch (e) { toast('复制失败', e.message, 'error'); }
  };
  $('#miDel').onclick = async () => {
    closeModal();
    const box = openModal(`<h2>删除实例？</h2>
      <p class="modal-sub">「${esc(inst.name)}」的全部模组、存档与配置都会被删除，此操作不可撤销。</p>`,
      { okText: '确认删除', onOk: async () => {
        await apiPost('/api/instances/delete', { id: inst.id });
        toast('已删除', inst.name, 'ok');
        if (S.selected === inst.id) { S.selected = null; localStorage.removeItem('nova.selected'); }
        await refreshAll();
      } });
  };
}

async function newInstanceWizard() {
  // 版本用下拉，不留空：先放已安装的，再异步补上官方清单
  const initialOpts = await buildMcVersionOptions(false);
  const firstOpts = initialOpts.length ? initialOpts : [{ id: '1.20.1', label: '1.20.1' }];
  openModal(`
    <h2>新建实例</h2>
    <p class="modal-sub">每个实例拥有独立的模组、存档与配置。</p>
    <div class="form-grid">
      <div class="field"><label>实例名称</label><input type="text" id="niName" placeholder="我的生存" value="我的世界"></div>
      <div class="field"><label>Minecraft 版本</label>
        <select id="niVer">${firstOpts.map((o, i) => `<option value="${esc(o.id)}"${i === 0 ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select>
      </div>
      <div class="field"><label>模组加载器</label>
        <select id="niLoader">
          <option value="vanilla">原版（不加模组）</option>
          <option value="fabric">Fabric</option>
          <option value="neoforge">NeoForge</option>
          <option value="forge">Forge</option>
          <option value="quilt">Quilt</option>
        </select>
      </div>
      <div class="field"><label>加载器版本</label><select id="niLoaderVer"><option value="">自动选择最新</option></select></div>
    </div>
    <p class="hint" id="niHint">若所选版本尚未安装，创建时会自动下载。</p>`,
    {
      okText: '创建', onOk: async (box) => {
        const name = $('#niName', box).value.trim() || '新实例';
        const mcVersion = $('#niVer', box).value.trim();
        const loader = $('#niLoader', box).value;
        const loaderVersion = $('#niLoaderVer', box).value.trim() || undefined;
        if (!/^[\w.\-+]+$/.test(mcVersion)) { toast('版本号格式不对', '例如 1.20.1', 'error'); return false; }
        const r = await apiPost('/api/instances', { name, mcVersion, loader, loaderVersion });
        toast('开始创建实例', '看右下角任务进度', 'ok');
        closeModal();
        switchPage('home');
        ensureTaskPolling();
        return true;
      },
    });
  // 选加载器 / 改版本号时，自动拉取可用的加载器版本
  const niL = $('#niLoader'), niV = $('#niLoaderVer'), niMc = $('#niVer');
  if (niL && niV && niMc) {
    const refresh = () => fillLoaderVersions(niL, (niMc.value || '').trim(), niV);
    niL.onchange = refresh;
    niMc.onchange = refresh;
    refresh();
  }
  // 异步把官方版本清单补进下拉（失败就算了，已装版本仍然可选）
  buildMcVersionOptions(true).then(opts => {
    const sel = $('#niVer');
    if (!sel || !opts.length) return;
    const cur = sel.value;
    sel.innerHTML = opts.map(o =>
      `<option value="${esc(o.id)}"${o.id === cur ? ' selected' : ''}>${esc(o.label)}</option>`).join('');
  }).catch(() => { });
}

/* ------------------------------------------------------------ 启动 */

async function launch(id) {
  try {
    const r = await apiPost('/api/launch', { id });
    toast('正在启动', '首次启动需要下载文件，看右下角进度', 'info');
    showLogPanel();
    ensureTaskPolling();
    S.tasks.unshift(r.task);
  } catch (e) { toast('启动失败', e.message, 'error'); }
}

function showLogPanel() {
  $('#logHead').style.display = '';
  $('#logBox').style.display = '';
}

/* ------------------------------------------------------------ 版本下载 */

async function loadVersions(force = false) {
  const box = $('#versionList');
  box.innerHTML = '<div class="loading-line">加载版本清单中…</div>';
  try {
    const showSnap = $('#verSnapshots')?.checked ? 1 : 0;
    const r = await apiGet(`/api/versions?snapshots=${showSnap}` + (force ? '&refresh=1' : ''));
    S.versions = r.versions; S.latest = r.latest;
    renderVersions();
  } catch (e) {
    box.innerHTML = `<div class="loading-line">加载失败: ${esc(e.message)}</div>`;
  }
}

function renderVersions() {
  const q = ($('#verSearch')?.value || '').trim().toLowerCase();
  const list = S.versions.filter(v => !q || v.id.toLowerCase().includes(q));
  const box = $('#versionList');
  if (!list.length) { box.innerHTML = '<div class="loading-line">没有匹配的版本</div>'; return; }
  box.innerHTML = '';
  for (const v of list.slice(0, 400)) {
    const row = el('div', 'ver-row');
    const typeCls = v.type === 'release' ? '' : (v.type === 'snapshot' ? 'snapshot' : 'old');
    row.innerHTML = `
      <span class="ver-id">${esc(v.id)}</span>
      <span class="ver-type ${typeCls}">${v.type === 'release' ? '正式版' : v.type === 'snapshot' ? '快照' : v.type}</span>
      ${v.id === S.latest?.release ? '<span class="badge ok">最新</span>' : ''}
      <span class="ver-date">${esc(new Date(v.releaseTime).toLocaleDateString('zh-CN'))}</span>
      ${v.installed
        ? '<button class="btn btn-soft btn-sm" disabled>已安装</button>'
        : `<button class="btn btn-primary btn-sm" data-dl="${esc(v.id)}">安装</button>`}`;
    box.appendChild(row);
  }
  $$('[data-dl]', box).forEach(b => b.onclick = async () => {
    b.disabled = true; b.textContent = '下载中';
    try {
      await apiPost('/api/versions/install', { id: b.dataset.dl });
      toast('开始下载', b.dataset.dl, 'ok');
      ensureTaskPolling();
    } catch (e) { toast('下载失败', e.message, 'error'); b.disabled = false; b.textContent = '安装'; }
  });
}

async function loadInstalledVersions() {
  try {
    const r = await apiGet('/api/versions/installed');
    S.installed = r.versions;
    const box = $('#installedVersions');
    $('#installedCount').textContent = `${r.versions.length} 个`;
    if (!r.versions.length) {
      box.innerHTML = '<div class="loading-line">还没有已安装的版本</div>';
      return;
    }
    box.innerHTML = '';
    for (const v of r.versions) {
      const row = el('div', 'ver-row');
      row.innerHTML = `
        <span class="ver-id">${esc(v.id)}</span>
        ${v.inheritsFrom ? `<span class="ver-type snapshot">继承 ${esc(v.inheritsFrom)}</span>` : `<span class="ver-type">${esc(v.type)}</span>`}
        ${v.hasJar ? '' : '<span class="ver-type old">无 jar</span>'}
        <span class="ver-date">${fmtSize(v.size)}</span>
        <div class="row-gap">
          <button class="btn btn-soft btn-sm" data-newinst="${esc(v.id)}">建实例</button>
          <button class="btn btn-soft btn-sm" data-repair="${esc(v.id)}">修复</button>
          <button class="btn btn-danger btn-sm" data-delver="${esc(v.id)}">删除</button>
        </div>`;
      box.appendChild(row);
    }
    $$('[data-delver]', box).forEach(b => b.onclick = () => {
      openModal(`<h2>删除版本？</h2><p class="modal-sub">将删除 ${esc(b.dataset.delver)} 的全部文件（依赖库与资源文件共享，不受影响）。</p>`, {
        okText: '删除', onOk: async () => {
          await apiPost('/api/versions/delete', { id: b.dataset.delver });
          toast('已删除', b.dataset.delver, 'ok');
          await loadInstalledVersions(); await loadVersions(true);
        },
      });
    });
    $$('[data-repair]', box).forEach(b => b.onclick = async () => {
      await apiPost('/api/versions/repair', { id: b.dataset.repair });
      toast('开始修复', b.dataset.repair, 'info'); ensureTaskPolling();
    });
    $$('[data-newinst]', box).forEach(b => b.onclick = async () => {
      const ver = b.dataset.newinst;
      const isLoader = /fabric|forge|quilt/i.test(ver);
      openModal(`<h2>用 ${esc(ver)} 创建实例</h2>
        <div class="form-grid"><div class="field"><label>实例名称</label>
        <input type="text" id="qiName" value="${esc(ver)} 生存"></div>
        ${isLoader ? '' : `<div class="field"><label>模组加载器</label>
        <select id="qiLoader">
          <option value="vanilla">原版（不加模组）</option>
          <option value="fabric">Fabric</option>
          <option value="neoforge">NeoForge</option>
          <option value="forge">Forge</option>
          <option value="quilt">Quilt</option>
        </select></div>
        <div class="field"><label>加载器版本</label>
        <select id="qiLoaderVer"><option value="">自动选择最新</option></select></div>`}</div>
        ${isLoader ? '' : '<p class="hint">选好加载器会自动拉取可用版本；留空则用最新版。</p>'}`, {
        okText: '创建', onOk: async (box2) => {
          const payload = { name: $('#qiName', box2).value.trim() || ver };
          if (isLoader) payload.versionId = ver;            // 已含加载器，直接使用
          else {
            payload.mcVersion = ver;
            payload.loader = $('#qiLoader', box2).value;
            const lv = $('#qiLoaderVer', box2).value;
            if (lv) payload.loaderVersion = lv;
            payload.install = false;
          }
          await apiPost('/api/instances', payload);
          toast('开始创建', '看右下角进度', 'ok'); ensureTaskPolling(); switchPage('home');
        },
      });
      // 选加载器后自动拉版本列表
      if (!isLoader) {
        const lSel = $('#qiLoader'), vSel = $('#qiLoaderVer');
        const refresh = () => fillLoaderVersions(lSel, ver, vSel);
        lSel.onchange = refresh;
        refresh();
      }
    });
  } catch (e) { console.warn(e); }
}

/* ------------------------------------------------------------ 外链与中文名 */

const ICON_EXT = '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg>';
const ICON_BOOK = '<svg viewBox="0 0 24 24"><path d="M4 5a2 2 0 0 1 2-2h13v18H6a2 2 0 0 0-2 2z"/><path d="M4 19h15"/></svg>';

function mcmodUrl(key) {
  return 'https://search.mcmod.cn/s?key=' + encodeURIComponent(key || '');
}
function curseforgeUrl(q) {
  return 'https://www.curseforge.com/minecraft/search?page=1&pageSize=20&sortBy=relevancy&search=' + encodeURIComponent(q || '');
}
function modrinthUrl(slugOrId) {
  return 'https://modrinth.com/project/' + encodeURIComponent(slugOrId || '');
}

/**
 * 生成「官网 / MC百科 / 源码」跳转按钮。
 * info: { slug, title, cn, sourceUrl }
 */
function linkChips(info = {}) {
  if (!info) return '';
  const parts = [];
  const key = info.slug || info.projectId;
  const wikiKey = info.cn || info.title || info.slug;
  if (key) {
    parts.push(`<button class="link-chip" data-url="${esc(modrinthUrl(key))}" title="在 Modrinth 打开项目页">${ICON_EXT}官网</button>`);
  }
  if (wikiKey) {
    parts.push(`<button class="link-chip wiki" data-url="${esc(mcmodUrl(wikiKey))}" title="在 MC百科 搜索「${esc(wikiKey)}」">${ICON_BOOK}MC百科</button>`);
  }
  if (info.sourceUrl) {
    parts.push(`<button class="link-chip" data-url="${esc(info.sourceUrl)}" title="项目源码仓库">源码</button>`);
  }
  return parts.length ? `<div class="link-row">${parts.join('')}</div>` : '';
}

async function openUrl(url) {
  try {
    await apiPost('/api/system/open-url', { url });
    toast('已在浏览器打开', url.length > 64 ? url.slice(0, 64) + '…' : url, 'ok', 2000);
  } catch (e) { toast('打开失败', e.message, 'error'); }
}

/* ------------------------------------------------------------ 详情面板 */

const PROJECT_TYPE_CN = {
  mod: '模组', modpack: '整合包', shader: '光影', resourcepack: '资源包',
  datapack: '数据包', plugin: '插件',
};

const fmtCount = (n) => {
  if (!n) return '0';
  if (n >= 1e8) return (n / 1e8).toFixed(1) + '亿';
  if (n >= 1e4) return (n / 1e4).toFixed(1) + '万';
  return String(n);
};

function ldrTags(loaders) {
  const arr = (loaders || []).filter(Boolean);
  if (!arr.length) return '<span class="vt-date">—</span>';
  return `<div class="vt-loaders">${arr.map(l =>
    `<span class="ldr-tag ${esc(l)}">${esc(l)}</span>`).join('')}</div>`;
}

/**
 * 打开内容详情面板。
 * @param {string} projectId Modrinth 项目 id 或 slug
 * @param {object} opts { kind, instanceId }
 */
async function openDetail(projectId, opts = {}) {
  const kind = opts.kind || 'mod';
  const inst = opts.instanceId
    ? S.instances.find(i => i.id === opts.instanceId)
    : currentInstance();

  openModal(`<div class="detail-loading"><span class="spin-mini"></span>正在读取项目详情…</div>`,
    { cancelText: '关闭', wide: true });

  try {
    const [prRes, verRes] = await Promise.all([
      apiGet('/api/mr/project?id=' + encodeURIComponent(projectId)),
      apiGet('/api/mr/versions?project=' + encodeURIComponent(projectId)).catch(() => ({ versions: [] })),
    ]);
    const p = prRes.project || {};
    const versions = verRes.versions || [];

    // 已安装文件名（用于在版本表里标记「已装」）
    let installed = new Set();
    if (inst) {
      try {
        const c = await apiGet(`/api/content?instance=${encodeURIComponent(inst.id)}&kind=${kind}`);
        installed = new Set((c.items || []).map(i => i.name.replace(/\.disabled$/i, '')));
      } catch { }
    }

    const isPack = p.projectType === 'modpack' || kind === 'modpack';
    const authors = (p.authors || []).map(a => a.name).join('、') || (p.author || '未知');
    const iconHtml = p.iconUrl
      ? `<img class="detail-icon" src="/api/proxy?url=${encodeURIComponent(p.iconUrl)}" onerror="this.style.visibility='hidden'">`
      : `<div class="detail-icon ph">◆</div>`;

    const matchFn = (v) => {
      if (!inst) return false;
      const mcOk = !inst.version || (v.gameVersions || []).includes(inst.version);
      const ldrOk = !inst.loader || inst.loader === 'vanilla' || (v.loaders || []).includes(inst.loader);
      return mcOk && ldrOk;
    };

    const box = $('#modalBox');
    box.innerHTML = `
      <div class="detail-wrap">
        <div class="detail-head">
          ${iconHtml}
          <div class="detail-titles">
            <div class="detail-name">
              ${esc(p.cn || p.title || projectId)}
              ${p.cn && p.title ? `<span class="dn-en">${esc(p.title)}</span>` : ''}
              <span class="detail-type">${esc(PROJECT_TYPE_CN[p.projectType] || p.projectType || '内容')}</span>
            </div>
            <div class="detail-sub">
              <span class="ds-item">作者 <b>${esc(authors)}</b></span>
              <span class="ds-item"><b>${fmtCount(p.downloads)}</b> 下载</span>
              ${p.license ? `<span class="ds-item">许可 <b>${esc(p.license.name)}</b></span>` : ''}
              ${p.updated ? `<span class="ds-item">更新 <b>${fmtTime(new Date(p.updated).getTime())}</b></span>` : ''}
            </div>
            <div class="ci-source" style="margin-top:11px">${linkChips({
              slug: p.slug, projectId: p.id, title: p.title, cn: p.cn, sourceUrl: p.sourceUrl,
            })}</div>
          </div>
        </div>

        <div class="detail-section">
          <div class="sec-title">简介<span class="st-spacer"></span>
            <button class="btn btn-soft btn-sm" id="btnTranslate">翻译简介</button>
          </div>
          <div class="detail-desc" id="descEn">${esc(p.description || '（没有简介）')}</div>
          <div id="descZhBox"></div>
        </div>

        <div class="detail-section">
          <div class="sec-title">
            可用版本 <span class="st-count" id="verCount">共 ${versions.length} 个${inst ? ' · 当前实例 ' + esc(inst.name) : ''}</span>
            <span class="st-spacer"></span>
            ${inst ? `<label class="switch-line"><input type="checkbox" id="onlyMatch"> 只看匹配</label>` : ''}
          </div>
          <div class="ver-wrap">
            <table class="ver-table">
              <thead><tr>
                <th style="width:26%">版本号</th><th style="width:30%">游戏版本</th>
                <th style="width:24%">加载器</th><th style="width:12%">发布</th><th style="width:8%"></th>
              </tr></thead>
              <tbody id="verBody"></tbody>
            </table>
          </div>
        </div>
      </div>
      <div class="modal-actions"><button class="btn btn-ghost" id="mCancel">关闭</button></div>`;
    $('#mCancel').onclick = closeModal;

    /* ---- 简介翻译 ---- */
    const zhBox = $('#descZhBox');
    function showZh(text, tagText, tagCls) {
      zhBox.innerHTML = `
        <div class="trans-meta"><span class="tm-tag ${tagCls}">${esc(tagText)}</span>
          <span>${tagCls === 'builtin' ? '本项目内置译文' : '机器翻译，仅供参考'}</span></div>
        <div class="detail-desc zh">${esc(text)}</div>`;
    }
    // 有内置高质量译文就直接展示，省一次网络请求
    if (p.cnDescription) showZh(p.cnDescription, '内置译文', 'builtin');

    $('#btnTranslate').onclick = async () => {
      const btn = $('#btnTranslate');
      if (!p.description) return toast('没有可翻译的简介', '', 'warn');
      btn.disabled = true;
      btn.innerHTML = '<span class="spin-mini" style="margin:0"></span> 翻译中…';
      try {
        const r = await apiPost('/api/translate', { text: p.description, to: 'zh-CN' });
        showZh(r.text, r.cached ? '翻译 · 缓存' : '翻译 · MyMemory', '');
        toast('翻译完成', r.cached ? '来自本地缓存' : '由 MyMemory 提供', 'ok', 2500);
      } catch (e) {
        toast('翻译失败', e.message, 'error', 6000);
      } finally {
        btn.disabled = false;
        btn.textContent = '翻译简介';
      }
    };

    /* ---- 版本表格 ---- */
    const tbody = $('#verBody');
    function renderVers() {
      const only = $('#onlyMatch') ? $('#onlyMatch').checked : false;
      const matchCount = versions.filter(matchFn).length;

      // 标题里显示「匹配几个」，让用户一眼知道能不能装在当前实例
      const cnt = $('#verCount');
      if (cnt) {
        cnt.innerHTML = `共 ${versions.length} 个`
          + (inst ? ` · 当前实例 ${esc(inst.name)} 匹配 <b style="color:${matchCount ? 'var(--ok)' : 'var(--warn)'}">${matchCount}</b> 个` : '');
      }

      let list = versions.filter(v => !only || matchFn(v));
      // 匹配当前实例的排前面，其余按发布时间倒序
      list = list.slice().sort((a, b) => {
        const ma = matchFn(a) ? 1 : 0, mb = matchFn(b) ? 1 : 0;
        if (ma !== mb) return mb - ma;
        return new Date(b.datePublished || 0) - new Date(a.datePublished || 0);
      });
      if (!list.length) {
        // 区分「加载器不支持」和「游戏版本不支持」，提示更有用
        let why = '没有任何版本';
        if (versions.length) {
          const hasLoader = !inst || inst.loader === 'vanilla'
            || versions.some(v => (v.loaders || []).includes(inst.loader));
          const hasMc = !inst || versions.some(v => (v.gameVersions || []).includes(inst.version));
          if (!hasLoader) why = `该项目没有 ${esc(loaderName(inst?.loader))} 版本，无法装进当前实例`;
          else if (!hasMc) why = `没有适配 Minecraft ${esc(inst?.version || '')} 的版本`;
          else why = '没有同时匹配当前版本与加载器的构建';
        }
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:26px;color:var(--text-mute);line-height:1.7">
          ${why}<br><span style="font-size:11px">取消勾选「只看匹配」可查看全部版本</span></td></tr>`;
        return;
      }
      tbody.innerHTML = list.slice(0, 120).map(v => {
        const f = (v.files || []).find(x => x.primary) || (v.files || [])[0] || {};
        const isInstalled = installed.has(f.filename || '');
        const matched = matchFn(v);
        const chCls = v.channel === 'release' ? 'release' : '';
        const chText = v.channel === 'release' ? '正式' : (v.channel === 'beta' ? '测试' : (v.channel === 'alpha' ? '内测' : ''));
        return `<tr class="${matched ? 'match' : ''}">
          <td><span class="vt-num">${esc(v.versionNumber || v.name || '')}</span>
            ${chText ? `<span class="ch-tag ${chCls}">${chText}</span>` : ''}</td>
          <td class="vt-mc">${esc((v.gameVersions || []).slice(0, 5).join(', ') || '—')}${(v.gameVersions || []).length > 5 ? ' …' : ''}</td>
          <td>${ldrTags(v.loaders)}</td>
          <td class="vt-date">${v.datePublished ? fmtTime(new Date(v.datePublished).getTime()) : '—'}</td>
          <td class="vt-act">
            ${isInstalled
              ? '<span class="badge ok" style="font-size:9.5px">已装</span>'
              : `<button class="mini-btn" data-install-ver="${esc(v.id)}" style="width:auto;padding:0 9px;height:24px;font-size:11px">安装</button>`}
          </td>
        </tr>`;
      }).join('') + (list.length > 120
        ? `<tr><td colspan="5" style="text-align:center;padding:14px;color:var(--text-mute);font-size:11px">
            仅显示前 120 个版本（共 ${list.length} 个）</td></tr>` : '');

      $$('[data-install-ver]', tbody).forEach(b => b.onclick = async () => {
        const vid = b.dataset.installVer;
        const v = versions.find(x => x.id === vid);
        if (!inst) return toast('请先选择一个实例', '在「启动」页点击实例卡片', 'warn');
        b.disabled = true; b.textContent = '安装中';
        try {
          if (isPack) {
            await apiPost('/api/pack/install', { project: p.id || projectId, versionId: vid, name: (p.cn || p.title || '整合包') });
          } else {
            await apiPost('/api/mr/install', {
              instance: inst.id, kind, project: p.id || projectId, versionId: vid,
              mcVersion: (v.gameVersions || [])[0], loader: inst.loader,
            });
          }
          toast('开始安装', `${p.cn || p.title} ${v.versionNumber}`, 'ok');
          ensureTaskPolling();
          b.textContent = '已加入队列';
        } catch (e) {
          toast('安装失败', e.message, 'error');
          b.disabled = false; b.textContent = '安装';
        }
      });
    }
    renderVers();
    if ($('#onlyMatch')) $('#onlyMatch').onchange = renderVers;
  } catch (e) {
    const box = $('#modalBox');
    box.innerHTML = `<div class="detail-loading">读取失败：${esc(e.message)}</div>
      <div class="modal-actions"><button class="btn btn-ghost" id="mCancel">关闭</button></div>`;
    $('#mCancel').onclick = closeModal;
  }
}

/* ------------------------------------------------------------ 通用：内容列表 */

async function loadKindItems(instanceId, kind) {
  const r = await apiGet(`/api/content?instance=${encodeURIComponent(instanceId)}&kind=${kind}`);
  return r.items || [];
}

function kindLabel(k) {
  return { mod: '模组', resourcepack: '资源包', shader: '光影包', datapack: '数据包', world: '存档' }[k] || k;
}

function contentItemHtml(it, kind) {
  const m = it.meta || {};
  const src = it.source || null;
  const cn = src?.cn || null;
  const displayName = cn || m.name || it.name;
  const enName = cn ? (m.name || src?.title || null) : null;
  const iconHtml = (src?.iconUrl && /^https?:/.test(src.iconUrl))
    ? `<img src="/api/proxy?url=${encodeURIComponent(src.iconUrl)}" onerror="this.parentNode.innerHTML='◆'">`
    : (m.icon && /^data:/.test(m.icon) ? `<img src="${esc(m.icon)}">`
      : `<span>${kind === 'mod' ? '◆' : kind === 'shader' ? '☀' : kind === 'resourcepack' ? '▩' : '▤'}</span>`);
  return `<div class="content-item${it.enabled ? '' : ' disabled'}">
    <div class="ci-thumb">${iconHtml}</div>
    <div class="ci-body">
      <div class="ci-title ${src?.slug ? 'clickable' : ''}" ${src?.slug ? `data-detail="${esc(src.slug)}" data-kind="${esc(kind)}"` : ''}
           title="${esc(displayName + (enName ? ' / ' + enName : ''))}${src?.slug ? '（点击查看详情）' : ''}">${esc(displayName)}${enName ? `<span class="en-sub">${esc(enName)}</span>` : ''}</div>
      <div class="ci-sub">
        ${m.version ? `<span>v${esc(String(m.version))}</span>` : ''}
        ${m.loader ? `<span class="badge gray" style="font-size:9.5px">${esc(m.loader)}</span>` : ''}
        <span>${fmtSize(it.size)}</span>
        ${!it.enabled ? '<span style="color:var(--warn)">已禁用</span>' : ''}
      </div>
      ${m.description ? `<div class="ci-desc">${esc(m.description)}</div>` : ''}
      ${src ? `<div class="ci-source">${linkChips(src)}</div>` : ''}
    </div>
    <div class="ci-actions">
      ${kind !== 'world' ? `<button class="toggle ${it.enabled ? 'on' : ''}" data-toggle="${esc(it.file)}" title="${it.enabled ? '禁用' : '启用'}"></button>` : ''}
      <button class="mini-btn danger" data-del="${esc(it.file)}" title="删除">
        <svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/></svg></button>
    </div>
  </div>`;
}

/* ------------------------------------------------------------ 内容下载页 */

const STORE = { kind: 'mod', hits: [], queryInfo: null, total: 0, type: 'search' };

function storeInstanceId() {
  const sel = $('#storeInstance');
  return (sel && sel.value) || S.selected || (S.instances[0] && S.instances[0].id) || null;
}

function renderStoreInit() {
  const sel = $('#storeInstance');
  if (!sel) return;
  sel.innerHTML = S.instances.length
    ? S.instances.map(i => `<option value="${esc(i.id)}" ${i.id === S.selected ? 'selected' : ''}>${esc(i.name)} · ${esc(i.version)} / ${esc(loaderName(i.loader))}</option>`).join('')
    : '<option value="">请先创建实例</option>';
  if (!STORE.hits.length && S.instances.length) doStoreSearch();
}

async function doStoreSearch() {
  const kind = $('#storeKind').value || 'mod';
  const srcEl = $('#storeSource');
  const source = (srcEl && srcEl.value) || 'modrinth';
  STORE.kind = kind;
  STORE.source = source;
  STORE.type = 'search';
  const box = $('#storeResults');
  box.innerHTML = '<div class="loading-line">搜索中…</div>';

  if (source === 'curseforge') {
    return doCfSearch(kind);
  }

  const q = ($('#storeQuery').value || '').trim();
  const instId = storeInstanceId();
  const inst = S.instances.find(i => i.id === instId);
  const kindArg = kind === 'modpack' ? 'modpack' : kind;
  const useLoader = (kind === 'mod' || kind === 'modpack') ? (inst?.loader || '') : '';

  const search = (withFilter) => apiGet(`/api/mr/search?query=${encodeURIComponent(q)}&kind=${kindArg}`
    + (withFilter ? `&mcVersion=${encodeURIComponent(inst?.version || '')}&loader=${encodeURIComponent(useLoader)}` : '')
    + `&limit=24`);

  try {
    let r = await search(true);
    // 按当前实例过滤后没结果 → 自动放宽到全部版本，并告诉用户原因
    if ((r.hits || []).length === 0 && inst) {
      const loose = await search(false).catch(() => null);
      if (loose && (loose.hits || []).length) {
        r = loose;
        STORE.relaxed = `没有适配 ${inst.version}${useLoader ? ' / ' + loaderName(useLoader) : ''} 的结果，已显示全部版本`;
      } else {
        STORE.relaxed = null;
      }
    } else {
      STORE.relaxed = null;
    }
    STORE.hits = r.hits || [];
    STORE.total = r.total || 0;
    STORE.queryInfo = r.queryInfo || null;
    renderStoreResults();
  } catch (e) {
    box.innerHTML = `<div class="loading-line">搜索失败：${esc(e.message)}</div>`;
  }
}

function renderStoreResults() {
  const box = $('#storeResults');
  const inst = S.instances.find(i => i.id === storeInstanceId());
  const qi = STORE.queryInfo;
  const transTip = qi?.translated
    ? `<span class="badge purple" style="margin-left:8px">中文检索：${esc(qi.original)} → ${esc(qi.used)}</span>` : '';
  const relaxedTip = STORE.relaxed
    ? `<div class="hint" style="color:var(--warn);margin:0 0 10px">⚠ ${esc(STORE.relaxed)}</div>` : '';
  const head = `<div class="section-head" style="margin-top:18px">
      <h2>${STORE.kind === 'modpack' ? '整合包' : kindLabel(STORE.kind) + '搜索结果'}
        <span class="muted">共 ${STORE.total} 个${transTip}</span></h2>
      <span class="muted">${inst ? '目标实例：' + esc(inst.name) + '（' + esc(inst.version) + ' / ' + esc(loaderName(inst.loader)) + '）' : '未选择实例'}</span>
    </div>${relaxedTip}`;

  if (!STORE.hits.length) {
    const qq = ($('#storeQuery') && $('#storeQuery').value || '').trim();
    box.innerHTML = head + `<div class="empty">
      <div class="em-ico">◇</div>
      <div class="em-t">Modrinth 上没有找到「${esc(qq)}」</div>
      <div class="em-d">有些模组（例如 FTB Ultimine / 连锁破坏）只在 CurseForge、MC百科 或作者自己的站点发布，
        Modrinth 没有收录，所以启动器里搜不到。</div>
      <div class="row-gap" style="justify-content:center;margin-top:16px">
        <button class="btn btn-soft btn-sm" data-url="${esc(mcmodUrl(qq))}">在 MC百科 搜索「${esc(qq)}」</button>
        <button class="btn btn-soft btn-sm" data-url="${esc(curseforgeUrl(qq))}">在 CurseForge 搜索</button>
      </div>
      <div class="em-d" style="margin-top:16px">下载到 .jar 或 .zip 后，直接把文件<b>拖进窗口</b>就能装进当前实例。</div>
    </div>`;
    return;
  }

  if (STORE.kind === 'modpack') {
    box.innerHTML = head + `<div class="pack-grid">${STORE.hits.map(h => `
      <div class="pack-card" data-detail="${esc(h.id)}" data-kind="modpack" style="cursor:pointer">
        <div class="pack-banner">
          <img src="/api/proxy?url=${encodeURIComponent(h.icon || '')}" onerror="this.style.display='none'">
          <img class="pack-ico" src="/api/proxy?url=${encodeURIComponent(h.icon || '')}" onerror="this.style.display='none'">
        </div>
        <div class="pack-body">
          <div class="pack-title">${esc(h.cn || h.title)}${h.cn ? `<span class="en-sub">${esc(h.title)}</span>` : ''}</div>
          <div class="pack-desc">${esc(h.description)}</div>
          <div class="pack-foot">
            <span class="muted">${(h.downloads || 0).toLocaleString()} 次下载</span>
            <div class="row-gap">
              <button class="btn btn-soft btn-sm" data-detail="${esc(h.id)}" data-kind="modpack">详情</button>
            </div>
          </div>
        </div>
      </div>`).join('')}</div>`;
    return;
  }

  box.innerHTML = head + `<div class="mr-results" style="max-height:none">${STORE.hits.map(h => {
    const cn = h.cn || null;
    return `<div class="mr-item">
      <img class="mr-icon" src="/api/proxy?url=${encodeURIComponent(h.icon || '')}" onerror="this.style.visibility='hidden'">
      <div class="mr-body">
        <div class="mr-title clickable" data-detail="${esc(h.id || h.slug)}" title="点击查看详情与全部版本">${esc(cn || h.title)}${cn ? `<span class="en-sub">${esc(h.title)}</span>` : ''}${h.fuzzy ? '<span class="badge purple" style="font-size:9px;margin-left:6px">相似</span>' : ''}</div>
        <div class="mr-desc">${esc(h.description)}</div>
        <div class="mr-stats">
          <span>作者 <b>${esc(h.author)}</b></span>
          <span>下载 <b>${(h.downloads || 0).toLocaleString()}</b></span>
          <span>更新 <b>${fmtTime(new Date(h.updated).getTime())}</b></span>
        </div>
        <div class="ci-source">${linkChips({ slug: h.slug, title: h.title, cn, sourceUrl: h.source })}</div>
      </div>
      <div class="mr-side">
        <button class="btn btn-primary btn-sm" data-store-install="${esc(h.id)}">安装</button>
        <button class="btn btn-soft btn-sm" data-detail="${esc(h.id || h.slug)}">详情</button>
      </div>
    </div>`;
  }).join('')}</div>`;

  $$('[data-store-install]', box).forEach(b => b.onclick = () => {
    const h = STORE.hits.find(x => x.id === b.dataset.storeInstall);
    if (h && h.sourceKind === 'curseforge') return openCfInstall(h);
    storeInstall(b.dataset.storeInstall);
  });
  $$('[data-store-install]', box).forEach(b => b.onclick = () => storeInstall(b.dataset.storeInstall));
}

/** 内容下载页的安装：直接装最新适配版本到所选实例 */
async function storeInstall(projectId) {
  const instId = storeInstanceId();
  const inst = S.instances.find(i => i.id === instId);
  if (!inst) return toast('请先选择实例', '在「实例」页创建一个', 'warn');
  const hit = STORE.hits.find(h => h.id === projectId);
  const kind = STORE.kind === 'modpack' ? 'mod' : STORE.kind;
  try {
    await apiPost('/api/mr/install', {
      instance: inst.id, kind, project: projectId,
      mcVersion: inst.version, loader: inst.loader,
    });
    toast('开始安装', `${hit?.cn || hit?.title || ''} → ${inst.name}`, 'ok');
    ensureTaskPolling();
  } catch (e) { toast('安装失败', e.message, 'error'); }
}

/* ------------------------------------------------------------ 实例页 */

const INST = { detailId: null, tab: 'overview', counts: {}, page: {} };

/** 内容列表一页多少个（模组 / 资源包 / 光影 / 数据包） */
const PAGE_SIZE = 30;

/**
 * 分页条：第一页 / 上一页 / 数字页码 / 下一页 / 最后一页。
 * 页码多于 7 个时两头留省略号，始终能看到首末页 —— 不然装了 300 个模组
 * 就变成一堵数字墙。
 */
function pagerHtml(total, page, pageSize) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return '';
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(total, page * pageSize);

  // 挑出要显示的数字：首、末、当前 ±1，其余折叠
  const nums = [];
  const push = (n) => { if (n >= 1 && n <= pages && !nums.includes(n)) nums.push(n); };
  push(1);
  for (let i = page - 1; i <= page + 1; i++) push(i);
  push(pages);
  nums.sort((a, b) => a - b);

  let cells = '';
  let prev = 0;
  for (const n of nums) {
    if (prev && n - prev > 1) cells += `<span class="pg-gap">…</span>`;
    cells += `<button class="pg-num${n === page ? ' active' : ''}" data-pg="${n}">${n}</button>`;
    prev = n;
  }

  const at = (cond) => cond ? ' disabled' : '';
  return `<div class="pager">
    <span class="pg-info">第 ${start}–${end} 个 · 共 ${total} 个 · 第 ${page}/${pages} 页</span>
    <button class="pg-btn" data-pg="first"${at(page === 1)}>第一页</button>
    <button class="pg-btn" data-pg="prev"${at(page === 1)}>上一页</button>
    <span class="pg-nums">${cells}</span>
    <button class="pg-btn" data-pg="next"${at(page === pages)}>下一页</button>
    <button class="pg-btn" data-pg="last"${at(page === pages)}>最后一页</button>
  </div>`;
}

/** 把 data-pg 的点击翻译成目标页码 */
function bindPager(root, page, total, pageSize, go) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  $$('[data-pg]', root).forEach(b => b.onclick = () => {
    const v = b.dataset.pg;
    const n = v === 'first' ? 1 : v === 'last' ? pages
      : v === 'prev' ? page - 1 : v === 'next' ? page + 1 : Number(v);
    if (!Number.isFinite(n) || n < 1 || n > pages || n === page) return;
    go(n);
  });
}

/**
 * 翻页后让列表回到视野顶部。
 * 真正的滚动容器是 .pages，所以不能用 scrollIntoView —— 那会把实例标题
 * 和标签栏一起滚出去，翻完页就不知道自己在看什么了。
 * 因此以标签栏为锚点，保证「标签栏 + 工具条 + 第一行卡片」都在画面里。
 */
function scrollTabToTop(el) {
  const sc = el.closest('.pages') || document.querySelector('.pages');
  if (!sc) return;
  const anchor = document.querySelector('#instTabs') || el;
  const delta = anchor.getBoundingClientRect().top - sc.getBoundingClientRect().top;
  if (delta > -10) return;                 // 已经在上方，不用动
  sc.scrollBy({ top: delta - 10, behavior: 'smooth' });
}

const INST_TABS = [
  { key: 'overview', label: '概览' },
  { key: 'mods', label: '模组', kind: 'mod' },
  { key: 'resourcepacks', label: '资源包', kind: 'resourcepack' },
  { key: 'shaderpacks', label: '光影', kind: 'shader' },
  { key: 'datapacks', label: '数据包', kind: 'datapack' },
  { key: 'saves', label: '存档' },
  { key: 'screenshots', label: '截图' },
  { key: 'settings', label: '设置' },
];

function renderInstancesPage() {
  const listView = $('#instListView');
  const detail = $('#instDetailView');
  if (!listView || !detail) return;
  if (INST.detailId) {
    listView.classList.add('hidden');
    detail.classList.remove('hidden');
    renderInstanceDetail();
  } else {
    listView.classList.remove('hidden');
    detail.classList.add('hidden');
    renderInstanceListFull();
  }
}

function instanceCardHtml(inst) {
  const memMb = inst.memory || S.config.memory?.customMb || S.optimize?.recommendedMb || 0;
  return `<div class="inst-card${inst.id === S.selected ? ' selected' : ''}" data-inst-open="${esc(inst.id)}">
    <div class="inst-top">
      <div class="inst-icon">${esc((inst.name || '?').trim().charAt(0).toUpperCase())}</div>
      <div class="inst-info">
        <div class="inst-name" title="${esc(inst.name)}">${esc(inst.name)}</div>
        <div class="inst-tags">
          <span class="inst-tag">MC ${esc(inst.version || '?')}</span>
          <span class="inst-tag loader">${esc(loaderName(inst.loader))}${inst.loaderVersion ? ' ' + esc(String(inst.loaderVersion).slice(0, 9)) : ''}</span>
          ${memMb ? `<span class="inst-tag">${memMb} MB</span>` : ''}
        </div>
      </div>
    </div>
    <div class="inst-foot">
      <div class="inst-meta">${inst.lastPlayed ? '上次 ' + fmtTime(inst.lastPlayed) : '还没玩过'}${inst.playtimeSec ? ' · ' + fmtDur(inst.playtimeSec) : ''}</div>
      <div class="inst-actions">
        <button class="inst-play" data-play="${esc(inst.id)}"><svg viewBox="0 0 24 24"><path d="M7 4l13 8-13 8z"/></svg>启动</button>
        <button class="inst-more" data-more="${esc(inst.id)}" title="更多">
          <svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>
        </button>
      </div>
    </div>
  </div>`;
}

function renderInstanceListFull() {
  const grid = $('#instanceGridFull');
  if (!S.instances.length) {
    grid.innerHTML = `<div class="empty"><div class="em-ico">◇</div>
      <div class="em-t">还没有任何实例</div>
      <div class="em-d">点右上角「+ 新建实例」开始</div></div>`;
    return;
  }
  grid.innerHTML = S.instances.map(instanceCardHtml).join('');
  $$('[data-inst-open]', grid).forEach(c => c.onclick = (e) => {
    if (e.target.closest('[data-play]') || e.target.closest('[data-more]')) return;
    INST.detailId = c.dataset.instOpen;
    INST.tab = 'overview';
    S.selected = INST.detailId;
    localStorage.setItem('nova.selected', INST.detailId);
    renderInstancesPage();
  });
  $$('[data-play]', grid).forEach(b => b.onclick = (e) => { e.stopPropagation(); launch(b.dataset.play); });
  $$('[data-more]', grid).forEach(b => b.onclick = (e) => { e.stopPropagation(); instanceMenu(b.dataset.more); });
}

async function renderInstanceDetail() {
  const inst = S.instances.find(i => i.id === INST.detailId);
  if (!inst) { INST.detailId = null; renderInstancesPage(); return; }

  const memMb = inst.memory || S.optimize?.recommendedMb || 0;
  $('#instHero').innerHTML = `
    <div class="inst-hero-icon">${esc((inst.name || '?').trim().charAt(0).toUpperCase())}</div>
    <div class="inst-hero-main">
      <div class="inst-hero-name">${esc(inst.name)}</div>
      <div class="inst-hero-meta">
        <span>版本 <b>${esc(inst.version)}</b></span>
        <span>加载器 <b>${esc(loaderName(inst.loader))}${inst.loaderVersion ? ' ' + esc(inst.loaderVersion) : ''}</b></span>
        <span>内存 <b>${memMb} MB</b></span>
        ${inst.lastPlayed ? `<span>上次启动 <b>${fmtTime(inst.lastPlayed)}</b></span>` : ''}
        <span>累计 <b>${fmtDur(inst.playtimeSec)}</b></span>
      </div>
    </div>
    <div class="inst-hero-actions">
      <button class="btn btn-primary" data-play="${esc(inst.id)}">
        <svg viewBox="0 0 24 24" class="btn-ico" style="fill:currentColor;stroke:none"><path d="M7 4l13 8-13 8z"/></svg>启动</button>
      <button class="btn btn-soft btn-sm" data-open-folder="${esc(inst.id)}" data-folder="root">打开目录</button>
      <button class="btn btn-soft btn-sm" data-more="${esc(inst.id)}">实例选项</button>
    </div>`;

  $$('[data-play]', $('#instHero')).forEach(b => b.onclick = () => launch(b.dataset.play));
  $$('[data-open-folder]', $('#instHero')).forEach(b => b.onclick = () =>
    apiPost('/api/instance/open-folder', { id: b.dataset.openFolder, kind: b.dataset.folder }).catch(() => { }));
  $$('[data-more]', $('#instHero')).forEach(b => b.onclick = () => instanceMenu(b.dataset.more));

  renderInstTabs(inst);
  await renderInstTab();
}

function renderInstTabs(inst) {
  $('#instTabs').innerHTML = INST_TABS.map(t => {
    const c = INST.counts[t.key];
    return `<button class="inst-tab${INST.tab === t.key ? ' active' : ''}" data-tab="${t.key}">
      ${esc(t.label)}${(c !== undefined && c !== null) ? `<span class="tt-count">${c}</span>` : ''}</button>`;
  }).join('');
  $$('.inst-tab', $('#instTabs')).forEach(b => b.onclick = () => {
    INST.tab = b.dataset.tab;
    renderInstTabs(inst);
    renderInstTab();
  });
}

async function renderInstTab() {
  const inst = S.instances.find(i => i.id === INST.detailId);
  const body = $('#instTabBody');
  if (!inst || !body) return;
  // 换了实例就从头开始 —— 上一个实例的页码对这份文件列表毫无意义
  if (INST.pageInst !== inst.id) { INST.page = {}; INST.pageInst = inst.id; }
  body.innerHTML = '<div class="loading-line">读取中…</div>';
  try {
    if (INST.tab === 'overview') await renderTabOverview(inst, body);
    else if (INST.tab === 'saves') await renderTabSaves(inst, body);
    else if (INST.tab === 'screenshots') await renderTabScreenshots(inst, body);
    else if (INST.tab === 'settings') await renderTabSettings(inst, body);
    else await renderTabContent(inst, body, INST_TABS.find(t => t.key === INST.tab).kind);
  } catch (e) {
    body.innerHTML = `<div class="loading-line">读取失败：${esc(e.message)}</div>`;
  }
}

/* ---- 概览 ---- */
async function renderTabOverview(inst, body) {
  const [mods, shaders, packs, datas, saves, shots] = await Promise.all([
    loadKindItems(inst.id, 'mod').catch(() => []),
    loadKindItems(inst.id, 'shader').catch(() => []),
    loadKindItems(inst.id, 'resourcepack').catch(() => []),
    loadKindItems(inst.id, 'datapack').catch(() => []),
    apiGet(`/api/saves?instance=${encodeURIComponent(inst.id)}`).catch(() => ({ items: [] })),
    apiGet(`/api/screenshots?instance=${encodeURIComponent(inst.id)}`).catch(() => ({ items: [] })),
  ]);
  INST.counts = {
    mods: mods.length, resourcepacks: packs.length, shaderpacks: shaders.length,
    datapacks: datas.length, saves: saves.items.length, screenshots: shots.items.length,
  };
  renderInstTabs(inst);

  const onMods = mods.filter(m => m.enabled).length;
  body.innerHTML = `
    <div class="dl-stats" style="margin-bottom:16px">
      <div class="stat-card accent"><span class="sc-val">${onMods}<small>/${mods.length}</small></span><span class="sc-label">模组（启用/总数）</span></div>
      <div class="stat-card"><span class="sc-val">${shaders.length}</span><span class="sc-label">光影包</span></div>
      <div class="stat-card"><span class="sc-val">${packs.length}</span><span class="sc-label">资源包</span></div>
      <div class="stat-card"><span class="sc-val">${saves.items.length}</span><span class="sc-label">存档</span></div>
      <div class="stat-card"><span class="sc-val">${shots.items.length}</span><span class="sc-label">截图</span></div>
    </div>
    <div class="card pad">
      <div class="card-head"><h3>这个实例的文件夹</h3></div>
      <div class="row-gap">
        ${['mods', 'resourcepacks', 'shaderpacks', 'datapacks', 'saves', 'screenshots', 'config', 'logs'].map(k =>
    `<button class="btn btn-soft btn-sm" data-open-folder="${esc(inst.id)}" data-folder="${k}">${kindLabel(k === 'shaderpacks' ? 'shader' : k === 'resourcepacks' ? 'resourcepack' : k === 'datapacks' ? 'datapack' : k)}/</button>`).join('')}
      </div>
      <p class="hint">每个实例有自己独立的一套文件夹，互不干扰；点按钮直接在资源管理器中定位到该路径。</p>
    </div>`;

  $$('[data-open-folder]', body).forEach(b => b.onclick = () =>
    apiPost('/api/instance/open-folder', { id: b.dataset.openFolder, kind: b.dataset.folder })
      .then(r => toast('已打开', r.dir, 'ok', 2500))
      .catch(e => toast('打开失败', e.message, 'error')));
}

/* ---- 模组 / 资源包 / 光影 / 数据包 ---- */
async function renderTabContent(inst, body, kind) {
  const items = await loadKindItems(inst.id, kind);
  INST.counts[INST.tab] = items.length;
  renderInstTabs(inst);

  const on = items.filter(i => i.enabled).length;
  body.innerHTML = `
    <div class="sub-toolbar">
      <span class="st-title">${kindLabel(kind)}</span>
      <span class="st-hint">${items.length ? `${on}/${items.length} 启用 · 共 ${fmtSize(items.reduce((a, b) => a + (b.size || 0), 0))}` : '暂无'}</span>
      <span class="st-spacer"></span>
      <button class="btn btn-soft btn-sm" data-open-folder="${esc(inst.id)}" data-folder="${{ mod: 'mods', resourcepack: 'resourcepacks', shader: 'shaderpacks', datapack: 'datapacks' }[kind]}">打开文件夹</button>
      <button class="btn btn-soft btn-sm" data-goto-store="${esc(kind)}">去下载</button>
      <button class="btn btn-soft btn-sm" data-import-kind="${esc(kind)}">从电脑导入</button>
    </div>
    ${items.length ? '' : `<div class="empty"><div class="em-ico">＋</div><div class="em-t">还没有${esc(kindLabel(kind))}</div>
       <div class="em-d">点「去下载」从 Modrinth 搜索安装，或用「从电脑导入」放本地文件</div></div>`}
    <div class="content-grid" id="instContentGrid"></div>
    <div id="instPagerBox"></div>`;

  const grid = $('#instContentGrid', body);
  const pagerBox = $('#instPagerBox', body);

  /**
   * 只重绘当前页 + 分页条，不重新请求数据 ——
   * 翻页要跟手，30 个卡片重排是几十毫秒的事，没必要再走一趟 API。
   */
  function paint() {
    const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    // 删到当前页空掉时往回退，不会停在一片空白上
    let page = Math.min(Math.max(1, INST.page[kind] || 1), pages);
    INST.page[kind] = page;

    const slice = items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    grid.innerHTML = slice.map(it => contentItemHtml(it, kind)).join('');
    pagerBox.innerHTML = items.length > PAGE_SIZE ? pagerHtml(items.length, page, PAGE_SIZE) : '';
    bindPager(pagerBox, page, items.length, PAGE_SIZE, (n) => {
      INST.page[kind] = n;
      paint();
      scrollTabToTop(body);
    });

    bindGrid();
  }

  /** 卡片上的开关 / 删除：每翻一页都要重新绑，因为 grid 是整体重建的 */
  function bindGrid() {
    $$('[data-toggle]', grid).forEach(b => b.onclick = async () => {
      try {
        await apiPost('/api/content/toggle', { instance: inst.id, kind, file: b.dataset.toggle });
        await renderInstTab();
      } catch (e) { toast('操作失败', e.message, 'error'); }
    });
    $$('[data-del]', grid).forEach(b => b.onclick = () => {
      const f = b.dataset.del;
      openModal(`<h2>删除文件？</h2><p class="modal-sub">${esc(f)}<br>只影响当前实例「${esc(inst.name)}」。</p>`, {
        okText: '删除', onOk: async () => {
          await apiPost('/api/content/delete', { instance: inst.id, kind, file: f });
          toast('已删除', f, 'ok');
          await renderInstTab();
        },
      });
    });
  }

  paint();

  $$('[data-open-folder]', body).forEach(b => b.onclick = () =>
    apiPost('/api/instance/open-folder', { id: b.dataset.openFolder, kind: b.dataset.folder })
      .then(r => toast('已打开', r.dir, 'ok', 2500)).catch(() => { }));
  $$('[data-goto-store]', body).forEach(b => {
    b.onclick = () => {
      switchPage('store');
      $('#storeKind').value = b.dataset.gotoStore === 'shader' ? 'shader'
        : b.dataset.gotoStore === 'resourcepack' ? 'resourcepack'
          : b.dataset.gotoStore === 'datapack' ? 'datapack' : 'mod';
      $('#storeInstance').value = inst.id;
      doStoreSearch();
    };
  });
  $$('[data-import-kind]', body).forEach(b => b.onclick = () => importIntoInstance(inst.id, b.dataset.importKind));
}

function importIntoInstance(instanceId, kind) {
  const inp = $('#fileInput');
  inp.accept = kind === 'mod' ? '.jar' : '.zip';
  inp.onchange = async () => {
    const files = [...inp.files];
    if (!files.length) return;
    for (const f of files) {
      try {
        await apiUpload(`/api/content/upload?instance=${encodeURIComponent(instanceId)}&kind=${kind}`, f);
        toast('已导入', f.name, 'ok');
      } catch (e) { toast('导入失败', f.name + ': ' + e.message, 'error'); }
    }
    inp.value = '';
    await renderInstTab();
  };
  inp.click();
}

/* ---- 存档 ---- */
async function renderTabSaves(inst, body) {
  const r = await apiGet(`/api/saves?instance=${encodeURIComponent(inst.id)}`);
  const items = r.items || [];
  INST.counts.saves = items.length;
  renderInstTabs(inst);

  body.innerHTML = `
    <div class="sub-toolbar">
      <span class="st-title">游戏存档</span>
      <span class="st-hint">${items.length} 个 · 可直接改游戏模式、难度、作弊开关</span>
      <span class="st-spacer"></span>
      <button class="btn btn-primary btn-sm" id="btnImportSave">导入存档</button>
      <button class="btn btn-soft btn-sm" id="btnImportSaveUrl">从链接下载</button>
      <button class="btn btn-soft btn-sm" data-url="https://www.planetminecraft.com/projects/?keywords=&t=worlds"
        title="在浏览器中打开 Planet Minecraft 的存档区（该站有 Cloudflare 防护，只能跳转后手动下载）">Planet Minecraft ↗</button>
      <button class="btn btn-soft btn-sm" data-open-folder="${esc(inst.id)}" data-folder="saves">打开文件夹</button>
    </div>
    <p class="hint" style="margin:-4px 0 14px">
      想从 <b>Planet Minecraft</b> 下存档？点上面的按钮去站内挑选并下载压缩包，
      回到这里「导入存档」即可；也可以直接把 <code>.zip</code> / <code>.mcworld</code> <b>拖进窗口</b>。
    </p>
    <div id="saveList"></div>`;

  const list = $('#saveList', body);
  if (!items.length) {
    list.innerHTML = `<div class="empty"><div class="em-ico">▤</div><div class="em-t">还没有存档</div>
      <div class="em-d">进游戏创建一个世界，或从 Planet Minecraft 下载后把压缩包拖进窗口</div></div>`;
  } else {
    list.innerHTML = items.map(it => {
      const i = it.info || {};
      return `<div class="save-card">
        <div class="save-icon">▤</div>
        <div class="save-body">
          <div class="save-name">${esc(i.levelName || it.name)}
            ${i.hardcore ? '<span class="save-tag hardcore">极限</span>' : ''}</div>
          <div class="save-tags">
            ${i.gameType !== undefined ? `<span class="save-tag mode">${esc(i.gameTypeName)}</span>` : ''}
            ${i.difficultyName ? `<span class="save-tag">难度 ${esc(i.difficultyName)}</span>` : ''}
            ${i.cheats ? '<span class="save-tag cheat">允许作弊</span>' : ''}
            ${i.versionName ? `<span class="save-tag">${esc(i.versionName)}</span>` : ''}
          </div>
          <div class="save-meta">
            <span>第 ${i.day || 0} 天</span>
            <span>${fmtSize(it.size)}</span>
            <span>${it.mtime ? fmtTime(it.mtime) : ''}</span>
            <span>文件夹 ${esc(it.name)}</span>
            ${it.error ? `<span style="color:var(--danger)">读取失败: ${esc(it.error)}</span>` : ''}
          </div>
        </div>
        <div class="save-actions">
          <button class="btn btn-soft btn-sm" data-save-edit="${esc(it.name)}">编辑</button>
          <button class="btn btn-soft btn-sm" data-save-export="${esc(it.name)}">导出</button>
          <button class="btn btn-soft btn-sm" data-save-backup="${esc(it.name)}">备份</button>
          <button class="mini-btn" data-save-reveal="${esc(it.name)}" title="在资源管理器中定位">
            <svg viewBox="0 0 24 24"><path d="M3 7h6l2 2h10v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/></svg></button>
          <button class="mini-btn danger" data-save-del="${esc(it.name)}" title="删除存档">
            <svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/></svg></button>
        </div>
      </div>`;
    }).join('');
  }

  $$('[data-open-folder]', body).forEach(b => b.onclick = () =>
    apiPost('/api/instance/open-folder', { id: b.dataset.openFolder, kind: b.dataset.folder }).catch(() => { }));
  $$('[data-save-edit]', list).forEach(b => b.onclick = () => openSaveEditor(inst, b.dataset.saveEdit, items));
  if ($('#btnImportSave', body)) $('#btnImportSave', body).onclick = () => importSaveFile(inst.id);
  if ($('#btnImportSaveUrl', body)) $('#btnImportSaveUrl', body).onclick = () => importSaveFromUrl(inst.id);
  $$('[data-save-export]', list).forEach(b => b.onclick = async () => {
    b.disabled = true;
    try {
      const r = await apiPost('/api/saves/export-file', { instance: inst.id, world: b.dataset.saveExport });
      toast('已导出存档', `${r.path}（${fmtSize(r.size)}）`, 'ok', 7000);
    } catch (e) { toast('导出失败', e.message, 'error'); }
    finally { b.disabled = false; }
  });
  $$('[data-save-backup]', list).forEach(b => b.onclick = async () => {
    try {
      const res = await apiPost('/api/saves/backup', { instance: inst.id, world: b.dataset.saveBackup });
      toast('已备份', res.dest, 'ok', 4000);
    } catch (e) { toast('备份失败', e.message, 'error'); }
  });
  $$('[data-save-reveal]', list).forEach(b => b.onclick = () =>
    apiPost('/api/instance/open-folder', { id: inst.id, kind: 'saves' }).catch(() => { }));
  $$('[data-save-del]', list).forEach(b => b.onclick = () => {
    const w = b.dataset.saveDel;
    openModal(`<h2>删除存档？</h2><p class="modal-sub">「${esc(w)}」整个文件夹都会被删除，无法恢复。<br>
      建议先点「备份」。</p>`, {
      okText: '确认删除', onOk: async () => {
        await apiPost('/api/saves/delete', { instance: inst.id, world: w });
        toast('已删除', w, 'ok');
        await renderInstTab();
      },
    });
  });
}

/** 存档编辑弹窗 */
function openSaveEditor(inst, world, items) {
  const it = (items || []).find(x => x.name === world);
  const i = (it && it.info) || {};
  openModal(`
    <h2>${esc(i.levelName || world)}</h2>
    <p class="modal-sub">修改会直接写进 level.dat，并自动留一份 <code>level.dat.nova-bak</code> 备份。<br>
      请先退出游戏再保存，否则会被游戏覆盖。</p>
    <div class="save-form">
      <div class="field"><label>存档名称</label>
        <input type="text" id="svName" value="${esc(i.levelName || world)}" maxlength="64"></div>
      <div class="field"><label>游戏模式</label>
        <select id="svMode">
          ${['生存模式', '创造模式', '冒险模式', '旁观模式'].map((n, idx) =>
    `<option value="${idx}" ${i.gameType === idx ? 'selected' : ''}>${n}</option>`).join('')}
        </select></div>
      <div class="field"><label>难度</label>
        <select id="svDiff">
          ${['和平', '简单', '普通', '困难'].map((n, idx) =>
      `<option value="${idx}" ${i.difficulty === idx ? 'selected' : ''}>${n}</option>`).join('')}
        </select></div>
      <div class="field"><label>天数</label>
        <input type="number" id="svDay" min="0" max="1000000" value="${i.day || 0}"></div>
    </div>
    <div class="row-gap" style="margin-top:16px;gap:18px">
      <label class="switch-line"><input type="checkbox" id="svCheat" ${i.cheats ? 'checked' : ''}> 允许作弊（可开指令）</label>
      <label class="switch-line"><input type="checkbox" id="svHard" ${i.hardcore ? 'checked' : ''}> 极限模式</label>
      <label class="switch-line"><input type="checkbox" id="svLock" ${i.difficultyLocked ? 'checked' : ''}> 锁定难度</label>
    </div>
    <p class="hint">改「游戏模式」不影响已经拿到的成就；改「允许作弊」后进入游戏即可用 /gamemode 等指令。</p>`,
    {
      okText: '保存修改', wide: true, onOk: async (box) => {
        const patch = {
          levelName: $('#svName', box).value.trim() || world,
          gameType: Number($('#svMode', box).value),
          difficulty: Number($('#svDiff', box).value),
          day: Number($('#svDay', box).value) || 0,
          allowCommands: $('#svCheat', box).checked,
          hardcore: $('#svHard', box).checked,
          difficultyLocked: $('#svLock', box).checked,
        };
        try {
          const r = await apiPost('/api/saves/edit', { instance: inst.id, world, patch });
          toast('已保存', (r.changed || []).join(' · '), 'ok', 5000);
          await renderInstTab();
        } catch (e) { toast('保存失败', e.message, 'error', 6000); return false; }
        return true;
      },
    });
}

/** 导入本地存档压缩包（.zip / .mcworld） */
function importSaveFile(instanceId) {
  const inp = $('#fileInput');
  inp.accept = '.zip,.mcworld';
  inp.onchange = async () => {
    const f = inp.files[0];
    if (!f) return;
    toast('正在导入存档', f.name + ' …', 'info', 3000);
    try {
      const r = await apiUpload(`/api/saves/import?instance=${encodeURIComponent(instanceId)}`, f);
      toast('导入成功', (r.created || []).join('、'), 'ok', 6000);
      inp.value = '';
      await renderInstTab();
    } catch (e) {
      toast('导入失败', e.message, 'error', 7000);
    }
  };
  inp.click();
}

/** 从直链下载存档 */
function importSaveFromUrl(instanceId) {
  openModal(`<h2>从链接下载存档</h2>
    <p class="modal-sub">粘贴存档压缩包（.zip / .mcworld）的直链，启动器会下载并自动解压到该实例的存档目录。</p>
    <div class="field"><label>下载链接</label>
      <input type="text" id="saveUrl" placeholder="https://example.com/world.zip"></div>
    <p class="hint">只支持 http/https 直链。大存档可能要几分钟，进度可以在「下载管理」里看。</p>`,
    {
      okText: '开始下载', onOk: async (box) => {
        const url = $('#saveUrl', box).value.trim();
        if (!/^https?:\/\//i.test(url)) { toast('链接格式不对', '需要以 http:// 或 https:// 开头', 'warn'); return false; }
        try {
          await apiPost('/api/saves/import-url', { instance: instanceId, url });
          toast('开始下载存档', url.length > 60 ? url.slice(0, 60) + '…' : url, 'ok');
          ensureTaskPolling();
        } catch (e) { toast('下载失败', e.message, 'error'); return false; }
        return true;
      },
    });
}
/* ---- 截图 ---- */
async function renderTabScreenshots(inst, body) {
  const r = await apiGet(`/api/screenshots?instance=${encodeURIComponent(inst.id)}`);
  const items = r.items || [];
  INST.counts.screenshots = items.length;
  renderInstTabs(inst);

  body.innerHTML = `
    <div class="sub-toolbar">
      <span class="st-title">游戏截图</span>
      <span class="st-hint">${items.length} 张 · 游戏内按 F2 截图会存到这里</span>
      <span class="st-spacer"></span>
      <button class="btn btn-soft btn-sm" data-open-folder="${esc(inst.id)}" data-folder="screenshots">打开截图文件夹</button>
    </div>
    <div id="shotWall"></div>`;

  const wall = $('#shotWall', body);
  if (!items.length) {
    wall.innerHTML = `<div class="empty"><div class="em-ico">▩</div><div class="em-t">还没有截图</div>
      <div class="em-d">游戏里按 F2 就能截图，会自动出现在这里</div></div>`;
  } else {
    wall.innerHTML = `<div class="shot-grid">${items.map(s => `
      <div class="shot-item">
        <img src="/api/screenshot/file?instance=${encodeURIComponent(inst.id)}&file=${encodeURIComponent(s.name)}"
             alt="${esc(s.name)}" data-shot="${esc(s.name)}" loading="lazy">
        <div class="shot-ops">
          <button class="mini-btn" data-shot-reveal="${esc(s.name)}" title="在文件夹中显示">
            <svg viewBox="0 0 24 24"><path d="M3 7h6l2 2h10v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/></svg></button>
          <button class="mini-btn danger" data-shot-del="${esc(s.name)}" title="删除">
            <svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/></svg></button>
        </div>
        <div class="shot-cap"><span>${esc(s.name.replace(/\.(png|jpe?g)$/i, ''))}</span><span>${fmtSize(s.size)}</span></div>
      </div>`).join('')}</div>`;
  }

  $$('[data-open-folder]', body).forEach(b => b.onclick = () =>
    apiPost('/api/instance/open-folder', { id: b.dataset.openFolder, kind: b.dataset.folder }).catch(() => { }));
  $$('[data-shot]', wall).forEach(img => img.onclick = () => {
    const lb = el('div', 'lightbox');
    lb.innerHTML = `<button class="lb-close">✕</button><img src="${img.src}">`;
    lb.onclick = () => lb.remove();
    document.body.appendChild(lb);
  });
  $$('[data-shot-reveal]', wall).forEach(b => b.onclick = () =>
    apiPost('/api/screenshot/reveal', { instance: inst.id, file: b.dataset.shotReveal }).catch(() => { }));
  $$('[data-shot-del]', wall).forEach(b => b.onclick = () => {
    const f = b.dataset.shotDel;
    openModal(`<h2>删除截图？</h2><p class="modal-sub">${esc(f)}</p>`, {
      okText: '删除', onOk: async () => {
        await apiPost('/api/screenshots/delete', { instance: inst.id, file: f });
        toast('已删除', f, 'ok');
        await renderInstTab();
      },
    });
  });
}

/* ---- 实例设置 ---- */
async function renderTabSettings(inst, body) {
  const tune = await apiGet('/api/autotune?instance=' + encodeURIComponent(inst.id)).catch(() => null);
  const autoOpt = inst.autoOptimize !== undefined ? inst.autoOptimize : true;
  body.innerHTML = `
    <div class="settings-grid">
      <div class="card pad">
        <div class="card-head"><h3>基本信息</h3></div>
        <div class="field"><label>实例名称</label>
          <input type="text" id="isName" value="${esc(inst.name)}"></div>
        <div class="field"><label>版本</label>
          <input type="text" value="${esc(inst.version)} · ${esc(loaderName(inst.loader))} ${esc(inst.loaderVersion || '')}" disabled></div>
        <div class="row-gap" style="margin-top:14px">
          <button class="btn btn-soft btn-sm" data-open-folder="${esc(inst.id)}" data-folder="root">打开实例目录</button>
        </div>
      </div>

      <div class="card pad">
        <div class="card-head"><h3>内存</h3>
          <span class="badge ${autoOpt ? 'ok' : 'gray'}">${autoOpt ? '自动优化中' : '手动设置'}</span></div>
        <label class="switch-line"><input type="checkbox" id="isAutoOpt" ${autoOpt ? 'checked' : ''}> 启动时自动优化内存</label>
        <p class="hint">${tune ? `当前会分配 <b>${tune.memoryMb} MB</b> / ${esc(tune.preset)}` : ''}
          ${autoOpt ? '开启时下面的手动值不生效。' : ''}</p>
        <div class="field" style="margin-top:12px"><label>手动内存 <b id="isMemShow">${inst.memory || 3072} MB</b></label>
          <input type="range" id="isMem" min="512" max="16384" step="256" value="${inst.memory || 3072}"></div>
        <div class="field"><label>JVM 预设</label>
          <select id="isPreset">
            ${Object.entries(JVM_PRESETS).map(([k, v]) =>
    `<option value="${k}" ${k === (inst.jvmPreset || 'aikar') ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}
          </select></div>
        <div class="field"><label>额外 JVM 参数</label>
          <input type="text" id="isJvm" value="${esc(inst.extraJvmArgs || '')}" placeholder="-XX:+UseZGC"></div>
      </div>

      <div class="card pad">
        <div class="card-head"><h3>模组加载器</h3></div>
        <div class="field"><label>当前</label>
          <input type="text" value="${esc(loaderName(inst.loader))}${inst.loaderVersion ? ' ' + esc(inst.loaderVersion) : ''}" disabled></div>
        <p class="hint">换加载器会重新安装对应版本（原版 ↔ Fabric ↔ Forge ↔ NeoForge ↔ Quilt）。
          存档、截图不受影响，但<b>原来的模组很可能不兼容</b>，换完记得去「模组」页检查。</p>
        <div class="row-gap" style="margin-top:12px">
          <button class="btn btn-soft btn-sm" id="isChangeLoader">更换加载器</button>
        </div>
      </div>

      <div class="card pad">
        <div class="card-head"><h3>Java 与窗口</h3></div>
        <div class="field"><label>使用的 Java</label>
          <select id="isJava"><option value="auto">自动选择（推荐）</option>
            ${(S.status?.javas || []).map(j =>
      `<option value="${esc(j.path)}" ${j.path === inst.javaPath ? 'selected' : ''}>Java ${j.major} · ${esc(j.vendor || '')}</option>`).join('')}
          </select></div>
        <div class="form-grid" style="margin-top:12px">
          <div class="field"><label>窗口宽</label><input type="number" id="isW" value="${inst.width || 854}"></div>
          <div class="field"><label>窗口高</label><input type="number" id="isH" value="${inst.height || 480}"></div>
        </div>
        <div class="row-gap" style="margin-top:16px">
          <button class="btn btn-primary btn-sm" id="isSave">保存设置</button>
          <button class="btn btn-danger btn-sm" id="isDelete">删除实例</button>
        </div>
      </div>
    </div>`;

  $$('[data-open-folder]', body).forEach(b => b.onclick = () =>
    apiPost('/api/instance/open-folder', { id: b.dataset.openFolder, kind: b.dataset.folder }).catch(() => { }));
  if ($('#isChangeLoader', body)) $('#isChangeLoader', body).onclick = () => openChangeLoader(inst);
  const mem = $('#isMem', body);
  mem.oninput = () => { $('#isMemShow', body).textContent = Number(mem.value) + ' MB'; };
  $('#isSave', body).onclick = async () => {
    try {
      await apiPost('/api/instances/update', {
        id: inst.id,
        name: $('#isName', body).value.trim() || inst.name,
        memory: Number($('#isMem', body).value) || null,
        jvmPreset: $('#isPreset', body).value,
        autoOptimize: $('#isAutoOpt', body).checked,
        javaPath: $('#isJava', body).value,
        extraJvmArgs: $('#isJvm', body).value,
        width: Number($('#isW', body).value) || 854,
        height: Number($('#isH', body).value) || 480,
      });
      toast('已保存', '实例设置已更新', 'ok');
      await refreshAll();
      await renderInstTab();
    } catch (e) { toast('保存失败', e.message, 'error'); }
  };
  $('#isDelete', body).onclick = () => {
    openModal(`<h2>删除实例</h2>
      <p class="modal-sub">「${esc(inst.name)}」的全部模组、存档、截图与配置都会被删除，<b>不可撤销</b>。<br>
      请输入实例名以确认：</p>
      <div class="field"><input type="text" id="confirmName" placeholder="${esc(inst.name)}"></div>`, {
      okText: '确认删除', onOk: async (box) => {
        if ($('#confirmName', box).value.trim() !== inst.name) {
          toast('名字不一致', '请完整输入实例名后再删除', 'warn', 4000);
          return false;
        }
        await apiPost('/api/instances/delete', { id: inst.id });
        toast('已删除', inst.name, 'ok');
        INST.detailId = null;
        if (S.selected === inst.id) { S.selected = null; localStorage.removeItem('nova.selected'); }
        await refreshAll();
        renderInstancesPage();
        },
      });
  };
}
/* ------------------------------------------------------------ 下载管理 */

const TASK_TYPES = {
  install: '安装版本', java: 'Java', download: '内容下载', pack: '整合包',
  launch: '启动', instance: '实例', repair: '修复',
};
const typeName = (t) => TASK_TYPES[t] || t || '任务';

const fmtSpeed = (bps) => {
  if (!bps) return '0 KB';
  if (bps < 1048576) return (bps / 1024).toFixed(0) + ' KB';
  return (bps / 1048576).toFixed(1) + ' MB';
};
const fmtEta = (sec) => {
  if (!isFinite(sec) || sec <= 0) return '—';
  if (sec < 60) return Math.ceil(sec) + ' 秒';
  if (sec < 3600) return Math.ceil(sec / 60) + ' 分';
  return Math.floor(sec / 3600) + ' 时 ' + Math.round((sec % 3600) / 60) + ' 分';
};

async function loadDownloads() {
  try {
    const r = await apiGet('/api/downloads/history');
    S.dlHistory = r.history || [];
    S.dlRunning = r.running || [];
    renderDownloads();
  } catch (e) {
    $('#dlHistory').innerHTML = `<div class="loading-line">读取失败: ${esc(e.message)}</div>`;
  }
}

function renderDownloads() {
  if (S.page !== 'downloads') return;
  const running = (S.tasks || []).filter(t => t.status === 'running');
  S.dlRunning = running;

  /* ---- 统计卡 ---- */
  const hist = S.dlHistory || [];
  const totalBytes = hist.reduce((a, b) => a + (b.bytes || 0), 0)
    + running.reduce((a, b) => a + (b.bytesDone || 0), 0);
  const doneN = hist.filter(h => h.status === 'done').length;
  const failN = hist.filter(h => h.status === 'error').length;
  const rate = (doneN + failN) ? Math.round((doneN / (doneN + failN)) * 100) : 100;
  const speed = running.reduce((a, b) => a + (b.speedBps || 0), 0);
  const files = hist.reduce((a, b) => a + (b.files || 0), 0) + running.reduce((a, b) => a + (b.fileDone || 0), 0);

  $('#dlStats').innerHTML = `
    <div class="stat-card accent">
      <span class="sc-val">${running.length}</span>
      <span class="sc-label">进行中任务</span>
    </div>
    <div class="stat-card accent">
      <span class="sc-val">${fmtSpeed(speed)}<small>/s</small></span>
      <span class="sc-label">当前总速度</span>
    </div>
    <div class="stat-card">
      <span class="sc-val">${fmtSize(totalBytes)}</span>
      <span class="sc-label">累计下载 · ${files} 个文件</span>
    </div>
    <div class="stat-card ${rate >= 90 ? 'ok' : 'bad'}">
      <span class="sc-val">${rate}<small>%</small></span>
      <span class="sc-label">成功率 · 成功 ${doneN} / 失败 ${failN}</span>
    </div>`;

  /* ---- 进行中 ---- */
  $('#dlRunningCount').textContent = running.length ? `${running.length} 个` : '';
  $('#btnCancelAll').style.display = running.length ? '' : 'none';
  const runBox = $('#dlRunning');
  runBox.innerHTML = running.length ? running.map(t => {
    // 单文件下载时 percent 一直是 0，改用已下载字节算一个更直观的进度
    const byFile = t.percent || 0;
    const byByte = (t.bytesTotal > 0) ? Math.min(99, Math.round((t.bytesDone / t.bytesTotal) * 100)) : 0;
    const pct = Math.max(byFile, byByte);
    const left = (t.bytesTotal || 0) - (t.bytesDone || 0);
    const eta = t.speedBps && left > 0 ? left / t.speedBps : 0;
    return `<div class="dl-task running">
      <div class="dlt-head">
        <span class="dlt-title">${esc(t.title)}</span>
        <span class="dlt-type">${esc(typeName(t.type))}</span>
        <div class="dlt-actions"><button class="mini-btn" data-cancel="${t.id}">取消</button></div>
      </div>
      <div class="dlt-bar"><div class="dlt-fill" style="width:${pct}%"></div></div>
      <div class="dlt-meta">
        <span>进度 <b>${pct}%</b></span>
        <span>${t.done || 0}/${t.total || 0} 文件</span>
        <span>已下载 <b>${fmtSize(t.bytesDone || 0)}</b>${t.bytesTotal ? ' / ' + fmtSize(t.bytesTotal) : ''}</span>
        ${t.speedBps ? `<span class="sp">${fmtSpeed(t.speedBps)}</span>` : ''}
        ${eta > 0 ? `<span>剩余 ~${fmtEta(eta)}</span>` : ''}
        ${t.stage ? `<span>${esc(t.stage)}</span>` : ''}
      </div>
    </div>`;
  }).join('') : `<div class="empty" style="padding:30px">
      <div class="em-t">当前没有进行中的任务</div>
      <div class="em-d">去「下载游戏」或「内容管理」发起一个吧</div></div>`;

  /* ---- 历史 ---- */
  const shown = hist.filter(h => S.dlFilter === 'all' ? true
    : S.dlFilter === 'done' ? h.status === 'done' : h.status !== 'done');
  $('#dlHistoryCount').textContent = hist.length ? `${shown.length} / ${hist.length} 条` : '';
  const histBox = $('#dlHistory');
  histBox.innerHTML = shown.length ? shown.map(h => {
    const statusLabel = h.status === 'done' ? '成功' : h.status === 'cancelled' ? '已取消' : '失败';
    const color = h.status === 'done' ? 'var(--ok)' : h.status === 'cancelled' ? 'var(--text-mute)' : 'var(--danger)';
    const dur = h.finishedAt && h.createdAt ? Math.round((h.finishedAt - h.createdAt) / 1000) : 0;
    return `<div class="dl-task ${h.status}">
      <div class="dlt-head">
        <span class="dlt-title">${esc(h.title)}</span>
        <span class="dlt-type">${esc(typeName(h.type))}</span>
        <div class="dlt-actions">
          ${h.retrySpec ? `<button class="mini-btn" data-retry="${h.id}">重试</button>` : ''}
          <button class="mini-btn" data-log="${h.id}">日志</button>
        </div>
      </div>
      <div class="dlt-meta">
        <span style="color:${color};font-weight:600">${statusLabel}</span>
        <span>${h.files || 0} 个文件</span>
        <span>${fmtSize(h.bytes || 0)}</span>
        ${dur ? `<span>耗时 ${fmtEta(dur)}</span>` : ''}
        <span>${fmtTime(h.finishedAt)}</span>
      </div>
      ${h.error ? `<div class="dlt-err">${esc(h.error)}</div>` : ''}
    </div>`;
  }).join('') : `<div class="empty" style="padding:30px">
      <div class="em-t">还没有下载记录</div>
      <div class="em-d">完成或失败的任务会记录在这里，可一键重试</div></div>`;

  /* ---- 事件 ---- */
  $$('[data-cancel]', runBox).forEach(b => b.onclick = async () => {
    try { await apiPost('/api/tasks/cancel', { id: b.dataset.cancel }); toast('已请求取消', '', 'warn', 2000); }
    catch (e) { toast('取消失败', e.message, 'error'); }
  });
  $$('[data-retry]', histBox).forEach(b => b.onclick = async () => {
    const h = (S.dlHistory || []).find(x => x.id === b.dataset.retry);
    if (!h?.retrySpec?.api) return toast('这条记录无法重试', '', 'warn');
    try {
      await apiPost(h.retrySpec.api, h.retrySpec.body || {});
      toast('已重新发起', h.title, 'ok');
      ensureTaskPolling();
      setTimeout(loadDownloads, 900);
    } catch (e) { toast('重试失败', e.message, 'error'); }
  });
  $$('[data-log]', histBox).forEach(b => b.onclick = () => {
    const h = (S.dlHistory || []).find(x => x.id === b.dataset.log);
    if (!h) return;
    openModal(`<h2>${esc(h.title)}</h2>
      <p class="modal-sub">${esc(typeName(h.type))} · ${new Date(h.finishedAt || h.createdAt).toLocaleString('zh-CN')}</p>
      <pre>${esc((h.logs || []).join('\n') || '(无日志)')}</pre>`, { cancelText: '关闭', wide: true });
  });
}

/* ------------------------------------------------------------ 自动优化 / 汉化 */

async function renderAutoTune() {
  const box = $('#autotunePreview');
  if (!box) return;
  try {
    const t = await apiGet('/api/autotune' + (S.selected ? '?instance=' + encodeURIComponent(S.selected) : ''));
    S.autotune = t;
    const badge = $('#autoOptBadge');
    badge.textContent = t.autoOptimize ? '已开启' : '已关闭';
    badge.className = 'badge ' + (t.autoOptimize ? 'ok' : 'gray');
    box.innerHTML = `
      <div class="at-head">
        <span class="at-mem">${t.autoOptimize ? t.memoryMb + ' MB' : '不生效'}</span>
        <span class="at-preset">${esc(JVM_PRESETS[t.preset]?.name || t.preset)}</span>
        ${t.manualMemoryMb ? `<span class="at-preset">· 手动值 ${t.manualMemoryMb} MB</span>` : ''}
      </div>
      <ul>${(t.notes || []).map(n => `<li class="${/⚠/.test(n) ? 'warn' : ''}">${esc(n)}</li>`).join('')}</ul>`;
  } catch (e) {
    box.innerHTML = `<span class="at-bad">读取调优信息失败: ${esc(e.message)}</span>`;
  }
}

async function renderCfpaStatus() {
  const badge = $('#cfpaBadge');
  const info = $('#cfpaInfo');
  if (!badge || !info) return;
  if (!S.selected) {
    badge.textContent = '未选择实例';
    badge.className = 'badge gray';
    info.innerHTML = '先在「启动」页选一个实例。';
    return;
  }
  try {
    const r = await apiGet('/api/i18n/status?instance=' + encodeURIComponent(S.selected));
    badge.textContent = r.installed ? (r.enabled ? '已安装' : '已安装·已禁用') : '未安装';
    badge.className = 'badge ' + (r.installed ? (r.enabled ? 'ok' : 'gray') : 'gray');
    const inst = currentInstance();
    info.innerHTML = r.installed
      ? `<span class="at-ok">✓ 检测到 ${esc(r.file)}</span><br>进入游戏后它会自动下载并应用 CFPA 简体中文语言包，模组界面就会变中文。`
      : `目标实例：<b>${esc(inst?.name || '')}</b>（${esc(inst?.version || '')} / ${esc(loaderName(inst?.loader))}）<br>
         需要实例已装模组加载器；原版实例无法使用模组形式的汉化包。`;
  } catch (e) {
    info.innerHTML = `<span class="at-bad">读取失败: ${esc(e.message)}</span>`;
  }
}

/* ------------------------------------------------------------ 设置 */

function renderSettings() {
  const cfg = S.config || {};
  renderThemeGrid();
  $('#setUsername').value = cfg.username || '';

  // 启动优化
  const inst0 = currentInstance();
  const autoOpt = inst0
    ? (inst0.autoOptimize !== undefined ? inst0.autoOptimize : cfg.autoOptimize !== false)
    : (cfg.autoOptimize !== false);
  $('#setAutoOptimize').checked = autoOpt;
  renderAutoTune();
  renderCfpaStatus();
  const mem = currentInstance()?.memory || cfg.memory?.customMb || S.optimize?.recommendedMb || 3072;
  const slider = $('#setMemory');
  slider.max = Math.max(2048, Math.min(16384, Math.floor((S.status?.totalMemMb || 8192) * 0.9)));
  slider.value = mem;
  $('#memShow').textContent = mem >= 1024 ? `${(mem / 1024).toFixed(1)} GB` : `${mem} MB`;
  $('#memRecBadge').textContent = `推荐 ${S.optimize?.recommendedMb || '—'} MB`;

  const presetSel = $('#setJvmPreset');
  presetSel.innerHTML = Object.entries(JVM_PRESETS).map(([k, v]) =>
    `<option value="${k}" ${k === (currentInstance()?.jvmPreset || cfg.jvmPreset || 'aikar') ? 'selected' : ''}>${esc(v.name)}</option>`).join('');
  $('#jvmPresetDesc').textContent = JVM_PRESETS[presetSel.value]?.desc || '';

  $('#setSource').value = cfg.source || 'auto';
  if ($('#setAutoBackup')) $('#setAutoBackup').checked = cfg.autoBackup !== false;
  if ($('#setCfKey') && cfg.curseforgeApiKey) $('#setCfKey').value = cfg.curseforgeApiKey;
  $('#setConcurrency').value = cfg.downloadConcurrency || 12;
  $('#setExtraJvm').value = currentInstance()?.extraJvmArgs || cfg.extraJvmArgs || '';
  const cur = currentInstance();
  $('#memTarget').textContent = cur ? cur.name : '全局默认（新建实例时使用）';
  $('#dataDirPath').textContent = S.status?.dataDir || '—';

  // Java 列表
  const jl = $('#javaList');
  const javas = S.status?.javas || [];
  jl.innerHTML = javas.length
    ? javas.map(j => `<div class="java-row">
        <span class="java-ver">J${j.major}</span>
        <span class="jp" title="${esc(j.path)}">${esc(j.path)}</span>
        ${j.is64 ? '<span class="badge gray">64位</span>' : '<span class="badge gray">32位</span>'}
      </div>`).join('')
    : '<div class="loading-line">未检测到 Java，请点击下方按钮安装</div>';

  renderNotices();
}

function renderNotices() {
  if (S.noticeShown) return;
  S.noticeShown = true;
  const notices = [
    ['BMCLAPI 镜像', 'bangbang93', 'MIT', 'https://github.com/bangbang93/BMCLAPI'],
    ['Modrinth', 'Modrinth 团队', '开放 API', 'https://docs.modrinth.com'],
    ['Mojang 版本清单', 'Mojang Studios', '官方', 'https://www.minecraft.net'],
    ['Fabric / Quilt', 'FabricMC / QuiltMC', 'Apache-2.0', 'https://fabricmc.net'],
    ['Forge / NeoForge', 'MinecraftForge', 'LGPL-2.1', 'https://minecraftforge.net'],
    ['Adoptium JDK', 'Eclipse Adoptium', 'GPL-2.0+CE', 'https://adoptium.net'],
    ["Aikar's Flags", 'Aikar', 'MIT', 'https://mcflags.emc.gs'],
    ['CFPA 简中语言包', 'CFPAOrg 及译者', '见项目页', 'https://github.com/CFPAOrg/Minecraft-Mod-Language-Package'],
    ['I18nUpdateMod', 'CFPAOrg', '见项目页', 'https://modrinth.com/project/PWERr14M'],
    ['MC百科（仅跳转链接）', 'MC百科', '站外链接', 'https://www.mcmod.cn'],
    ['Node.js 运行时', 'OpenJS Foundation', 'MIT', 'https://nodejs.org'],
    ['PCL2（设计参考，未用代码）', 'Meloong-Git', 'MIT', 'https://github.com/Meloong-Git/PCL'],
    ['HMCL（设计参考，未用代码）', 'HMCL-dev', 'GPL-3.0', 'https://github.com/HMCL-dev/HMCL'],
  ];
  $('#noticeList').innerHTML = notices.map(([n, a, l, u]) =>
    `<div class="notice-row"><span class="nn">${esc(n)}</span>
      <span class="nl">${esc(a)} · ${esc(l)} · <a href="${esc(u)}" target="_blank" rel="noopener">${esc(u)}</a></span></div>`).join('');
}

/* ------------------------------------------------------------ 任务轮询 */

let taskTimer = null, logTimer = null, statusTimer = null;

function ensureTaskPolling() {
  if (taskTimer) return;
  taskTimer = setInterval(pollTasks, 1200);
  pollTasks();
}
function ensureLogPolling() {
  if (logTimer) return;
  logTimer = setInterval(pollLog, 1500);
}

async function pollTasks() {
  try {
    const r = await apiGet('/api/tasks');
    S.tasks = r.tasks;
    renderTaskbar();

    // 侧边栏「下载管理」角标
    const runningCount = r.tasks.filter(t => t.status === 'running').length;
    const badge = $('#navDlBadge');
    if (badge) {
      badge.textContent = runningCount ? String(runningCount) : '';
      badge.classList.toggle('hidden', !runningCount);
    }
    // 下载管理页实时刷新（速度/进度）
    if (S.page === 'downloads') renderDownloads();

    // 任务状态变化检测
    for (const t of r.tasks) {
      if (S.handled.has(t.id)) continue;
      if (t.status === 'done' || t.status === 'error' || t.status === 'cancelled') {
        S.handled.add(t.id);
        if (t.status === 'error') toast('任务失败: ' + t.title, t.error?.slice(0, 200) || '', 'error', 8000);
        else if (t.status === 'cancelled') toast('已取消: ' + t.title, '', 'warn', 3000);
        else toast('完成: ' + t.title, t.stage || '', 'ok');
        await refreshAll();
        if (S.page === 'downloads') loadDownloads();
      }
    }
  } catch { }
}

function renderTaskbar() {
  const bar = $('#taskbar');
  const now = Date.now();
  const list = S.tasks.filter(t => t.status === 'running' || (now - t.createdAt) < 25000);
  if (!list.length) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  const body = $('#taskbarBody');
  body.innerHTML = list.slice(0, 6).map(t => {
    const label = t.status === 'error' ? '失败' : t.status === 'done' ? '完成'
      : t.status === 'cancelled' ? '已取消' : (t.percent || 0) + '%';
    return `
    <div class="task-item ${t.status}">
      <div class="ti-head">
        <span class="ti-title">${esc(t.title)}</span>
        <span class="ti-pct">${label}</span>
      </div>
      <div class="ti-bar"><div class="ti-fill" style="width:${t.status === 'error' || t.status === 'done' ? 100 : (t.percent || 0)}%"></div></div>
      <div class="ti-stage">${esc(t.status === 'error' ? (t.error || '').split('\n')[0].slice(0, 120) : (t.stage + (t.detail ? ' · ' + t.detail : '')))}</div>
    </div>`;
  }).join('');
}

async function pollLog() {
  try {
    const r = await apiGet(`/api/game/log?since=${S.logSince}` + (S.selected ? `&instance=${encodeURIComponent(S.selected)}` : ''));
    S.logSince = r.serverTime;
    if (r.logs.length) {
      S.logs.push(...r.logs);
      if (S.logs.length > 800) S.logs = S.logs.slice(-800);
      const box = $('#logBox');
      box.innerHTML = S.logs.map(l => {
        const cls = /error|exception|failed|Caused by/i.test(l.line) ? 'log-err'
          : /warn/i.test(l.line) ? '' : /---/.test(l.line) ? 'log-ok' : '';
        return `<span class="${cls}">${esc(l.line)}</span>`;
      }).join('\n');
      box.scrollTop = box.scrollHeight;
    }
    if (r.running) { S.running = r.running; showLogPanel(); }
    else if (S.logs.length) { S.running = null; }
  } catch { }
}

/* ------------------------------------------------------------ 刷新全局 */

async function refreshAll() {
  try {
    S.status = await apiGet('/api/status');
    S.config = S.status.config;
    renderStatus();
  } catch (e) { console.warn('status', e); }
  try {
    const r = await apiGet('/api/instances');
    S.instances = r.instances;
    if (!S.selected || !S.instances.find(i => i.id === S.selected)) {
      const saved = localStorage.getItem('nova.selected');
      S.selected = (saved && S.instances.find(i => i.id === saved)) ? saved
        : (S.instances[0]?.id || null);
    }
    if (S.page === 'home') { renderHome(); renderHero(); }
    if (S.page === 'instances') renderInstancesPage();
  } catch (e) { console.warn('instances', e); }
}

/* ------------------------------------------------------------ 事件绑定 */

/* ------------------------------------------------------------ 外观绑定 */
/**
 * 主题导入 / 壁纸相关的全部交互。
 * 滑块用「input 事件本地实时预览 + change 事件才落盘」，
 * 拖动时不打服务端，松手才存一条配置。
 */
function bindAppearance() {
  // ---- 主题导入
  const tIn = $('#themeFileInput');
  if ($('#btnThemeImport')) {
    $('#btnThemeImport').onclick = () => tIn.click();
    tIn.onchange = async () => {
      const f = tIn.files && tIn.files[0];
      tIn.value = '';
      if (!f) return;
      if (f.size > 512 * 1024) return toast('文件太大', '主题文件一般只有几 KB', 'warn');
      const text = await f.text();
      await importThemeFile(f.name, text);
    };
    $('#btnThemeOpen').onclick = async () => {
      try { await apiPost('/api/themes/open', {}); }
      catch (e) { toast('打开失败', e.message, 'error'); }
    };
    $('#btnThemeSample').onclick = async () => {
      try {
        const r = await apiGet('/api/themes/sample');
        downloadText('示例主题-熔岩.json', r.json);
        setTimeout(() => downloadText('示例主题-极光.html', r.html), 400);
        toast('示例模板已保存', '改完拖回窗口就能用', 'ok', 5000);
      } catch (e) { toast('获取失败', e.message, 'error'); }
    };
  }

  // ---- 壁纸
  const wIn = $('#wallFileInput');
  if ($('#btnWallpick')) {
    $('#btnWallpick').onclick = () => wIn.click();
    wIn.onchange = async () => {
      const f = wIn.files && wIn.files[0];
      wIn.value = '';
      if (f) await uploadWallpaper(f);
    };
    $('#btnWallClear').onclick = async () => {
      if (!WP.has) return toast('当前没有壁纸', '', 'info');
      openModal('<h2>移除壁纸？</h2><p class="modal-sub">图片文件会从 data/wallpapers 里删掉，恢复需要重新选一张。</p>', {
        okText: '移除', onOk: async () => {
          try { applyWallpaper(await apiPost('/api/wallpaper/clear', {})); toast('壁纸已移除', '', 'ok'); }
          catch (e) { toast('移除失败', e.message, 'error'); }
        },
      });
    };
    $('#btnWallOpen').onclick = async () => {
      try { await apiPost('/api/wallpaper/open', {}); }
      catch (e) { toast('打开失败', e.message, 'error'); }
    };

    const live = () => {
      const root = document.documentElement;
      const dim = Number($('#wpDim').value);
      const op = Number($('#wpOpacity').value) / 100;
      const bl = Number($('#wpBlur').value);
      $('#wpDimVal').textContent = dim + '%';
      $('#wpOpacityVal').textContent = Math.round(op * 100) + '%';
      $('#wpBlurVal').textContent = bl + ' px';
      root.style.setProperty('--wp-dim', dim + '%');
      root.style.setProperty('--wp-opacity', String(op));
      root.style.setProperty('--wp-blur', bl + 'px');
      $('#wpOverlay')?.style.setProperty('--wp-dim', dim + '%');
      return { dim, opacity: op, blur: bl };
    };
    const commit = async () => {
      const p = live();
      Object.assign(WP, p);
      try { localStorage.setItem('nova.wallpaper', JSON.stringify(WP)); } catch { }
      try { await apiPost('/api/wallpaper/config', p); }
      catch (e) { toast('保存失败', e.message, 'error'); }
    };
    ['#wpDim', '#wpOpacity', '#wpBlur'].forEach(sel => {
      const e = $(sel);
      if (!e) return;
      e.oninput = live;
      e.onchange = commit;
    });
    const fit = $('#wpFit');
    if (fit) fit.onchange = async () => {
      const v = fit.value;
      document.documentElement.style.setProperty('--wp-size', v);
      WP.fit = v;
      try { applyWallpaper(await apiPost('/api/wallpaper/config', { fit: v })); }
      catch (e) { toast('保存失败', e.message, 'error'); }
    };
  }
}

/** 让用户把一段文本存成文件（示例模板用） */
function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function bindEvents() {
  $$('.nav-item').forEach(b => b.onclick = () => switchPage(b.dataset.page));
  bindAppearance();

  // 全局接管 [data-url] —— 官网 / MC百科 / 源码 跳转
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-url]');
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    openUrl(b.dataset.url);
  }, true);


/** 拖拽导入：按扩展名分发。存档失败时再让用户选资源包/光影/数据包 */
let _dropOverlay = null;
function showDropHint(text) {
  if (!_dropOverlay) {
    _dropOverlay = el('div', 'drop-overlay');
    _dropOverlay.innerHTML = '<div class="do-box"><div class="do-icon">⤓</div><div class="do-text"></div></div>';
    document.body.appendChild(_dropOverlay);
  }
  _dropOverlay.querySelector('.do-text').textContent = text || '松手即可导入';
  _dropOverlay.style.display = 'grid';
}
function hideDropHint() { if (_dropOverlay) _dropOverlay.style.display = 'none'; }

function askContentKind(inst, file, reason) {
  openModal(`<h2>这个压缩包要装到哪？</h2>
    <p class="modal-sub">${esc(file.name)}<br>
      <span style="color:var(--text-mute)">包里没找到 level.dat（存档的标志）。${esc(reason || '')}</span></p>
    <div class="row-gap">
      <button class="btn btn-soft" data-kind-pick="resourcepack">作为资源包装入</button>
      <button class="btn btn-soft" data-kind-pick="shader">作为光影装入</button>
      <button class="btn btn-soft" data-kind-pick="datapack">作为数据包装入</button>
    </div>`, { cancelText: '取消' });
  $$('[data-kind-pick]').forEach(b => b.onclick = async () => {
    try {
      await apiUpload(`/api/content/upload?instance=${encodeURIComponent(inst.id)}&kind=${b.dataset.kindPick}`, file);
      toast('已导入', file.name, 'ok');
      closeModal();
      if (S.page === 'instances') renderInstTab();
    } catch (e) { toast('导入失败', e.message, 'error'); }
  });
}

const KIND_LABEL = {
  'save': '存档', 'resourcepack': '资源包', 'shader': '光影',
  'datapack': '数据包', 'modpack-mrpack': '整合包', 'modpack-curseforge': '整合包',
  'modpack-raw': '整合包',
};

/**
 * 拖拽导入：交给后端 /api/import/auto 自动识别类型。
 * 存档 / 资源包 / 光影 / 数据包 直接装进当前实例；
 * 整合包会被识别出来，自动新建实例并安装。
 */
async function handleDroppedFiles(files) {
  const inst = currentInstance();
  for (const f of files) {
    const n = f.name.toLowerCase();
    try {
      // 外观类文件跟实例无关，先处理掉
      if (/\.(json|html?|css)$/i.test(n)) {
        if (f.size > 512 * 1024) { toast('文件太大', '主题文件一般只有几 KB：' + f.name, 'warn'); continue; }
        await importThemeFile(f.name, await f.text());
        continue;
      }
      if (/\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(n)) {
        await uploadWallpaper(f);
        continue;
      }
      if (n.endsWith('.jar')) {
        if (!inst) { toast('请先打开一个实例', '在「实例」页点开一个实例', 'warn'); continue; }
        await apiUpload(`/api/content/upload?instance=${encodeURIComponent(inst.id)}&kind=mod`, f);
        toast('已导入模组', f.name, 'ok');
        continue;
      }
      if (!/\.(zip|mcworld|mrpack)$/.test(n)) {
        toast('不支持这种文件', f.name + '（支持 .jar / .zip / .mcworld / .mrpack / 主题文件 / 图片）', 'warn', 5000);
        continue;
      }
      if (!inst) { toast('请先打开一个实例', '在「实例」页点开一个实例', 'warn'); continue; }

      const r = await apiUpload(`/api/import/auto?instance=${encodeURIComponent(inst.id)}`, f);
      const label = KIND_LABEL[r.kind] || '内容';

      if (r.action === 'task') {
        toast(`识别为${label}`, `正在新建实例并安装：${f.name}`, 'ok', 6000);
        ensureTaskPolling();
      } else {
        toast(`已导入${label}`, (r.created || []).join('、'), 'ok', 6000);
      }
    } catch (e) {
      toast('导入失败', f.name + '：' + e.message, 'error', 8000);
    }
  }
  if (S.page === 'instances') renderInstTab();
  await refreshAll();
}
  // 拖拽导入
  let _dragDepth = 0;
  document.addEventListener('dragover', (e) => {
    if (!e.dataTransfer || Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') < 0) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    showDropHint('松手即可导入（模组 / 存档 / 整合包 / 主题 / 壁纸）');
  });
  document.addEventListener('dragenter', (e) => {
    if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') >= 0) _dragDepth++;
  });
  document.addEventListener('dragleave', () => {
    _dragDepth = Math.max(0, _dragDepth - 1);
    if (_dragDepth === 0) hideDropHint();
  });
  document.addEventListener('drop', async (e) => {
    e.preventDefault();
    _dragDepth = 0;
    hideDropHint();
    const files = e.dataTransfer && e.dataTransfer.files ? Array.prototype.slice.call(e.dataTransfer.files) : [];
    if (!files.length) return;
    await handleDroppedFiles(files);
  });
  // 全局接管 [data-detail] —— 打开内容详情面板
  document.addEventListener('click', (e) => {
    const d = e.target.closest('[data-detail]');
    if (!d) return;
    e.preventDefault();
    e.stopPropagation();
    openDetail(d.dataset.detail, { kind: d.dataset.kind || undefined });
  }, true);

  $('#btnRefresh').onclick = async () => {
    $('#btnRefresh').classList.add('spin');
    await refreshAll();
    await renderOptimize();
    if (S.page === 'download') { await loadVersions(true); await loadInstalledVersions(); }
    if (S.page === 'instances') renderInstancesPage();
    setTimeout(() => $('#btnRefresh').classList.remove('spin'), 500);
  };

  $('#btnHeroPlay').onclick = () => { if (S.selected) launch(S.selected); };
  $('#btnHeroFolder').onclick = () => { if (S.selected) apiPost('/api/instances/open', { id: S.selected }).catch(() => { }); };
  $('#btnNewInstance').onclick = newInstanceWizard;
  $('#btnApplyRec').onclick = async () => {
    const rec = S.optimize?.recommendedMb;
    if (!rec) return;
    if (S.selected) await apiPost('/api/instances/update', { id: S.selected, memory: rec, jvmPreset: 'aikar' });
    else await apiPost('/api/config', { memory: { customMb: rec }, jvmPreset: 'aikar' });
    toast('已应用推荐配置', `${rec} MB + Aikar 优化`, 'ok');
    await refreshAll(); renderOptimize();
  };

  // 下载页
  $$('.dl-tab').forEach(b => b.onclick = () => {
    S.dlMode = b.dataset.mode;
    $$('.dl-tab').forEach(x => x.classList.toggle('active', x === b));
    $('#dlVanilla').classList.toggle('hidden', S.dlMode !== 'vanilla');
    $('#dlLoader').classList.toggle('hidden', S.dlMode !== 'loader');
  });
  $('#verSearch').oninput = () => renderVersions();
  $('#verSnapshots').onchange = () => loadVersions(true);
  $('#btnReloadVersions').onclick = () => loadVersions(true);
  $('#loaderMc').onchange = loadLoaderVersions;
  $('#loaderType').onchange = loadLoaderVersions;
  $('#btnInstallLoader').onclick = async () => {
    const mcVersion = $('#loaderMc').value.trim();
    const loader = $('#loaderType').value;
    const loaderVersion = $('#loaderVersion').value || undefined;
    if (!/^[\w.\-+]+$/.test(mcVersion)) { toast('版本号格式不对', '例如 1.20.1', 'error'); return; }
    try {
      await apiPost('/api/versions/install-loader', { mcVersion, loader, loaderVersion });
      toast('开始安装', `${loaderName(loader)} ${loaderVersion || '最新'} / MC ${mcVersion}`, 'ok');
      ensureTaskPolling();
    } catch (e) { toast('安装失败', e.message, 'error'); }
  };

  // 内容下载页（只管搜索与安装）
  $('#storeKind').onchange = () => doStoreSearch();
  $('#storeInstance').onchange = () => { S.selected = $('#storeInstance').value; };
  $('#btnStoreSearch').onclick = doStoreSearch;
  $('#storeQuery').onkeydown = e => { if (e.key === 'Enter') doStoreSearch(); };
  $('#btnPackImport').onclick = () => {
    const inp = $('#fileInput');
    inp.accept = '.mrpack,.zip';
    inp.onchange = async () => {
      const f = inp.files[0];
      if (!f) return;
      try {
        const up = await apiUpload('/api/pack/upload', f);
        if (/\.mrpack$/i.test(f.name)) {
          await apiPost('/api/pack/install', { path: up.path, name: up.name });
        } else {
          await apiPost('/api/pack/import-zip', { path: up.path, name: up.name });
        }
        toast('开始安装整合包', f.name, 'ok');
        ensureTaskPolling();
      } catch (e) { toast('导入失败', e.message, 'error'); }
      inp.value = '';
    };
    inp.click();
  };


  // 数据源切换
  if ($('#storeSource')) $('#storeSource').onchange = () => doStoreSearch();

  // CurseForge API Key
  async function refreshCfStatus() {
    const badge = $('#cfBadge');
    if (!badge) return;
    try {
      const st = await apiGet('/api/cf/status');
      if (!st.configured) { badge.textContent = '未配置'; badge.className = 'badge gray'; return; }
      badge.textContent = st.ok ? '可用' : ('不可用');
      badge.className = 'badge ' + (st.ok ? 'ok' : 'bad');
      const sel = $('#storeSource');
      if (sel) {
        const opt = Array.from(sel.options).find(o => o.value === 'curseforge');
        if (opt) opt.disabled = !st.ok;
      }
    } catch (e) { }
  }
  if ($('#btnCfSave')) $('#btnCfSave').onclick = async () => {
    const k = ($('#setCfKey').value || '').trim();
    if (!k) return toast('请先粘贴 API Key', '', 'warn');
    try {
      await apiPost('/api/config', { curseforgeApiKey: k });
      toast('已保存，正在测试…', '', 'info');
      S.config = (await apiGet('/api/config')).config;
      await refreshCfStatus();
      const st = await apiGet('/api/cf/status');
      if (st.ok) toast('CurseForge Key 可用', '现在可以在内容下载里切换数据源了', 'ok', 5000);
      else toast('Key 测试失败', st.error || '', 'error', 8000);
    } catch (e) { toast('保存失败', e.message, 'error'); }
  };
  if ($('#btnCfClear')) $('#btnCfClear').onclick = async () => {
    await apiPost('/api/config', { curseforgeApiKey: '' });
    if ($('#setCfKey')) $('#setCfKey').value = '';
    await refreshCfStatus();
    toast('已清除', '', 'ok');
  };
  refreshCfStatus();

  if ($('#btnNewInst2')) $('#btnNewInst2').onclick = newInstanceWizard;
  if ($('#btnBackToList')) $('#btnBackToList').onclick = () => {
    INST.detailId = null;
    renderInstancesPage();
  };

  // 设置
  const saveCfg = debounce(async (patch) => {
    try { await apiPost('/api/config', patch); S.config = { ...S.config, ...patch }; }
    catch (e) { toast('保存失败', e.message, 'error'); }
  }, 400);

  $('#setUsername').onchange = e => saveCfg({ username: e.target.value.trim() });
  $('#setMemory').oninput = e => {
    const v = Number(e.target.value);
    $('#memShow').textContent = v >= 1024 ? `${(v / 1024).toFixed(1)} GB` : `${v} MB`;
  };
  $('#setMemory').onchange = async e => {
    const v = Number(e.target.value);
    if (S.selected) { await apiPost('/api/instances/update', { id: S.selected, memory: v }); await refreshAll(); }
    else await saveCfg({ memory: { customMb: v } });
    toast('内存已设为 ' + v + ' MB', '', 'ok');
    renderOptimize();
  };
  $('#setJvmPreset').onchange = async e => {
    const v = e.target.value;
    $('#jvmPresetDesc').textContent = JVM_PRESETS[v]?.desc || '';
    if (S.selected) { await apiPost('/api/instances/update', { id: S.selected, jvmPreset: v }); await refreshAll(); }
    else await saveCfg({ jvmPreset: v });
    toast('JVM 预设已更新', JVM_PRESETS[v]?.name || v, 'ok');
  };
  $('#setExtraJvm').onchange = async e => {
    const v = e.target.value;
    if (S.selected) await apiPost('/api/instances/update', { id: S.selected, extraJvmArgs: v });
    else await saveCfg({ extraJvmArgs: v });
  };
  $('#setSource').onchange = e => { saveCfg({ source: e.target.value }); toast('下载源已更新', e.target.selectedOptions[0].text, 'ok'); };
  $('#setConcurrency').onchange = e => saveCfg({ downloadConcurrency: Number(e.target.value) || 12 });

  // 启动时自动内存优化
  $('#setAutoOptimize').onchange = async e => {    const v = e.target.checked;
    try {
      if (S.selected) await apiPost('/api/instances/update', { id: S.selected, autoOptimize: v });
      else await apiPost('/api/config', { autoOptimize: v });
      toast(v ? '已开启自动内存优化' : '已关闭自动内存优化',
        v ? '每次启动会按当时的可用内存重新计算' : '改为使用手动内存设置', 'ok');
      await refreshAll();
      renderSettings();
    } catch (err) { toast('保存失败', err.message, 'error'); }
  };

  // 汉化包
  $('#btnInstallCfpa').onclick = async () => {
    const inst = currentInstance();
    if (!inst) return toast('请先选择一个实例', '在「启动」页点击实例卡片', 'warn');
    if (!inst.loader || inst.loader === 'vanilla') {
      return toast('原版实例不支持', '请先创建 Fabric/Forge/NeoForge 实例', 'warn', 6000);
    }
    try {
      await apiPost('/api/i18n/install', { instance: inst.id });
      toast('开始安装汉化包', 'CFPA 简中语言包（I18nUpdateMod）', 'ok');
      ensureTaskPolling();
      setTimeout(renderCfpaStatus, 3000);
    } catch (e) { toast('安装失败', e.message, 'error'); }
  };
  $('#btnCfpaStatus').onclick = () => renderCfpaStatus();
  $('#btnDetectJava').onclick = async () => {
    try { await apiGet('/api/java?refresh=1'); S.status = await apiGet('/api/status'); renderStatus(); renderSettings(); toast('已重新检测', '', 'ok'); }
    catch (e) { toast('检测失败', e.message, 'error'); }
  };
  $$('[data-install-java]').forEach(b => b.onclick = async () => {
    const v = b.dataset.installJava;
    await apiPost('/api/java/install', { major: Number(v) });
    toast('开始下载 Java ' + v, '来自 Adoptium 官方', 'info');
    ensureTaskPolling();
  });
  $('#btnShowNotice').onclick = async () => {
    try {
      const r = await apiGet('/api/about');
      openModal(`<h2>开源归属与致谢</h2>
        <p class="modal-sub">本项目使用、调用或借鉴的全部第三方成果。源码同内容见仓库根目录 <code>开源归属与致谢.md</code>。</p>
        <pre>${esc(r.markdown)}</pre>`, { cancelText: '关闭', wide: true });
    } catch (e) { toast('读取失败', e.message, 'error'); }
  };

  // 日志
  $('#btnClearLog').onclick = async () => {
    await apiPost('/api/game/clear-log').catch(() => { });
    S.logs = []; $('#logBox').innerHTML = '';
  };
  $('#btnKillGame').onclick = async () => {
    try { await apiPost('/api/kill'); toast('已请求结束游戏', '', 'warn'); }
    catch (e) { toast('操作失败', e.message, 'error'); }
  };

  // 数据快照
  const fmtSize = (n) => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : (n / 1024).toFixed(0) + ' KB';
  async function renderBackups() {
    const box = $('#backupList');
    if (!box) return;
    try {
      const r = await apiGet('/api/backup/list');
      if (!r.items.length) {
        box.innerHTML = '<p class="hint">还没有快照。点「立即备份」建一份，之后每天会自动存。</p>';
        return;
      }
      box.innerHTML = r.items.map(it => `
        <div class="backup-row">
          <div class="backup-main">
            <b>${esc(it.file.replace(/^snapshot-|\.zip$/g, ''))}</b>
            <span class="backup-meta">${fmtSize(it.size)} · ${it.instances ?? '?'} 个实例 · ${it.files ?? '?'} 个文件 · ${esc(it.reason)}</span>
          </div>
          <div class="backup-acts">
            <button class="btn btn-soft btn-xs" data-restore="${esc(it.file)}">恢复</button>
            <button class="btn btn-ghost btn-xs" data-del="${esc(it.file)}">删除</button>
          </div>
        </div>`).join('');
      $$('[data-restore]', box).forEach(b => b.onclick = () => doRestore(b.dataset.restore));
      $$('[data-del]', box).forEach(b => b.onclick = () => {
        openModal(`<h2>删除这份快照？</h2><p class="modal-sub">${esc(b.dataset.del)}<br>删除后不可恢复。</p>`, {
          okText: '删除', onOk: async () => {
            await apiPost('/api/backup/delete', { file: b.dataset.del });
            toast('已删除', '', 'ok');
            renderBackups();
          },
        });
      });
    } catch (e) {
      box.innerHTML = `<p class="hint">读取失败：${esc(e.message)}</p>`;
    }
  }
  async function doRestore(file) {
    let plan;
    try { plan = (await apiPost('/api/backup/restore', { file })).plan; }
    catch (e) { return toast('无法读取快照', e.message, 'error'); }
    openModal(`
      <h2>恢复这份快照？</h2>
      <p class="modal-sub">${esc(file)}</p>
      <div class="notice ok">
        将覆盖：设置${plan.config ? '' : '（无）'}、
        ${plan.instances.length} 个实例的配置、${plan.saves} 个存档文件、
        ${plan.themes} 个自定义主题${plan.wallpaper ? '、当前壁纸' : ''}。
        <br>当前状态会先自动存一份「恢复前存档」，点错了还能退回来。
      </div>`, {
      okText: '确认恢复', onOk: async () => {
        try {
          const r = await apiPost('/api/backup/restore', { file, confirm: true });
          toast('恢复完成', `${r.restored} 个文件已还原，重启启动器后设置生效` +
            (r.safety ? `；恢复前状态存于 ${r.safety}` : ''), 'ok', 8000);
          renderBackups();
        } catch (e) { toast('恢复失败', e.message, 'error'); }
      },
    });
  }
  if ($('#btnBackupNow')) {
    $('#btnBackupNow').onclick = async () => {
      const b = $('#btnBackupNow');
      b.disabled = true; b.textContent = '备份中…';
      try {
        const r = await apiPost('/api/backup/now', { reason: '手动' });
        toast('备份完成', `${r.item.file} · ${fmtSize(r.item.size)}`, 'ok');
        renderBackups();
      } catch (e) { toast('备份失败', e.message, 'error'); }
      finally { b.disabled = false; b.textContent = '立即备份'; }
    };
    $('#btnBackupOpen').onclick = async () => {
      try { await apiPost('/api/backup/open', {}); }
      catch (e) { toast('打开失败', e.message, 'error'); }
    };
    $('#setAutoBackup').onchange = async e => {
      const v = e.target.checked;
      try {
        await apiPost('/api/config', { autoBackup: v });
        toast(v ? '已开启每日自动备份' : '已关闭自动备份',
          v ? '每天第一次启动时自动存一份' : '仍可随时点「立即备份」', 'ok');
      } catch (err) { toast('保存失败', err.message, 'error'); }
    };
    renderBackups();
  }

  // 工具与维护
  $$('[data-open]').forEach(b => b.onclick = async () => {
    try { await apiPost('/api/system/open', { target: b.dataset.open }); }
    catch (e) { toast('打开失败', e.message, 'error'); }
  });
  $('#btnClearCache').onclick = async () => {
    try { await apiPost('/api/system/clear-cache'); toast('已清理', '图标缓存已清空', 'ok'); }
    catch (e) { toast('清理失败', e.message, 'error'); }
  };
  $('#btnShowServerLog').onclick = async () => {
    try {
      const r = await apiGet('/api/system/server-log');
      openModal(`<h2>服务日志</h2><p class="modal-sub">启动器本地服务的最近输出</p>
        <pre>${esc(r.log)}</pre>`, { cancelText: '关闭', wide: true });
    } catch (e) { toast('读取失败', e.message, 'error'); }
  };

  // 任务面板折叠
  $('#btnToggleTasks').onclick = () => $('#taskbar').classList.toggle('collapsed');

  // 下载管理
  $('#btnCancelAll').onclick = async () => {
    const running = (S.tasks || []).filter(t => t.status === 'running');
    if (!running.length) return;
    for (const t of running) await apiPost('/api/tasks/cancel', { id: t.id }).catch(() => { });
    toast('已请求取消', `${running.length} 个任务`, 'warn');
  };
  $('#btnClearHistory').onclick = () => {
    openModal('<h2>清空下载历史？</h2><p class="modal-sub">只会删除记录，不会删除已下载的游戏文件。</p>', {
      okText: '清空', onOk: async () => {
        await apiPost('/api/downloads/clear-history', {});
        S.dlHistory = [];
        renderDownloads();
        toast('历史已清空', '', 'ok');
      },
    });
  };
  $$('#dlFilter .kind-tab').forEach(b => b.onclick = () => {
    S.dlFilter = b.dataset.f;
    $$('#dlFilter .kind-tab').forEach(x => x.classList.toggle('active', x === b));
    renderDownloads();
  });
}

async function loadLoaderVersions() {
  const loader = $('#loaderType').value;
  const mc = $('#loaderMc').value.trim();
  const sel = $('#loaderVersion');
  if (!mc) return;
  sel.innerHTML = '<option value="">读取中…</option>';
  try {
    const r = await apiPost('/api/loaders', { loader, mcVersion: mc });
    sel.innerHTML = '<option value="">自动选择最新</option>' +
      r.loaders.slice(0, 60).map(l => `<option value="${esc(l.version)}">${esc(l.version)}${l.stable ? '' : ' (测试版)'}</option>`).join('');
    if (!r.loaders.length) sel.innerHTML = '<option value="">该版本无可用加载器</option>';
  } catch (e) {
    sel.innerHTML = '<option value="">读取失败（可留空自动）</option>';
  }
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/* ------------------------------------------------------------ 启动流程 */

async function boot() {
  bindEvents();

  // 主题先落定，避免首屏闪色。?theme=xxx 只用于临时预览，不写入本地设置
  // 自定义主题/壁纸用本地缓存先垫上，再去服务端校正，这样不会先白一下再变
  try { rebuildThemeList(JSON.parse(localStorage.getItem('nova.themes') || '[]')); } catch { }
  try {
    const wpCache = JSON.parse(localStorage.getItem('nova.wallpaper') || 'null');
    if (wpCache) applyWallpaper(wpCache);
  } catch { }
  const urlTheme = new URLSearchParams(location.search).get('theme');
  applyTheme(urlTheme || localStorage.getItem('nova.theme') || 'nova', false, !urlTheme);

  await refreshAll();
  await renderOptimize();
  renderSettings();

  // 服务端的主题/壁纸才是准的（可能别的窗口改过）
  await Promise.all([
    loadThemes().then(r => {
      const key = urlTheme || (S.config && S.config.theme) || localStorage.getItem('nova.theme') || 'nova';
      if (r && document.documentElement.dataset.theme !== key) applyTheme(key, false, !urlTheme);
    }),
    loadWallpaper(),
  ]);


  const saved = localStorage.getItem('nova.selected');
  if (saved && S.instances.find(i => i.id === saved)) S.selected = saved;

  ensureTaskPolling();
  ensureLogPolling();
  statusTimer = setInterval(async () => {
    try { S.status = await apiGet('/api/status'); renderStatus(); }
    catch { }
  }, 8000);

  if (S.page === 'home') { renderHome(); renderHero(); }
  switchPage('home');


  // 支持 ?page=download 之类的深链接（也方便做桌面快捷方式）
  const qs = new URLSearchParams(location.search);
  // ?inst=<实例id>&tab=mods 直接进实例详情的某个子项
  const instParam = qs.get('inst');
  if (instParam) {
    INST.detailId = instParam;
    if (qs.get('tab')) INST.tab = qs.get('tab');
  }
  const initPage = qs.get('page');
  if (initPage && PAGE_META[initPage]) switchPage(initPage);

  // ?q=<关键词> 直接带着关键词进内容下载页搜索
  const initQuery = qs.get('q');
  if (initQuery) {
    setTimeout(() => {
      if (!$('#storeQuery')) return;
      if (S.page !== 'store') switchPage('store');
      $('#storeQuery').value = initQuery;
      doStoreSearch();
    }, 900);
  }

  // ?detail=<项目id或slug> 直接打开某个内容的详情面板
  const dm = qs.get('detail');
  if (dm) setTimeout(() => openDetail(dm, { kind: qs.get('kind') || undefined }), 600);
}

boot();

/**
 * 给「加载器类型 + 版本」下拉填充可选版本。
 * 原则：不留空——加载完直接选中第一个（最新）版本，用户想改再改。
 */
async function fillLoaderVersions(loaderSel, mcVersion, verSel) {
  const loader = loaderSel.value;
  if (!loader || loader === 'vanilla') {
    verSel.disabled = true;
    verSel.innerHTML = '<option value="">原版无需加载器</option>';
    return;
  }
  verSel.disabled = false;
  verSel.innerHTML = '<option value="">读取中…</option>';
  if (!mcVersion) {
    verSel.innerHTML = '<option value="">请先选择 Minecraft 版本</option>';
    return;
  }
  try {
    const r = await apiPost('/api/loaders', { loader, mcVersion });
    const list = r.loaders || [];
    if (!list.length) {
      verSel.innerHTML = `<option value="">${loaderName(loader)} 没有适配 ${esc(mcVersion)} 的构建</option>`;
      return;
    }
    // 默认选中第一个（最新稳定版），不留空
    verSel.innerHTML = list.slice(0, 120).map((l, i) =>
      `<option value="${esc(l.version)}"${i === 0 ? ' selected' : ''}>${esc(l.version)}${l.stable === false ? '（测试版）' : ''}</option>`).join('');
  } catch (e) {
    verSel.innerHTML = `<option value="">读取失败：${esc(e.message.slice(0, 40))}</option>`;
  }
}

/** 生成 Minecraft 版本下拉选项：已装版本优先，再接官方清单 */
async function buildMcVersionOptions(includeAll) {
  const opts = [];
  const seen = new Set();
  for (const v of (S.installed || [])) {
    if (v.inheritsFrom) continue;
    opts.push({ id: v.id, label: `${v.id}（已安装）` });
    seen.add(v.id);
  }
  if (includeAll) {
    try { if (!S.versions.length) await loadVersions(); } catch { }
    for (const v of (S.versions || [])) {
      if (seen.has(v.id)) continue;
      opts.push({ id: v.id, label: v.id + (v.type === 'release' ? '' : `（${v.type}）`) });
      if (opts.length > 120) break;
    }
  }
  return opts;
}

function mcVersionSelectHtml(opts, selected) {
  const sel = selected || (opts[0] && opts[0].id) || '';
  return `<select id="__mcSel">${opts.map(o =>
    `<option value="${esc(o.id)}"${o.id === sel ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
}
/** 下载页「模组加载器」的 Minecraft 版本下拉（不留空） */
async function fillLoaderMcVersions() {
  const sel = $('#loaderMc');
  if (!sel) return;
  if (sel.dataset.filled === '1') return;
  const opts = await buildMcVersionOptions(true);
  const cur = (sel.value || '').trim();
  const list = opts.length ? opts : [{ id: '1.20.1', label: '1.20.1' }];
  sel.innerHTML = list.map(o =>
    `<option value="${esc(o.id)}"${o.id === cur ? ' selected' : ''}>${esc(o.label)}</option>`).join('');
  // 没有匹配到就选第一个，绝不留空
  if (!sel.value && sel.options.length) sel.selectedIndex = 0;
  sel.dataset.filled = '1';
  loadLoaderVersions();
}
/** 更换实例的模组加载器 */
function openChangeLoader(inst) {
  openModal(`<h2>更换模组加载器</h2>
    <p class="modal-sub">当前：<b>${esc(loaderName(inst.loader))}${inst.loaderVersion ? ' ' + esc(inst.loaderVersion) : ''}</b>
      · Minecraft ${esc(inst.version)}<br>
      会重新安装对应版本；存档与截图不受影响，但原模组可能不兼容。</p>
    <div class="form-grid">
      <div class="field"><label>新的加载器</label>
        <select id="clLoader">
          <option value="vanilla">原版（去掉加载器）</option>
          <option value="fabric">Fabric</option>
          <option value="neoforge">NeoForge</option>
          <option value="forge">Forge</option>
          <option value="quilt">Quilt</option>
        </select></div>
      <div class="field"><label>加载器版本</label>
        <select id="clVer"><option value="">读取中…</option></select></div>
    </div>`, {
    okText: '开始更换', onOk: async (box) => {
      const loader = $('#clLoader', box).value;
      const lv = $('#clVer', box).value;
      if (loader !== 'vanilla' && !lv) {
        toast('请选择加载器版本', '下拉框还没加载好，稍等一下', 'warn');
        return false;
      }
      try {
        await apiPost('/api/instances/change-loader', { id: inst.id, loader, loaderVersion: lv || undefined });
        toast('开始更换加载器', '进度在右下角任务队列', 'ok');
        ensureTaskPolling();
        return true;
      } catch (e) { toast('更换失败', e.message, 'error'); return false; }
    },
  });
  const lSel = $('#clLoader'), vSel = $('#clVer');
  if (!lSel || !vSel) return;
  lSel.value = inst.loader || 'vanilla';
  const refresh = () => fillLoaderVersions(lSel, inst.version, vSel);
  lSel.onchange = refresh;
  refresh();
}
/* ------------------------------------------------------------ CurseForge 搜索 */

async function doCfSearch(kind) {
  const box = $('#storeResults');
  const q = ($('#storeQuery').value || '').trim();
  const inst = S.instances.find(i => i.id === storeInstanceId());
  try {
    const r = await apiGet(`/api/cf/search?query=${encodeURIComponent(q)}&kind=${kind}`
      + `&mcVersion=${encodeURIComponent(inst?.version || '')}`
      + `&loader=${encodeURIComponent(kind === 'mod' ? (inst?.loader || '') : '')}&limit=24`);
    STORE.hits = (r.hits || []).map(h => ({ ...h, sourceKind: 'curseforge' }));
    STORE.total = r.total || 0;
    STORE.queryInfo = null;
    renderStoreResults();
  } catch (e) {
    box.innerHTML = `<div class="loading-line">CurseForge 搜索失败：${esc(e.message)}</div>`;
  }
}

/** CurseForge 项目：拉文件列表后选版本安装 */
async function openCfInstall(hit) {
  const inst = S.instances.find(i => i.id === storeInstanceId());
  if (!inst) return toast('请先选择实例', '', 'warn');
  openModal(`<h2>${esc(hit.title)}</h2>
    <p class="modal-sub">CurseForge · 为 ${esc(inst.name)}（${esc(inst.version)} / ${esc(loaderName(inst.loader))}）选择文件</p>
    <div id="cfFileBox" class="mr-results"><div class="loading-line">读取文件列表…</div></div>`,
    { cancelText: '关闭', wide: true });
  try {
    const kind = STORE.kind || 'mod';
    const r = await apiGet(`/api/cf/files?id=${encodeURIComponent(hit.id)}`
      + `&mcVersion=${encodeURIComponent(inst.version)}&loader=${encodeURIComponent(inst.loader)}`);
    const box = $('#cfFileBox');
    if (!r.files.length) { box.innerHTML = '<div class="loading-line">没有适配当前版本/加载器的文件</div>'; return; }
    box.innerHTML = '';
    for (const f of r.files.slice(0, 40)) {
      const row = el('div', 'mr-item');
      const rel = f.releaseType === 1 ? '正式' : f.releaseType === 2 ? '测试' : '内测';
      const blocked = !f.downloadUrl;
      row.innerHTML = `
        <div class="mr-body">
          <div class="mr-title">${esc(f.displayName)}</div>
          <div class="mr-stats">
            <span>${esc(f.fileName)}</span>
            <span>${fmtSize(f.fileLength)}</span>
            <span>${rel}</span>
            <span>${f.fileDate ? fmtTime(new Date(f.fileDate).getTime()) : ''}</span>
            ${blocked ? '<span style="color:var(--warn)">作者禁止第三方下载</span>' : ''}
          </div>
        </div>
        <div class="mr-side">
          ${blocked
            ? `<button class="btn btn-soft btn-sm" data-url="${esc(hit.source || '')}">去网页下载</button>`
            : `<button class="btn btn-primary btn-sm" data-cf-install="${esc(f.id)}">安装</button>`}
        </div>`;
      box.appendChild(row);
    }
    $$('[data-cf-install]', box).forEach(b => b.onclick = async () => {
      const f = r.files.find(x => x.id === b.dataset.cfInstall);
      b.disabled = true; b.textContent = '安装中';
      try {
        await apiPost('/api/cf/install', {
          instance: inst.id, kind, modId: hit.id, fileId: f.id,
          fileName: f.fileName, fileSize: f.fileLength, downloadUrl: f.downloadUrl,
          slug: hit.slug, title: hit.title, websiteUrl: hit.source,
        });
        toast('开始下载', f.fileName, 'ok');
        closeModal();
        ensureTaskPolling();
      } catch (e) { toast('安装失败', e.message, 'error'); b.disabled = false; b.textContent = '安装'; }
    });
  } catch (e) {
    $('#cfFileBox').innerHTML = `<div class="loading-line">读取失败：${esc(e.message)}</div>`;
  }
}

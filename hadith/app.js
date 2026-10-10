// Энциклопедия хадисов — мини-приложение Telegram.
// Данные: HadeethEnc.com (русская версия — копия в ./data, остальные языки — напрямую из API).

const CFG = {
  api: "https://hadeethenc.com/api/v1",
  mirror: "./data",
  bot: "Hadis_1234bot", // запасное имя; настоящее приходит с botInfo
  botInfo: "https://knigaletit88-uxgithubio-hadith-verc.vercel.app/api/info",
  appUrl: "https://knigaletit88-ux.github.io/hadith/",
  siteHome: "https://sarhaan.com/hadeeth/ru/",
  siteHadith: (lang, id) => `https://sarhaan.com/hadeeth/${lang}/${id}/`,
  defaultLang: "ru",
};

const tg = window.Telegram?.WebApp;
const IN_TG = Boolean(tg && tg.platform && tg.platform !== "unknown");
const app = document.getElementById("app");
const DAY = 864e5;

// ------------------------------------------------------------------ утилиты

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const safe = (fn) => { try { return fn(); } catch { return undefined; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const plural = (n, one, few, many) => {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? few : many;
};
const hadithWord = (n) => `${n.toLocaleString("ru-RU")} ${plural(n, "хадис", "хадиса", "хадисов")}`;
const paras = (t) => String(t || "").replace(/\r/g, "").split(/\n+/).map((s) => s.trim()).filter(Boolean);
const isRtl = (t) => {
  const letters = String(t).match(/\p{L}/gu) || [];
  const rtl = letters.filter((c) => /[\u0590-\u08FF\uFB1D-\uFEFF]/.test(c)).length;
  return letters.length > 0 && rtl / letters.length > 0.4;
};

function normalize(text) {
  return String(text || "")
    .normalize("NFKC").toLowerCase().replace(/ё/g, "е")
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g, "")
    .replace(/[إأآٱ]/g, "ا").replace(/ى/g, "ي")
    .replace(/[\p{P}\p{S}\s]+/gu, " ").trim();
}

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function haptic(kind = "light") {
  if (!IN_TG) return;
  safe(() => (kind === "success" || kind === "error" ? tg.HapticFeedback.notificationOccurred(kind) : tg.HapticFeedback.impactOccurred(kind)));
}

let toastTimer;
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
}

function openLink(url) {
  if (IN_TG) {
    if (url.startsWith("https://t.me/")) safe(() => tg.openTelegramLink(url));
    else safe(() => tg.openLink(url));
  } else {
    window.open(url, "_blank", "noopener");
  }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.append(ta);
    ta.select();
    safe(() => document.execCommand("copy"));
    ta.remove();
  }
  haptic("success");
  toast("Скопировано");
}

// ---------------------------------------------------------------- хранилище

const LS = {
  get(key, fallback) {
    try { const v = localStorage.getItem("he:" + key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem("he:" + key, JSON.stringify(value)); return true; } catch { return false; }
  },
  del(key) { safe(() => localStorage.removeItem("he:" + key)); },
};

const cloud = IN_TG && tg.CloudStorage && safe(() => tg.isVersionAtLeast("6.9")) ? tg.CloudStorage : null;
function cloudSet(key, value) { if (cloud) safe(() => cloud.setItem(key, value, () => {})); }
function cloudGet(keys) {
  return new Promise((resolve) => {
    if (!cloud) return resolve({});
    const timer = setTimeout(() => resolve({}), 1500);
    safe(() => cloud.getItems(keys, (err, values) => { clearTimeout(timer); resolve(err ? {} : values || {}); }));
  });
}

const state = {
  lang: LS.get("lang", CFG.defaultLang),
  favs: LS.get("favs", []), // [{id, lang, title}]
  query: "",
  langNames: LS.get("langNames", {}),
  bot: LS.get("bot", CFG.bot),
};

// Имя бота берём у сервера бота: после смены токена ссылки сами ведут на нового бота
async function refreshBotName() {
  try {
    const res = await fetch(CFG.botInfo);
    const info = await res.json();
    if (info?.username && info.username !== state.bot) {
      state.bot = info.username;
      LS.set("bot", info.username);
    }
  } catch { /* сервер недоступен — остаётся сохранённое имя */ }
}

function saveFavs() {
  LS.set("favs", state.favs);
  let packed = state.favs.map((f) => `${f.lang}:${f.id}`).join(",");
  while (packed.length > 4000) packed = packed.slice(packed.indexOf(",") + 1);
  cloudSet("favs", packed);
}
const isFav = (id, lang) => state.favs.some((f) => f.id === id && f.lang === lang);

async function syncFromCloud() {
  const values = await cloudGet(["lang", "favs"]);
  let changed = false;
  if (values.lang && values.lang !== state.lang && !LS.get("langLocal")) {
    state.lang = values.lang;
    LS.set("lang", state.lang);
    changed = true;
  }
  for (const item of String(values.favs || "").split(",").filter(Boolean)) {
    const [lang, id] = item.split(":");
    if (id && !isFav(id, lang)) { state.favs.push({ id, lang, title: "" }); changed = true; }
  }
  if (changed) LS.set("favs", state.favs);
  return changed;
}

// ---------------------------------------------------------------------- API

class NotFound extends Error {}
const memo = new Map();
let mirrorMeta = null;

async function fetchJson(url) {
  if (memo.has(url)) return memo.get(url);
  const promise = (async () => {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url);
        if (res.status === 404) throw new NotFound(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
      } catch (err) {
        if (err instanceof NotFound) throw err;
        lastError = err;
        await sleep(400 * 2 ** attempt);
      }
    }
    throw lastError;
  })();
  memo.set(url, promise);
  promise.catch(() => memo.delete(url));
  return promise;
}

function apiUrl(path, params = {}) {
  const url = new URL(CFG.api + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

async function cachedLS(key, ttl, loader) {
  const hit = LS.get("c:" + key);
  if (hit && Date.now() - hit.t < ttl) return hit.v;
  try {
    const value = await loader();
    if (!LS.set("c:" + key, { t: Date.now(), v: value })) pruneCache();
    return value;
  } catch (err) {
    if (hit) return hit.v;
    throw err;
  }
}

function pruneCache() {
  safe(() => {
    for (const k of Object.keys(localStorage)) if (k.startsWith("he:c:idx:")) localStorage.removeItem(k);
  });
}

async function mirrorLangs() {
  if (!mirrorMeta) mirrorMeta = fetchJson(`${CFG.mirror}/meta.json`).catch(() => ({ langs: [] }));
  return (await mirrorMeta).langs || [];
}
const hasMirror = async (lang) => (await mirrorLangs()).includes(lang);

const DB = {
  async languages() {
    const list = await cachedLS("langs", 7 * DAY, async () => {
      try { return await fetchJson(`${CFG.mirror}/languages.json`); } catch { return await fetchJson(apiUrl("/languages")); }
    });
    const names = Object.fromEntries(list.map((l) => [l.code, l.native]));
    if (Object.keys(names).length) { state.langNames = names; LS.set("langNames", names); }
    return list;
  },

  async categories(lang) {
    if (await hasMirror(lang)) {
      const cats = await fetchJson(`${CFG.mirror}/${lang}/categories.json`).catch(() => null);
      if (cats) return cats.map((c) => ({ ...c, count: c.ids.length }));
    }
    return cachedLS(`cats:${lang}`, DAY, async () => {
      const raw = await fetchJson(apiUrl("/categories/list/", { language: lang }));
      return raw.map((c) => ({
        id: String(c.id), title: c.title, count: +c.hadeeths_count || 0,
        parent: c.parent_id && c.parent_id !== "0" ? String(c.parent_id) : null,
      }));
    });
  },

  async index(lang) {
    if (await hasMirror(lang)) {
      const idx = await fetchJson(`${CFG.mirror}/${lang}/index.json`).catch(() => null);
      if (idx) return idx;
    }
    return cachedLS(`idx:${lang}`, 7 * DAY, async () => {
      const roots = (await DB.categories(lang)).filter((c) => !c.parent && c.count > 0);
      const lists = await Promise.all(roots.map((r) => fetchJson(apiUrl("/hadeeths/list/", { language: lang, category_id: r.id, page: 1, per_page: 2000 }))));
      const seen = new Map();
      for (const list of lists) for (const it of list.data || []) if (!seen.has(String(it.id))) seen.set(String(it.id), it.title);
      return [...seen].map(([id, title]) => [id, title]);
    });
  },

  // Хадисы раздела: {items: [{id, title}], total, pages}
  async list(lang, catId, page, perPage = 20) {
    if (await hasMirror(lang)) {
      const [cats, idx] = await Promise.all([DB.categories(lang), DB.index(lang)]);
      const cat = cats.find((c) => c.id === catId);
      if (cat?.ids) {
        const titles = indexMap(lang, idx);
        const ids = cat.ids.slice((page - 1) * perPage, page * perPage);
        return { items: ids.map((id) => ({ id, title: titles.get(id) || "" })), total: cat.ids.length, pages: Math.ceil(cat.ids.length / perPage) };
      }
    }
    const res = await fetchJson(apiUrl("/hadeeths/list/", { language: lang, category_id: catId, page, per_page: perPage }));
    const meta = res.meta || {};
    return {
      items: (res.data || []).map((it) => ({ id: String(it.id), title: it.title })),
      total: +meta.total_items || 0,
      pages: +meta.last_page || 1,
    };
  },

  async hadith(lang, id) {
    if (await hasMirror(lang)) {
      try { return { ...(await fetchJson(`${CFG.mirror}/${lang}/h/${id}.json`)), lang }; } catch { /* ниже — API */ }
    }
    return { ...(await fetchJson(apiUrl("/hadeeths/one/", { language: lang, id }))), lang };
  },

  // Хадис на выбранном языке, а если перевода нет — на русском, английском или арабском.
  async hadithAny(id, lang) {
    for (const l of [...new Set([lang, CFG.defaultLang, "en", "ar"])]) {
      try { return await DB.hadith(l, id); } catch (err) { if (!(err instanceof NotFound)) throw err; }
    }
    throw new NotFound(id);
  },

  async reference(id) {
    return (await DB.hadith("ar", id)).reference || "";
  },
};

const indexMaps = new Map();
function indexMap(lang, idx) {
  if (!indexMaps.has(lang) || indexMaps.get(lang).src !== idx) indexMaps.set(lang, { src: idx, map: new Map(idx) });
  return indexMaps.get(lang).map;
}

async function randomId(lang) {
  const idx = await DB.index(lang);
  return idx[Math.floor(Math.random() * idx.length)][0];
}

async function dailyId(lang) {
  const today = new Date().toISOString().slice(0, 10);
  const key = `daily:${lang}:${today}`;
  const saved = LS.get(key);
  if (saved) return saved;
  const idx = await DB.index(lang);
  const id = idx[hashStr(today + "hadith") % idx.length][0];
  LS.set(key, id);
  return id;
}

// -------------------------------------------------------------------- иконки

const svg = (body, extra = "") => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${body}</svg>`;
const I = {
  mark: `<svg class="brand-mark" viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="9" y="9" width="22" height="22" rx="1.5"/><rect x="9" y="9" width="22" height="22" rx="1.5" transform="rotate(45 20 20)"/><circle cx="20" cy="20" r="5"/></svg>`,
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  globe: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z"/>'),
  heart: svg('<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>'),
  image: svg('<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-8 9"/>'),
  share: svg('<path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/>'),
  more: svg('<circle cx="5" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="19" cy="12" r="1.4" fill="currentColor"/>'),
  back: svg('<path d="M15 5l-7 7 7 7"/>'),
  dice: svg('<rect x="4" y="4" width="16" height="16" rx="4"/><circle cx="9" cy="9" r="1.1" fill="currentColor"/><circle cx="15" cy="15" r="1.1" fill="currentColor"/><circle cx="15" cy="9" r="1.1" fill="currentColor"/><circle cx="9" cy="15" r="1.1" fill="currentColor"/>'),
  send: svg('<path d="M21 3 3 10.5l7 2.5 2.5 7z"/><path d="m21 3-11 10"/>'),
  check: svg('<path d="m5 12 5 5 9-10"/>'),
  copy: svg('<rect x="8" y="8" width="12" height="12" rx="3"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>'),
  external: svg('<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>'),
  book: svg('<path d="M4 5.5C6.5 4 9.5 4 12 6c2.5-2 5.5-2 8-.5V19c-2.5-1.5-5.5-1.5-8 .5-2.5-2-5.5-2-8-.5z"/><path d="M12 6v13.5"/>'),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  download: svg('<path d="M12 4v11M7 10l5 5 5-5"/><path d="M5 19h14"/>'),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
};
const CAT_ICONS = {
  1: I.book,
  2: svg('<path d="M7 4h11a2 2 0 0 1 2 2v1h-4"/><path d="M16 7v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-1h10"/><path d="M7 4a2 2 0 0 0-2 2v11"/><path d="M9 9h4M9 13h4"/>'),
  3: svg('<path d="M20 14.5A8 8 0 1 1 10.5 4a6.5 6.5 0 0 0 9.5 10.5z"/>'),
  4: svg('<path d="M12 4v16M8 20h8M5 7h14"/><path d="m5 7-3 6a3 3 0 0 0 6 0zM19 7l-3 6a3 3 0 0 0 6 0z"/>'),
  5: svg('<path d="M12 2.5l2.1 4.6 4.6-1.9-1.9 4.6 4.6 2.1-4.6 2.1 1.9 4.6-4.6-1.9-2.1 4.6-2.1-4.6-4.6 1.9 1.9-4.6-4.6-2.1 4.6-2.1-1.9-4.6 4.6 1.9z"/>'),
  6: svg('<path d="M3 10v4a1 1 0 0 0 1 1h3l6 4V5L7 9H4a1 1 0 0 0-1 1z"/><path d="M17 8.5a5 5 0 0 1 0 7M8 15l1 5h3"/>'),
  7: svg('<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>'),
};

// -------------------------------------------------------------- навигация

// stack — экраны приложения; real — сколько из них имеют настоящую запись в истории браузера.
const nav = { stack: [], scroll: {}, replacing: false, pushNext: false, back: false, real: 0 };
let renderSeq = 0;
let actions = {};
const currentRoute = () => (location.hash && location.hash !== "#" ? location.hash : "#/");

function go(hash, { replace = false } = {}) {
  if (hash === currentRoute()) return;
  nav.scroll[currentRoute()] = window.scrollY;
  if (replace) { nav.replacing = true; location.replace(hash); }
  else { nav.real += 1; location.hash = hash; }
}

function goBack() {
  if (closeSheet()) return;
  if (currentRoute() === "#/" && state.query) { clearSearch(); return; }
  if (nav.real > 0) { history.back(); return; }
  const prev = nav.stack[nav.stack.length - 2] || "#/";
  nav.stack.pop();
  nav.back = true;
  go(prev, { replace: true });
}

function updateBackButton() {
  if (!IN_TG) return;
  const show = sheetOpen() || currentRoute() !== "#/" || Boolean(state.query);
  safe(() => (show ? tg.BackButton.show() : tg.BackButton.hide()));
}

const ROUTES = [
  [/^#?\/?$/, () => viewHome()],
  [/^#\/cat\/(\d+)$/, (m) => viewCategory(m[1])],
  [/^#\/h\/(\d+)(?:\/([a-z]{2,4}))?$/, (m) => viewHadith(m[1], m[2])],
  [/^#\/card\/(\d+)\/([a-z]{2,4})$/, (m) => viewCard(m[1], m[2])],
  [/^#\/fav$/, () => viewFavs()],
  [/^#\/lang$/, () => viewLangs()],
  [/^#\/about$/, () => viewAbout()],
];

async function onRoute() {
  const route = currentRoute();
  let isBack = false;
  if (nav.pushNext) {
    nav.stack.push(route);
    nav.pushNext = nav.replacing = false;
  } else if (nav.replacing) {
    nav.stack[Math.max(0, nav.stack.length - 1)] = route;
    nav.replacing = false;
    isBack = nav.back;
    nav.back = false;
  } else if (route === nav.stack[nav.stack.length - 2]) {
    nav.stack.pop();
    nav.real = Math.max(0, nav.real - 1);
    isBack = true;
  } else if (nav.stack[nav.stack.length - 1] !== route) {
    nav.stack.push(route);
  }
  closeSheet();
  actions = {};
  const seq = ++renderSeq;
  const match = ROUTES.map(([re, fn]) => [route.match(re), fn]).find(([m]) => m);
  updateBackButton();
  paintHeader();
  try {
    await (match ? match[1](match[0]) : viewHome());
  } catch (err) {
    if (seq === renderSeq) showError(err, () => onRoute());
  }
  if (seq !== renderSeq) return;
  window.scrollTo(0, isBack ? nav.scroll[route] || 0 : 0);
}

const isCurrent = (seq) => seq === renderSeq;

function mount(html) {
  app.innerHTML = `<div class="view">${html}</div>`;
  return app.firstElementChild;
}

function topbar(title, extra = "") {
  return `<div class="topbar"><button class="icon-btn back" data-act="back" aria-label="Назад">${I.back}</button><h1>${esc(title)}</h1>${extra}</div>`;
}

function showError(err, retry) {
  console.error(err);
  const notFound = err instanceof NotFound;
  actions.retry = retry;
  const box = `<div class="error-box">
    <p>${notFound ? "Хадис не найден — возможно, неверный номер." : "Не получилось загрузить данные. Проверьте интернет и попробуйте ещё раз."}</p>
    ${notFound ? `<button class="btn" data-go="#/">На главную</button>` : `<button class="btn" data-act="retry">Повторить</button>`}
  </div>`;
  const slot = app.querySelector("[data-slot=main]");
  if (slot) slot.innerHTML = box;
  else mount(topbar("Энциклопедия хадисов") + box);
}

app.addEventListener("click", (e) => {
  const el = e.target.closest("[data-go],[data-act],[data-ext]");
  if (!el || !app.contains(el)) return;
  if (el.dataset.go) { haptic(); go(el.dataset.go); }
  else if (el.dataset.ext) { e.preventDefault(); openLink(el.dataset.ext); }
  else if (el.dataset.act === "back") goBack();
  else if (el.dataset.act === "reload") onRoute();
  else if (actions[el.dataset.act]) { haptic(); actions[el.dataset.act](el, e); }
});

// Знак ﷺ оборачивается в <span class="saw">, чтобы он не выглядел огромным
const SAW = "\uFDFA";
function wrapSaw(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.nodeValue.includes(SAW) && !n.parentElement?.closest(".saw, .ar, .ar-block, .words, .ref, .hero-ar") ? 1 : 2),
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const frag = document.createDocumentFragment();
    node.nodeValue.split(SAW).forEach((part, i) => {
      if (i) { const span = document.createElement("span"); span.className = "saw"; span.textContent = SAW; frag.append(span); }
      if (part) frag.append(part);
    });
    node.replaceWith(frag);
  }
}
new MutationObserver((mutations) => {
  for (const m of mutations) {
    for (const n of m.addedNodes) {
      if (n.nodeType === 1) wrapSaw(n);
      else if (n.nodeType === 3 && n.parentElement) wrapSaw(n.parentElement);
    }
  }
}).observe(document.body, { childList: true, subtree: true });

// ------------------------------------------------------------- нижний лист

function sheetOpen() { return Boolean(document.querySelector("#sheet-root .sheet")); }
function closeSheet() {
  const root = document.getElementById("sheet-root");
  if (!root.firstChild) return false;
  root.innerHTML = "";
  updateBackButton();
  return true;
}
function openSheet(html, handlers = {}) {
  const root = document.getElementById("sheet-root");
  root.innerHTML = `<div class="sheet-backdrop"></div><div class="sheet" role="dialog"><div class="sheet-grip"></div>${html}</div>`;
  root.querySelector(".sheet-backdrop").addEventListener("click", closeSheet);
  root.querySelector(".sheet").addEventListener("click", (e) => {
    const el = e.target.closest("[data-act],[data-go],[data-ext]");
    if (!el) return;
    haptic();
    if (el.dataset.go) { closeSheet(); go(el.dataset.go); }
    else if (el.dataset.ext) { e.preventDefault(); openLink(el.dataset.ext); }
    else handlers[el.dataset.act]?.(el, e);
  });
  updateBackButton();
  return root.querySelector(".sheet");
}

// ------------------------------------------------------------------ главная

const langName = (code) => state.langNames[code] || code.toUpperCase();
const skeletonList = (n = 4) => Array.from({ length: n }, () => `<div class="skeleton" style="height:76px"></div>`).join("");

async function viewHome() {
  const seq = renderSeq;
  const root = mount(`
    <header class="hero">
      <div class="hero-top">
        <div class="brand">${I.mark}<div class="brand-name">Энциклопедия<small>хадисов Пророка ﷺ</small></div></div>
        <button class="lang-chip" data-go="#/lang">${I.globe.replace("<svg", '<svg width="16" height="16"')}${esc(langName(state.lang))}</button>
      </div>
      <h1 class="hero-title">Хадисы Пророка ﷺ<br>с разъяснениями</h1>
      <div class="hero-ar">موسوعة الأحاديث النبوية</div>
      <p class="hero-sub">Тексты, разъяснения и полезные выводы на 72 языках</p>
    </header>
    <label class="search-box">
      ${I.search}
      <input id="q" type="search" inputmode="search" enterkeyhint="search" autocomplete="off" placeholder="Слово, фраза или номер хадиса" value="${esc(state.query)}">
      <button class="clear" data-act="clear" aria-label="Очистить" ${state.query ? "" : "hidden"}>×</button>
    </label>
    <div id="home-search" ${state.query ? "" : "hidden"}></div>
    <div id="home-main" ${state.query ? "hidden" : ""}>
      <section class="section">
        <div class="section-head"><h2 class="section-title">Хадис дня</h2><span class="muted small">${new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}</span></div>
        <div id="daily"><div class="daily"><div class="skeleton sk-line" style="width:40%"></div><div class="skeleton sk-line"></div><div class="skeleton sk-line"></div><div class="skeleton sk-line" style="width:70%"></div></div></div>
      </section>
      <div class="section quick">
        <button class="quick-btn" data-act="random"><span class="quick-icon">${I.dice}</span>Случайный</button>
        <button class="quick-btn" data-go="#/fav"><span class="quick-icon">${I.heart}${state.favs.length ? `<b class="q-badge">${state.favs.length}</b>` : ""}</span>Избранное</button>
        <button class="quick-btn" data-act="shareApp"><span class="quick-icon">${I.send}</span>Поделиться</button>
      </div>
      <section class="section">
        <div class="section-head"><h2 class="section-title">Разделы</h2><a class="section-link" data-go="#/about">О проекте</a></div>
        <div class="cats" id="cats">${Array.from({ length: 6 }, () => `<div class="skeleton" style="height:128px"></div>`).join("")}</div>
      </section>
      <div class="share-banner">
        <p>«Указавший на благое получает такую же награду, как и совершивший его»</p>
        <button class="btn" data-act="shareApp">${I.send} Отправить друзьям</button>
      </div>
    </div>`);

  const input = root.querySelector("#q");
  let timer;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => setQuery(input.value), 220);
  });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { input.blur(); setQuery(input.value); } });
  actions.clear = () => { input.value = ""; clearSearch(); input.focus(); };
  actions.random = async () => {
    try { go(`#/h/${await randomId(state.lang)}`); } catch (err) { console.error(err); toast("Не получилось загрузить"); }
  };
  actions.shareApp = shareApp;

  if (state.query) runSearch(state.query);

  const lang = state.lang;
  DB.languages().then(() => {
    const chip = isCurrent(seq) && root.querySelector(".lang-chip");
    if (chip) chip.lastChild.textContent = langName(lang);
  }).catch(() => {});
  const cats = DB.categories(lang).then((all) => {
    if (!isCurrent(seq)) return;
    const roots = all.filter((c) => !c.parent && c.count > 0);
    root.querySelector("#cats").innerHTML = roots.map((c, i) => `
      <a class="cat-tile ${roots.length % 2 && i === roots.length - 1 ? "wide" : ""}" data-go="#/cat/${c.id}">
        <span class="cat-icon">${CAT_ICONS[c.id] || CAT_ICONS[5]}</span>
        <span class="cat-body"><span class="cat-name">${esc(c.title)}</span><span class="cat-count">${hadithWord(c.count)}</span></span>
      </a>`).join("");
  });
  const daily = (async () => {
    const h = await DB.hadithAny(await dailyId(lang), lang);
    if (!isCurrent(seq)) return;
    const [, matn] = splitIntro(h);
    root.querySelector("#daily").innerHTML = `
      <a class="daily" data-go="#/h/${h.id}/${h.lang}">
        <div class="daily-label">${I.sun} Хадис дня · №${esc(h.id)}</div>
        <p class="daily-text">${esc(matn)}</p>
        <div class="daily-foot"><span>${esc(h.attribution || "")}</span><span class="daily-more">Читать →</span></div>
      </a>`;
  })();
  await Promise.all([
    cats.catch((err) => isCurrent(seq) && (root.querySelector("#cats").innerHTML = errorInline(err))),
    daily.catch((err) => isCurrent(seq) && (root.querySelector("#daily").innerHTML = errorInline(err))),
  ]);
}

function errorInline(err) {
  console.error(err);
  return `<div class="error-box" style="grid-column:1/-1;margin:0 16px"><p>Не получилось загрузить. Проверьте интернет.</p><button class="btn ghost" data-act="reload">Обновить</button></div>`;
}

function setQuery(q) {
  state.query = q.trim();
  const main = app.querySelector("#home-main");
  const box = app.querySelector("#home-search");
  const clear = app.querySelector(".search-box .clear");
  if (!main) return;
  main.hidden = Boolean(state.query);
  box.hidden = !state.query;
  clear.hidden = !state.query;
  updateBackButton();
  if (state.query) runSearch(state.query);
}

function clearSearch() {
  const input = app.querySelector("#q");
  if (input) input.value = "";
  setQuery("");
}

function highlight(title, words) {
  if (!words.length) return esc(title);
  const pattern = words
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/[её]/g, "[её]"))
    .sort((a, b) => b.length - a.length).join("|");
  const re = new RegExp(`(${pattern})`, "giu");
  return title.split(re).map((part, i) => (i % 2 ? `<mark>${esc(part)}</mark>` : esc(part))).join("");
}

let searchSeq = 0;
async function runSearch(q) {
  const seq = ++searchSeq;
  const box = app.querySelector("#home-search");
  const number = q.replace(/^[№#\s]+/, "");
  if (/^\d+$/.test(number)) {
    box.innerHTML = `<div class="list"><a class="h-item" data-go="#/h/${number}"><span class="h-num">№${esc(number)}</span><span class="h-title">Открыть хадис №${esc(number)}</span></a></div>`;
    return;
  }
  const lang = state.lang;
  const fast = indexMaps.has(lang);
  if (!fast) box.innerHTML = `<div class="spinner"></div><p class="hint">Загружаю хадисы для поиска…</p>`;
  let idx;
  try {
    idx = await DB.index(lang);
  } catch (err) {
    if (seq === searchSeq) box.innerHTML = errorInline(err);
    return;
  }
  if (seq !== searchSeq) return;
  indexMap(lang, idx);
  const phrase = normalize(q);
  const words = phrase.split(" ").filter(Boolean);
  if (!words.length) { box.innerHTML = ""; return; }
  const exact = [], partial = [];
  for (const [id, title] of idx) {
    const t = normalize(title);
    if (t.includes(phrase)) exact.push([id, title]);
    else if (words.every((w) => t.includes(w))) partial.push([id, title]);
  }
  const results = exact.concat(partial);
  const rawWords = q.trim().split(/\s+/).filter((w) => w.length > 1);
  const renderPage = (count) => {
    box.innerHTML = results.length
      ? `<div class="section-head" style="padding-top:18px"><h2 class="section-title">Найдено: ${results.length}</h2></div>
         <div class="list" style="padding-top:0">${results.slice(0, count).map(([id, title]) => `
           <a class="h-item" data-go="#/h/${id}/${lang}"><span class="h-num">№${id}</span><span class="h-title">${highlight(title, rawWords)}</span></a>`).join("")}</div>
         ${results.length > count ? `<button class="btn ghost more-btn" data-act="moreResults">Показать ещё</button>` : ""}`
      : `<div class="empty">${I.search}<h3>Ничего не найдено</h3><p>Попробуйте другое слово или его часть, например «молитв» вместо «молитвами».</p></div>`;
    actions.moreResults = () => renderPage(count + 40);
  };
  renderPage(40);
}

// ------------------------------------------------------------------ раздел

async function viewCategory(id) {
  const seq = renderSeq;
  const lang = state.lang;
  const root = mount(`${topbar("Раздел")}<div data-slot="main"><div class="list">${skeletonList(6)}</div></div>`);
  const cats = await DB.categories(lang);
  if (!isCurrent(seq)) return;
  const cat = cats.find((c) => c.id === id);
  if (!cat) throw new NotFound(id);
  const parent = cats.find((c) => c.id === cat.parent);
  const children = cats.filter((c) => c.parent === id && c.count > 0);
  root.querySelector(".topbar h1").textContent = cat.title;
  root.querySelector("[data-slot=main]").innerHTML = `
    <div class="page-head">
      ${parent ? `<a class="crumb" data-go="#/cat/${parent.id}">← ${esc(parent.title)}</a>` : `<a class="crumb" data-go="#/">← Все разделы</a>`}
      <h2>${esc(cat.title)}</h2>
      <p>${hadithWord(cat.count)}</p>
    </div>
    ${children.length ? `<div class="chips">${children.map((c) => `<button class="chip" data-go="#/cat/${c.id}">${esc(c.title)}<b>${c.count}</b></button>`).join("")}</div>` : ""}
    <div class="list" id="items">${skeletonList(5)}</div>
    <div id="more"></div>`;

  let page = 0;
  const load = async () => {
    page += 1;
    const res = await DB.list(lang, id, page);
    if (!isCurrent(seq)) return;
    const html = res.items.map((it) => `<a class="h-item" data-go="#/h/${it.id}/${lang}"><span class="h-num">№${it.id}</span><span class="h-title">${esc(it.title)}</span></a>`).join("");
    const items = root.querySelector("#items");
    if (page === 1) items.innerHTML = html || `<div class="empty"><h3>Пока пусто</h3><p>В этом разделе нет хадисов на выбранном языке.</p></div>`;
    else items.insertAdjacentHTML("beforeend", html);
    root.querySelector("#more").innerHTML = page < res.pages ? `<button class="btn ghost more-btn" data-act="more">Показать ещё</button>` : "";
  };
  actions.more = (el) => { el.disabled = true; el.textContent = "Загружаю…"; load().catch((e) => { toast("Не получилось загрузить"); console.error(e); el.disabled = false; el.textContent = "Показать ещё"; page -= 1; }); };
  await load();
}

// ------------------------------------------------------------------ хадис

function splitIntro(h) {
  const text = (h.hadeeth || h.title || "").trim();
  const intro = (h.hadeeth_intro || "").trim();
  if (intro && text.startsWith(intro) && text.length > intro.length + 10) return [intro, text.slice(intro.length).trim()];
  return ["", text];
}

const hadithLink = (h) => `https://t.me/${state.bot}?startapp=h${h.id}_${h.lang}`;

async function viewHadith(id, langParam) {
  const seq = renderSeq;
  const lang = langParam || state.lang;
  const root = mount(`${topbar(`Хадис №${id}`)}<div data-slot="main"><div class="hadith"><div class="h-card">
    <div class="skeleton sk-line" style="width:45%"></div><div class="skeleton sk-line"></div><div class="skeleton sk-line"></div><div class="skeleton sk-line"></div><div class="skeleton sk-line" style="width:60%"></div>
  </div></div></div>`);
  const h = await DB.hadithAny(id, lang);
  if (!isCurrent(seq)) return;
  if (!state.langNames[h.lang]) await DB.languages().catch(() => {});

  const [intro, matn] = splitIntro(h);
  const arabic = h.lang === "ar" ? "" : h.hadeeth_ar;
  const words = (h.lang === "ar" ? h.words_meanings : h.words_meanings_ar) || [];
  const tabs = [
    ["exp", "Разъяснение", Boolean(h.explanation)],
    ["hints", "Польза", Boolean(h.hints?.length)],
    ["words", "Значение слов", words.length > 0],
    ["src", "Источники", true],
  ].filter((t) => t[2]);
  const dir = isRtl(matn) ? 'dir="rtl"' : "";

  root.querySelector("[data-slot=main]").innerHTML = `
    <div class="hadith">
      <article class="h-card">
        ${h.lang !== lang ? `<p class="notice">Этот хадис пока не переведён на «${esc(langName(lang))}» — показан перевод: ${esc(langName(h.lang))}.</p>` : ""}
        <div class="h-meta">
          <span class="badge num">№ ${esc(h.id)}</span>
          ${h.grade ? `<span class="badge grade">${I.check}${esc(h.grade)}</span>` : ""}
        </div>
        ${intro ? `<p class="h-intro" ${dir}>${esc(intro)}</p>` : ""}
        <p class="h-text" ${dir}>${esc(matn)}</p>
        ${h.attribution ? `<div class="h-attr">${I.book}<span>${esc(h.attribution)}</span></div>` : ""}
      </article>
      ${arabic ? `
        <button class="ar-toggle" data-act="toggleAr"><span>Текст на арабском</span><span class="ar">النص العربي</span></button>
        <div class="ar-block" id="ar" hidden>
          <p class="ar-text">${esc(arabic)}</p>
          <div class="ar-meta">${esc([h.attribution_ar, h.grade_ar].filter(Boolean).join(" · "))}</div>
        </div>` : ""}
      <div class="tabs" role="tablist">${tabs.map(([key, label], i) => `<button class="tab ${i ? "" : "on"}" data-act="tab" data-tab="${key}">${label}</button>`).join("")}</div>
      <div class="tab-body" id="tab-body"></div>
    </div>
    <nav class="actions">
      <button class="act ${isFav(h.id, h.lang) ? "on" : ""}" data-act="fav">${I.heart}<span>Избранное</span></button>
      <button class="act primary" data-go="#/card/${h.id}/${h.lang}">${I.image}<span>Карточка</span></button>
      <button class="act" data-act="share">${I.share}<span>Поделиться</span></button>
      <button class="act" data-act="more">${I.more}<span>Ещё</span></button>
    </nav>`;

  const body = root.querySelector("#tab-body");
  const showTab = async (key) => {
    root.querySelectorAll(".tab").forEach((t) => t.classList.toggle("on", t.dataset.tab === key));
    if (key === "exp") body.innerHTML = paras(h.explanation).map((p) => `<p ${isRtl(p) ? 'dir="rtl"' : ""}>${esc(p)}</p>`).join("");
    if (key === "hints") body.innerHTML = `<ol class="hints">${h.hints.map((x) => `<li ${isRtl(x) ? 'dir="rtl"' : ""}>${esc(x)}</li>`).join("")}</ol>`;
    if (key === "words") body.innerHTML = `<dl class="words">${words.map((w) => `<dt>${esc(w.word)}</dt><dd>${esc(w.meaning)}</dd>`).join("")}</dl>`;
    if (key === "src") {
      body.innerHTML = `<div class="spinner"></div>`;
      const ref = h.reference || (await DB.reference(h.id).catch(() => ""));
      if (!isCurrent(seq)) return;
      body.innerHTML = `
        ${h.attribution ? `<p><b>${esc(h.attribution)}</b>${h.grade ? ` · ${esc(h.grade)}` : ""}</p>` : ""}
        ${ref ? `<div class="ref">${esc(ref)}</div>` : ""}
        <p class="muted small" style="margin-top:16px">Источник текстов — HadeethEnc.com, «Энциклопедия переведённых хадисов Пророка». Тексты приводятся без изменений.</p>
        <button class="btn ghost" data-ext="${esc(CFG.siteHadith(h.lang, h.id))}">${I.external} Открыть на сайте</button>`;
    }
  };
  showTab(tabs[0][0]);

  actions.tab = (el) => showTab(el.dataset.tab);
  actions.toggleAr = () => { const ar = root.querySelector("#ar"); ar.hidden = !ar.hidden; };
  actions.fav = (el) => {
    if (isFav(h.id, h.lang)) {
      state.favs = state.favs.filter((f) => !(f.id === h.id && f.lang === h.lang));
      el.classList.remove("on");
      toast("Убрано из избранного");
    } else {
      state.favs.unshift({ id: h.id, lang: h.lang, title: h.title || matn.slice(0, 160) });
      el.classList.add("on");
      haptic("success");
      toast("Добавлено в избранное");
    }
    saveFavs();
  };
  actions.share = () => shareHadith(h, matn);
  actions.more = () => openHadithMenu(h, intro, matn);
}

function shareHadith(h, matn) {
  const text = `${matn.length > 700 ? matn.slice(0, 700).trim() + "…" : matn}\n\n📚 ${h.attribution || ""}`.trim();
  const link = hadithLink(h);
  if (IN_TG) {
    openLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`);
  } else if (navigator.share) {
    navigator.share({ title: `Хадис №${h.id}`, text, url: link }).catch(() => {});
  } else {
    copyText(`${text}\n\n${link}`);
  }
}

async function openHadithMenu(h, intro, matn) {
  const langs = (h.translations || []).filter((c) => c !== h.lang);
  openSheet(`
    <h3>Хадис №${esc(h.id)}</h3>
    <div class="lang-list" style="padding:0">
      <button class="lang-row" data-act="copy">Скопировать текст ${I.copy.replace("<svg", '<svg width="20" height="20"')}</button>
      <button class="lang-row" data-ext="${esc(CFG.siteHadith(h.lang, h.id))}">Открыть на сайте ${I.external.replace("<svg", '<svg width="20" height="20"')}</button>
      ${langs.length ? `<button class="lang-row" data-act="langs">Другие языки <span>${langs.length}</span></button>` : ""}
    </div>`, {
    copy: () => {
      closeSheet();
      copyText([intro, matn].filter(Boolean).join(" ") + (h.attribution ? `\n\n${h.attribution}` : "") + `\n\n${hadithLink(h)}`);
    },
    langs: async () => {
      await DB.languages().catch(() => {});
      const sorted = langs.map((c) => [c, langName(c)]).sort((a, b) => a[1].localeCompare(b[1]));
      openSheet(`<h3>Перевод хадиса на другой язык</h3><div class="lang-list" style="padding:0">${sorted.map(([c, n]) => `
        <button class="lang-row" data-go="#/h/${h.id}/${c}">${esc(n)}<span>${c}</span></button>`).join("")}</div>`);
    },
  });
}

// --------------------------------------------------------------- избранное

async function viewFavs() {
  const root = mount(`${topbar("Избранное")}<div data-slot="main"></div>`);
  const render = () => {
    root.querySelector("[data-slot=main]").innerHTML = state.favs.length
      ? `<div class="page-head"><h2>Избранное</h2><p>${hadithWord(state.favs.length)}</p></div>
         <div class="list">${state.favs.map((f, i) => `
           <div class="h-item" data-go="#/h/${f.id}/${f.lang}">
             <span class="h-num">№${esc(f.id)}</span>
             <span class="h-title">${esc(f.title || "…")}${f.lang !== state.lang ? ` <span class="muted small">· ${esc(langName(f.lang))}</span>` : ""}</span>
             <button class="h-del" data-act="del" data-i="${i}" aria-label="Удалить">×</button>
           </div>`).join("")}</div>`
      : `<div class="empty">${I.heart}<h3>Здесь будут ваши хадисы</h3><p>Нажмите «Избранное» под хадисом, чтобы сохранить его.</p><button class="btn" data-go="#/">К разделам</button></div>`;
  };
  actions.del = (el, e) => {
    e.stopPropagation();
    state.favs.splice(+el.dataset.i, 1);
    saveFavs();
    render();
  };
  render();
  // Подписи для избранного, перенесённого с другого устройства
  const missing = state.favs.filter((f) => !f.title);
  if (missing.length) {
    await Promise.all(missing.slice(0, 30).map(async (f) => {
      const h = await DB.hadith(f.lang, f.id).catch(() => null);
      if (h) f.title = h.title || splitIntro(h)[1].slice(0, 160);
    }));
    LS.set("favs", state.favs);
    render();
  }
}

// -------------------------------------------------------------------- языки

async function viewLangs() {
  const root = mount(`${topbar("Язык перевода")}
    <div class="page-head"><h2>Язык перевода</h2><p>Хадисы, разъяснения и выводы будут на выбранном языке.</p></div>
    <label class="search-box search-inline">${I.search}<input id="lq" type="search" placeholder="Найти язык" autocomplete="off"></label>
    <div data-slot="main"><div class="spinner"></div></div>`);
  const langs = await DB.languages();
  const ordered = [...langs].sort((a, b) => (a.code === state.lang ? -1 : b.code === state.lang ? 1 : 0));
  const render = (q = "") => {
    const nq = normalize(q);
    root.querySelector("[data-slot=main]").innerHTML = `<div class="lang-list">${ordered
      .filter((l) => !nq || normalize(l.native).includes(nq) || l.code.includes(nq))
      .map((l) => `<button class="lang-row ${l.code === state.lang ? "on" : ""}" data-act="pick" data-code="${esc(l.code)}">${esc(l.native)}<span>${l.code === state.lang ? "✓" : esc(l.code)}</span></button>`)
      .join("")}</div>`;
  };
  root.querySelector("#lq").addEventListener("input", (e) => render(e.target.value));
  actions.pick = (el) => {
    state.lang = el.dataset.code;
    state.query = "";
    LS.set("lang", state.lang);
    LS.set("langLocal", true);
    cloudSet("lang", state.lang);
    haptic("success");
    toast(`Язык: ${langName(state.lang)}`);
    if (nav.stack[nav.stack.length - 2] === "#/") goBack();
    else go("#/", { replace: true });
  };
  render();
}

// --------------------------------------------------------------- о проекте

function shareApp() {
  const link = `https://t.me/${state.bot}?startapp`;
  const text = "🌿 Энциклопедия хадисов Пророка ﷺ: хадисы с разъяснениями и полезными выводами на 72 языках, поиск и карточки для публикации.";
  if (IN_TG) openLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`);
  else if (navigator.share) navigator.share({ text, url: link }).catch(() => {});
  else copyText(`${text}\n${link}`);
}

function viewAbout() {
  mount(`${topbar("О проекте")}
    <div class="page-head"><h2>Энциклопедия хадисов Пророка ﷺ</h2></div>
    <div class="prose">
      <ul>
        <li>📖 Хадисы с разъяснениями и полезными выводами</li>
        <li>🌍 Доступна на 72 языках</li>
        <li>🔍 Поиск по словам и номеру хадиса</li>
        <li>🎨 Создание и публикация карточек с хадисами</li>
      </ul>
      <h3>📢 Помогите распространять Сунну</h3>
      <ul>
        <li>🔄 Поделитесь энциклопедией</li>
        <li>📲 Отправьте её тем, кому она может быть полезна</li>
        <li>🎨 Создайте карточку с хадисом и поделитесь ею</li>
        <li>🌍 Распространяйте её на разных языках</li>
      </ul>
      <div class="quote">💚 Указавший на благое получает такую же награду, как и совершивший его.</div>
      <div class="btn-row"><button class="btn" data-act="shareApp">${I.send} Поделиться</button><button class="btn ghost" data-ext="${CFG.siteHome}">${I.external} Сайт</button></div>
      <h3>Источник</h3>
      <p class="muted">Тексты хадисов, переводы, разъяснения и выводы — проект <a data-ext="https://hadeethenc.com" style="color:var(--emerald);font-weight:700">HadeethEnc.com</a> («Энциклопедия переведённых хадисов Пророка»). Тексты приводятся без изменений.</p>
    </div>`);
  actions.shareApp = shareApp;
}

// ----------------------------------------------------------------- карточки

const CARD_THEMES = {
  emerald: { name: "Изумруд", bg: ["#0f5a43", "#062a20"], glow: "rgba(216,178,90,.28)", pattern: "rgba(241,227,189,.10)", panel: "#fbf6e9", border: "#b8913a", ink: "#1f2b25", muted: "#6b624d", accent: "#a87f2a", foot: "#f4ead0", foot2: "#d8b25a" },
  night: { name: "Ночь", bg: ["#18244a", "#080d1c"], glow: "rgba(217,180,90,.22)", pattern: "rgba(217,180,90,.09)", panel: "#101a33", border: "#d9b45a", ink: "#f1e8d2", muted: "#a7a18c", accent: "#d9b45a", foot: "#f1e8d2", foot2: "#d9b45a" },
  sand: { name: "Пергамент", bg: ["#ecdfc2", "#cdb685"], glow: "rgba(255,255,255,.45)", pattern: "rgba(110,80,30,.10)", panel: "#fffaf0", border: "#9c6b2f", ink: "#33281a", muted: "#7a6748", accent: "#93622a", foot: "#3d2f1c", foot2: "#7d5a26" },
  azure: { name: "Лазурь", bg: ["#11577a", "#072c40"], glow: "rgba(150,220,255,.22)", pattern: "rgba(220,240,255,.09)", panel: "#f5fafc", border: "#c9a24a", ink: "#14303d", muted: "#5d6f78", accent: "#a8862f", foot: "#e9f5fb", foot2: "#e2c47a" },
};
const CARD_FORMATS = { post: ["Пост 4:5", 1350], story: ["Сторис", 1920], square: ["Квадрат", 1080] };

const measureCtx = document.createElement("canvas").getContext("2d");

function wrapText(ctx, text, maxWidth, lang) {
  const out = [];
  const segmenter = typeof Intl !== "undefined" && Intl.Segmenter ? new Intl.Segmenter(lang, { granularity: "word" }) : null;
  for (const para of paras(text)) {
    let line = "";
    const add = (unit, sep) => {
      const next = line ? line + sep + unit : unit;
      if (!line || ctx.measureText(next).width <= maxWidth) line = next;
      else { out.push(line); line = unit; }
    };
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (!segmenter || ctx.measureText(word).width <= maxWidth) { add(word, " "); continue; }
      // Языки без пробелов (китайский, тайский…) — переносим по границам слов
      [...segmenter.segment(word)].forEach(({ segment }, i) => add(segment, i ? "" : " "));
    }
    if (line) out.push(line);
    out.push(null);
  }
  out.pop();
  return out;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function star(ctx, cx, cy, r) {
  ctx.beginPath();
  ctx.rect(cx - r, cy - r, 2 * r, 2 * r);
  const d = r * Math.SQRT2;
  ctx.moveTo(cx, cy - d); ctx.lineTo(cx + d, cy); ctx.lineTo(cx, cy + d); ctx.lineTo(cx - d, cy); ctx.closePath();
}

function divider(ctx, cx, y, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - 200, y); ctx.lineTo(cx - 28, y);
  ctx.moveTo(cx + 28, y); ctx.lineTo(cx + 200, y);
  ctx.stroke();
  star(ctx, cx, y, 9);
  ctx.stroke();
}

async function drawCard(canvas, h, opts) {
  const T = CARD_THEMES[opts.theme];
  const W = 1080;
  const baseH = CARD_FORMATS[opts.format][1];
  const translation = opts.mode !== "ar" ? h.hadeeth || h.title : "";
  const arabic = opts.mode !== "tr" ? (h.lang === "ar" ? (opts.mode === "ar" ? h.hadeeth : "") : h.hadeeth_ar) : "";
  const attribution = [h.attribution, h.grade].filter(Boolean).join(" · ");
  const sample = `${translation} ${arabic} ${attribution} Энциклопедия ﷺ`;
  await Promise.all([
    document.fonts.load("500 40px Lora", sample), document.fonts.load("400 40px Amiri", sample),
    document.fonts.load("700 40px Amiri", "موسوعة"), document.fonts.load("700 30px Manrope", sample),
  ]).catch(() => {});

  const M = 60, FOOT = 170, HEADER = 200, PAD = 76;
  const maxW = W - 2 * (M + PAD);
  const trRtl = isRtl(translation);
  const metaFont = `600 30px Manrope, Amiri, sans-serif`;
  measureCtx.font = metaFont;
  const metaLines = attribution ? wrapText(measureCtx, attribution, maxW, h.lang).filter(Boolean).slice(0, 3) : [];
  const META = metaLines.length ? 70 + metaLines.length * 42 : 30;

  const layout = (size) => {
    const blocks = [];
    if (arabic) {
      const s = Math.round(size * 1.18);
      measureCtx.font = `400 ${s}px Amiri, serif`;
      measureCtx.direction = "rtl";
      blocks.push({ font: measureCtx.font, lh: s * 1.85, dir: "rtl", lines: wrapText(measureCtx, arabic, maxW, "ar") });
    }
    if (translation) {
      measureCtx.font = `500 ${size}px Lora, Amiri, serif`;
      measureCtx.direction = trRtl ? "rtl" : "ltr";
      blocks.push({ font: measureCtx.font, lh: size * (trRtl ? 1.8 : 1.52), dir: trRtl ? "rtl" : "ltr", lines: wrapText(measureCtx, translation, maxW, h.lang) });
    }
    const gap = blocks.length > 1 ? size * 1.6 : 0;
    const total = blocks.reduce((s, b) => s + b.lines.reduce((t, l) => t + (l === null ? b.lh * 0.5 : b.lh), 0), 0) + gap;
    return { blocks, total, gap };
  };
  const avail = (H) => H - FOOT - M - HEADER - META - 40;

  let H = baseH, L, grown = false;
  for (let size = 54; size >= 26; size -= 2) {
    L = layout(size);
    if (L.total <= avail(H)) break;
  }
  if (L.total > avail(H)) {
    L = layout(30);
    H = Math.min(4320, Math.ceil(L.total + (baseH - avail(baseH))));
    grown = true;
  }

  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  // Фон, свечение и узор из восьмиконечных звёзд
  const bg = ctx.createLinearGradient(0, 0, W * 0.3, H);
  bg.addColorStop(0, T.bg[0]);
  bg.addColorStop(1, T.bg[1]);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.85, 0, 0, W * 0.85, 0, W * 0.9);
  glow.addColorStop(0, T.glow);
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = T.pattern;
  ctx.lineWidth = 2;
  for (let row = 0, y = 0; y < H + 120; row++, y += 110) {
    for (let x = row % 2 ? 55 : 0; x < W + 120; x += 110) { star(ctx, x, y, 22); ctx.stroke(); }
  }

  // Панель
  const panelBottom = H - FOOT;
  ctx.shadowColor = "rgba(0,0,0,.25)";
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 12;
  roundRect(ctx, M, M, W - 2 * M, panelBottom - M, 40);
  ctx.fillStyle = T.panel;
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.lineWidth = 4;
  ctx.strokeStyle = T.border;
  ctx.stroke();
  roundRect(ctx, M + 16, M + 16, W - 2 * M - 32, panelBottom - M - 32, 28);
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Заголовок
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = T.accent;
  ctx.direction = "rtl";
  ctx.font = "700 44px Amiri, serif";
  ctx.fillText("موسوعة الأحاديث النبوية", W / 2, M + 92);
  ctx.direction = "ltr";
  divider(ctx, W / 2, M + 150, T.border);

  // Текст
  let y = M + HEADER + (avail(H) - L.total) / 2;
  ctx.fillStyle = T.ink;
  L.blocks.forEach((b, bi) => {
    if (bi > 0) {
      ctx.fillStyle = T.border;
      ctx.beginPath();
      [-24, 0, 24].forEach((dx) => ctx.arc(W / 2 + dx, y + L.gap / 2, 4, 0, Math.PI * 2));
      ctx.fill();
      ctx.fillStyle = T.ink;
      y += L.gap;
    }
    ctx.font = b.font;
    ctx.direction = b.dir;
    for (const line of b.lines) {
      if (line === null) { y += b.lh * 0.5; continue; }
      ctx.fillText(line, W / 2, y + b.lh / 2);
      y += b.lh;
    }
  });
  ctx.direction = "ltr";

  // Источник
  if (metaLines.length) {
    let my = panelBottom - META - 4;
    divider(ctx, W / 2, my, T.border);
    my += 52;
    ctx.font = metaFont;
    ctx.fillStyle = T.muted;
    ctx.direction = isRtl(attribution) ? "rtl" : "ltr";
    for (const line of metaLines) { ctx.fillText(line, W / 2, my); my += 42; }
    ctx.direction = "ltr";
  }

  // Подвал
  ctx.fillStyle = T.foot;
  ctx.font = "800 34px Manrope, Amiri, sans-serif";
  ctx.fillText("Энциклопедия хадисов Пророка ﷺ", W / 2, panelBottom + 62);
  ctx.fillStyle = T.foot2;
  ctx.font = "600 27px Manrope, sans-serif";
  ctx.fillText(`@${state.bot} · хадис №${h.id}`, W / 2, panelBottom + 112);
  return { grown };
}

async function viewCard(id, lang) {
  const seq = renderSeq;
  const root = mount(`${topbar("Карточка")}<div data-slot="main"><div class="card-stage"><div class="skeleton" style="aspect-ratio:4/5"></div></div></div>`);
  const h = await DB.hadithAny(id, lang);
  if (!isCurrent(seq)) return;
  const hasBoth = h.lang !== "ar" && Boolean(h.hadeeth_ar);
  const opts = { format: LS.get("cardFormat", "post"), theme: LS.get("cardTheme", "emerald"), mode: hasBoth ? LS.get("cardMode", "tr") : h.lang === "ar" ? "ar" : "tr" };
  if (!CARD_FORMATS[opts.format]) opts.format = "post";
  if (!CARD_THEMES[opts.theme]) opts.theme = "emerald";

  root.querySelector("[data-slot=main]").innerHTML = `
    <div class="card-stage">
      <div class="card-preview"><canvas id="card"></canvas></div>
      <p class="hint" id="grown" hidden>Хадис длинный — карточка стала выше, чтобы текст поместился целиком.</p>
      <div class="opt"><div class="opt-label">Оформление</div>
        <div class="swatches">${Object.entries(CARD_THEMES).map(([k, t]) => `<button class="swatch ${k === opts.theme ? "on" : ""}" data-act="theme" data-v="${k}" title="${t.name}" style="background:linear-gradient(135deg,${t.bg[0]},${t.bg[1]})"></button>`).join("")}</div>
      </div>
      <div class="opt"><div class="opt-label">Формат</div>
        <div class="seg">${Object.entries(CARD_FORMATS).map(([k, f]) => `<button class="${k === opts.format ? "on" : ""}" data-act="format" data-v="${k}">${f[0]}</button>`).join("")}</div>
      </div>
      ${hasBoth ? `<div class="opt"><div class="opt-label">Текст</div>
        <div class="seg">${[["tr", "Перевод"], ["both", "Оба"], ["ar", "Арабский"]].map(([k, l]) => `<button class="${k === opts.mode ? "on" : ""}" data-act="mode" data-v="${k}">${l}</button>`).join("")}</div>
      </div>` : ""}
      <div class="btn-row" style="margin-top:20px">
        <button class="btn" data-act="shareCard">${I.share} Поделиться</button>
        <button class="btn gold" data-act="saveCard">${I.download} Сохранить</button>
      </div>
      <p class="hint">Карточку можно отправить в чат, сторис или сохранить в галерею.</p>
    </div>`;

  const canvas = root.querySelector("#card");
  const redraw = async () => {
    const { grown } = await drawCard(canvas, h, opts);
    root.querySelector("#grown").hidden = !grown;
  };
  const pick = (key, storeKey) => (el) => {
    opts[key] = el.dataset.v;
    LS.set(storeKey, opts[key]);
    el.parentElement.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === el));
    redraw();
  };
  actions.theme = pick("theme", "cardTheme");
  actions.format = pick("format", "cardFormat");
  actions.mode = pick("mode", "cardMode");
  actions.shareCard = () => shareCard(canvas, h);
  actions.saveCard = () => saveCard(canvas, h);
  await redraw();
}

const cardBlob = (canvas) => new Promise((resolve) => canvas.toBlob(resolve, "image/png"));

async function shareCard(canvas, h) {
  const blob = await cardBlob(canvas);
  const file = new File([blob], `hadith-${h.id}.png`, { type: "image/png" });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text: `Хадис №${h.id} — ${hadithLink(h)}` });
      return;
    } catch (err) {
      if (err.name === "AbortError") return;
    }
  }
  showCardSheet(blob, h);
}

async function saveCard(canvas, h) {
  const blob = await cardBlob(canvas);
  if (!IN_TG) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `hadith-${h.id}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast("Карточка сохранена");
    return;
  }
  showCardSheet(blob, h);
}

function showCardSheet(blob, h) {
  const url = URL.createObjectURL(blob);
  openSheet(`
    <h3>Карточка готова</h3>
    <img src="${url}" alt="Карточка хадиса №${esc(h.id)}">
    <p class="hint">Нажмите на картинку и удерживайте, затем выберите «Сохранить» — она появится в галерее.</p>
    <div class="btn-row" style="margin-top:12px">
      <a class="btn gold" href="${url}" download="hadith-${esc(h.id)}.png">${I.download} Скачать</a>
      <button class="btn ghost" data-act="close">Готово</button>
    </div>`, { close: closeSheet });
}

// ------------------------------------------------------------------- запуск

const pageColor = () => (document.documentElement.dataset.theme === "dark" ? "#0b1512" : "#f5efe3");

function paintHeader() {
  if (!IN_TG) return;
  const home = currentRoute() === "#/";
  safe(() => tg.setHeaderColor(home ? "#0f5a43" : pageColor()));
}

function applyTheme() {
  const dark = IN_TG ? tg.colorScheme === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  if (IN_TG) {
    safe(() => tg.setBackgroundColor(pageColor()));
    safe(() => tg.setBottomBarColor(pageColor()));
    paintHeader();
  }
}

function startRoute() {
  // Telegram передаёт служебные данные в адресе после «#» (#tgWebAppData=…).
  // Скрипт telegram-web-app.js их уже прочитал, поэтому заменяем на маршрут главной.
  if (!location.hash.startsWith("#/")) history.replaceState(null, "", location.pathname + location.search + "#/");

  // h2962_ru — хадис, c2962_ru — карточка. Из ссылки t.me/…?startapp=… или из адреса ?startapp=…
  const param = (IN_TG && tg.initDataUnsafe?.start_param) || new URLSearchParams(location.search).get("startapp");
  const m = /^([hc])(\d+)(?:_([a-z]{2,4}))?$/.exec(param || "");
  if (!m || currentRoute() !== "#/") return false;
  const lang = m[3] || state.lang;
  // Под открытым экраном — главная, чтобы «Назад» вёл на неё
  nav.stack = ["#/"];
  nav.pushNext = true;
  location.replace(m[1] === "c" ? `#/card/${m[2]}/${lang}` : `#/h/${m[2]}/${lang}`);
  return true;
}

function boot() {
  if (IN_TG) {
    document.documentElement.classList.add("in-tg");
    safe(() => tg.ready());
    safe(() => tg.expand());
    safe(() => tg.isVersionAtLeast("7.7") && tg.disableVerticalSwipes());
    safe(() => tg.onEvent("themeChanged", applyTheme));
    safe(() => tg.BackButton.onClick(goBack));
  } else {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", applyTheme);
  }
  applyTheme();
  window.addEventListener("hashchange", onRoute);
  DB.languages().catch(() => {});
  refreshBotName();
  syncFromCloud().then((changed) => { if (changed && currentRoute() === "#/") onRoute(); });
  if (!startRoute()) onRoute();
}

boot();

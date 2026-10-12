// Данные энциклопедии: русская версия с сайта мини-приложения (GitHub Pages),
// при недоступности — напрямую из API HadeethEnc.com.

import { compile, find } from "./search.js";

export const DATA_URL = process.env.DATA_URL || "https://knigaletit88-ux.github.io/hadith/data/ru";
const API = "https://hadeethenc.com/api/v1";
const INDEX_TTL = 6 * 3600e3;

let index = null; // { at, items: [[id, title], …], pos: Map(id → место в списке) }
let texts = null; // { at, src, items: [[id, title, текст, вступление], …] } — для поиска
const hadiths = new Map();

// Тот же расчёт, что в мини-приложении, — «Хадис дня» совпадает
export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

async function getJson(url) {
  const res = await fetch(url, { headers: { "User-Agent": "HadithBot/1.0 (+https://knigaletit88-ux.github.io/hadith/)" } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

export async function getIndex() {
  if (index && Date.now() - index.at < INDEX_TTL) return index.items;
  try {
    const items = await getJson(`${DATA_URL}/index.json`);
    if (!items?.length) throw new Error("пустой индекс");
    const list = items.map(([id, title]) => [String(id), title]);
    index = { at: Date.now(), items: list, pos: new Map(list.map(([id], i) => [id, i])) };
  } catch (err) {
    if (!index) throw err;
    console.error("Индекс: использую старую копию", err.message);
  }
  return index.items;
}

export async function getHadith(id) {
  id = String(id);
  if (hadiths.has(id)) return hadiths.get(id);
  let h = null;
  try {
    h = await getJson(`${DATA_URL}/h/${id}.json`);
  } catch (err) {
    console.error("Копия на сайте недоступна:", err.message);
  }
  if (!h) h = await getJson(`${API}/hadeeths/one/?language=ru&id=${encodeURIComponent(id)}`).catch(() => null);
  if (h) {
    hadiths.set(id, h);
    if (hadiths.size > 300) hadiths.delete(hadiths.keys().next().value);
  }
  return h;
}

// Полные тексты для поиска (search.json); если файла нет — ищем по заголовкам
async function searchItems() {
  const items = await getIndex();
  if (texts && texts.src === items && Date.now() - texts.at < INDEX_TTL) return texts.items;
  try {
    const rows = await getJson(`${DATA_URL}/search.json`);
    if (!rows?.length) throw new Error("нет search.json");
    const byId = new Map(rows.map(([id, ...rest]) => [String(id), rest]));
    texts = { at: Date.now(), src: items, items: items.map(([id, title]) => [id, title, ...(byId.get(id) || [])]) };
  } catch (err) {
    console.error("Поиск без search.json:", err.message);
    // Оставляем прежние тексты (или только заголовки) и пробуем снова через 10 минут
    texts = { at: Date.now() - INDEX_TTL + 600e3, src: items, items: texts?.src === items ? texts.items : items };
  }
  return texts.items;
}

// → { total, items: [{id, title, text, intro, inTitle, inText}], query }
export async function search(query, limit = 50) {
  const q = compile(query);
  const all = find(await searchItems(), q);
  return { total: all.length, items: all.slice(0, limit), query: q };
}

// Предыдущий и следующий хадис в порядке энциклопедии (по кругу)
export async function neighbors(id) {
  await getIndex();
  const i = index.pos.get(String(id));
  if (i === undefined) return null;
  const n = index.items.length;
  return { prev: index.items[(i - 1 + n) % n][0], next: index.items[(i + 1) % n][0], pos: i + 1, total: n };
}

// Оригинал на арабском: из копии на сайте, а если там нет — из арабской версии API
export async function getArabic(id) {
  const h = await getHadith(id);
  if (h?.hadeeth_ar) return { text: h.hadeeth_ar, attribution: h.attribution_ar, grade: h.grade_ar, reference: h.reference };
  const ar = await getJson(`${API}/hadeeths/one/?language=ar&id=${encodeURIComponent(id)}`).catch(() => null);
  return ar?.hadeeth ? { text: ar.hadeeth, attribution: ar.attribution, grade: ar.grade, reference: ar.reference } : null;
}

export async function dailyId(date = new Date()) {
  const items = await getIndex();
  return items[hashStr(date.toISOString().slice(0, 10) + "hadith") % items.length][0];
}

export async function randomId() {
  const items = await getIndex();
  return items[Math.floor(Math.random() * items.length)][0];
}

export function splitIntro(h) {
  const text = String(h.hadeeth || h.title || "").trim();
  const intro = String(h.hadeeth_intro || "").trim();
  if (intro && text.startsWith(intro) && text.length > intro.length + 10) return [intro, text.slice(intro.length).trim()];
  return ["", text];
}

export function resetCache() {
  index = null;
  texts = null;
  hadiths.clear();
}

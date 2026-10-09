// Данные энциклопедии: русская версия с сайта мини-приложения (GitHub Pages),
// при недоступности — напрямую из API HadeethEnc.com.

export const DATA_URL = process.env.DATA_URL || "https://knigaletit88-ux.github.io/hadith/data/ru";
const API = "https://hadeethenc.com/api/v1";
const INDEX_TTL = 6 * 3600e3;

let index = null; // { at, items: [[id, title, norm], …] }
const hadiths = new Map();

export function normalize(text) {
  return String(text || "")
    .normalize("NFKC").toLowerCase().replace(/ё/g, "е")
    .replace(/[ؐ-ًؚ-ٰٟۖ-ۭـ]/g, "")
    .replace(/[إأآٱ]/g, "ا").replace(/ى/g, "ي")
    .replace(/[\p{P}\p{S}\s]+/gu, " ").trim();
}

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
    index = { at: Date.now(), items: items.map(([id, title]) => [String(id), title, normalize(title)]) };
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

export async function search(query, limit = 50) {
  const phrase = normalize(query);
  const words = phrase.split(" ").filter(Boolean);
  if (!words.length) return { total: 0, items: [] };
  const exact = [];
  const partial = [];
  for (const [id, title, norm] of await getIndex()) {
    if (norm.includes(phrase)) exact.push([id, title]);
    else if (words.every((w) => norm.includes(w))) partial.push([id, title]);
  }
  const all = exact.concat(partial);
  return { total: all.length, items: all.slice(0, limit) };
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
  hadiths.clear();
}

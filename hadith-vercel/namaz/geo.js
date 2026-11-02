// Поиск места — Nominatim (OpenStreetMap); часовой пояс и погода — open-meteo.com (перенос namaz/geo.py).
// Оба сервиса бесплатные и без ключа.

const WEATHER_TTL = 15 * 60_000;
const COORDS_RE = /^\s*(-?\d{1,2}(?:[.,]\d+)?)\s*[,; ]\s*(-?\d{1,3}(?:[.,]\d+)?)\s*$/;
const WMO = [[0, "☀️"], [2, "🌤"], [3, "☁️"], [48, "🌫"], [57, "🌦"], [67, "🌧"], [77, "🌨"], [82, "🌧"], [86, "🌨"], [99, "⛈"]];
const weatherCache = new Map();
let nominatimLast = 0;
let nominatimQueue = Promise.resolve();

/** Место: { name, lat, lon, tz, region, country, country_code } — те же поля, что у Python-версии. */
export const place = (name, lat, lon, tz = null, region = "", country = "", country_code = "") => ({ name, lat, lon, tz, region, country, country_code });

export function placeLabel(p) {
  const region = p.region !== p.name ? p.region : ""; // «Москва, Москва» не нужно
  return [p.name, region, p.country].filter(Boolean).join(", ");
}

async function get(url, params) {
  const query = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  try {
    // Nominatim требует представляться в User-Agent
    const res = await fetch(`${url}?${query}`, { headers: { "User-Agent": "namaz-bot/1.0" }, signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) { // сеть недоступна — бот продолжает работать без этих данных
    console.warn(url, err.message);
    return null;
  }
}

export function parseCoords(text) {
  const m = COORDS_RE.exec(text);
  if (!m) return null;
  const lat = parseFloat(m[1].replace(",", "."));
  const lon = parseFloat(m[2].replace(",", "."));
  return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180 ? [lat, lon] : null;
}

/** Запрос к Nominatim не чаще раза в секунду — так требуют правила сервиса. */
function nominatim(path, params) {
  const run = nominatimQueue.then(async () => {
    const wait = nominatimLast + 1100 - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    nominatimLast = Date.now();
    return get(`https://nominatim.openstreetmap.org/${path}`, { format: "jsonv2", "accept-language": "ru", ...params });
  });
  nominatimQueue = run.catch(() => {});
  return run;
}

/**
 * null — сервисы недоступны; [] — ничего не найдено.
 * Сначала OpenStreetMap: он знает русские названия вплоть до сёл. Если он недоступен
 * или ничего не нашёл — справочник open-meteo.
 */
export async function searchCity(name) {
  const found = await nominatim("search", { q: name, addressdetails: 1, limit: 8, featureType: "settlement" });
  const places = [];
  for (const r of [...(found || [])].sort((a, b) => (b.importance || 0) - (a.importance || 0))) {
    const addr = r.address || {};
    if (["state", "region", "province", "county", "country"].includes(r.addresstype)) continue;
    const p = place(r.name, parseFloat(r.lat), parseFloat(r.lon), null, addr.state || "", addr.country || "", (addr.country_code || "").toUpperCase());
    if (!places.some((x) => placeLabel(x) === placeLabel(p))) places.push(p);
  }
  if (places.length) return places.slice(0, 6);

  const data = await get("https://geocoding-api.open-meteo.com/v1/search", { name, count: 6, language: "ru", format: "json" });
  if (data === null) return found === null ? null : [];
  return (data.results || []).map((r) => place(r.name, r.latitude, r.longitude, r.timezone || null, r.admin1 || "", r.country || "", r.country_code || ""));
}

/** Место по координатам: название и регион, если сервис доступен, иначе просто координаты. */
export async function reverse(lat, lon) {
  const data = await nominatim("reverse", { lat, lon, zoom: 10 });
  const addr = data?.address || {};
  const name = ["city", "town", "village", "municipality", "county", "state"].map((k) => addr[k]).find(Boolean) || "";
  if (!name) return place(`${lat.toFixed(2)}, ${lon.toFixed(2)}`, lat, lon);
  return place(name, lat, lon, null, addr.state || "", addr.country || "", (addr.country_code || "").toUpperCase());
}

export async function timezoneAt(lat, lon) {
  const data = await get("https://api.open-meteo.com/v1/forecast", { latitude: lat, longitude: lon, current: "temperature_2m", timezone: "auto" });
  return data?.timezone || null;
}

/** Строка о погоде для карточки дня или пустая строка. */
export async function weather(lat, lon) {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const cached = weatherCache.get(key);
  if (cached && Date.now() - cached[0] < WEATHER_TTL) return cached[1];
  const data = await get("https://api.open-meteo.com/v1/forecast", {
    latitude: lat, longitude: lon, wind_speed_unit: "ms",
    current: "temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code",
  });
  if (!data?.current) return "";
  const c = data.current;
  const icon = WMO.find(([limit]) => (c.weather_code ?? 3) <= limit)?.[1] || "☁️";
  const text =
    `${icon} ${c.temperature_2m.toFixed(1)}°C (ощущается как ${c.apparent_temperature.toFixed(1)}°C), ` +
    `влажность ${c.relative_humidity_2m.toFixed(0)}%, ветер ${c.wind_speed_10m.toFixed(1)} м/с`;
  weatherCache.set(key, [Date.now(), text]);
  return text;
}

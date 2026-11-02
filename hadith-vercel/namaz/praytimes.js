// Астрономический расчёт времён намаза (формулы PrayTimes.org) — перенос namaz/praytimes.py один в один.
// Всё считается в часах местного времени, без округления.
import { mod, ymd } from "./time.js";

// За полярным кругом, когда солнце не восходит или не заходит (или день/ночь короче этого порога),
// времена берутся по ближайшей широте, где сутки делятся на день и ночь.
const MIN_DAY_OR_NIGHT = 1.0; // часов
const LAT_STEP = 0.25;

export function calcParams({ fajrAngle = 18, ishaAngle = 15, ishaMinutes = 0, asrFactor = 2, highlat = "angle", elevation = 0 } = {}) {
  return { fajrAngle, ishaAngle, ishaMinutes, asrFactor, highlat, elevation };
}

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;
const sin = (d) => Math.sin(rad(d));
const cos = (d) => Math.cos(rad(d));

function julian(year, month, day) {
  if (month <= 2) {
    year -= 1;
    month += 12;
  }
  const a = Math.floor(year / 100);
  const b = 2 - a + Math.floor(a / 4);
  return Math.floor(365.25 * (year + 4716)) + Math.floor(30.6001 * (month + 1)) + day + b - 1524.5;
}

/** Склонение солнца (градусы) и уравнение времени (часы). */
function sunPosition(jd) {
  const d = jd - 2451545.0;
  const g = mod(357.529 + 0.98560028 * d, 360);
  const q = mod(280.459 + 0.98564736 * d, 360);
  const lng = mod(q + 1.915 * sin(g) + 0.020 * sin(2 * g), 360);
  const e = 23.439 - 0.00000036 * d;
  const ra = mod(deg(Math.atan2(cos(e) * sin(lng), cos(lng))) / 15, 24);
  return [deg(Math.asin(sin(e) * sin(lng))), q / 15 - ra];
}

/** Времена в местном солнечном времени; NaN — если солнце не достигает нужной высоты. */
function solve(day, lat, lon, p) {
  const { y, m, d } = ymd(day);
  const jd = julian(y, m, d) - lon / 360;
  const midDay = (t) => mod(12 - sunPosition(jd + t)[1], 24);
  const angleTime = (angle, t, ccw) => {
    const decl = sunPosition(jd + t)[0];
    const x = (-sin(angle) - sin(decl) * sin(lat)) / (cos(decl) * cos(lat));
    if (!(x >= -1 && x <= 1)) return NaN;
    const h = deg(Math.acos(x)) / 15;
    return midDay(t) + (ccw ? -h : h);
  };
  const asrTime = (t) => {
    const decl = sunPosition(jd + t)[0];
    const angle = -deg(Math.atan(1 / (p.asrFactor + Math.tan(rad(Math.abs(lat - decl))))));
    return angleTime(angle, t, false);
  };

  const horizon = 0.833 + 0.0347 * Math.sqrt(Math.max(p.elevation, 0));
  const guess = { dawn: 5, sunrise: 6, noon: 12, asr: 13, sunset: 18, dusk: 18 };
  let t = { ...guess };
  for (let i = 0; i < 2; i++) {
    const f = Object.fromEntries(Object.entries(t).map(([k, v]) => [k, (Number.isNaN(v) ? guess[k] : v) / 24]));
    t = {
      dawn: angleTime(p.fajrAngle, f.dawn, true),
      sunrise: angleTime(horizon, f.sunrise, true),
      noon: midDay(f.noon),
      asr: asrTime(f.asr),
      sunset: angleTime(horizon, f.sunset, false),
      dusk: angleTime(p.ishaAngle, f.dusk, false),
    };
  }
  return t;
}

const hasDayAndNight = (t) => {
  const day = t.sunset - t.sunrise; // NaN не проходит ни одно сравнение
  return MIN_DAY_OR_NIGHT <= day && day <= 24 - MIN_DAY_OR_NIGHT;
};

/** → { dawn, sunrise, noon, asr, sunset, dusk, lat } в часах местного времени. */
export function sunTimes(day, lat, lon, tzHours, p) {
  let used = lat;
  let t = solve(day, used, lon, p);
  while (!hasDayAndNight(t) && Math.abs(used) > LAT_STEP) {
    used -= Math.sign(used) * LAT_STEP;
    t = solve(day, used, lon, p);
  }

  const shift = tzHours - lon / 15;
  t = Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v + shift]));
  if (Number.isNaN(t.asr)) t.asr = (t.noon + t.sunset) / 2;

  // Высокие широты: если угол не достигается или даёт слишком длинный интервал.
  const night = mod(t.sunrise - t.sunset, 24);
  const portion = (angle) => ({ angle: angle / 60, midnight: 0.5, seventh: 1 / 7 })[p.highlat] * night;

  const pf = portion(p.fajrAngle);
  if (Number.isNaN(t.dawn) || t.sunrise - t.dawn > pf) t.dawn = t.sunrise - pf;
  const pi = portion(p.ishaAngle);
  if (Number.isNaN(t.dusk) || t.dusk - t.sunset > pi) t.dusk = t.sunset + pi;
  if (p.ishaMinutes) t.dusk = t.sunset + Math.min(p.ishaMinutes / 60, night / 2);
  return { ...t, lat: used };
}

/**
 * Времена в целых минутах от полуночи. Начало намаза округляется вверх — время не объявляется
 * раньше, чем наступило; восход — до ближайшей минуты.
 */
export function minutes(st) {
  const out = {};
  for (const k of ["dawn", "noon", "asr", "sunset", "dusk"]) out[k] = Math.ceil(st[k] * 60 - 1e-6);
  out.sunrise = Math.floor(st.sunrise * 60 + 0.5);
  return out;
}

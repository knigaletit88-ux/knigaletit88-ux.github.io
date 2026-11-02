// Настройки пользователя и пресеты методов расчёта (перенос namaz/models.py).
// Настройки хранятся в Redis тем же JSON, что писала Python-версия, — с теми же именами полей.
import { calcParams } from "./praytimes.js";

// Намазы, по которым приходят уведомления (восход — как конец времени Фаджра).
export const PRAYERS = ["fajr", "sunrise", "zuhr", "asr", "maghrib", "isha"];

export const NAMES = {
  imsak: "Имсак", fajr: "Фаджр", sunrise: "Восход", zuhr: "Зухр", asr: "Аср", maghrib: "Магриб", isha: "Иша",
};

const method = (title, fajr_angle, isha_angle, isha_minutes = 0, zuhr_fixed = "") => ({ title, fajr_angle, isha_angle, isha_minutes, zuhr_fixed });
export const METHODS = {
  dumrt: method("ДУМ РТ (Татарстан)", 18, 15, 0, "12:00"),
  dumrf: method("ДУМ РФ", 16, 15),
  mwl: method("Всемирная исламская лига", 18, 17),
  turkey: method("Диянет (Турция)", 18, 17),
  makkah: method("Умм аль-Кура (Мекка)", 18.5, 0, 90),
  egypt: method("Египет", 19.5, 17.5),
  karachi: method("Карачи", 18, 18),
  isna: method("ISNA (Сев. Америка)", 15, 15),
};

export const HIGHLATS = { angle: "по углу (доля ночи)", midnight: "середина ночи", seventh: "1/7 ночи" };

export const EXTRAS = {
  duha: "Духа",
  fast_week: "Посты: пн и чт",
  fast_white: "Посты: белые дни",
  fast_special: "Посты: Арафа, Ашура, Шавваль",
  third: "Последняя треть ночи",
  midnight: "Середина ночи",
  wed: "Дуа в среду (Зухр–Аср)",
};

export const ASR_ALT = "asr_alt"; // Аср по другой тени, не той, что выбрана основной

const defaultAt = () => ({ ...Object.fromEntries(PRAYERS.map((p) => [p, p !== "sunrise"])), [ASR_ALT]: false });
const defaultPre = () => ({ ...Object.fromEntries(PRAYERS.map((p) => [p, true])), [ASR_ALT]: false });
const defaultExtra = () => Object.fromEntries(Object.keys(EXTRAS).map((k) => [k, k !== "midnight"]));

export function defaultSettings() {
  return {
    city: "", region: "", country: "", lat: null, lon: null, tz: "Europe/Moscow",
    method: "dumrf", method_auto: true, fajr_angle: 16.0, isha_angle: 15.0, isha_minutes: 0, asr_factor: 2,
    zuhr_fixed: "", fajr_before: 0, highlat: "angle", offsets: {}, hijri_offset: 0, use_custom: true,
    at: defaultAt(), pre: defaultPre(), pre_minutes: 15, extra: defaultExtra(), duha_delay: 20, fast_time: "20:00", weather: true,
  };
}

/** Настройки из JSON; новые ключи, появившиеся после сохранения, берут значения по умолчанию. */
export function settingsFromJson(data = {}) {
  const s = defaultSettings();
  for (const k of Object.keys(s)) if (k in data) s[k] = data[k];
  s.at = { ...defaultAt(), ...s.at };
  s.pre = { ...defaultPre(), ...s.pre };
  s.extra = { ...defaultExtra(), ...s.extra };
  s.offsets = { ...s.offsets };
  return s;
}

export const isReady = (s) => s.lat !== null && s.lat !== undefined && s.lon !== null && s.lon !== undefined;

export const settingsParams = (s) =>
  calcParams({ fajrAngle: s.fajr_angle, ishaAngle: s.isha_angle, ishaMinutes: s.isha_minutes, asrFactor: s.asr_factor, highlat: s.highlat });

export function applyMethod(s, key) {
  const m = METHODS[key];
  s.method = key;
  s.fajr_angle = m.fajr_angle;
  s.isha_angle = m.isha_angle;
  s.isha_minutes = m.isha_minutes;
  s.zuhr_fixed = m.zuhr_fixed;
}

/** Метод и Аср, принятые в местных расписаниях. */
export function applyPlaceDefaults(s) {
  applyMethod(s, defaultMethod(s.lat, s.lon, s.region, s.country));
  s.asr_factor = defaultAsr(s.lat, s.lon, s.region, s.country);
}

export const g = (x) => String(Number(x)); // как f"{x:g}" для углов: 18, 19.5

export function methodTitle(s) {
  if (s.method in METHODS) return METHODS[s.method].title;
  const isha = s.isha_minutes ? `+${s.isha_minutes} мин` : `${g(s.isha_angle)}°`;
  return `свой (Фаджр ${g(s.fajr_angle)}°, Иша ${isha})`;
}

export const asrTitle = (factor) => (factor === 2 ? "2 тени" : "1 тень");
export const asrName = (factor) => `Аср (${asrTitle(factor)})`;

// Где расписания принято составлять с Асром по двум теням.
const TWO_SHADOWS = new Set(["ru", "kz", "uz", "kg", "tj", "tm", "af", "pk", "in", "bd"]);
const ONE_SHADOW_REGIONS = ["дагестан", "чеч", "ингуш"];

/** Аср по умолчанию для места: 1 или 2 тени — как в местных расписаниях. */
export function defaultAsr(lat, lon, region = "", country = "") {
  region = region.toLowerCase();
  country = country.toLowerCase();
  if (ONE_SHADOW_REGIONS.some((name) => region.includes(name))) return 1;
  if (country) return TWO_SHADOWS.has(country) ? 2 : 1;
  return lat >= 41 && lat <= 82 && lon >= 27 && lon <= 180 ? 2 : 1;
}

/** Метод по умолчанию для места: Татарстан — ДУМ РТ, Россия — ДУМ РФ, иначе Лига. */
export function defaultMethod(lat, lon, region = "", country = "") {
  region = region.toLowerCase();
  country = country.toLowerCase();
  if (region.includes("татарстан") || region.includes("tatarstan")) return "dumrt";
  if (!region && lat >= 54.0 && lat <= 56.7 && lon >= 47.3 && lon <= 54.3) return "dumrt"; // геопозиция без названия региона
  if (country === "ru" || (!country && lat >= 41 && lat <= 70 && lon >= 27 && lon <= 180)) return "dumrf";
  if (country === "tr") return "turkey";
  return "mwl";
}

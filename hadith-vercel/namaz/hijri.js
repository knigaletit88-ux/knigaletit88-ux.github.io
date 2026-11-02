// Календарь хиджры (таблицы Умм аль-Кура — встроенный календарь Intl) и дни желательных постов.
// Перенос namaz/hijri.py, где те же таблицы брались из пакета hijridate.
import { weekday } from "./time.js";

export const MONTHS = [
  "Мухаррам", "Сафар", "Раби аль-авваль", "Раби ас-сани", "Джумада аль-уля", "Джумада ас-сани",
  "Раджаб", "Шаабан", "Рамадан", "Шавваль", "Зуль-када", "Зуль-хиджа",
];

const fmt = new Intl.DateTimeFormat("en-US-u-ca-islamic-umalqura-nu-latn", { timeZone: "UTC", year: "numeric", month: "numeric", day: "numeric" });
const cache = new Map();

function raw(day) {
  let h = cache.get(day);
  if (!h) {
    const p = Object.fromEntries(fmt.formatToParts(new Date(day * 86_400_000)).map((x) => [x.type, x.value]));
    h = [parseInt(p.year, 10), parseInt(p.month, 10), parseInt(p.day, 10)];
    if (cache.size > 5000) cache.clear();
    cache.set(day, h);
  }
  return h;
}

/** [год, месяц, день]. offset — поправка в днях под местное наблюдение луны. */
export const toHijri = (day, offset = 0) => raw(day + offset);

export function format(day, offset = 0) {
  const [y, m, d] = toHijri(day, offset);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export function formatShort(day, offset = 0) {
  const [y, m, d] = toHijri(day, offset);
  return `${d}.${m}.${y}`;
}

const monthLength = (firstDay) => (raw(firstDay + 29)[2] === 30 ? 30 : 29);

/** Сколько дней до начала следующего месяца, его название и дата (номер дня). */
export function nextMonth(day, offset = 0) {
  const [, m, d] = toHijri(day, offset);
  const first = day + offset - (d - 1);
  const days = monthLength(first) - d + 1;
  return [days, MONTHS[m % 12], day + days];
}

export function moon(day, offset = 0) {
  const d = toHijri(day, offset)[2];
  for (const [limit, icon] of [[1, "🌑"], [6, "🌒"], [8, "🌓"], [13, "🌔"], [16, "🌕"], [21, "🌖"], [23, "🌗"], [28, "🌘"]]) {
    if (d <= limit) return icon;
  }
  return "🌑";
}

/**
 * Причины, по которым пост в день желателен: week / white / arafa / tasua / ashura / shawwal.
 * Пусто, если пост в этот день обязателен (Рамадан) или запрещён (праздники, дни ташрика).
 */
export function fastingReasons(day, offset = 0) {
  const [, m, d] = toHijri(day, offset);
  if (m === 9 || (m === 10 && d === 1) || (m === 12 && d >= 10 && d <= 13)) return [];
  const reasons = [];
  if (m === 12 && d === 9) reasons.push("arafa");
  if (m === 1 && d === 9) reasons.push("tasua");
  if (m === 1 && d === 10) reasons.push("ashura");
  if (m === 10 && d === 2) reasons.push("shawwal");
  if (d === 13 || d === 14 || d === 15) reasons.push("white");
  if (weekday(day) === 0 || weekday(day) === 3) reasons.push("week");
  return reasons;
}

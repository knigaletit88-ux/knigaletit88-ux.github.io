// Даты и время раздела «Время намаза».
//
// Дата — номер дня от 1970-01-01 (целое). Время — «настенные» минуты от 1970-01-01 00:00 в часовом
// поясе пользователя: так же, как в Python-версии бота (datetime с одним и тем же ZoneInfo),
// сравнение и разность — по местным часам, без перевода в UTC.

export const MINUTE = 60_000;
export const DAY_MIN = 1440;

// Python-совместимые операции: % с неотрицательным остатком и round() с округлением к чётному
export const mod = (a, b) => ((a % b) + b) % b;
export function pyRound(x) {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

// ── даты ────────────────────────────────────────────────────────────────────

export const dayOf = (y, m, d) => Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
export function ymd(day) {
  const dt = new Date(day * 86_400_000);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}
export const weekday = (day) => mod(day + 3, 7); // понедельник — 0, как date.weekday() в Python
export const ordinal = (day) => day + 719163; // date.toordinal()
export const isoDate = (day) => new Date(day * 86_400_000).toISOString().slice(0, 10);
export const parseIsoDate = (text) => {
  const [y, m, d] = text.split("-").map(Number);
  return dayOf(y, m, d);
};
export function validDate(y, m, d) {
  const day = dayOf(y, m, d);
  const p = ymd(day);
  return p.y === y && p.m === m && p.d === d ? day : null;
}
export const daysInMonth = (y, m) => ymd(dayOf(y, m + 1, 1) - 1).d;
const pad = (n) => String(n).padStart(2, "0");
export const ddmm = (day) => { const p = ymd(day); return `${pad(p.d)}.${pad(p.m)}`; };
export const ddmmyyyy = (day) => { const p = ymd(day); return `${pad(p.d)}.${pad(p.m)}.${p.y}`; };

// ── «настенное» время ───────────────────────────────────────────────────────

export const wallOf = (day, minutes = 0) => day * DAY_MIN + minutes;
export const wallDay = (wall) => Math.floor(wall / DAY_MIN);
export const hm = (wall) => {
  const m = mod(Math.floor(wall), DAY_MIN);
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
};
export const parseHm = (text) => {
  const [h, m] = text.split(":").map(Number);
  return h * 60 + m;
};
// round_minute: ближайшая минута, половина — вверх
export const roundMinute = (wall) => Math.floor(wall + 0.5);

// ── часовые пояса ───────────────────────────────────────────────────────────

const formatters = new Map();
function formatter(tz) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric",
    });
    formatters.set(tz, f);
  }
  return f;
}

export function validTz(tz) {
  try {
    formatter(tz);
    return true;
  } catch {
    return false;
  }
}

/** Смещение пояса от UTC в минутах в момент utcMs. */
export function offsetAt(tz, utcMs) {
  const p = Object.fromEntries(formatter(tz).formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  const local = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  return Math.round((local - Math.floor(utcMs / MINUTE) * MINUTE) / MINUTE);
}

/** Момент UTC (мс) → настенные минуты пояса. */
export const toWall = (tz, utcMs) => Math.floor(utcMs / MINUTE) + offsetAt(tz, utcMs);

/** Настенные минуты → момент UTC (мс). В неоднозначный час берётся первое из двух значений. */
export function fromWall(tz, wall) {
  const guess = wall * MINUTE;
  const off1 = offsetAt(tz, guess - offsetAt(tz, guess) * MINUTE);
  const off0 = offsetAt(tz, guess - off1 * MINUTE - 3 * 3600_000);
  for (const off of [Math.max(off0, off1), Math.min(off0, off1)]) {
    if (toWall(tz, (wall - off) * MINUTE) === wall) return (wall - off) * MINUTE;
  }
  return (wall - off1) * MINUTE; // время попало в перевод часов — как есть
}

/** Смещение пояса (в часах) в полдень даты — так считает Python-версия. */
export const tzHoursAtNoon = (tz, day) => offsetAt(tz, fromWall(tz, wallOf(day, 720))) / 60;

/** Местное «сейчас» с секундами (дробные минуты) — как datetime.now(tz). */
export const nowWall = (tz, utcMs = Date.now()) => utcMs / MINUTE + offsetAt(tz, utcMs);

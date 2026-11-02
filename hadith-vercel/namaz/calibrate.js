// Подстройка под загруженное расписание (перенос namaz/calibrate.py).
//
// Столбцы таблицы сопоставляются с астрономическим расчётом для места пользователя: так определяется,
// где Фаджр, где Восход и т. д., за какой месяц расписание, какие ячейки с ошибкой и какими параметрами
// (углы, Аср по одной или двум теням, поправки) расчёт точнее всего повторяет это расписание.
import { asrTitle, g, METHODS, NAMES, settingsFromJson } from "./models.js";
import { calcParams, minutes, sunTimes } from "./praytimes.js";
import { median, mostCommon } from "./timetable.js";
import { ddmmyyyy, isoDate, mod, pyRound, tzHoursAtNoon, validDate, ymd } from "./time.js";

const ANGLES_FAJR = [18, 16, 15, 19.5, 18.5, 19, 20, 17.5, 17, 14, 13, 12];
const ANGLES_ISHA = [15, 17, 18, 17.5, 16, 14, 13, 12];

export const KEY_TITLES = {
  dawn: "Фаджр (рассвет)", fajr_m: "Фаджр (до восхода)", sunrise: NAMES.sunrise, zuhr: NAMES.zuhr,
  asr: NAMES.asr, maghrib: NAMES.maghrib, isha: NAMES.isha,
};

export class CalibrationError extends Error {}

/** Применяет подобранные параметры расчёта (result.changes) к настройкам. */
export function applyChanges(s, changes) {
  for (const [k, v] of Object.entries(changes)) {
    if (k === "offsets") s.offsets = { ...s.offsets, ...v };
    else s[k] = v;
  }
}

const hmOf = (m) => {
  m = mod(m, 1440);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

/** Расчётные времена (в минутах) для набора дат с кэшем по параметрам. */
class Model {
  constructor(s, dates) {
    this.s = s;
    this.dates = dates;
    this.tzh = dates.map((d) => tzHoursAtNoon(s.tz, d));
    this.cache = new Map();
  }

  get({ fajr = 18, isha = 15, asr = 2 } = {}) {
    const key = `${fajr}/${isha}/${asr}`;
    if (!this.cache.has(key)) {
      const p = calcParams({ fajrAngle: fajr, ishaAngle: isha, ishaMinutes: 0, asrFactor: asr, highlat: this.s.highlat });
      const out = { dawn: [], sunrise: [], noon: [], asr: [], sunset: [], dusk: [] };
      // то же округление, что и в расписании, — иначе поправки съедут на минуту
      this.dates.forEach((d, i) => {
        for (const [k, v] of Object.entries(minutes(sunTimes(d, this.s.lat, this.s.lon, this.tzh[i], p)))) out[k].push(v);
      });
      this.cache.set(key, out);
    }
    return this.cache.get(key);
  }
}

const residual = (v, p) => mod(v - p + 720, 1440) - 720;

/** Медианное отклонение столбца от модели и разброс (без 15% худших значений). */
function fit(col, model) {
  const res = [];
  col.forEach((v, i) => { if (v !== null) res.push(residual(v, model[i])); });
  if (res.length < 3) return null;
  const med = pyRound(median(res));
  const dev = res.map((r) => Math.abs(r - med)).sort((a, b) => a - b);
  const keep = dev.slice(0, Math.max(3, Math.ceil(dev.length * 0.85)));
  return [med, keep.reduce((a, b) => a + b, 0) / keep.length];
}

const match = (col, key, model, med, spread, params = {}, score = 0, offsetKey = "") => ({ col, key, model, med, spread, params, score, offsetKey });

function candidates(j, col, model) {
  const out = [];
  const base = model.get();
  const add = (key, series, lo, hi, penalty = 0, params = {}) => {
    const f = fit(col, series);
    if (f && lo <= f[0] && f[0] <= hi && f[1] <= 2.0) {
      out.push(match(j, key, series, f[0], f[1], params, f[1] + 0.2 * Math.abs(f[0]) + penalty, key === "dawn" ? "fajr" : key));
    }
  };

  ANGLES_FAJR.forEach((a, i) => add("dawn", model.get({ fajr: a }).dawn, -6, 6, i * 0.01, { fajr_angle: a }));
  ANGLES_ISHA.forEach((a, i) => add("isha", model.get({ isha: a }).dusk, -6, 6, i * 0.01, { isha_angle: a, isha_minutes: 0 }));
  for (const factor of [2, 1]) {
    // если в расписании оба Асра (1 и 2 тени), основным остаётся тот, что выбран у пользователя
    add("asr", model.get({ asr: factor }).asr, -6, 6, factor === model.s.asr_factor ? 0 : 0.05, { asr_factor: factor });
  }
  add("sunrise", base.sunrise, -6, 6);
  add("maghrib", base.sunset, -3, 12);

  // Фаджр «за N минут до восхода» и Иша «через N минут после заката».
  let f = fit(col, base.sunrise);
  if (f && f[0] >= -150 && f[0] <= -20 && f[1] <= 1.5) {
    const n = -f[0];
    out.push(match(j, n <= 100 ? "fajr_m" : "dawn", base.sunrise.map((v) => v - n), 0, f[1], n <= 100 ? { fajr_before: n } : {}, f[1] + 0.5));
  }
  f = fit(col, base.sunset);
  if (f && f[0] >= 45 && f[0] <= 130 && f[1] <= 1.5) {
    out.push(match(j, "isha", base.sunset.map((v) => v + f[0]), 0, f[1], { isha_minutes: f[0] }, f[1] + 0.5));
  }

  // Зухр: фиксированное время (один и тот же час весь месяц) или по солнцу.
  const known = col.filter((v) => v !== null);
  if (known.length) {
    const [mode, n] = mostCommon(known)[0];
    if (n >= 0.9 * known.length && mode >= 11 * 60 && mode <= 13 * 60 + 45) {
      out.push(match(j, "zuhr", col.map(() => mode), 0, 0.0, { zuhr_fixed: hmOf(mode) }, 0.0));
    } else {
      add("zuhr", base.noon, -2, 20, 0, { zuhr_fixed: "" });
    }
  }
  return out;
}

function assign(table, model) {
  const cands = [];
  for (let j = 0; j < table.ncols; j++) cands.push(...candidates(j, table.rows.map((r) => r.times[j]), model));
  const chosen = [];
  for (const c of cands.sort((a, b) => a.score - b.score)) {
    if (chosen.every((m) => c.col !== m.col && c.key !== m.key)) chosen.push(c);
  }
  return chosen;
}

/** Насколько таблица похожа на эти даты: по восходу и закату (они не зависят от метода). */
function monthScore(table, model) {
  const base = model.get();
  const scores = [];
  for (const [key, lo, hi] of [["sunrise", -6, 6], ["sunset", -3, 12]]) {
    let best = 30.0;
    for (let j = 0; j < table.ncols; j++) {
      const f = fit(table.rows.map((r) => r.times[j]), base[key]);
      if (f && lo <= f[0] && f[0] <= hi) best = Math.min(best, Math.abs(f[0]) + f[1]);
    }
    scores.push(best);
  }
  return [scores[0] + scores[1], Math.min(...scores)];
}

/** Последовательные номера по строкам; пропуски и ошибки распознавания правятся по соседям. */
function consensus(values) {
  const n = values.length;
  if (values.filter((v) => v !== null).length < n / 2) return null;
  const offs = values.map((v, i) => (v !== null ? v - i : null));
  const out = [];
  for (let i = 0; i < n; i++) {
    const near = offs.slice(Math.max(0, i - 3), i + 4).filter((o) => o !== null);
    if (!near.length) throw new Error("consensus: нет соседних значений"); // как IndexError в Python-версии
    const [common, cnt] = mostCommon(near)[0];
    out.push(i + (offs[i] !== null && (offs[i] === common || cnt < 2) ? offs[i] : common));
  }
  return new Set(out).size === n ? out : null;
}

const ORDINAL_SHIFT = 719163; // date.toordinal() для 1970-01-01

/** Варианты дат для строк таблицы, в порядке предпочтения. */
function dateOptions(table, today, month) {
  if (!month) {
    const full = consensus(table.rows.map((r) => (r.fullDate !== null ? r.fullDate + ORDINAL_SHIFT : null)));
    if (full && full.length) return [full.map((o) => o - ORDINAL_SHIFT)];
  }
  let days = consensus(table.rows.map((r) => (r.fullDate !== null ? ymd(r.fullDate).d : r.day)));
  if (days === null) days = table.rows.map((_, i) => i + 1);
  let months;
  if (month) {
    months = [month];
  } else {
    // текущий месяц, следующий, предыдущий, затем остальные на год вперёд
    const t = ymd(today);
    const idx = t.y * 12 + t.m - 1;
    const order = [idx, idx + 1, idx - 1];
    for (let i = idx + 2; i < idx + 11; i++) order.push(i);
    order.push(idx - 2);
    months = order.map((i) => [Math.floor(i / 12), (i % 12) + 1]);
    // в строках указан месяц («01.10») — остаётся выбрать только год
    const seen = mostCommon(table.rows.filter((r) => r.month).map((r) => r.month));
    if (seen.length && seen[0][1] >= table.rows.length / 2) months = months.filter(([, m]) => m === seen[0][0]);
  }
  const out = [];
  for (const [y, m] of months) {
    const dates = days.map((d) => validDate(y, m, d));
    if (dates.every((d) => d !== null)) out.push(dates);
  }
  return out;
}

const sameMethod = (s, key) => {
  const m = METHODS[key];
  if (s.fajr_angle !== m.fajr_angle || s.isha_minutes !== m.isha_minutes || s.zuhr_fixed !== m.zuhr_fixed) return false;
  return Boolean(m.isha_minutes) || s.isha_angle === m.isha_angle;
};

/** month=[год, месяц] — если пользователь указал месяц сам; иначе определяется автоматически. */
export function calibrate(table, s, today, month = null) {
  if (table.rows.length < 5) throw new CalibrationError("Не удалось найти таблицу: нужно хотя бы 5 строк с временами намаза.");
  let best = null;
  for (const dates of dateOptions(table, today, month)) {
    const model = new Model(s, dates);
    const [total, single] = monthScore(table, model);
    if (best === null || total < best[0] - 1.0) best = [total, single, dates, model];
  }
  if (best === null) throw new CalibrationError("Числа месяца в таблице не подходят к указанному месяцу.");
  const [, single, dates, model] = best;
  if (single > 8) {
    throw new CalibrationError(
      `Таблица не похожа на расписание для места «${s.city}»: восход и закат не совпадают с расчётом. ` +
        "Проверьте город в настройках. Если месяц определился неверно — пришлите расписание ещё раз " +
        "с месяцем в первой строке, например: 11.2026",
    );
  }

  const matches = assign(table, model);
  const keys = new Set(matches.map((m) => m.key));
  if ((!keys.has("sunrise") && !keys.has("maghrib")) || matches.length < 3) {
    throw new CalibrationError("Не удалось понять, какие столбцы каким намазам соответствуют.");
  }

  // Значения по дням: явные ошибки распознавания и пропуски заменяются расчётом
  // с тем же отклонением, что у соседних дней.
  const values = Object.fromEntries(dates.map((d) => [isoDate(d), {}]));
  let fixed = 0;
  let filled = 0;
  for (const m of matches) {
    const col = table.rows.map((r) => r.times[m.col]);
    const res = col.map((v, i) => (v === null ? null : residual(v, m.model[i])));
    const limit = m.spread <= 1 ? 2 : Math.max(3, pyRound(3 * m.spread));
    dates.forEach((d, i) => {
      const lo = Math.max(0, i - 3);
      const near = res.slice(lo, i + 4).filter((r, k) => r !== null && k + lo !== i);
      const local = near.length >= 2 ? pyRound(median(near)) : m.med;
      let v;
      if (res[i] === null) {
        filled += 1;
        v = m.model[i] + local;
      } else if (Math.abs(res[i] - local) >= limit) {
        fixed += 1;
        v = m.model[i] + local;
      } else {
        v = col[i];
      }
      values[isoDate(d)][m.key] = hmOf(v);
    });
  }

  // Параметры расчёта, которые лучше всего повторяют расписание (для дат вне него).
  const changes = {};
  const offsets = {};
  for (const m of matches) {
    if (m.spread > 1.5) continue;
    Object.assign(changes, m.params);
    if (m.offsetKey) offsets[m.offsetKey] = m.med;
  }
  if (Object.keys(offsets).length) changes.offsets = offsets;
  const probe = settingsFromJson(JSON.parse(JSON.stringify(s)));
  for (const [k, v] of Object.entries(changes)) if (k !== "offsets") probe[k] = v;
  changes.method = [s.method, ...Object.keys(METHODS)].find((k) => k in METHODS && sameMethod(probe, k)) || "custom";
  return { dates, values, matches, changes, fixed, filled, cells: dates.length * matches.length, ignoredCols: table.ncols - matches.length };
}

export function summary(r) {
  const lines = [`📅 ${ddmmyyyy(r.dates[0])} – ${ddmmyyyy(r.dates.at(-1))}, дней: ${r.dates.length}`];
  lines.push("Столбцы: " + [...r.matches].sort((a, b) => a.col - b.col).map((m) => KEY_TITLES[m.key]).join(", "));
  if (r.ignoredCols) lines.push(`Пропущено столбцов, не похожих на времена намаза: ${r.ignoredCols}`);
  if (r.fixed || r.filled) lines.push(`Ячеек исправлено по соседним дням: ${r.fixed}, дополнено расчётом: ${r.filled} (из ${r.cells})`);
  const fitted = [];
  const c = r.changes;
  if ("fajr_angle" in c) fitted.push(`Фаджр ${g(c.fajr_angle)}°`);
  if ("fajr_before" in c && c.fajr_before) fitted.push(`Фаджр за ${c.fajr_before} мин до восхода`);
  if (c.isha_minutes) fitted.push(`Иша через ${c.isha_minutes} мин после Магриба`);
  else if ("isha_angle" in c) fitted.push(`Иша ${g(c.isha_angle)}°`);
  if ("asr_factor" in c) fitted.push(`Аср — ${asrTitle(c.asr_factor)}`);
  if ("zuhr_fixed" in c) fitted.push(c.zuhr_fixed ? `Зухр всегда в ${c.zuhr_fixed}` : "Зухр по солнцу");
  const offs = Object.entries(c.offsets || {}).filter(([, v]) => v).map(([k, v]) => `${NAMES[k]} ${v >= 0 ? "+" : ""}${v}`);
  if (offs.length) fitted.push("поправки (мин): " + offs.join(", "));
  if (fitted.length) lines.push("Подстройка расчёта: " + fitted.join("; "));
  return lines.join("\n");
}

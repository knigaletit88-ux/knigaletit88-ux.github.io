// Разбор текста расписания в «сырую» таблицу: строки-дни × столбцы времён (перенос namaz/timetable.py).
// Что означает каждый столбец, здесь не решается — это делает calibrate.js, сравнивая столбцы с расчётом.
import { validDate } from "./time.js";

const DATE_RE = /(?<!\d)(\d{1,2})[./](\d{1,2})[./](\d{4}|\d{2})(?!\d)/g;
export const TIME_RE = /(?<![\d:])([01]?\d|2[0-3])\s?[:：]\s?([0-5]\d)(?![\d:])/g;
// Запасные варианты: «05.33», «05-33», «0533» — когда двоеточие не распозналось.
const WEAK_RE = /(?<![\d.:])([01]\d|2[0-3])\s?[.,;'\-]?\s?([0-5]\d)(?![\d.:])/g;
const DAY_MONTH_RE = /(?<![\d.:])(\d{1,2})[./](\d{1,2})(?![\d.:])/; // «01.10» без года
const DAY_RE = /(?<![\d.:,])(0?[1-9]|[12]\d|3[01])(?![\d.:,])/;

// Типичные ошибки распознавания внутри чисел.
const FIX = Object.fromEntries([..."OoОоlI|SsBЗзб"].map((ch, i) => [ch, "0000111558336"[i]]));

export const median = (values) => {
  const v = [...values].sort((a, b) => a - b);
  const n = v.length;
  return n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2;
};

/** Counter(...).most_common(): по убыванию числа, при равенстве — в порядке первого появления. */
export function mostCommon(values) {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]);
}

const normalize = (text) =>
  text.replace(/\S+/g, (word) => {
    const digits = [...word].filter((ch) => /\d/.test(ch)).length;
    return digits * 2 >= [...word].length ? [...word].map((ch) => FIX[ch] ?? ch).join("") : word;
  });

const blank = (text, start, end) => text.slice(0, start) + " ".repeat(end - start) + text.slice(end);

function scan(cell, row) {
  let text = normalize(cell.text);
  const scale = (cell.x1 - cell.x0) / Math.max(text.length, 1);
  const pos = (m) => cell.x0 + ((m.index + m.index + m[0].length) / 2) * scale;

  for (const m of [...text.matchAll(DATE_RE)]) {
    const d = +m[1], mo = +m[2];
    let y = +m[3];
    y += y < 100 ? 2000 : 0;
    if (row.fullDate === null && y >= 2000 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) row.fullDate = validDate(y, mo, d);
    text = blank(text, m.index, m.index + m[0].length);
  }
  for (const m of [...text.matchAll(TIME_RE)]) {
    row.strong.push([pos(m), +m[1] * 60 + +m[2]]);
    text = blank(text, m.index, m.index + m[0].length);
  }
  for (const m of text.matchAll(WEAK_RE)) row.weak.push([pos(m), +m[1] * 60 + +m[2]]);
  let m = DAY_MONTH_RE.exec(text);
  if (m && row.month === null && +m[1] >= 1 && +m[1] <= 31 && +m[2] >= 1 && +m[2] <= 12) {
    row.day = [pos(m), +m[1]];
    row.month = +m[2];
    return;
  }
  m = DAY_RE.exec(text);
  if (m && row.month === null && (row.day === null || pos(m) < row.day[0])) row.day = [pos(m), +m[1]];
}

const byPair = (a, b) => a[0] - b[0] || a[1] - b[1];

/** geometry=true — столбцы по положению на картинке; false — по порядку в строке (текст). */
export function buildTable(cells, geometry = true) {
  if (!cells.length) return { rows: [], ncols: 0 };
  // Если двоеточий в тексте почти нет — значит времена записаны через точку/дефис.
  const joined = cells.map((c) => normalize(c.text)).join(" ").replace(DATE_RE, " ");
  const strongCount = [...joined.matchAll(TIME_RE)].length;
  const dotted = strongCount < 12 && 12 <= [...joined.matchAll(WEAK_RE)].length;

  const lineH = median(cells.map((c) => c.h));
  const rows = [];
  for (const cell of [...cells].sort((a, b) => a.y - b.y)) {
    if (!rows.length || cell.y - rows.at(-1).y > 0.6 * lineH) rows.push({ y: cell.y, fullDate: null, day: null, month: null, strong: [], weak: [] });
    scan(cell, rows.at(-1));
  }
  for (const r of rows) {
    if (dotted) [r.strong, r.weak] = [r.weak, []];
    r.strong.sort(byPair);
    // число месяца стоит левее времён
    if (dotted || (r.day && r.strong.length && r.day[0] > r.strong[0][0])) r.day = r.month = null;
  }

  const data = rows.filter((r) => r.strong.length >= 3);
  if (!data.length) return { rows: [], ncols: 0 };
  const counts = new Map();
  for (const r of data) counts.set(r.strong.length, (counts.get(r.strong.length) || 0) + 1);
  const ncols = [...counts].reduce((best, cur) => (cur[1] > best[1] || (cur[1] === best[1] && cur[0] > best[0]) ? cur : best))[0];
  const ref = data.filter((r) => r.strong.length === ncols);
  const centers = Array.from({ length: ncols }, (_, j) => median(ref.map((r) => r.strong[j][0])));
  const spacing = centers.length > 1 ? Math.min(...centers.slice(1).map((c, i) => c - centers[i])) : 1.0;
  const nearest = (x) => centers.reduce((best, c, k) => (Math.abs(x - c) < Math.abs(x - centers[best]) ? k : best), 0);

  const out = [];
  for (const r of data) {
    let times;
    if (r.strong.length === ncols) {
      times = r.strong.map(([, v]) => v);
    } else if (!geometry) {
      continue;
    } else {
      times = new Array(ncols).fill(null);
      const dist = new Array(ncols).fill(spacing * 0.5);
      for (const [x, v] of r.strong) {
        const j = nearest(x);
        if (Math.abs(x - centers[j]) < dist[j]) [times[j], dist[j]] = [v, Math.abs(x - centers[j])];
      }
      for (const [x, v] of r.weak) {
        const j = nearest(x);
        if (times[j] === null && Math.abs(x - centers[j]) < spacing * 0.35) times[j] = v;
      }
    }
    if (times.filter((v) => v !== null).length * 2 > ncols) out.push({ day: r.day ? r.day[1] : null, fullDate: r.fullDate, times, month: r.month });
  }
  return { rows: out, ncols };
}

export const textCells = (text) =>
  text.split(/\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/).map((line, i) => ({ text: line, x0: 0, x1: line.length, y: i, h: 1 })).filter((c) => c.text.trim());

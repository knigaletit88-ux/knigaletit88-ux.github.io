// Картинка с расписанием на месяц (перенос namaz/render.py). Python-версия рисовала её через Pillow;
// здесь та же раскладка собирается в SVG и переводится в PNG библиотекой resvg (WebAssembly).
// Модуль работает только под Deno (npm:-импорт) — bot.js подгружает его, когда нужна картинка.
// Шрифт DejaVu лежит рядом с кодом — картинка выглядит одинаково везде.
import { initWasm, Resvg } from "npm:@resvg/resvg-wasm@2.6.2";
import * as hijri from "./hijri.js";
import { asrTitle, methodTitle, NAMES, PRAYERS } from "./models.js";
import { Schedule } from "./schedule.js";
import { MONTHS_NOM, WEEKDAYS_SHORT } from "./texts.js";
import { daysInMonth, dayOf, ddmm, hm, weekday } from "./time.js";

const RESVG = "2.6.2"; // npm:@resvg/resvg-wasm — версия кода и wasm-файла должна совпадать
const BG = "#FFFFFF", INK = "#1B1F23", MUTED = "#6B7280", LINE = "#E1E7E3";
const BRAND = "#0F5132", BRAND_SOFT = "#E8F3EE", ZEBRA = "#F7FAF8", FRIDAY = "#FFF6DC", TODAY = "#CFEBDB";
const MARGIN = 40, ROW_H = 50, HEAD_H = 64, TITLE_H = 150, FOOT_H = 96;
const W_DATE = 196, W_HIJRI = 186, W_TIME = 134, W_NIGHT = 158, W_ASR = 166;
// Положение базовой линии DejaVu Sans: верх текста (как anchor «la» в Pillow) и середина («lm», «mm»)
const TOP = 0.928, MIDDLE = 0.346;

const xml = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** SVG месяца — та же раскладка, что у Python-версии. */
export function monthSvg(user, year, month, today = null) {
  const s = user.s;
  const sched = new Schedule(s, user.custom);
  // Столбцы времён: [заголовок, ширина, как взять время из дня, жирным ли, серым ли]. Аср — двумя столбцами.
  const times = [];
  for (const k of [...(s.fajr_before ? ["imsak"] : []), ...PRAYERS]) {
    if (k === "asr") {
      for (const f of [1, 2]) times.push([`Аср ${asrTitle(f)}`, W_ASR, (day) => day.asr[f], f === s.asr_factor, false]);
    } else {
      const minor = k === "imsak" || k === "sunrise";
      times.push([NAMES[k], W_TIME, (day) => day.t[k], !minor, minor]);
    }
  }
  const cols = [["Дата", W_DATE], ["Хиджра", W_HIJRI], ...times.map((c) => [c[0], c[1]]), ["Полночь", W_NIGHT], ["Посл. 1/3", W_NIGHT]];
  const ndays = daysInMonth(year, month);
  const width = MARGIN * 2 + cols.reduce((a, [, w]) => a + w, 0);
  const height = TITLE_H + HEAD_H + ROW_H * ndays + FOOT_H;

  const out = [];
  const rect = (x, y, w, h, fill) => out.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`);
  const text = (x, y, value, size, fill, { bold = false, anchor = "start", middle = true } = {}) =>
    out.push(`<text x="${x}" y="${(y + size * (middle ? MIDDLE : TOP)).toFixed(1)}" font-size="${size}"${bold ? ' font-weight="bold"' : ""} fill="${fill}" text-anchor="${anchor}">${xml(value)}</text>`);

  rect(0, 0, width, height, BG);
  rect(0, 0, width, TITLE_H, BRAND);
  text(MARGIN, 28, `Время намаза — ${MONTHS_NOM[month - 1]} ${year}`, 44, "#FFFFFF", { bold: true, middle: false });
  text(MARGIN, 96, `${s.city}  ·  метод: ${methodTitle(s)}`, 26, "#CFE5DA", { middle: false });

  let y = TITLE_H;
  rect(0, y, width, HEAD_H, BRAND_SOFT);
  let x = MARGIN;
  for (const [title, w] of cols) {
    text(x + w / 2, y + HEAD_H / 2, title, 24, BRAND, { bold: true, anchor: "middle" });
    x += w;
  }
  y += HEAD_H;

  let anyCustom = false;
  for (let n = 1; n <= ndays; n++) {
    const d = dayOf(year, month, n);
    const day = sched.day(d);
    const night = sched.night(d);
    const friday = weekday(d) === 4;
    const fill = d === today ? TODAY : friday ? FRIDAY : n % 2 === 0 ? ZEBRA : null;
    if (fill) rect(0, y, width, ROW_H, fill);
    out.push(`<line x1="${MARGIN}" y1="${y + ROW_H}" x2="${width - MARGIN}" y2="${y + ROW_H}" stroke="${LINE}" stroke-width="1"/>`);
    anyCustom ||= day.custom.size > 0;

    const cy = y + ROW_H / 2;
    x = MARGIN;
    text(x + 12, cy, ddmm(d), 28, INK, { bold: true });
    text(x + 112, cy, WEEKDAYS_SHORT[weekday(d)] + (day.custom.size ? " •" : ""), 24, friday ? BRAND : MUTED);
    x += W_DATE;
    text(x + W_HIJRI / 2, cy, hijri.formatShort(d, s.hijri_offset), 24, MUTED, { anchor: "middle" });
    x += W_HIJRI;
    for (const [, w, get, bold, muted] of times) {
      text(x + w / 2, cy, hm(get(day)), 28, muted ? MUTED : INK, { bold, anchor: "middle" });
      x += w;
    }
    for (const t of [night.midnight, night.third3]) {
      text(x + W_NIGHT / 2, cy, hm(t), 28, MUTED, { anchor: "middle" });
      x += W_NIGHT;
    }
    y += ROW_H;
  }

  const notes = ["Полночь и последняя треть — для ночи после Магриба этого дня (до Фаджра следующего)."];
  if (anyCustom) notes.push("• — времена этого дня взяты из загруженного календаря.");
  notes.forEach((note, i) => text(MARGIN, y + 20 + i * 32, note, 22, MUTED, { middle: false }));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="DejaVu Sans" xml:space="preserve">${out.join("")}</svg>`;
}

let engine = null; // Promise<шрифты> — wasm и шрифты загружаются при первой картинке

async function loadEngine() {
  await initWasm(fetch(`https://cdn.jsdelivr.net/npm/@resvg/resvg-wasm@${RESVG}/index_bg.wasm`));
  return Promise.all(["DejaVuSans.ttf", "DejaVuSans-Bold.ttf"].map((f) => Deno.readFile(new URL(`./fonts/${f}`, import.meta.url))));
}

/** PNG месяца (Uint8Array). */
export async function renderMonth(user, year, month, today = null) {
  engine ||= loadEngine().catch((err) => { engine = null; throw err; });
  const fonts = await engine;
  const resvg = new Resvg(monthSvg(user, year, month, today), {
    font: { fontBuffers: fonts, loadSystemFonts: false, defaultFontFamily: "DejaVu Sans" },
  });
  return resvg.render().asPng();
}

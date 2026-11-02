// Клавиатуры и экраны настроек (перенос namaz/keyboards.py). Раздел живёт внутри бота хадисов,
// поэтому в меню всегда есть кнопка «📖 Хадисы».
import { ASR_ALT, asrName, asrTitle, EXTRAS, g, HIGHLATS, methodTitle, METHODS, NAMES, PRAYERS } from "./models.js";
import { escape, minutesWord, MONTHS_NOM } from "./texts.js";
import { ddmm, ddmmyyyy, isoDate, parseIsoDate } from "./time.js";

export const BTN_TODAY = "🕌 Сегодня";
export const BTN_TOMORROW = "🌄 Завтра";
export const BTN_MONTH = "🗓 Месяц";
export const BTN_CALC = "🧮 Калькулятор";
export const BTN_NOTIFY = "🔔 Уведомления";
export const BTN_SETTINGS = "⚙️ Настройки";
export const BTN_CALENDAR = "📷 Мой календарь";
export const BTN_CANCEL = "Отмена";
export const BTN_HADITH = "📖 Хадисы"; // вернуться к хадисам

const key = (text, extra = {}) => ({ text, ...extra });

export const mainMenu = () => ({
  keyboard: [
    [key(BTN_TODAY), key(BTN_TOMORROW)],
    [key(BTN_MONTH), key(BTN_CALC)],
    [key(BTN_NOTIFY), key(BTN_SETTINGS)],
    [key(BTN_CALENDAR), key(BTN_HADITH)],
  ],
  resize_keyboard: true,
});

export const TIMEZONES = [
  ["Калининград +2", "Europe/Kaliningrad"], ["Москва +3", "Europe/Moscow"], ["Самара +4", "Europe/Samara"],
  ["Екатеринбург +5", "Asia/Yekaterinburg"], ["Омск +6", "Asia/Omsk"], ["Красноярск +7", "Asia/Krasnoyarsk"],
  ["Иркутск +8", "Asia/Irkutsk"], ["Якутск +9", "Asia/Yakutsk"], ["Владивосток +10", "Asia/Vladivostok"],
  ["Магадан +11", "Asia/Magadan"], ["Камчатка +12", "Asia/Kamchatka"],
];
export const ZUHR_OPTIONS = ["12:00", "12:30", "13:00"];

export const btn = (text, data) => ({ text, callback_data: data });
export const markup = (...rows) => ({ inline_keyboard: rows.filter((r) => r && r.length) });
const check = (on) => (on ? "✅" : "▫️");
const signed = (n) => `${n >= 0 ? "+" : ""}${n}`;

export function placeRequest(cancel) {
  const rows = [[key("📍 Отправить геопозицию", { request_location: true })]];
  if (cancel) rows.push([key(BTN_CANCEL)]);
  return { keyboard: rows, resize_keyboard: true };
}

export function dayNav(d, today) {
  const prev = d - 1;
  const nxt = d + 1;
  return markup([btn(`◀ ${ddmm(prev)}`, `day:${isoDate(prev)}`), btn("Сегодня", `day:${isoDate(today)}`), btn(`${ddmm(nxt)} ▶`, `day:${isoDate(nxt)}`)]);
}

export function months(todayYm, page) {
  const first = todayYm.y * 12 + todayYm.m - 1 + page * 6;
  const cells = [];
  for (let i = first; i < first + 6; i++) {
    const y = Math.floor(i / 12);
    const m = (((i % 12) + 12) % 12) + 1;
    cells.push(btn(`${MONTHS_NOM[m - 1].slice(0, 3)} ${y}`, `mo:${y}-${String(m).padStart(2, "0")}`));
  }
  return markup(cells.slice(0, 3), cells.slice(3), [btn("◀ раньше", `ml:${page - 1}`), btn("позже ▶", `ml:${page + 1}`)]);
}

export const monthFile = (y, m) => markup([btn("📎 Прислать файлом (без сжатия)", `mf:${y}-${String(m).padStart(2, "0")}`)]);

// ── уведомления ─────────────────────────────────────────────────────────────

export function notifyScreen(s) {
  const text =
    "🔔 <b>Уведомления</b>\n" +
    "Левая колонка — в момент наступления, правая — заранее " +
    `(сейчас за ${minutesWord(s.pre_minutes)}). Нажмите, чтобы включить или выключить.`;
  // Аср — двумя строками по времени: сначала по 1 тени, потом по 2 теням.
  const asrKeys = s.asr_factor === 1 ? ["asr", ASR_ALT] : [ASR_ALT, "asr"];
  const names = { ...NAMES, [asrKeys[0]]: asrName(1), [asrKeys[1]]: asrName(2) };
  const order = PRAYERS.flatMap((p) => (p === "asr" ? asrKeys : [p]));
  const rows = order.map((p) => [btn(`${check(s.at[p])} ${names[p]}`, `n:a:${p}`), btn(`${check(s.pre[p])} заранее`, `n:p:${p}`)]);
  rows.push([btn("−5", "n:m:-5"), btn("−1", "n:m:-1"), btn(`⏳ за ${s.pre_minutes} мин`, "n:noop"), btn("+1", "n:m:1"), btn("+5", "n:m:5")]);
  const extra = (k) => btn(`${check(s.extra[k])} ${EXTRAS[k]}`, `n:x:${k}`);
  rows.push(
    [extra("duha"), extra("wed")],
    [extra("third"), extra("midnight")],
    [extra("fast_week"), extra("fast_white")],
    [extra("fast_special")],
    [btn("⏱ Когда напоминать о Духа и постах", "n:t")],
  );
  return [text, markup(...rows)];
}

export function notifyTimesScreen(s) {
  const text =
    "⏱ <b>Время напоминаний</b>\n" +
    `• Духа — через ${minutesWord(s.duha_delay)} после восхода;\n` +
    `• о желательном посте — накануне в ${s.fast_time};\n` +
    "• о дуа в среду — через 30 минут после Зухра;\n" +
    "• о последней трети и середине ночи — в момент наступления.";
  return [text, markup(
    [btn("−5", "n:d:-5"), btn(`Духа: +${s.duha_delay} мин`, "n:noop"), btn("+5", "n:d:5")],
    [btn("−30 мин", "n:f:-30"), btn(`Пост: в ${s.fast_time}`, "n:noop"), btn("+30 мин", "n:f:30")],
    [btn("← Назад", "n:b")],
  )];
}

// ── настройки ───────────────────────────────────────────────────────────────

function offsetsText(s) {
  const items = PRAYERS.filter((p) => s.offsets[p]).map((p) => `${NAMES[p]} ${signed(s.offsets[p])}`);
  return items.length ? items.join(", ") : "нет";
}
const fajrText = (s) => (s.fajr_before ? `за ${s.fajr_before} мин до восхода` : "с рассветом");
const hijriText = (s) => (s.hijri_offset ? `${signed(s.hijri_offset)} дн.` : "без поправки");

export function settingsScreen(user) {
  const s = user.s;
  const asr = asrTitle(s.asr_factor);
  const zuhr = s.zuhr_fixed || "по солнцу";
  const text = [
    "⚙️ <b>Настройки</b>",
    `📍 ${escape(s.city)} (${s.lat.toFixed(2)}, ${s.lon.toFixed(2)}), ${s.tz}`,
    `🧭 Метод: ${methodTitle(s)}`,
    `Фаджр: ${fajrText(s)} · Зухр: ${zuhr}`,
    `Аср: показываются оба времени — по 1 тени и по 2 теням; основной — ${asr}`,
    `Поправки (мин): ${offsetsText(s)}`,
    `Хиджра: ${hijriText(s)} · высокие широты: ${HIGHLATS[s.highlat]}`,
  ].join("\n");
  return [text, markup(
    [btn("📍 Изменить город", "s:city"), btn("🕐 Часовой пояс", "s:tz")],
    [btn("🧭 Метод расчёта", "s:method")],
    [btn(`Основной Аср: ${asr}`, "s:asr"), btn(`Зухр: ${zuhr}`, "s:zuhr")],
    [btn(`Фаджр: ${fajrText(s)}`, "s:fajr")],
    [btn("± Поправки по минутам", "s:off")],
    [btn("−1", "s:h:-1"), btn(`🌙 Хиджра: ${hijriText(s)}`, "s:noop"), btn("+1", "s:h:1")],
    [btn(`Высокие широты: ${HIGHLATS[s.highlat]}`, "s:hl")],
    [btn(`${check(s.weather)} Погода в карточке дня`, "s:w")],
  )];
}

export function methodsScreen(s) {
  const text =
    "🧭 <b>Метод расчёта</b>\n" +
    "От метода зависят Фаджр и Иша (угол солнца под горизонтом). " +
    "Если есть расписание вашей мечети — пришлите его текстом (по строке на день), и бот подберёт параметры сам.";
  const rows = Object.entries(METHODS).map(([k, m]) => {
    const isha = m.isha_minutes ? `+${m.isha_minutes} мин` : `${g(m.isha_angle)}°`;
    return [btn(`${check(s.method === k)} ${m.title} · ${g(m.fajr_angle)}° / ${isha}`, `s:m:${k}`)];
  });
  rows.push([btn("← Назад", "s:b")]);
  return [text, markup(...rows)];
}

export function zuhrScreen(s) {
  const text =
    "<b>Зухр</b>\nПо солнцу — сразу после зенита. В Татарстане и некоторых других регионах " +
    "Зухр круглый год указывают в одно и то же время.";
  return [text, markup(
    [btn(`${check(!s.zuhr_fixed)} По солнцу`, "s:z:sun")],
    ZUHR_OPTIONS.map((v) => btn(`${check(s.zuhr_fixed === v)} ${v}`, `s:z:${v}`)),
    [btn("← Назад", "s:b")],
  )];
}

export function offsetsScreen(s) {
  const text = "± <b>Поправки</b>\nСдвиг времени каждого намаза в минутах — чтобы совпадало с расписанием вашей мечети.";
  const rows = PRAYERS.map((p) => [btn("−1", `s:o:${p}:-1`), btn(`${NAMES[p]} ${signed(s.offsets[p] || 0)}`, "s:noop"), btn("+1", `s:o:${p}:1`)]);
  rows.push([btn("Сбросить все", "s:o:reset"), btn("← Назад", "s:b")]);
  return [text, markup(...rows)];
}

export function tzScreen(s) {
  const text = `🕐 <b>Часовой пояс</b>\nСейчас: ${s.tz}. Обычно определяется автоматически по городу.`;
  const cells = TIMEZONES.map(([title, tz]) => btn(`${check(s.tz === tz)} ${title}`, `s:t:${tz}`));
  const rows = [];
  for (let i = 0; i < cells.length; i += 2) rows.push(cells.slice(i, i + 2));
  rows.push([btn("← Назад", "s:b")]);
  return [text, markup(...rows)];
}

// ── мой календарь ───────────────────────────────────────────────────────────

export function calendarScreen(user) {
  const s = user.s;
  const days = Object.keys(user.custom).sort();
  const lines = [
    "📷 <b>Мой календарь</b>",
    "Пришлите расписание намазов вашей мечети текстом — по строке на день: число и времена, например " +
      "<code>5  05:41  07:20  12:00  13:59  15:56  17:30</code>. Я сверю его с расчётом и подстроюсь: " +
      "в дни из расписания буду показывать и напоминать точно по нему, а для остальных дат подберу " +
      "параметры расчёта, которые его повторяют.",
    "",
    "Если месяц определится неверно, напишите его первой строкой, например <code>11.2026</code>. " +
      "Распознавание фото расписания здесь пока не работает.",
    "",
  ];
  lines.push(days.length ? `Загружено дней: ${days.length} (${ddmmyyyy(parseIsoDate(days[0]))} – ${ddmmyyyy(parseIsoDate(days.at(-1)))}).` : "Пока ничего не загружено.");
  const rows = [];
  if (days.length) {
    rows.push([btn(`${check(s.use_custom)} Использовать загруженное расписание`, "c:use")]);
    rows.push([btn("🗑 Удалить загруженное расписание", "c:del")]);
  }
  rows.push([btn("↩️ Сбросить подстройку расчёта", "c:reset")]);
  return [lines.join("\n"), markup(...rows)];
}

export const CONFIRM_CALENDAR = markup([btn("✅ Применить", "c:ok"), btn("❌ Отмена", "c:no")]);

// Все тексты раздела: карточки, уведомления, хадисы (перенос namaz/texts.py).
// Хадисы приведены в смысловом переводе с указанием источника — их можно править прямо здесь.
import * as hijri from "./hijri.js";
import { asrName, NAMES, PRAYERS } from "./models.js";
import { ddmmyyyy, hm, ordinal, pyRound, wallDay, weekday, ymd } from "./time.js";

export const MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
export const MONTHS_NOM = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
export const WEEKDAYS = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"];
export const WEEKDAYS_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

export const DUHA_END_BEFORE_NOON = 10; // минут до зенита, когда заканчивается время Духа
export const WED_DELAY = 30; // через сколько минут после Зухра в среду напоминать о дуа

const DUHA_HADITHS = [
  ["Пророк ﷺ совершал намаз Духа в четыре ракаата и добавлял, сколько пожелает Аллах.", "Муслим, 719"],
  [
    "Каждое утро за каждый сустав любого из вас положена милостыня… " +
      "и всё это заменяют два ракаата, совершённые во время Духа.",
    "Муслим, 720",
  ],
  ["Намаз кающихся (аввабин) совершается тогда, когда верблюжатам становится жарко от раскалённого песка.", "Муслим, 748"],
  [
    "Абу Хурайра сказал: «Мой любимый друг ﷺ завещал мне три вещи: поститься три дня каждый месяц, " +
      "совершать два ракаата Духа и совершать витр перед сном».",
    "аль-Бухари, 1178; Муслим, 721",
  ],
];

const THIRD_HADITH = [
  "Наш Господь, Благословенный и Всевышний, каждую ночь нисходит к ближайшему небу, когда остаётся " +
    "последняя треть ночи, и говорит: «Кто взывает ко Мне, чтобы Я ответил ему? Кто просит Меня, " +
    "чтобы Я даровал ему? Кто просит у Меня прощения, чтобы Я простил его?»",
  "аль-Бухари, 1145; Муслим, 758",
];

const WED_HADITH = [
  "Джабир ибн Абдуллах рассказывал, что Пророк ﷺ обращался с мольбой в мечети аль-Фатх в понедельник, " +
    "вторник и среду, и ответ был дан ему в среду между двумя намазами. Джабир сказал: «И какое бы важное " +
    "дело меня ни постигало, я выбирал это время, обращался с мольбой — и видел ответ».",
  "Ахмад, 14563; аль-Бухари в «аль-Адаб аль-муфрад», 704",
];

// причина поста → [заголовок, хадис, источник]
const FASTS = {
  arafa: ["День Арафа (9 Зуль-хиджа)", "Пост в день Арафа — я надеюсь, что Аллах простит за него грехи прошлого и будущего года.", "Муслим, 1162"],
  ashura: ["День Ашура (10 Мухаррама)", "Пост в день Ашура — я надеюсь, что Аллах простит за него грехи прошлого года.", "Муслим, 1162"],
  tasua: ["Ташуа (9 Мухаррама), накануне Ашуры", "Если я доживу до следующего года, то обязательно буду поститься и девятого.", "Муслим, 1134"],
  shawwal: ["Можно начинать шесть постов Шавваля", "Кто постился в Рамадан, а затем добавил к нему шесть дней Шавваля, тот словно постился весь год.", "Муслим, 1164"],
  white: ["Белые дни (13, 14 и 15-е числа лунного месяца)", "Если будешь поститься три дня в месяц, то постись тринадцатого, четырнадцатого и пятнадцатого.", "ат-Тирмизи, 761"],
  week: ["", "Дела представляются (Аллаху) в понедельник и четверг, и я люблю, чтобы мои дела представлялись, когда я пощусь.", "ат-Тирмизи, 747"],
};
export const FAST_TOGGLE = { week: "fast_week", white: "fast_white", arafa: "fast_special", ashura: "fast_special", tasua: "fast_special", shawwal: "fast_special" };

// html.escape из Python: и кавычки тоже
export const escape = (text) =>
  String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");

export function plural(n, one, few, many) {
  n = Math.abs(n);
  if (n % 10 === 1 && n % 100 !== 11) return one;
  if (n % 10 >= 2 && n % 10 <= 4 && !(n % 100 >= 12 && n % 100 <= 14)) return few;
  return many;
}

export const minutesWord = (n) => `${n} ${plural(n, "минуту", "минуты", "минут")}`;

/** Продолжительность (в минутах) словами: «2 ч 05 мин». */
export function duration(mins) {
  const total = Math.max(0, pyRound(mins));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h ? `${h} ч ${String(m).padStart(2, "0")} мин` : `${m} мин`;
}

export function fmtDate(day, withWeekday = true) {
  const { y, m, d } = ymd(day);
  const text = `${d} ${MONTHS_GEN[m - 1]} ${y}`;
  return withWeekday ? `${text}, ${WEEKDAYS[weekday(day)]}` : text;
}

const quote = ([text, source]) => `<blockquote>${escape(text)}\n— <i>${escape(source)}</i></blockquote>`;

// ── карточки ────────────────────────────────────────────────────────────────

export function nightLines(n) {
  return [
    `Магриб ${hm(n.start)} → Фаджр ${hm(n.end)}, ночь длится ${duration(n.end - n.start)}`,
    `• конец первой трети: <b>${hm(n.third1)}</b>`,
    `• середина ночи: <b>${hm(n.midnight)}</b>`,
    `• начало последней трети: <b>${hm(n.third3)}</b>`,
  ];
}

/** now (настенные минуты) передаётся только для сегодняшнего дня — тогда отмечается ближайший намаз. */
export function dayCard(user, d, now = null, weather = "") {
  const s = user.s;
  const sched = user.schedule();
  const day = sched.day(d);
  const night = sched.night(d);
  const lines = [`🌍 <b>${escape(s.city)}</b>`, `📅 ${fmtDate(d)}`, `${hijri.moon(d, s.hijri_offset)} ${hijri.format(d, s.hijri_offset)}`];
  if (weather) lines.push(weather);

  // Аср показываем оба — по 1 тени и по 2 теням; ближайшим намазом считается выбранный в настройках.
  const rows = [];
  for (const k of [...(s.fajr_before ? ["imsak"] : []), ...PRAYERS]) {
    if (k === "asr") for (const f of [1, 2]) rows.push([asrName(f), day.asr[f], f === s.asr_factor]);
    else rows.push([NAMES[k], day.t[k], true]);
  }
  const next = now === null ? -1 : rows.findIndex(([, t, main]) => main && t > now);
  let upcoming = next >= 0 ? rows[next] : null;
  // без «½» и «⅓»: в моноширинном блоке дроби ломают выравнивание
  rows.push(["Середина ночи", night.midnight, false], ["Посл. треть", night.third3, false]);
  const table = rows.map((row, i) => `${row[0].padEnd(15)}${hm(row[1])}${i === next ? "  ◀" : ""}`).join("\n");
  lines.push("", `<pre>${table}</pre>`);

  if (now !== null && !upcoming) upcoming = [NAMES.fajr, sched.day(d + 1).t.fajr];
  if (upcoming) lines.push(`⏳ ${upcoming[0]} через ${duration(upcoming[1] - now)}`);
  if (day.custom.size) lines.push("📷 Времена взяты из вашего календаря");
  if (day.calcLat !== null) {
    lines.push(
      `❄️ В этот день солнце здесь не ${day.t.maghrib - day.t.sunrise > 720 ? "заходит" : "восходит"} ` +
        `(или почти) — времена рассчитаны по ближайшей широте, где есть день и ночь (${Math.abs(day.calcLat).toFixed(1)}°).`,
    );
  }
  const [days, name, when] = hijri.nextMonth(d, s.hijri_offset);
  lines.push(`До месяца ${name} ~${days} дн. (≈${ddmmyyyy(when)})`);
  return lines.join("\n");
}

export function calculator(user, now) {
  const sched = user.schedule();
  let d = wallDay(now);
  if (now < sched.day(d).t.imsak) d -= 1; // после полуночи ещё идёт ночь предыдущего дня
  return [
    "🧮 <b>Калькулятор</b>",
    "",
    `🌙 Ночь с ${ymd(d).d} на ${fmtDate(d + 1, false)}:`,
    ...nightLines(sched.night(d)),
    "",
    "Отправьте мне:",
    "• дату — например <code>25.12.2026</code> — покажу времена намаза, середину и трети ночи на этот день;",
    "• два времени — например <code>16:43 03:50</code> (Магриб и Фаджр) — посчитаю середину и трети ночи.",
  ].join("\n");
}

export const nightCalc = (n) => ["🌙 <b>Ночь по вашим временам</b>", ...nightLines(n)].join("\n");

// ── уведомления ─────────────────────────────────────────────────────────────

export function atPrayer(key, t, name = "") {
  if (key === "sunrise") return `🌅 <b>Восход</b> — ${hm(t)}. Время Фаджра вышло.`;
  return `🕌 <b>${name || NAMES[key]}</b> — ${hm(t)}`;
}

export function beforePrayer(key, t, mins, name = "") {
  if (key === "sunrise") return `⏳ До восхода ${minutesWord(mins)} (${hm(t)}) — время Фаджра заканчивается.`;
  return `⏳ ${name || NAMES[key]} начнётся через ${minutesWord(mins)} (${hm(t)})`;
}

export function duha(start, end, d) {
  const hadith = DUHA_HADITHS[ordinal(d) % DUHA_HADITHS.length];
  return `☀️ <b>Время намаза Духа</b>\nС ${hm(start)} до ${hm(end)} (за ${DUHA_END_BEFORE_NOON} минут до зенита).\n\n${quote(hadith)}`;
}

export const lastThird = (n) =>
  `🌌 <b>Последняя треть ночи</b>\nНачалась в ${hm(n.third3)}. До Фаджра ${duration(n.end - n.third3)} (в ${hm(n.end)}).\n\n${quote(THIRD_HADITH)}`;

export const midnight = (n) => `🌙 <b>Середина ночи</b> — ${hm(n.midnight)}. До Фаджра ${duration(n.end - n.midnight)}.`;

export const wednesday = (zuhr, asr) =>
  `🤲 <b>Среда: время между Зухром и Асром</b>\nСегодня с ${hm(zuhr)} до ${hm(asr)}.\n\n${quote(WED_HADITH)}`;

export function fast(d, reasons, suhur, iftar, hijriOffset) {
  const lines = ["🌙 <b>Завтра — желательный пост</b>", `${fmtDate(d)} · ${hijri.format(d, hijriOffset)}`, ""];
  for (const r of reasons) {
    const wd = WEEKDAYS[weekday(d)];
    lines.push(`• ${FASTS[r][0] || wd[0].toUpperCase() + wd.slice(1)}`);
  }
  lines.push("", `Сухур — до ${hm(suhur)}, ифтар — в ${hm(iftar)}.`, "", quote(FASTS[reasons[0]].slice(1)));
  if (reasons.some((r) => r !== "week")) lines.push("<i>Дата по хиджре расчётная и может на день отличаться от местного наблюдения луны.</i>");
  return lines.join("\n");
}

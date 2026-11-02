// Раздел «Время намаза» внутри бота хадисов (перенос namaz/handlers.py и namaz/cloud.py с Python).
// Бот хадисов решает, какие обновления относятся к намазу (lib/namaz.js), и передаёт их сюда.
// Обработчики идут в том же порядке, что и в Python-версии на aiogram.
import { applyChanges, calibrate, CalibrationError, summary } from "./calibrate.js";
import * as geo from "./geo.js";
import * as kb from "./keyboards.js";
import { applyMethod, applyPlaceDefaults, asrTitle, HIGHLATS, isReady, methodTitle, METHODS } from "./models.js";
import { nightParts } from "./schedule.js";
import { Fsm, P, Store } from "./store.js";
import * as texts from "./texts.js";
import { isoDate, nowWall, parseIsoDate, validDate, validTz, wallDay, ymd } from "./time.js";
import { buildTable, textCells, TIME_RE } from "./timetable.js";
import { redis } from "../lib/store.js";

const PLACE_WAITING = "Place:waiting"; // так состояние называет aiogram — его же читает lib/namaz.js
const DATE_RE = /^\s*(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?\s*$/;
const TWO_TIMES_RE = /^\s*(\d{1,2})[:.](\d{2})\s*(?:[-–—,;]|\s)\s*(\d{1,2})[:.](\d{2})\s*$/;
const MONTH_HINT_RE = /(?<!\d)(\d{1,2})[./-](\d{4})(?!\d)/;
const ASK_TEXT =
  "📷 Распознавать фото расписания я пока не умею. Пришлите расписание текстом — по строке на день: " +
  "число и времена намазов, например:\n<code>5  05:41  07:20  12:00  13:59  15:56  17:30</code>";

class Ctx {
  constructor(tg, token, store, user, chatId, fsm) {
    Object.assign(this, { tg, token, store, user, chatId, fsm });
  }

  /** Сообщение в чат (HTML, как DefaultBotProperties у Python-версии); → отправленное сообщение. */
  async answer(text, markup) {
    return this.tg("sendMessage", { chat_id: this.chatId, text, parse_mode: "HTML", reply_markup: markup });
  }

  async editMessage(message, text, markup) {
    const res = await this.tg.raw("editMessageText", { chat_id: message.chat.id, message_id: message.message_id, text, parse_mode: "HTML", reply_markup: markup });
    if (!res.ok && !/not modified/.test(res.description || "")) throw new Error(`editMessageText: ${res.description}`);
  }

  /** Картинка или файл (multipart: JSON-вызов файл не передаёт). */
  async upload(method, field, bytes, filename, fields) {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) if (v !== undefined) form.append(k, typeof v === "object" ? JSON.stringify(v) : String(v));
    form.append(field, new Blob([bytes], { type: "image/png" }), filename);
    const res = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, { method: "POST", body: form }).then((r) => r.json());
    if (!res.ok) throw new Error(`${method}: ${res.description}`);
  }
}

const localNow = (user) => nowWall(user.s.tz);
const today = (user) => wallDay(localNow(user));

async function cbAnswer(ctx, cb, text, showAlert = false) {
  await ctx.tg("answerCallbackQuery", { callback_query_id: cb.id, text, show_alert: showAlert || undefined });
}

/** Изменить сообщение с кнопками; сообщение старше 48 часов Telegram уже не отдаёт. */
async function edit(ctx, cb, text, markup) {
  if (!cb.message || !cb.message.date) {
    await cbAnswer(ctx, cb, "Сообщение устарело — откройте меню заново.", true);
    return;
  }
  await ctx.editMessage(cb.message, text, markup);
  await cbAnswer(ctx, cb);
}

// ── место ───────────────────────────────────────────────────────────────────

async function askPlace(ctx) {
  await ctx.fsm.setState(PLACE_WAITING);
  await ctx.answer("Напишите название города (например, <code>Набережные Челны</code>) или отправьте геопозицию.", kb.placeRequest(true));
}

/** true — места ещё нет, и бот попросил его. */
async function needPlace(ctx) {
  if (isReady(ctx.user.s)) {
    await ctx.fsm.setState(null); // выходим из ввода города; остальные данные (расписание на подтверждении) остаются
    return false;
  }
  await askPlace(ctx);
  return true;
}

async function setPlace(ctx, place) {
  const { user, store } = ctx;
  const s = user.s;
  const moved = isReady(s) && (Math.abs(s.lat - place.lat) > 0.05 || Math.abs(s.lon - place.lon) > 0.05);
  const notes = [];

  const tz = place.tz || (await geo.timezoneAt(place.lat, place.lon));
  if (tz && validTz(tz)) s.tz = tz;
  else notes.push(`Не удалось определить часовой пояс — оставил ${s.tz}. Проверьте его в настройках.`);
  Object.assign(s, { city: place.name, lat: place.lat, lon: place.lon, region: place.region, country: place.country_code });
  if (s.method_auto) applyPlaceDefaults(s);
  if (moved && Object.keys(user.custom).length) {
    store.clearCustom(user);
    notes.push("Загруженный календарь относился к прежнему месту — я его удалил.");
  }
  store.save(user);
  await ctx.fsm.clear();

  const lines = [`📍 <b>${texts.escape(geo.placeLabel(place))}</b>`, `Метод расчёта: ${methodTitle(s)}, Аср — ${asrTitle(s.asr_factor)}. Изменить можно в настройках.`, ...notes];
  await ctx.answer(lines.join("\n"), kb.mainMenu());
  await sendDay(ctx, today(user));
}

// ── главное меню ────────────────────────────────────────────────────────────

async function dayView(user, d) {
  const now = localNow(user);
  const isToday = d === wallDay(now);
  let weather = "";
  if (isToday && user.s.weather) {
    weather = await Promise.race([geo.weather(user.s.lat, user.s.lon), new Promise((resolve) => setTimeout(() => resolve(""), 3000))]);
  }
  return [texts.dayCard(user, d, isToday ? now : null, weather), kb.dayNav(d, wallDay(now))];
}

async function sendDay(ctx, d) {
  const [text, markup] = await dayView(ctx.user, d);
  await ctx.answer(text, markup);
}

/** Вход в раздел (команда /namaz и кнопка «🕌 Время намаза»). */
async function cmdNamaz(ctx) {
  if (!isReady(ctx.user.s)) {
    await ctx.answer("🕌 <b>Время намаза</b>\nЧтобы показать расписание и напоминать о намазе, мне нужен ваш город.");
    await askPlace(ctx);
    return;
  }
  await ctx.fsm.setState(null);
  await ctx.answer("🕌 <b>Время намаза</b> — меню внизу 👇", kb.mainMenu());
  await sendDay(ctx, today(ctx.user));
}

const MENU = {
  [kb.BTN_TODAY]: "today", [kb.BTN_TOMORROW]: "tomorrow", [kb.BTN_MONTH]: "month", [kb.BTN_CALC]: "calc",
  [kb.BTN_NOTIFY]: "notify", [kb.BTN_SETTINGS]: "settings", [kb.BTN_CALENDAR]: "calendar",
};

async function menu(ctx, item) {
  if (await needPlace(ctx)) return;
  const { user } = ctx;
  if (item === "today") return sendDay(ctx, today(user));
  if (item === "tomorrow") return sendDay(ctx, today(user) + 1);
  if (item === "month") return ctx.answer("За какой месяц сделать расписание?", kb.months(ymd(today(user)), 0));
  if (item === "calc") return ctx.answer(texts.calculator(user, localNow(user)));
  const screen = { notify: () => kb.notifyScreen(user.s), settings: () => kb.settingsScreen(user), calendar: () => kb.calendarScreen(user) }[item];
  const [text, markup] = screen();
  return ctx.answer(text, markup);
}

// ── ввод города ─────────────────────────────────────────────────────────────

async function placeCancel(ctx) {
  await ctx.fsm.clear();
  if (isReady(ctx.user.s)) await ctx.answer("Оставил как было.", kb.mainMenu());
  // внутри бота хадисов без города можно обойтись: возвращаем человека к хадисам
  else await ctx.answer("Хорошо. Когда понадобится — нажмите «🕌 Время намаза» или /namaz.", { remove_keyboard: true });
}

async function placeText(ctx, text) {
  const query = text.trim();
  const coords = geo.parseCoords(query);
  if (coords) return setPlace(ctx, await geo.reverse(...coords));
  const places = await geo.searchCity(query);
  if (places === null) {
    return ctx.answer("Сервис поиска городов сейчас недоступен. Отправьте геопозицию кнопкой ниже или напишите координаты, например: <code>55.74, 52.40</code>");
  }
  if (!places.length) return ctx.answer("Не нашёл такой город. Попробуйте написать иначе или отправьте геопозицию.");
  if (places.length === 1) return setPlace(ctx, places[0]);
  await ctx.fsm.updateData({ places });
  return ctx.answer("Уточните, какой именно:", kb.markup(...places.map((p, i) => [kb.btn(geo.placeLabel(p), `place:${i}`)])));
}

async function cbPlace(ctx, cb) {
  const places = (await ctx.fsm.getData()).places || [];
  const i = parseInt(cb.data.split(":")[1], 10);
  if (!(i < places.length) || !cb.message?.date) {
    await cbAnswer(ctx, cb, "Список устарел — напишите название города ещё раз.", true);
    return;
  }
  await cbAnswer(ctx, cb);
  await ctx.tg("editMessageReplyMarkup", { chat_id: cb.message.chat.id, message_id: cb.message.message_id });
  await setPlace(ctx, places[i]);
}

// ── день и месяц ────────────────────────────────────────────────────────────

async function cbMonth(ctx, cb) {
  const [year, month] = cb.data.slice(3).split("-").map(Number);
  await cbAnswer(ctx, cb, "Рассчитываю время намаза на месяц…");
  const { renderMonth } = await import("./render.js"); // только под Deno: resvg из npm
  const png = await renderMonth(ctx.user, year, month, today(ctx.user));
  const name = `namaz-${year}-${String(month).padStart(2, "0")}.png`;
  const caption = `${texts.MONTHS_NOM[month - 1]} ${year} · ${texts.escape(ctx.user.s.city)}`;
  const chat = { chat_id: cb.message.chat.id, caption, parse_mode: "HTML" };
  if (cb.data.startsWith("mf:")) await ctx.upload("sendDocument", "document", png, name, chat);
  else await ctx.upload("sendPhoto", "photo", png, name, { ...chat, reply_markup: kb.monthFile(year, month) });
}

// ── уведомления ─────────────────────────────────────────────────────────────

async function cbNotify(ctx, cb) {
  const s = ctx.user.s;
  const [, action, ...args] = cb.data.split(":");
  let screen = kb.notifyScreen;
  if (action === "noop") return cbAnswer(ctx, cb);
  const toggle = (obj) => {
    if (!(args[0] in obj)) throw new Error(`нет такого переключателя: ${args[0]}`);
    obj[args[0]] = !obj[args[0]];
  };
  if (action === "a") toggle(s.at);
  else if (action === "p") toggle(s.pre);
  else if (action === "x") toggle(s.extra);
  else if (action === "m") s.pre_minutes = Math.max(1, Math.min(180, s.pre_minutes + parseInt(args[0], 10)));
  else if (["t", "d", "f"].includes(action)) {
    screen = kb.notifyTimesScreen;
    if (action === "d") s.duha_delay = Math.max(5, Math.min(180, s.duha_delay + parseInt(args[0], 10)));
    else if (action === "f") {
      const [h, m] = s.fast_time.split(":").map(Number);
      const total = (((h * 60 + m + parseInt(args[0], 10)) % 1440) + 1440) % 1440;
      s.fast_time = `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
    }
  }
  ctx.store.save(ctx.user);
  await edit(ctx, cb, ...screen(s));
}

// ── настройки ───────────────────────────────────────────────────────────────

async function cbSettings(ctx, cb) {
  const { user } = ctx;
  const s = user.s;
  const [, action, ...args] = cb.data.split(":");
  let view = () => kb.settingsScreen(user);
  if (action === "noop") return cbAnswer(ctx, cb);
  if (action === "city") {
    await cbAnswer(ctx, cb);
    return askPlace(ctx);
  }
  if (action === "method") view = () => kb.methodsScreen(s);
  else if (action === "m" && args[0] in METHODS) {
    applyMethod(s, args[0]);
    s.method_auto = false;
  } else if (action === "asr") s.asr_factor = s.asr_factor === 2 ? 1 : 2;
  else if (action === "zuhr") view = () => kb.zuhrScreen(s);
  else if (action === "z") {
    const value = args.join(":");
    s.zuhr_fixed = kb.ZUHR_OPTIONS.includes(value) ? value : "";
  } else if (action === "fajr") s.fajr_before = s.fajr_before ? 0 : 90;
  else if (action === "off") view = () => kb.offsetsScreen(s);
  else if (action === "o") {
    view = () => kb.offsetsScreen(s);
    if (args[0] === "reset") s.offsets = {};
    else s.offsets[args[0]] = Math.max(-60, Math.min(60, (s.offsets[args[0]] || 0) + parseInt(args[1], 10)));
  } else if (action === "h") s.hijri_offset = Math.max(-2, Math.min(2, s.hijri_offset + parseInt(args[0], 10)));
  else if (action === "hl") {
    const keys = Object.keys(HIGHLATS);
    s.highlat = keys[(keys.indexOf(s.highlat) + 1) % keys.length];
  } else if (action === "w") s.weather = !s.weather;
  else if (action === "tz") view = () => kb.tzScreen(s);
  else if (action === "t") {
    const tz = args.join(":");
    if (kb.TIMEZONES.some(([, name]) => name === tz)) s.tz = tz;
  }
  ctx.store.save(user);
  await edit(ctx, cb, ...view());
}

// ── мой календарь ───────────────────────────────────────────────────────────

function monthHint(text) {
  const m = MONTH_HINT_RE.exec(text || "");
  return m && +m[1] >= 1 && +m[1] <= 12 && +m[2] >= 2000 && +m[2] <= 2100 ? [+m[2], +m[1]] : null;
}

async function offerTimetable(ctx, status, table, hint) {
  let result;
  try {
    result = calibrate(table, ctx.user.s, today(ctx.user), hint);
  } catch (err) {
    if (!(err instanceof CalibrationError)) throw err;
    return ctx.editMessage(status, `⚠️ ${err.message}`);
  }
  // ждёт подтверждения кнопкой «Применить»
  await ctx.fsm.updateData({ pending: { values: result.values, changes: result.changes, summary: summary(result) } });
  const order = [...result.matches].sort((a, b) => a.col - b.col).map((m) => m.key);
  const sample = result.dates.slice(0, 3).map((d) => `${isoDate(d).slice(8)}.${isoDate(d).slice(5, 7)}  ` + order.map((k) => result.values[isoDate(d)][k]).join(" ")).join("\n");
  await ctx.editMessage(
    status,
    `✅ <b>Расписание распознано</b>\n${summary(result)}\n\nПервые дни — сверьте с вашим расписанием:\n<pre>${sample}</pre>\n` +
      "Применить? В эти дни бот будет показывать и напоминать точно по расписанию, " +
      "а для остальных дат — считать с подобранными параметрами.",
    kb.CONFIRM_CALENDAR,
  );
}

const looksLikeTimetable = (text) =>
  (text || "").split(/\r\n|\n|\r/).filter((line) => [...line.matchAll(TIME_RE)].length >= 3).length >= 5;

async function cbCalendar(ctx, cb) {
  const { user, store } = ctx;
  const s = user.s;
  const action = cb.data.slice(2);
  if (action === "ok" || action === "no") {
    const { pending } = await ctx.fsm.getData();
    await ctx.fsm.updateData({ pending: null });
    if (action === "no" || !pending) {
      return edit(ctx, cb, pending ? "Расписание не применено." : "Это расписание уже неактуально — пришлите его ещё раз.");
    }
    store.setCustom(user, pending.values);
    applyChanges(s, pending.changes);
    s.method_auto = false;
    s.use_custom = true;
    store.save(user);
    return edit(ctx, cb, `✅ Готово, подстроился под ваше расписание.\n${pending.summary}`);
  }
  if (action === "use") s.use_custom = !s.use_custom;
  else if (action === "del") store.clearCustom(user);
  else if (action === "reset") {
    s.method_auto = true;
    applyPlaceDefaults(s);
    s.offsets = {};
    s.fajr_before = 0;
  }
  store.save(user);
  await edit(ctx, cb, ...kb.calendarScreen(user));
  if (action === "reset") await ctx.answer(`Параметры расчёта сброшены: ${methodTitle(s)}, Аср — ${asrTitle(s.asr_factor)}, без поправок.`);
}

// ── калькулятор: дата или два времени ───────────────────────────────────────

async function onDate(ctx, m) {
  if (await needPlace(ctx)) return;
  const year = m[3] ? +m[3] : ymd(today(ctx.user)).y;
  const full = year < 100 ? year + 2000 : year;
  const d = full >= 1 ? validDate(full, +m[2], +m[1]) : null;
  if (d === null) return ctx.answer("Не похоже на дату. Пример: <code>25.12.2026</code>");
  if (full < 1925 || full > 2075) return ctx.answer("Могу посчитать только для 1925–2075 годов.");
  return sendDay(ctx, d);
}

async function onTwoTimes(ctx, m) {
  const [h1, m1, h2, m2] = m.slice(1, 5).map(Number);
  if (h1 > 23 || h2 > 23 || m1 > 59 || m2 > 59) return ctx.answer("Не похоже на время. Пример: <code>16:43 03:50</code>");
  const start = h1 * 60 + m1;
  let end = h2 * 60 + m2;
  if (end <= start) end += 1440;
  return ctx.answer(texts.nightCalc(nightParts(start, end)));
}

// ── разбор обновления ───────────────────────────────────────────────────────

async function onMessage(ctx, msg) {
  const text = msg.text;
  const command = text?.startsWith("/") ? text.slice(1).split(/[\s@]/)[0].toLowerCase() : "";
  if (msg.location) return setPlace(ctx, await geo.reverse(msg.location.latitude, msg.location.longitude));
  if (command === "namaz") return cmdNamaz(ctx);
  if (text && MENU[text]) return menu(ctx, MENU[text]);
  if (["today", "tomorrow", "month", "calc", "notify", "settings", "calendar"].includes(command)) return menu(ctx, command);
  const waiting = (await ctx.fsm.getState()) === PLACE_WAITING;
  if (waiting && text === kb.BTN_CANCEL) return placeCancel(ctx);
  if (text && (waiting || !isReady(ctx.user.s))) return placeText(ctx, text);
  if (msg.photo || msg.document) {
    if (await needPlace(ctx)) return;
    return ctx.answer(ASK_TEXT);
  }
  if (looksLikeTimetable(text)) {
    if (await needPlace(ctx)) return;
    const status = await ctx.answer("🔎 Разбираю расписание…");
    return offerTimetable(ctx, status, buildTable(textCells(text), false), monthHint(text.split(/\r\n|\n|\r/)[0]));
  }
  let m = text && DATE_RE.exec(text);
  if (m) return onDate(ctx, m);
  m = text && TWO_TIMES_RE.exec(text);
  if (m) return onTwoTimes(ctx, m);
  if (await needPlace(ctx)) return;
  return ctx.answer(
    "Не понял. Выберите пункт меню, пришлите дату (<code>25.12.2026</code>), два времени (<code>16:43 03:50</code>) или расписание текстом.",
    kb.mainMenu(),
  );
}

async function onCallback(ctx, cb) {
  const data = cb.data || "";
  if (data === "nz:menu") {
    await cbAnswer(ctx, cb);
    if (cb.message) await cmdNamaz(ctx);
    return;
  }
  if (data.startsWith("place:")) return cbPlace(ctx, cb);
  if (data.startsWith("day:")) {
    const d = parseIsoDate(data.slice(4));
    if (Number.isNaN(d)) throw new Error(`неверная дата: ${data}`);
    return edit(ctx, cb, ...(await dayView(ctx.user, d)));
  }
  if (data.startsWith("ml:")) {
    const page = Math.max(-20, Math.min(20, parseInt(data.slice(3), 10)));
    return edit(ctx, cb, "За какой месяц сделать расписание?", kb.months(ymd(today(ctx.user)), page));
  }
  if (data.startsWith("mo:") || data.startsWith("mf:")) return cbMonth(ctx, cb);
  if (data.startsWith("n:")) return cbNotify(ctx, cb);
  if (data.startsWith("s:")) return cbSettings(ctx, cb);
  if (data.startsWith("c:")) return cbCalendar(ctx, cb);
}

/**
 * Обновление Telegram для раздела намаза. tg — клиент Bot API бота хадисов (lib/bot.js: telegram()).
 * → true, если настройки кого-то изменились (ближайшее уведомление могло сдвинуться).
 */
export async function handleNamaz(update, tg, token) {
  const cb = update.callback_query;
  const msg = update.message;
  const from = (msg || cb)?.from;
  const chatId = msg?.chat?.id ?? cb?.message?.chat?.id ?? from?.id;
  if (!from) return false;

  const seen = `${P}upd:${update.update_id}`;
  const [fresh, raw] = await Promise.all([redis("SET", seen, "1", "NX", "EX", "3600"), redis("GET", `${P}user:${from.id}`)]);
  if (fresh !== "OK") return false; // Telegram прислал то же обновление повторно

  const store = new Store();
  const user = store.put(from.id, raw);
  // вернувшийся пользователь снова получает уведомления
  if (!user.active) {
    user.active = true;
    store.save(user);
  }
  const ctx = new Ctx(tg, token, store, user, chatId, new Fsm(chatId, from.id));
  try {
    if (msg) await onMessage(ctx, msg);
    else if (cb) await onCallback(ctx, cb);
  } catch (err) {
    console.error("Раздел намаза:", err);
    try {
      if (cb) await cbAnswer(ctx, cb);
      if (msg || cb?.message) await ctx.answer("⚠️ Что-то пошло не так. Попробуйте ещё раз.");
    } catch { /* не страшно */ }
  }
  try {
    return await store.flush();
  } catch (err) {
    await redis("DEL", seen); // пусть Telegram повторит — обработаем заново
    throw err;
  }
}

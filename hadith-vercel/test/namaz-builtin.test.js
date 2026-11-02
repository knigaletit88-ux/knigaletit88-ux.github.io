// Встроенный раздел «Время намаза» (namaz/): от выбора города до уведомлений. npm test
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

process.env.DATA_URL = "https://data.test/ru";
process.env.BOT_USERNAME = "s_unnabot";
process.env.BOT_TOKEN = "123:TEST";
process.env.ADMIN_IDS = "7";
process.env.KV_REST_API_URL = "https://redis.test";
process.env.KV_REST_API_TOKEN = "secret";
delete process.env.NAMAZ_URL;
delete process.env.QSTASH_TOKEN;

const { handleUpdate } = await import("../lib/bot.js");
const { runTick } = await import("../namaz/tick.js");
const { nextEventTime } = await import("../namaz/events.js");
const { load } = await import("../namaz/store.js");
const { dayOf, fromWall, hm } = await import("../namaz/time.js");

// ── подставные Redis, Telegram и геосервисы ─────────────────────────────────

let strings, sets, calls;
function run([cmd, ...args]) {
  const [key] = args;
  switch (cmd) {
    case "GET": return strings.get(key) ?? null;
    case "MGET": return args.map((k) => strings.get(k) ?? null);
    case "SET": {
      const opts = args.slice(2).map(String);
      const prev = strings.get(key) ?? null;
      if (opts.includes("NX") && prev !== null) return null;
      strings.set(key, String(args[1]));
      return opts.includes("GET") ? prev : "OK";
    }
    case "DEL": return args.filter((k) => strings.delete(k) || sets.delete(k)).length;
    case "SADD": {
      const set = sets.get(key) || new Set();
      args.slice(1).forEach((v) => set.add(String(v)));
      sets.set(key, set);
      return 1;
    }
    case "SMEMBERS": return [...(sets.get(key) || [])];
    case "ZADD": case "ZCARD": return 1;
    default: throw new Error(`Redis: неизвестная команда ${cmd}`);
  }
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  if (url === "https://redis.test") return json({ result: run(JSON.parse(opts.body)) });
  if (url === "https://redis.test/pipeline") return json(JSON.parse(opts.body).map((c) => ({ result: run(c) })));
  if (url.startsWith("https://nominatim.openstreetmap.org/search")) {
    return json([{ name: "Казань", lat: "55.7887", lon: "49.1221", importance: 0.7, addresstype: "city", address: { state: "Татарстан", country: "Россия", country_code: "ru" } }]);
  }
  if (url.startsWith("https://api.open-meteo.com/v1/forecast")) {
    return json({ timezone: "Europe/Moscow", current: { temperature_2m: 3.2, apparent_temperature: -0.4, relative_humidity_2m: 81, wind_speed_10m: 4.1, weather_code: 3 } });
  }
  if (url.startsWith("https://data.test/")) return new Response("[]", { status: 200 });
  throw new Error("Неожиданный запрос " + url);
};

let messageId = 100;
const tg = async (method, params) => {
  calls.push({ method, params });
  if (method === "getMe") return { username: "s_unnabot" };
  if (method === "sendMessage") return { message_id: ++messageId, date: 1, chat: { id: params.chat_id } };
  return true;
};
tg.raw = async (method, params) => ({ ok: true, result: await tg(method, params) });

beforeEach(() => {
  strings = new Map();
  sets = new Map();
  calls = [];
});

const user = { id: 42, is_bot: false, first_name: "Абдулла" };
let updateId = 1;
const text = (value) => ({ update_id: ++updateId, message: { message_id: ++messageId, date: 1, chat: { id: 42, type: "private" }, from: user, text: value } });
const press = (data) => ({ update_id: ++updateId, callback_query: { id: "cb", from: user, chat_instance: "x", data, message: { message_id: 5, date: 1, chat: { id: 42, type: "private" } } } });
const sent = () => calls.filter((c) => c.method === "sendMessage").map((c) => c.params);
const edited = () => calls.filter((c) => c.method === "editMessageText").map((c) => c.params);
const saved = () => load(42, strings.get("namaz:user:42"));

async function withKazan() {
  await handleUpdate(text("/namaz"), tg);
  await handleUpdate(text("Казань"), tg);
  calls = [];
}

// ── сценарии ────────────────────────────────────────────────────────────────

test("/namaz без города: бот спрашивает город и ждёт его", async () => {
  await handleUpdate(text("/namaz"), tg);
  assert.match(sent()[0].text, /нужен ваш город/);
  assert.match(sent()[1].text, /Напишите название города/);
  assert.equal(sent()[1].reply_markup.keyboard[0][0].request_location, true);
  assert.equal(strings.get("namaz:fsm:s:42:42"), "Place:waiting");
  assert.equal(strings.get("namaz:user:42"), undefined); // новый пользователь не записывается, пока ничего не настроил
});

test("город текстом: место, пояс и метод Татарстана сохраняются, приходит карточка дня", async () => {
  await withKazan.call(null);
  const u = saved();
  assert.equal(u.s.city, "Казань");
  assert.equal(u.s.tz, "Europe/Moscow");
  assert.equal(u.s.method, "dumrt");
  assert.equal(u.s.zuhr_fixed, "12:00");
  assert.ok(sets.get("namaz:users").has("42"));
  assert.equal(strings.get("namaz:fsm:s:42:42"), undefined);
});

test("после выбора города — меню и карточка с временами", async () => {
  await handleUpdate(text("/namaz"), tg);
  calls = [];
  await handleUpdate(text("Казань"), tg);
  assert.match(sent()[0].text, /📍 <b>Казань, Татарстан, Россия<\/b>/);
  assert.equal(sent()[0].reply_markup.keyboard[3][1].text, "📖 Хадисы");
  assert.match(sent()[1].text, /🌍 <b>Казань<\/b>/);
  assert.match(sent()[1].text, /<pre>Фаджр\s+\d\d:\d\d/);
  assert.match(sent()[1].text, /☁️ 3\.2°C/);
  assert.ok(sent().every((m) => m.parse_mode === "HTML"));
});

test("кнопки меню, дата и калькулятор ночи", async () => {
  await withKazan();
  await handleUpdate(text("🌄 Завтра"), tg);
  await handleUpdate(text("25.12.2026"), tg);
  await handleUpdate(text("16:43 03:50"), tg);
  await handleUpdate(text("🧮 Калькулятор"), tg);
  const [tomorrow, date, night, calc] = sent();
  assert.match(tomorrow.text, /🌍 <b>Казань<\/b>/);
  assert.match(date.text, /25 декабря 2026, пятница/);
  assert.match(night.text, /Магриб 16:43 → Фаджр 03:50, ночь длится 11 ч 07 мин/);
  assert.match(night.text, /середина ночи: <b>22:17<\/b>/);
  assert.match(calc.text, /🧮 <b>Калькулятор<\/b>/);
});

test("уведомления и настройки переключаются кнопками и сохраняются", async () => {
  await withKazan();
  await handleUpdate(press("n:a:sunrise"), tg);
  await handleUpdate(press("n:m:5"), tg);
  await handleUpdate(press("s:asr"), tg);
  await handleUpdate(press("s:o:maghrib:1"), tg);
  const u = saved();
  assert.equal(u.s.at.sunrise, true);
  assert.equal(u.s.pre_minutes, 20);
  assert.equal(u.s.asr_factor, 1);
  assert.equal(u.s.offsets.maghrib, 1);
  assert.equal(edited().length, 4);
  assert.match(edited()[3].text, /Поправки/);
  assert.equal(calls.filter((c) => c.method === "answerCallbackQuery").length, 4);
});

test("фото расписания: бот просит прислать его текстом", async () => {
  await withKazan();
  await handleUpdate({ update_id: ++updateId, message: { message_id: 7, date: 1, chat: { id: 42, type: "private" }, from: user, photo: [{ file_id: "p" }] } }, tg);
  assert.match(sent()[0].text, /Пришлите расписание текстом/);
});

test("расписание текстом: распознаётся, после «Применить» дни берутся из него", async () => {
  await withKazan();
  // «расписание мечети»: расчёт по ДУМ РФ (16°) с поправкой +2 минуты к Магрибу
  const mosque = saved();
  Object.assign(mosque.s, { fajr_angle: 16, zuhr_fixed: "", offsets: { maghrib: 2 } });
  const rows = [];
  for (let d = 1; d <= 10; d++) {
    const day = mosque.schedule().day(dayOf(2026, 11, d));
    rows.push(`${d}  ${["imsak", "sunrise", "zuhr", "asr", "maghrib", "isha"].map((k) => hm(day.t[k])).join("  ")}`);
  }
  await handleUpdate(text(`11.2026\n${rows.join("\n")}`), tg);
  assert.match(sent()[0].text, /Разбираю расписание/);
  assert.match(edited()[0].text, /^✅ <b>Расписание распознано<\/b>\n📅 01\.11\.2026 – 10\.11\.2026, дней: 10/);
  assert.match(edited()[0].text, /Фаджр 16°/);
  assert.match(edited()[0].text, /Магриб \+2/);
  await handleUpdate(press("c:ok"), tg);
  const u = saved();
  assert.equal(Object.keys(u.custom).length, 10);
  assert.equal(u.s.use_custom, true);
  assert.equal(u.s.fajr_angle, 16);
  assert.match(edited()[1].text, /Готово, подстроился/);
});

test("будильник рассылает наступившее и называет следующее срабатывание", async () => {
  await withKazan();
  const u = saved();
  const first = fromWall(u.s.tz, nextEventTime(u, Date.now()));
  strings.set("namaz:last_tick", new Date(first - 60_000).toISOString().replace(".000Z", "+00:00"));
  const { sent: count, next } = await runTick(tg, "123:TEST", first);
  assert.ok(count >= 1);
  assert.ok(sent().every((m) => m.chat_id === 42 && m.parse_mode === "HTML"));
  assert.ok(next > first && next <= first + 15 * 60_000);
  // повторное срабатывание в ту же минуту ничего не досылает
  calls = [];
  assert.equal((await runTick(tg, "123:TEST", first)).sent, 0);
});

test("заблокировавший бота больше не получает уведомлений, пока не вернётся", async () => {
  await withKazan();
  const u = saved();
  const first = fromWall(u.s.tz, nextEventTime(u, Date.now()));
  strings.set("namaz:last_tick", new Date(first - 60_000).toISOString().replace(".000Z", "+00:00"));
  const raw = tg.raw;
  tg.raw = async () => ({ ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" });
  try {
    await runTick(tg, "123:TEST", first);
  } finally {
    tg.raw = raw;
  }
  assert.equal(saved().active, false);
  await handleUpdate(text("🕌 Сегодня"), tg);
  assert.equal(saved().active, true);
});

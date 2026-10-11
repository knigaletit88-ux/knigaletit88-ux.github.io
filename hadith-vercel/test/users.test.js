// Учёт пользователей для админки: кого бот считает и что показывает «Пользователи». npm test
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

process.env.DATA_URL = "https://data.test/ru";
process.env.BOT_USERNAME = "s_unnabot";
process.env.BOT_TOKEN = "123:TEST";
process.env.ADMIN_IDS = "7";
process.env.KV_REST_API_URL = "https://redis.test";
process.env.KV_REST_API_TOKEN = "secret";
process.env.NAMAZ_URL = "https://namaz.test";

const { handleUpdate } = await import("../lib/bot.js");
const { trackUser, userStats } = await import("../lib/store.js");

// Имитация Redis: обычные ключи, множества и упорядоченные наборы «участник → число»
let keys, zsets, sets, redisDown, forwarded, calls;
const zset = (name) => zsets.get(name) ?? zsets.set(name, new Map()).get(name);
function run([cmd, key, ...args]) {
  if (cmd === "GET") return keys.get(key) ?? null;
  if (cmd === "MGET") return [key, ...args].map((k) => keys.get(k) ?? null);
  if (cmd === "ZADD") {
    const nx = args[0] === "NX";
    const [score, member] = nx ? args.slice(1) : args;
    if (nx && zset(key).has(member)) return 0;
    const added = zset(key).has(member) ? 0 : 1;
    zset(key).set(member, Number(score));
    return added;
  }
  if (cmd === "ZCARD") return zset(key).size;
  if (cmd === "ZCOUNT") return [...zset(key).values()].filter((score) => score >= Number(args[0])).length;
  if (cmd === "ZRANGE") {
    const first = [...zset(key)].sort((a, b) => a[1] - b[1])[0];
    return first ? [first[0], String(first[1])] : [];
  }
  if (cmd === "SCARD") return sets.get(key)?.size ?? 0;
  throw new Error("Неизвестная команда " + cmd);
}

globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  if (url.startsWith("https://redis.test")) {
    if (redisDown) return json({}, 500);
    const body = JSON.parse(opts.body);
    return url.endsWith("/pipeline") ? json(body.map((command) => ({ result: run(command) }))) : json({ result: run(body) });
  }
  if (url === "https://namaz.test/api/webhook") {
    forwarded.push(JSON.parse(opts.body));
    return json({ ok: true });
  }
  if (url.startsWith("https://data.test/")) return new Response("[]", { status: 200 });
  if (url.startsWith("https://hadeethenc.com/")) return json({}, 404);
  throw new Error("Неожиданный запрос " + url);
};

const tg = async (method, params) => {
  calls.push({ method, params });
  return method === "getMe" ? { username: "s_unnabot" } : true;
};
const sent = () => calls.filter((c) => c.method === "sendMessage").map((c) => c.params);
const edits = () => calls.filter((c) => c.method === "editMessageText").map((c) => c.params);

beforeEach(() => {
  keys = new Map();
  zsets = new Map();
  sets = new Map();
  redisDown = false;
  forwarded = [];
  calls = [];
});

const person = (id, extra = {}) => ({ id, is_bot: false, first_name: "Гость", ...extra });
const text = (value, from, type = "private") => ({ update_id: 1, message: { message_id: 1, date: 0, chat: { id: type === "private" ? from.id : -100, type }, from, text: value } });
const press = (data, from, type = "private") => ({ update_id: 2, callback_query: { id: "cb", from, chat_instance: "x", data, message: { message_id: 5, date: 0, chat: { id: type === "private" ? from.id : -100, type } } } });
const admin = person(7);
const DAY = 86_400_000;

test("считается каждый, кто написал боту или нажал кнопку в личном чате, — по одному разу", async () => {
  await handleUpdate(text("/start", person(1)), tg);
  await handleUpdate(text("терпение", person(1)), tg);
  await handleUpdate(press("rnd", person(2)), tg);
  await handleUpdate(press("nz:menu", person(3)), tg, "123:TEST"); // раздел намаза — тоже пользователь бота
  assert.equal(forwarded.length, 1);
  assert.deepEqual([...zset("hadith:joined").keys()], ["1", "2", "3"]);
  assert.deepEqual([...zset("hadith:seen").keys()], ["1", "2", "3"]);
});

test("группы, другие боты и inline-запросы в счёт не идут", async () => {
  await handleUpdate(text("/today@s_unnabot", person(4), "group"), tg);
  await handleUpdate(press("rnd", person(5), "supergroup"), tg);
  await handleUpdate(text("/start", person(6, { is_bot: true })), tg);
  await handleUpdate({ update_id: 3, inline_query: { id: "iq", from: person(8), query: "" } }, tg);
  assert.equal(zset("hadith:joined").size, 0);
});

test("первое обращение запоминается навсегда, последнее — обновляется", async () => {
  const now = Date.now();
  await trackUser(1, now - 40 * DAY);
  await trackUser(1, now);
  assert.equal(zset("hadith:joined").get("1"), Math.floor((now - 40 * DAY) / 1000));
  assert.equal(zset("hadith:seen").get("1"), Math.floor(now / 1000));
});

test("сводка: всего, новые и активные за сутки, неделю и месяц, настроившие намаз", async () => {
  const now = Date.UTC(2026, 9, 20, 9, 0, 0);
  await trackUser(1, now - 40 * DAY); // давний, больше не писал
  await trackUser(2, now - 40 * DAY);
  await trackUser(2, now - 20 * DAY); // давний, писал три недели назад
  await trackUser(3, now - 5 * DAY); // пришёл на этой неделе
  await trackUser(4, now - 3600_000); // пришёл сегодня
  await trackUser(1, now - 2 * DAY); // давний снова написал позавчера
  sets.set("namaz:users", new Set(["3", "4"]));

  assert.deepEqual(await userStats(now), {
    total: 4, new1: 1, new7: 2, active1: 1, active7: 3, active30: 4, namaz: 2, since: Math.floor((now - 40 * DAY) / 1000) * 1000,
  });
});

test("админка: кнопка «Пользователи» и команда /users показывают сводку", async () => {
  await handleUpdate(text("/start", person(1)), tg);
  await handleUpdate(text("/start", person(2)), tg);
  sets.set("namaz:users", new Set(["2"]));
  calls = [];

  await handleUpdate(text("/admin", admin), tg);
  const buttons = sent()[0].reply_markup.inline_keyboard.flat();
  assert.deepEqual(buttons.at(-1), { text: "👥 Пользователи", callback_data: "ch:users" });

  await handleUpdate(press("ch:users", admin), tg);
  const view = edits()[0];
  assert.match(view.text, /Пользователи бота/);
  assert.match(view.text, /Всего: <b>3<\/b>/); // двое гостей и сам админ
  assert.match(view.text, /Новых: за сутки <b>3<\/b> · за 7 дней <b>3<\/b>/);
  assert.match(view.text, /Писали боту: за сутки <b>3<\/b> · за 7 дней <b>3<\/b> · за 30 дней <b>3<\/b>/);
  assert.match(view.text, /Настроили время намаза: <b>1<\/b>/);
  assert.match(view.text, /Учёт ведётся с \d{2}\.\d{2}\.\d{4}/);
  assert.deepEqual(view.reply_markup.inline_keyboard[0].map((b) => b.callback_data), ["ch:users", "ch:list"]);

  await handleUpdate(press("ch:list", admin), tg); // «« Админка» возвращает к списку каналов
  assert.match(edits().at(-1).text, /Админка · Полезные каналы/);

  calls = [];
  await handleUpdate(text("/users", admin), tg);
  assert.match(sent()[0].text, /Всего: <b>3<\/b>/);
});

test("сводка только для администратора", async () => {
  await handleUpdate(text("/users", person(5)), tg);
  assert.match(sent()[0].text, /только для администратора/);
  calls = [];
  await handleUpdate(press("ch:users", person(5)), tg);
  assert.equal(calls.find((c) => c.method === "answerCallbackQuery").params.text, "Только для администратора");
  assert.equal(edits().length, 0);
});

test("большие числа — с разделителем разрядов", async () => {
  const now = Date.now();
  for (let id = 100; id < 1350; id++) zset("hadith:joined").set(String(id), Math.floor(now / 1000) - 50 * 86400);
  await handleUpdate(text("/users", admin), tg);
  assert.match(sent()[0].text, /Всего: <b>1\s251<\/b>/); // 1250 и админ
});

test("если хранилище недоступно, бот отвечает как обычно — учёт просто пропускается", async () => {
  redisDown = true;
  await handleUpdate(text("/help", person(1)), tg);
  assert.match(sent()[0].text, /Как пользоваться/);
});

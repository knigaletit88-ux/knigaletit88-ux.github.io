// Раздел «Время намаза»: что бот хадисов передаёт туда, а что оставляет себе. npm test
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

process.env.DATA_URL = "https://data.test/ru";
process.env.BOT_USERNAME = "s_unnabot";
process.env.BOT_TOKEN = "123:TEST";
process.env.ADMIN_IDS = "7";
process.env.KV_REST_API_URL = "https://redis.test";
process.env.KV_REST_API_TOKEN = "secret";
process.env.NAMAZ_URL = "https://namaz.test/";

const { COMMANDS, handleUpdate } = await import("../lib/bot.js");
const { namazSecret } = await import("../lib/namaz.js");

let calls, forwarded, redis, namazStatus;
const tg = async (method, params) => {
  calls.push({ method, params });
  return method === "getMe" ? { username: "s_unnabot" } : true;
};
const sent = () => calls.filter((c) => c.method === "sendMessage").map((c) => c.params);

globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  if (url === "https://redis.test") {
    const [cmd, ...keys] = JSON.parse(opts.body);
    return json({ result: cmd === "MGET" ? keys.map((k) => redis.get(k) ?? null) : redis.get(keys[0]) ?? null });
  }
  if (url === "https://namaz.test/api/webhook") {
    forwarded.push({ secret: opts.headers["X-Telegram-Bot-Api-Secret-Token"], update: JSON.parse(opts.body) });
    return json({ ok: namazStatus === 200 }, namazStatus);
  }
  if (url.startsWith("https://data.test/")) return new Response("[]", { status: 200 });
  if (url.startsWith("https://hadeethenc.com/")) return json({}, 404);
  throw new Error("Неожиданный запрос " + url);
};

beforeEach(() => {
  calls = [];
  forwarded = [];
  redis = new Map();
  namazStatus = 200;
});

const user = { id: 42, is_bot: false, first_name: "Абдулла" };
const message = (fields, type = "private", from = user) => ({ update_id: 1, message: { message_id: 1, date: 0, chat: { id: from.id, type }, from, ...fields } });
const text = (value, type) => message({ text: value }, type);
const press = (data, type = "private") => ({ update_id: 2, callback_query: { id: "cb", from: user, chat_instance: "x", data, message: { message_id: 5, date: 0, chat: { id: 42, type } } } });
const usesNamaz = () => redis.set("namaz:user:42", '{"s":{"city":"Казань"}}');

test("в приветствии есть кнопка «Время намаза» — только в личном чате", async () => {
  await handleUpdate(text("/start"), tg);
  const buttons = sent()[0].reply_markup.inline_keyboard.flat();
  assert.deepEqual(buttons.find((b) => b.callback_data === "nz:menu"), { text: "🕌 Время намаза", callback_data: "nz:menu" });
  assert.equal(forwarded.length, 0);

  calls = [];
  await handleUpdate(text("/start@s_unnabot", "group"), tg);
  assert.ok(!sent()[0].reply_markup.inline_keyboard.flat().some((b) => b.callback_data === "nz:menu"));
});

test("кнопки и команды намаза уходят в раздел намаза как есть, с секретом", async () => {
  const updates = [press("nz:menu"), press("day:2026-10-11"), press("n:a:asr_alt"), press("s:z:12:00"), press("c:ok"), press("place:0"), press("mo:2026-11"),
    text("/namaz"), text("/notify"), text("/settings@s_unnabot"), text("🕌 Сегодня"), text("📷 Мой календарь"), message({ location: { latitude: 55.79, longitude: 49.12 } })];
  for (const update of updates) await handleUpdate(update, tg, "123:TEST");
  assert.equal(forwarded.length, updates.length);
  assert.deepEqual(forwarded.map((f) => f.update), updates);
  assert.ok(forwarded.every((f) => f.secret === namazSecret("123:TEST")));
  assert.match(namazSecret("123:TEST"), /^[0-9a-f]{40}$/);
  assert.equal(calls.filter((c) => c.method !== "getMe").length, 0); // сам бот хадисов на них не отвечает
});

test("хадисы остаются за ботом хадисов: /today, «Хадис дня», админка каналов, поиск", async () => {
  for (const update of [text("/today"), text("/random"), text("/help"), press("day"), press("rnd"), press("ch:list"), press("channels"), text("намерение"), text("2962")]) {
    await handleUpdate(update, tg, "123:TEST");
  }
  assert.equal(forwarded.length, 0);
  assert.ok(calls.some((c) => c.method === "sendMessage" || c.method === "answerCallbackQuery"));
});

test("дата, два времени, расписание и фото — намазу, только если человек им пользуется", async () => {
  const timetable = Array.from({ length: 6 }, (_, i) => `0${i + 1}.10 03:29 05:33 12:00 15:06 17:07 18:48`).join("\n");
  const inputs = [text("25.12.2026"), text("16:43 03:50"), text(timetable), message({ photo: [{ file_id: "p" }] }), message({ document: { file_id: "d", mime_type: "image/png" } })];

  for (const update of inputs) await handleUpdate(update, tg, "123:TEST");
  assert.equal(forwarded.length, 0); // для остальных это обычный поиск по хадисам (а картинки бот хадисов пропускает)

  usesNamaz();
  for (const update of inputs) await handleUpdate(update, tg, "123:TEST");
  assert.equal(forwarded.length, inputs.length);

  forwarded = [];
  for (const update of [text("терпение"), text("2962"), text("📖 Хадисы"), message({ document: { file_id: "d", mime_type: "application/pdf" } })]) {
    await handleUpdate(update, tg, "123:TEST");
  }
  assert.equal(forwarded.length, 0); // слова и номера — по-прежнему хадисы, даже у тех, кто пользуется намазом
});

test("пока бот ждёт название города, текст уходит намазу; потом — снова поиск по хадисам", async () => {
  redis.set("namaz:fsm:s:42:42", "Place:waiting");
  await handleUpdate(text("Казань"), tg, "123:TEST");
  await handleUpdate(text("Отмена"), tg, "123:TEST");
  assert.deepEqual(forwarded.map((f) => f.update.message.text), ["Казань", "Отмена"]);

  redis.delete("namaz:fsm:s:42:42");
  await handleUpdate(text("Казань"), tg, "123:TEST");
  assert.equal(forwarded.length, 2);
  await handleUpdate(text("/today"), tg, "123:TEST"); // команды хадисов работают и во время ожидания города
  assert.equal(forwarded.length, 2);
});

test("«📖 Хадисы» из меню намаза возвращает приветствие", async () => {
  usesNamaz();
  await handleUpdate(text("📖 Хадисы"), tg, "123:TEST");
  assert.match(sent()[0].text, /Энциклопедию хадисов/);
  assert.equal(forwarded.length, 0);
});

test("в группах раздел намаза не работает", async () => {
  usesNamaz();
  for (const update of [text("🕌 Сегодня", "group"), text("/namaz", "supergroup"), press("nz:menu", "group"), message({ photo: [{ file_id: "p" }] }, "group")]) {
    await handleUpdate(update, tg, "123:TEST");
  }
  assert.equal(forwarded.length, 0);
});

test("пересланный админом пост канала с картинкой остаётся админке каналов", async () => {
  const admin = { id: 7, is_bot: false, first_name: "Админ" };
  redis.set("namaz:user:7", "{}");
  const post = message({ photo: [{ file_id: "p" }], caption: "Пост", forward_origin: { type: "channel", chat: { id: -1001, type: "channel", title: "Канал", username: "ilm" } } }, "private", admin);
  await handleUpdate(post, tg, "123:TEST");
  assert.equal(forwarded.length, 0);
});

test("если раздел намаза недоступен — вежливый ответ, хадисы продолжают работать", async () => {
  namazStatus = 503;
  await handleUpdate(press("nz:menu"), tg, "123:TEST");
  assert.equal(calls.find((c) => c.method === "answerCallbackQuery").params.callback_query_id, "cb");
  assert.match(sent()[0].text, /«Время намаза» сейчас недоступен/);

  calls = [];
  await handleUpdate(text("/help"), tg, "123:TEST");
  assert.match(sent()[0].text, /Как пользоваться/);
  assert.match(sent()[0].text, /\/namaz/);
});

test("если хранилище недоступно — текст считается поиском по хадисам, кнопки намаза работают", async () => {
  const fetchOk = globalThis.fetch;
  globalThis.fetch = async (url, opts) => (String(url) === "https://redis.test" ? new Response("{}", { status: 500 }) : fetchOk(url, opts));
  try {
    await handleUpdate(text("25.12.2026"), tg, "123:TEST");
    assert.equal(forwarded.length, 0);
    await handleUpdate(text("🕌 Сегодня"), tg, "123:TEST");
    assert.equal(forwarded.length, 1);
  } finally {
    globalThis.fetch = fetchOk;
  }
});

test("в меню команд бота есть и хадисы, и намаз", () => {
  const names = COMMANDS.map((c) => c.command);
  assert.ok(["today", "random", "namaz", "notify", "channels"].every((c) => names.includes(c)));
  assert.equal(COMMANDS.find((c) => c.command === "today").description, "Хадис дня");
});

// «Полезные каналы»: админка в чате с ботом, список для всех и API мини-приложения. npm test
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

process.env.DATA_URL = "https://data.test/ru";
process.env.BOT_USERNAME = "s_unnabot";
process.env.BOT_TOKEN = "123:TEST";
process.env.ADMIN_IDS = "42, 7";
process.env.KV_REST_API_URL = "https://redis.test";
process.env.KV_REST_API_TOKEN = "secret";

const { handleUpdate } = await import("../lib/bot.js");
const { channelRef } = await import("../lib/channels.js");
const channelsApi = (await import("../api/channels.js")).default;
const photoApi = (await import("../api/channel-photo.js")).default;

const CHATS = {
  "@ilm_channel": { id: -1001, type: "channel", title: "Знание · Ilm", username: "Ilm_Channel", description: "Уроки по акыде и фикху", photo: { small_file_id: "small1" } },
  "@sunna_daily": { id: -1002, type: "channel", title: "Сунна каждый день", username: "sunna_daily" },
};

let calls, redis, redisDown;
const tg = async (method, params) => {
  calls.push({ method, params });
  if (method === "getMe") return { username: "s_unnabot" };
  if (method === "getChat") return CHATS[String(params.chat_id).toLowerCase()];
  if (method === "getFile") return { file_path: "photos/file_1.jpg" };
  return true;
};
const sent = () => calls.filter((c) => c.method === "sendMessage").map((c) => c.params);
const edits = () => calls.filter((c) => c.method === "editMessageText").map((c) => c.params);

globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  if (url === "https://redis.test") {
    assert.equal(opts.headers.Authorization, "Bearer secret");
    if (redisDown) return new Response("{}", { status: 500 });
    const [cmd, key, value] = JSON.parse(opts.body);
    const result = cmd === "GET" ? redis.get(key) ?? null : cmd === "SET" ? (redis.set(key, value), "OK") : cmd === "DEL" ? Number(redis.delete(key)) : null;
    return new Response(JSON.stringify({ result }), { status: 200 });
  }
  if (url.startsWith("https://api.telegram.org/bot123:TEST/")) {
    const method = url.split("/").pop();
    return new Response(JSON.stringify({ ok: true, result: await tg(method, JSON.parse(opts.body || "{}")) }));
  }
  if (url === "https://api.telegram.org/file/bot123:TEST/photos/file_1.jpg") {
    return new Response(new Uint8Array([0xff, 0xd8, 0xff]), { headers: { "content-type": "application/octet-stream" } });
  }
  throw new Error("Неожиданный запрос " + url);
};

beforeEach(() => {
  calls = [];
  redis = new Map();
  redisDown = false;
});

const from = (id) => ({ id, is_bot: false, first_name: "Админ" });
const msg = (text, id = 42, extra = {}) => ({ update_id: 1, message: { message_id: 10, date: 0, chat: { id, type: "private" }, from: from(id), text, ...extra } });
const press = (data, id = 42) => handleUpdate({
  update_id: 2,
  callback_query: { id: "cb", from: from(id), chat_instance: "x", data, message: { message_id: 77, date: 0, chat: { id, type: "private" } } },
}, tg);
const buttons = (m) => m.reply_markup.inline_keyboard.flat();
const stored = () => JSON.parse(redis.get("hadith:channels") || "[]");

async function addChannel(text, extra) {
  await handleUpdate(msg(text, 42, extra), tg);
  const preview = sent().at(-1);
  const add = buttons(preview).find((b) => b.callback_data?.startsWith("ch:add:"));
  await press(add.callback_data);
  return preview;
}

test("распознавание ссылок, @username и пересланных постов", () => {
  assert.deepEqual(channelRef({ text: "https://t.me/ilm_channel" }), { username: "ilm_channel", note: "" });
  assert.deepEqual(channelRef({ text: "t.me/ilm_channel/123\nЛучшие уроки" }), { username: "ilm_channel", note: "Лучшие уроки" });
  assert.deepEqual(channelRef({ text: "@sunna_daily" }), { username: "sunna_daily", note: "" });
  assert.deepEqual(channelRef({ text: "https://t.me/+AbCdEf123\nЗакрытый" }), { invite: "+AbCdEf123", note: "Закрытый" });
  assert.deepEqual(channelRef({ text: "t.me/joinchat/XyZ" }), { invite: "+XyZ", note: "" });
  assert.equal(channelRef({ text: "намерение" }), null);
  assert.equal(channelRef({ text: "t.me/share/url?url=x" }), null);
  assert.equal(channelRef({ text: "почта me@mail.ru" }), null);
  const fwd = { type: "channel", chat: { id: -1, type: "channel", title: "Канал" } };
  assert.deepEqual(channelRef({ forward_origin: fwd, text: "t.me/other" }), { forward: fwd.chat, note: "" });
});

test("админ добавляет канал по ссылке, и он появляется у всех", async () => {
  const preview = await addChannel("https://t.me/ilm_channel");
  assert.match(preview.text, /Добавить в «Полезные каналы»/);
  assert.match(preview.text, /Знание · Ilm/);
  assert.match(preview.text, /Уроки по акыде и фикху/);
  assert.match(edits().at(-1).text, /добавлен в «Полезные каналы»/);
  assert.deepEqual(stored().map((c) => [c.key, c.url, c.photo]), [["ilm_channel", "https://t.me/Ilm_Channel", true]]);
  assert.equal(redis.has("hadith:pending:42"), false);

  calls = [];
  await handleUpdate(msg("/channels", 5), tg);
  const list = sent()[0];
  assert.match(list.text, /Полезные каналы/);
  assert.equal(buttons(list)[0].url, "https://t.me/Ilm_Channel");

  calls = [];
  await handleUpdate(msg("/start", 5), tg);
  assert.ok(buttons(sent()[0]).some((b) => b.callback_data === "channels"));
});

test("пересланный пост, своё описание и закрытый канал", async () => {
  await addChannel("", { text: undefined, caption: "Пост с фото", forward_origin: { type: "channel", chat: { id: -1002, type: "channel", title: "Сунна каждый день", username: "sunna_daily" } } });
  await addChannel("https://t.me/+Secret12\nНаш закрытый канал\nТолько для своих");
  await addChannel("@ilm_channel\nСвоё описание канала");
  assert.deepEqual(stored().map((c) => [c.title, c.description]), [
    ["Сунна каждый день", ""],
    ["Наш закрытый канал", "Только для своих"],
    ["Знание · Ilm", "Своё описание канала"],
  ]);
  // Повторная ссылка обновляет описание, а не дублирует канал
  const preview = await addChannel("t.me/ilm_channel\nНовое описание");
  assert.match(preview.text, /уже в списке/);
  assert.equal(stored().length, 3);
  assert.equal(stored()[2].description, "Новое описание");

  calls = [];
  await handleUpdate(msg("", 42, { text: undefined, caption: "x", forward_origin: { type: "channel", chat: { id: -9, type: "channel", title: "Тайный" } } }), tg);
  assert.match(sent()[0].text, /закрытый канал/);
  calls = [];
  await handleUpdate(msg("https://t.me/+NoTitle"), tg);
  assert.match(sent()[0].text, /название канала/);
});

test("админка: порядок, удаление, устаревшая карточка", async () => {
  await addChannel("@ilm_channel");
  await addChannel("@sunna_daily");
  calls = [];
  await handleUpdate(msg("/admin"), tg);
  const panel = sent()[0];
  assert.match(panel.text, /В списке: <b>2<\/b>/);
  assert.deepEqual(buttons(panel).map((b) => b.callback_data), ["ch:item:ilm_channel", "ch:item:sunna_daily", "channels"]);

  await press("ch:up:sunna_daily");
  assert.deepEqual(stored().map((c) => c.key), ["sunna_daily", "ilm_channel"]);
  await press("ch:del:ilm_channel");
  assert.match(edits().at(-1).text, /Удалить «Знание · Ilm»/);
  assert.equal(stored().length, 2);
  await press("ch:rm:ilm_channel");
  assert.deepEqual(stored().map((c) => c.key), ["sunna_daily"]);

  calls = [];
  await press("ch:add:ilm_channel");
  assert.match(edits()[0].text, /устарела/);
  assert.equal(stored().length, 1);
});

test("чужие не могут управлять списком: их ссылки — обычный поиск", async () => {
  await handleUpdate(msg("https://t.me/ilm_channel", 5), tg);
  assert.match(sent()[0].text, /Найдено|ничего не нашлось|Не получилось/);
  assert.equal(redis.size, 0);
  calls = [];
  await handleUpdate(msg("/admin", 5), tg);
  assert.match(sent()[0].text, /только для администратора/);
  calls = [];
  await press("ch:rm:x", 5);
  assert.equal(calls.find((c) => c.method === "answerCallbackQuery").params.text, "Только для администратора");
  assert.equal(edits().length, 0);
  calls = [];
  await handleUpdate(msg("/id", 5), tg);
  assert.match(sent()[0].text, /<code>5<\/code>/);
});

test("подсказки: нет ADMIN_IDS или нет хранилища", async () => {
  const saved = { ...process.env };
  try {
    delete process.env.ADMIN_IDS;
    await handleUpdate(msg("/admin", 5), tg);
    assert.match(sent()[0].text, /ADMIN_IDS/);
    assert.match(sent()[0].text, /<code>5<\/code>/);
    process.env.ADMIN_IDS = "42";
    delete process.env.KV_REST_API_URL;
    calls = [];
    await handleUpdate(msg("/admin"), tg);
    assert.match(sent()[0].text, /Upstash for Redis/);
    calls = [];
    await handleUpdate(msg("/start"), tg);
    assert.ok(!buttons(sent()[0]).some((b) => b.callback_data === "channels"));
    calls = [];
    await handleUpdate(msg("/channels"), tg);
    assert.match(sent()[0].text, /скоро появятся/);
  } finally {
    Object.assign(process.env, saved);
  }
});

test("переменные Upstash с другими именами тоже подходят", async () => {
  const saved = { ...process.env };
  try {
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
    process.env.STORAGE_UPSTASH_REDIS_REST_URL = "https://redis.test/";
    process.env.STORAGE_UPSTASH_REDIS_REST_TOKEN = "secret";
    await addChannel("@sunna_daily");
    assert.equal(stored().length, 1);
  } finally {
    delete process.env.STORAGE_UPSTASH_REDIS_REST_URL;
    delete process.env.STORAGE_UPSTASH_REDIS_REST_TOKEN;
    Object.assign(process.env, saved);
  }
});

const call = async (handler, url) => {
  const res = { headers: {}, statusCode: 0, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
  await handler({ method: "GET", url, headers: { host: "bot.test" } }, res);
  return res;
};

test("API мини-приложения: список и аватарки", async () => {
  await addChannel("@ilm_channel");
  await addChannel("@sunna_daily");
  const res = await call(channelsApi, "/api/channels");
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["Access-Control-Allow-Origin"], "*");
  const { channels } = JSON.parse(res.body);
  assert.deepEqual(channels.map((c) => [c.title, c.photo]), [
    ["Знание · Ilm", "https://bot.test/api/channel-photo?c=ilm_channel"],
    ["Сунна каждый день", null],
  ]);

  const photo = await call(photoApi, "/api/channel-photo?c=ilm_channel");
  assert.equal(photo.statusCode, 200);
  assert.equal(photo.headers["Content-Type"], "image/jpeg");
  assert.equal(photo.body.length, 3);
  assert.equal((await call(photoApi, "/api/channel-photo?c=unknown")).statusCode, 404);
  assert.equal((await call(photoApi, "/api/channel-photo?c=sunna_daily")).statusCode, 404);

  redisDown = true;
  const down = await call(channelsApi, "/api/channels");
  assert.equal(down.statusCode, 503);
  assert.deepEqual(JSON.parse(down.body).channels, []);
});

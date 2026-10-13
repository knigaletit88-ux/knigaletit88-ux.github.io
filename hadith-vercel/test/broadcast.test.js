// «📣 Рассылка» из админки: черновик, подтверждение, доставка всем, паузы и продолжение. npm test
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

// Redis в памяти: строки со сроком (NX), упорядоченный набор пользователей
let keys, joined, forwarded, calls, blocked, slowOnce, draftGone;
function run([cmd, key, ...args]) {
  if (cmd === "GET") return keys.get(key) ?? null;
  if (cmd === "MGET") return [key, ...args].map((k) => keys.get(k) ?? null);
  if (cmd === "SET") {
    if (args.includes("NX") && keys.has(key)) return null;
    keys.set(key, args[0]);
    return "OK";
  }
  if (cmd === "DEL") return [key, ...args].filter((k) => keys.delete(k)).length;
  if (cmd === "ZADD") {
    if (key !== "hadith:joined") return 0; // «последний раз писал» здесь не нужен
    const nx = args[0] === "NX";
    const [score, member] = nx ? args.slice(1) : args;
    if (!(nx && joined.has(member))) joined.set(member, Number(score));
    return 1;
  }
  if (cmd === "ZCARD") return joined.size;
  if (cmd === "ZRANGE") {
    const ordered = [...joined].sort((a, b) => a[1] - b[1]).map(([id]) => id);
    return ordered.slice(Number(args[0]), Number(args[1]) + 1);
  }
  throw new Error("Неизвестная команда " + cmd);
}

globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  const json = (body) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
  if (url.startsWith("https://redis.test")) {
    const body = JSON.parse(opts.body);
    return url.endsWith("/pipeline") ? json(body.map((c) => ({ result: run(c) }))) : json({ result: run(body) });
  }
  if (url === "https://namaz.test/api/webhook") { forwarded.push(JSON.parse(opts.body)); return json({ ok: true }); }
  if (url.startsWith("https://data.test/")) return new Response("[]");
  if (url.startsWith("https://hadeethenc.com/")) return new Response("{}", { status: 404 });
  throw new Error("Неожиданный запрос " + url);
};

const tg = async (method, params) => {
  calls.push({ method, params });
  return method === "getMe" ? { username: "s_unnabot" } : true;
};
tg.raw = async (method, params) => {
  calls.push({ method, params, raw: true });
  const id = String(params.chat_id);
  if (draftGone) return { ok: false, error_code: 400, description: "Bad Request: message to copy not found" };
  if (blocked.has(id)) return { ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" };
  if (slowOnce.delete(id)) return { ok: false, error_code: 429, description: "Too Many Requests", parameters: { retry_after: 0.01 } };
  return { ok: true, result: { message_id: 1 } };
};

beforeEach(() => {
  keys = new Map();
  joined = new Map();
  forwarded = [];
  calls = [];
  blocked = new Set();
  slowOnce = new Set();
  draftGone = false;
  delete process.env.BROADCAST_BUDGET_MS;
});

const ADMIN = 7;
const person = (id) => ({ id, is_bot: false, first_name: "Читатель" });
const message = (fields, id = ADMIN) => ({ update_id: 1, message: { message_id: 50, date: 0, chat: { id, type: "private" }, from: person(id), ...fields } });
const press = (data, id = ADMIN) => handleUpdate({
  update_id: 2,
  callback_query: { id: "cb", from: person(id), chat_instance: "x", data, message: { message_id: 90, date: 1, chat: { id, type: "private" } } },
}, tg);
const edits = () => calls.filter((c) => c.method === "editMessageText").map((c) => c.params);
const sent = () => calls.filter((c) => c.method === "sendMessage").map((c) => c.params);
const deliveries = () => calls.filter((c) => c.raw && c.method === "copyMessage").map((c) => String(c.params.chat_id));
const addUsers = (n) => { for (let i = 1; i <= n; i++) joined.set(String(1000 + i), i); joined.set(String(ADMIN), 0); };

async function prepareDraft(fields = { text: "Ас-саляму алейкум! Новый раздел: t.me/hadith_daily" }) {
  await press("bc:start");
  await handleUpdate(message(fields), tg);
}

test("кнопка «Рассылка» → черновик → предпросмотр и подтверждение", async () => {
  addUsers(3);
  await press("bc:start");
  assert.match(edits()[0].text, /Получат: <b>3<\/b>/);

  calls = [];
  // Ссылка в тексте рассылки — не «добавить канал»
  await handleUpdate(message({ text: "Ас-саляму алейкум! Новый раздел: t.me/hadith_daily" }), tg);
  const preview = calls.find((c) => c.method === "copyMessage" && !c.raw).params;
  assert.deepEqual([preview.chat_id, preview.from_chat_id, preview.message_id], [ADMIN, ADMIN, 50]);
  const confirm = sent().at(-1);
  assert.match(confirm.text, /Отправить это сообщение <b>3<\/b> пользователям/);
  assert.deepEqual(confirm.reply_markup.inline_keyboard[0].map((b) => b.callback_data), ["bc:send", "bc:cancel"]);
  assert.ok(!sent().some((m) => /Полезные каналы/.test(m.text)));
  assert.equal(keys.has("hadith:pending:7"), false);
  // Следующее сообщение админа — снова обычное (поиск), а не рассылка
  calls = [];
  await handleUpdate(message({ text: "намерение" }), tg);
  assert.ok(!calls.some((c) => c.method === "copyMessage"));
});

test("отправка: всем, кроме автора; заблокировавшие бота — «не доставлено»; «подождите» от Telegram", async () => {
  addUsers(5);
  blocked.add("1002");
  slowOnce.add("1004");
  await prepareDraft();
  calls = [];
  await press("bc:send");
  const got = deliveries();
  assert.ok(!got.includes(String(ADMIN)));
  assert.deepEqual([...new Set(got)].sort(), ["1001", "1002", "1003", "1004", "1005"]);
  assert.equal(got.filter((id) => id === "1004").length, 2); // повтор после «подождите»
  const done = edits().at(-1).text;
  assert.match(done, /Рассылка завершена/);
  assert.match(done, /Доставлено: <b>4<\/b>/);
  assert.match(done, /Не доставлено: <b>1<\/b>/);
  assert.equal(keys.has("hadith:bcast:job"), false);
  assert.equal(keys.has("hadith:bcast:lock"), false);

  // Повторное нажатие (или повтор от Telegram) не рассылает второй раз
  calls = [];
  await press("bc:send");
  assert.equal(deliveries().length, 0);
  assert.equal(edits().length, 0); // итог «Рассылка завершена» остаётся
  assert.match(calls.find((c) => c.method === "answerCallbackQuery").params.text, /Нечего отправлять/);
});

test("много людей: пауза, «Продолжить» с того же места, каждому — один раз", async () => {
  addUsers(70);
  process.env.BROADCAST_BUDGET_MS = "0";
  await prepareDraft({ photo: [{ file_id: "p" }], caption: "Фото с подписью" });
  calls = [];
  await press("bc:send");
  assert.match(edits().at(-1).text, /⏸ Отправлено 29 из 70/); // в первой пачке 30 человек, один из них — сам админ
  assert.equal(edits().at(-1).reply_markup.inline_keyboard[0][0].callback_data, "bc:send");
  await press("bc:send");
  await press("bc:send");
  assert.match(edits().at(-1).text, /Рассылка завершена/);
  const got = deliveries();
  assert.equal(got.length, 70);
  assert.equal(new Set(got).size, 70);
});

test("пока рассылка идёт, второй запуск не начинается; «Остановить» и «Отмена»", async () => {
  addUsers(3);
  await prepareDraft();
  keys.set("hadith:bcast:lock", "1");
  calls = [];
  await press("bc:send");
  assert.equal(calls.find((c) => c.method === "answerCallbackQuery").params.text, "Рассылка уже идёт");
  assert.equal(deliveries().length, 0);
  keys.delete("hadith:bcast:lock");

  await press("bc:cancel");
  assert.match(edits().at(-1).text, /Рассылка отменена/);
  calls = [];
  await press("bc:send");
  assert.equal(deliveries().length, 0);
});

test("исходное сообщение удалено — рассылка останавливается с объяснением", async () => {
  addUsers(3);
  await prepareDraft();
  draftGone = true;
  calls = [];
  await press("bc:send");
  assert.match(edits().at(-1).text, /Исходное сообщение удалено/);
  assert.equal(keys.has("hadith:bcast:job"), false);
});

test("фото для рассылки не уходит в раздел намаза; чужим рассылка недоступна", async () => {
  addUsers(2);
  keys.set("namaz:user:7", "{}"); // админ сам пользуется намазом: его фото обычно уходят туда
  await press("bc:start");
  await handleUpdate(message({ photo: [{ file_id: "p" }], caption: "Расписание мероприятий" }), tg);
  assert.equal(forwarded.length, 0);
  assert.match(sent().at(-1).text, /Отправить это сообщение/);

  calls = [];
  await press("bc:send", 1001);
  assert.equal(calls.find((c) => c.method === "answerCallbackQuery").params.text, "Только для администратора");
  assert.equal(deliveries().length, 0);
  await handleUpdate(message({ text: "/broadcast" }, 1001), tg);
  assert.match(sent().at(-1).text, /только для администратора/);
  calls = [];
  await handleUpdate(message({ text: "/broadcast" }), tg);
  assert.match(sent().at(-1).text, /Пришлите сюда сообщение для рассылки/);
});

test("альбом из нескольких фото — просим одно фото", async () => {
  addUsers(1);
  await press("bc:start");
  await handleUpdate(message({ photo: [{ file_id: "p" }], media_group_id: "g1" }), tg);
  assert.match(sent().at(-1).text, /Альбом/);
  assert.ok(keys.has("hadith:bcast:wait:7")); // ждём дальше
});

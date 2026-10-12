// Викторина дня: составление вопросов, рассылка в 12:00, подписка, каналы. npm test
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { beforeEach, test } from "node:test";

process.env.DATA_URL = "https://data.test/ru";
process.env.BOT_USERNAME = "s_unnabot";
process.env.BOT_TOKEN = "123:TEST";
process.env.ADMIN_IDS = "42";
process.env.KV_REST_API_URL = "https://redis.test";
process.env.KV_REST_API_TOKEN = "secret";
const DATA_DIR = new URL("../../hadith/data/ru/", import.meta.url);

const { handleUpdate } = await import("../lib/bot.js");
const { buildQuiz, localTime, runDaily } = await import("../lib/quiz.js");
const { getHadith, isSahih } = await import("../lib/hadith.js");
const quizApi = (await import("../api/quiz.js")).default;
const sahih = new Set(JSON.parse(await readFile(new URL("sahih.json", DATA_DIR), "utf8")));

// Redis в памяти: строки, множества, хеши
let db;
function redis([cmd, key, ...args]) {
  const set = () => db.get(key) || new Set();
  const hash = () => db.get(key) || new Map();
  switch (cmd) {
    case "GET": return db.has(key) ? db.get(key) : null;
    case "SET": if (args.includes("NX") && db.has(key)) return null; db.set(key, args[0]); return "OK";
    case "DEL": return Number(db.delete(key));
    case "SADD": { const s = set(); s.add(args[0]); db.set(key, s); return 1; }
    case "SREM": { const s = set(); const had = s.delete(args[0]); db.set(key, s); return Number(had); }
    case "SISMEMBER": return Number(set().has(args[0]));
    case "SMEMBERS": return [...set()];
    case "SCARD": return set().size;
    case "HSET": { const h = hash(); h.set(args[0], args[1]); db.set(key, h); return 1; }
    case "HDEL": { const h = hash(); const had = h.delete(args[0]); db.set(key, h); return Number(had); }
    case "HGETALL": return [...hash()].flat();
    default: throw new Error("Redis: " + cmd);
  }
}

let calls, blocked;
const CHANNEL = { id: -100777, type: "channel", title: "Хадисы каждый день", username: "hadith_daily" };
const tg = async (method, params) => {
  calls.push({ method, params });
  tg.lastError = null;
  if (method === "getMe") return { id: 999, username: "s_unnabot" };
  if (method === "getChat") return [CHANNEL.id, String(CHANNEL.id), "@hadith_daily"].includes(params.chat_id) ? CHANNEL : undefined;
  if (method === "getChatMember") return { status: "administrator", can_post_messages: true };
  if (method === "sendPoll" && blocked.has(String(params.chat_id))) { tg.lastError = { ok: false, error_code: 403 }; return undefined; }
  return method === "sendPoll" ? { message_id: 1 } : true;
};
const polls = () => calls.filter((c) => c.method === "sendPoll").map((c) => c.params);
const sent = () => calls.filter((c) => c.method === "sendMessage").map((c) => c.params);

globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  if (url === "https://redis.test") return new Response(JSON.stringify({ result: redis(JSON.parse(opts.body)) }));
  if (url.startsWith("https://data.test/ru/")) {
    try { return new Response(await readFile(new URL(url.slice("https://data.test/ru/".length), DATA_DIR))); } catch { return new Response("", { status: 404 }); }
  }
  if (url.startsWith("https://api.telegram.org/bot123:TEST/")) {
    const result = await tg(url.split("/").pop(), JSON.parse(opts.body || "{}"));
    return new Response(JSON.stringify(result === undefined ? { ok: false, error_code: 403 } : { ok: true, result }));
  }
  throw new Error("Неожиданный запрос " + url);
};

beforeEach(() => {
  calls = [];
  db = new Map();
  blocked = new Set();
});

const MSK = (time, day = "2026-10-12") => new Date(`${day}T${time}:00+03:00`);
const user = (id) => ({ id, is_bot: false, first_name: "Читатель" });
const msg = (text, id = 42) => ({ update_id: 1, message: { message_id: 3, date: 0, chat: { id, type: "private" }, from: user(id), text } });
const press = (data, id = 42, extra = {}) => handleUpdate({
  update_id: 2,
  callback_query: { id: "cb", from: user(id), chat_instance: "x", data, message: { message_id: 8, date: 1, chat: { id, type: "private" }, ...extra } },
}, tg);

test("время викторины считается по Москве", () => {
  assert.deepEqual(localTime(new Date("2026-10-12T08:59:00Z")), { date: "2026-10-12", minutes: 11 * 60 + 59 });
  assert.deepEqual(localTime(new Date("2026-10-12T21:30:00Z")), { date: "2026-10-13", minutes: 30 });
});

test("вопросы: только достоверные хадисы, по правилам Telegram, через день разные виды", async () => {
  const used = new Set();
  const kinds = new Set();
  for (let d = 1; d <= 20; d++) {
    const date = `2026-11-${String(d).padStart(2, "0")}`;
    const q = await buildQuiz(date, used);
    used.add(q.id);
    kinds.add(q.kind);
    const h = await getHadith(q.id);
    assert.ok(isSahih(h) && sahih.has(q.id), `${date}: №${q.id} — ${h.grade}`);
    assert.ok(q.question.length <= 300 && q.explanation.length <= 200);
    assert.equal(q.options.length, 4);
    assert.equal(new Set(q.options).size, 4);
    assert.ok(q.options.every((o) => o.length >= 1 && o.length <= 100));
    assert.match(q.explanation, new RegExp(`№${q.id}`));
    if (q.kind === "continue") {
      const text = `${h.hadeeth}`.replace(/[«»“”„"/]/g, "").replace(/\s+/g, " ");
      assert.ok(text.includes(q.options[q.correct].slice(1)), `${date}: правильное окончание из этого хадиса`);
    } else {
      assert.match(h.attribution.toLowerCase(), new RegExp(q.options[q.correct].toLowerCase().replace("абу дауд", "абу дав?у?д")));
    }
    // Тот же день — та же викторина
    assert.deepEqual(await buildQuiz(date, new Set([...used].filter((id) => id !== q.id))), q);
  }
  assert.deepEqual(kinds, new Set(["continue", "source"]));
  assert.equal(used.size, 20);
});

test("рассылка: не раньше 12:00, один раз в день, в каналы и подписчикам", async () => {
  db.set("hadith:quiz:chats", new Map([[String(CHANNEL.id), JSON.stringify({ title: CHANNEL.title, type: "channel" })]]));
  db.set("hadith:quiz:subs", new Set(["5", "6"]));
  blocked.add("6");

  assert.equal((await runDaily(tg, { now: MSK("11:59") })).status, "early");
  assert.equal(polls().length, 0);

  const result = await runDaily(tg, { now: MSK("12:00") });
  assert.equal(result.status, "sent");
  assert.equal(result.sent, 2);
  const [toChannel, toUser] = polls();
  assert.equal(toChannel.chat_id, String(CHANNEL.id));
  assert.equal(toChannel.type, "quiz");
  assert.equal(toChannel.reply_markup.inline_keyboard.length, 1); // в канале — только «Разъяснение»
  assert.match(toChannel.reply_markup.inline_keyboard[0][0].url, /^https:\/\/t\.me\/s_unnabot\?startapp=h\d+_ru$/);
  assert.equal(toUser.reply_markup.inline_keyboard[1][0].callback_data, "qz:unsub");
  assert.equal(toChannel.question, toUser.question);
  assert.deepEqual([...db.get("hadith:quiz:subs")], ["5"]); // остановивший бота убран из рассылки

  calls = [];
  assert.equal((await runDaily(tg, { now: MSK("12:40") })).status, "already");
  assert.equal(polls().length, 0);
  // На следующий день — новая викторина
  const next = await runDaily(tg, { now: MSK("12:05", "2026-10-13") });
  assert.equal(next.status, "sent");
  assert.notEqual(next.hadith, result.hadith);
});

test("/quiz присылает викторину дня, кнопка подписки включает и выключает рассылку", async () => {
  await handleUpdate(msg("/quiz", 5), tg);
  const [poll] = polls();
  assert.equal(poll.chat_id, 5);
  assert.equal(poll.reply_markup.inline_keyboard[1][0].callback_data, "qz:sub");

  calls = [];
  await press("qz:sub", 5, { reply_markup: poll.reply_markup });
  assert.ok(db.get("hadith:quiz:subs").has("5"));
  assert.match(calls.find((c) => c.method === "answerCallbackQuery").params.text, /каждый день в 12:00/);
  const markup = calls.find((c) => c.method === "editMessageReplyMarkup").params.reply_markup.inline_keyboard;
  assert.equal(markup.length, 2);
  assert.equal(markup[1][0].callback_data, "qz:unsub");

  await press("qz:unsub", 5);
  assert.ok(!db.get("hadith:quiz:subs").has("5"));

  // В приветствии есть кнопка «Викторина дня»
  calls = [];
  await handleUpdate(msg("/start", 5), tg);
  assert.ok(sent()[0].reply_markup.inline_keyboard.flat().some((b) => b.callback_data === "quiz"));
});

test("админ добавляет бота в канал → подтверждение → канал в рассылке; убрали бота — канал убран", async () => {
  const member = (status, extra = {}) => handleUpdate({
    update_id: 3,
    my_chat_member: { chat: CHANNEL, from: user(42), date: 0, old_chat_member: { status: "left" }, new_chat_member: { status, user: { id: 999 }, ...extra } },
  }, tg);
  await member("administrator", { can_post_messages: true });
  const ask = sent()[0];
  assert.equal(ask.chat_id, 42);
  assert.match(ask.text, /Хадисы каждый день/);
  assert.equal(ask.reply_markup.inline_keyboard[0][0].callback_data, `qz:add:${CHANNEL.id}`);

  await press(`qz:add:${CHANNEL.id}`);
  assert.ok(db.get("hadith:quiz:chats").has(String(CHANNEL.id)));

  calls = [];
  await press("qz:admin");
  const view = calls.find((c) => c.method === "editMessageText").params;
  assert.match(view.text, /📣 Хадисы каждый день/);

  await member("left");
  assert.ok(!db.get("hadith:quiz:chats").has(String(CHANNEL.id)));

  // Чужой человек добавил бота — админа не спрашиваем, но и не публикуем
  calls = [];
  await handleUpdate({ update_id: 4, my_chat_member: { chat: CHANNEL, from: user(5), date: 0, old_chat_member: { status: "left" }, new_chat_member: { status: "administrator", can_post_messages: true, user: { id: 999 } } } }, tg);
  assert.equal(sent().length, 0);
  assert.ok(!db.get("hadith:quiz:chats").has(String(CHANNEL.id)));
});

test("/quiz_add @канал и пробная викторина из админки", async () => {
  await handleUpdate(msg("/quiz_add @hadith_daily"), tg);
  assert.match(sent()[0].text, /✅ Викторина будет приходить в «Хадисы каждый день»/);
  assert.ok(db.get("hadith:quiz:chats").has(String(CHANNEL.id)));

  calls = [];
  await handleUpdate(msg("/quiz_add @hadith_daily", 5), tg);
  assert.match(sent()[0].text, /только для администратора/);

  calls = [];
  await press("qz:test");
  assert.equal(polls()[0].chat_id, 42);
  calls = [];
  await press("qz:rm:-100777", 5);
  assert.equal(calls.find((c) => c.method === "answerCallbackQuery").params.text, "Только для администратора");
  assert.ok(db.get("hadith:quiz:chats").has(String(CHANNEL.id)));
});

test("/api/quiz отвечает статусом и сам решает, пора ли отправлять", async () => {
  const res = { headers: {}, statusCode: 0, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
  await quizApi({ method: "GET", headers: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.match(JSON.parse(res.body).status, /^(early|sent|already)$/);
});

// Проверка бота на настоящих данных из hadith/data и имитации Telegram: npm test
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { beforeEach, test } from "node:test";

process.env.DATA_URL = "https://data.test/ru";
process.env.BOT_USERNAME = "Hadis_1234bot";
const DATA_DIR = new URL("../../hadith/data/ru/", import.meta.url);

const { handleUpdate, splitText, webhookSecret } = await import("../lib/bot.js");
const { dailyId, resetCache, search } = await import("../lib/hadith.js");
const webhook = (await import("../api/webhook.js")).default;

let calls;
let dataDown;
const tg = async (method, params) => {
  calls.push({ method, params });
  return method === "getMe" ? { username: "Hadis_1234bot" } : true;
};
const sent = () => calls.filter((c) => c.method === "sendMessage").map((c) => c.params);

globalThis.fetch = async (url) => {
  url = String(url);
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  if (url.startsWith("https://data.test/ru/")) {
    if (dataDown) return new Response("down", { status: 503 });
    try {
      return new Response(await readFile(new URL(url.slice("https://data.test/ru/".length), DATA_DIR)), { status: 200 });
    } catch {
      return new Response("not found", { status: 404 });
    }
  }
  if (url.startsWith("https://hadeethenc.com/")) return json({ message: "not found" }, 404);
  if (url.startsWith("https://api.telegram.org/")) {
    calls.push({ method: url.split("/").pop(), params: {} });
    return json({ ok: true, result: true });
  }
  throw new Error("Неожиданный запрос " + url);
};

beforeEach(() => {
  calls = [];
  dataDown = false;
});

const user = { id: 42, is_bot: false, first_name: "Абдулла" };
const msg = (text, type = "private") => ({ update_id: 1, message: { message_id: 1, date: 0, chat: { id: 42, type }, from: user, text } });

test("приветствие с арабским саламом и кнопкой мини-приложения", async () => {
  await handleUpdate(msg("/start"), tg);
  const [m] = sent();
  assert.match(m.text, /السلام عليكم ورحمة الله وبركاته/);
  assert.match(m.text, /Ас-саляму алейкум ва рахматуллахи ва баракятух, Абдулла!/);
  assert.equal(m.reply_markup.inline_keyboard[0][0].web_app.url, "https://knigaletit88-ux.github.io/hadith/");
});

test("ссылка /start h2962 открывает хадис", async () => {
  await handleUpdate(msg("/start h2962_ru"), tg);
  const [m] = sent();
  assert.match(m.text, /Хадис №2962/);
  assert.match(m.text, /кровопролитием/);
  const buttons = m.reply_markup.inline_keyboard.flat();
  assert.equal(buttons[0].web_app.url, "https://knigaletit88-ux.github.io/hadith/?startapp=h2962_ru");
  assert.equal(buttons[1].web_app.url, "https://knigaletit88-ux.github.io/hadith/?startapp=c2962_ru");
  assert.equal(buttons[2].switch_inline_query, "2962");
});

test("номер хадиса и неизвестный номер", async () => {
  await handleUpdate(msg("№5907"), tg);
  assert.match(sent()[0].text, /Хадис №5907/);
  calls = [];
  await handleUpdate(msg("99999999"), tg);
  assert.match(sent()[0].text, /не найден/);
});

test("поиск по словам: кнопки-номера открывают хадис", async () => {
  await handleUpdate(msg("намерен"), tg);
  const m = sent()[0];
  assert.match(m.text, /Найдено: <b>\d+<\/b>/);
  const first = m.reply_markup.inline_keyboard[0][0];
  calls = [];
  await handleUpdate({ update_id: 2, callback_query: { id: "cb", from: user, chat_instance: "x", data: first.callback_data, message: { message_id: 5, date: 0, chat: { id: 42, type: "private" } } } }, tg);
  assert.equal(calls[0].method, "answerCallbackQuery");
  assert.match(sent()[0].text, /Хадис №/);
});

test("ничего не найдено и ответ на салам", async () => {
  await handleUpdate(msg("абракадабра"), tg);
  assert.match(sent()[0].text, /ничего не нашлось/);
  calls = [];
  await handleUpdate(msg("Ассаляму алейкум"), tg);
  assert.match(sent()[0].text, /وعليكم السلام/);
});

test("хадис дня совпадает с мини-приложением и не меняется в течение дня", async () => {
  const a = await dailyId(new Date("2026-10-09T05:00:00Z"));
  const b = await dailyId(new Date("2026-10-09T20:00:00Z"));
  assert.equal(a, b);
  await handleUpdate(msg("/today"), tg);
  assert.match(sent()[0].text, /Хадис дня/);
});

test("в группе бот отвечает только на команды и даёт ссылки вместо web_app", async () => {
  await handleUpdate(msg("намерение", "group"), tg);
  assert.equal(sent().length, 0);
  await handleUpdate(msg("/random@Hadis_1234bot", "group"), tg);
  const buttons = sent()[0].reply_markup.inline_keyboard.flat();
  assert.ok(buttons[0].url.startsWith("https://t.me/Hadis_1234bot?startapp=h"));
});

test("inline-режим: поиск и номер", async () => {
  await handleUpdate({ update_id: 3, inline_query: { id: "iq", from: user, query: "намерен", offset: "" } }, tg);
  const answer = calls.find((c) => c.method === "answerInlineQuery").params;
  assert.ok(answer.results.length > 0);
  assert.ok(answer.results.every((r) => r.input_message_content.message_text.length <= 4096));
  calls = [];
  await handleUpdate({ update_id: 4, inline_query: { id: "iq2", from: user, query: "2962", offset: "" } }, tg);
  assert.equal(calls.find((c) => c.method === "answerInlineQuery").params.results[0].id, "2962");
});

test("если данные недоступны — вежливое сообщение об ошибке", async () => {
  resetCache();
  dataDown = true;
  await handleUpdate(msg("/random"), tg);
  assert.match(sent()[0].text, /Не получилось загрузить/);
  resetCache();
});

test("поиск: ё и е не различаются", async () => {
  const a = await search("её");
  const b = await search("ее");
  assert.equal(a.total, b.total);
});

test("длинный текст делится на части не длиннее лимита", () => {
  const parts = splitText(("слово ".repeat(900) + "\n\n").repeat(3), 4000);
  assert.ok(parts.length > 1 && parts.every((p) => p.length <= 4000));
});

test("вебхук принимает только запросы с секретом Telegram", async () => {
  process.env.BOT_TOKEN = "123:TEST";
  const run = async (headers, body) => {
    const res = { headers: {}, statusCode: 0, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
    await webhook({ method: "POST", headers, body }, res);
    return res;
  };
  assert.equal((await run({}, msg("/start"))).statusCode, 401);
  const ok = await run({ "x-telegram-bot-api-secret-token": webhookSecret("123:TEST") }, msg("/start"));
  assert.equal(ok.statusCode, 200);
  assert.ok(calls.some((c) => c.method === "sendMessage"));
});

// Сохранение карточки из мини-приложения: проверка Telegram, отправка файлом в чат, ссылка для скачивания. npm test
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

process.env.BOT_TOKEN = "123:TEST";
process.env.BOT_USERNAME = "s_unnabot";
const { checkInitData, signInitData } = await import("../lib/webapp.js");
const card = (await import("../api/card.js")).default;

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const now = () => String(Math.floor(Date.now() / 1000));
const initData = (user = { id: 42, first_name: "Читатель" }, auth = now()) =>
  signInitData({ query_id: "q", user: JSON.stringify(user), auth_date: auth }, "123:TEST");

let calls, telegramFails;
globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  calls.push({ url, opts });
  if (url.endsWith("/sendDocument")) {
    if (telegramFails) return new Response(JSON.stringify({ ok: false, error_code: 403, description: "Forbidden: bot can't initiate conversation" }));
    return new Response(JSON.stringify({ ok: true, result: { message_id: 9, document: { file_id: "FILE-1" } } }));
  }
  if (url.includes("/getFile")) return new Response(JSON.stringify({ ok: true, result: { file_path: "documents/file_1.png" } }));
  if (url.endsWith("/file/bot123:TEST/documents/file_1.png")) return new Response(PNG);
  throw new Error("Неожиданный запрос " + url);
};

beforeEach(() => {
  calls = [];
  telegramFails = false;
});

async function call({ method = "POST", url = "/api/card?id=3362&lang=ru", headers = {}, body } = {}) {
  const res = { headers: {}, statusCode: 0, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = b; } };
  await card({ method, url, headers: { host: "bot.test", ...headers }, body }, res);
  return { ...res, json: () => JSON.parse(res.body) };
}

test("данные мини-приложения: подпись Telegram, срок, подделка", () => {
  assert.equal(checkInitData(initData(), "123:TEST").id, 42);
  assert.equal(checkInitData(initData(), "999:OTHER"), null);
  assert.equal(checkInitData(initData().replace("42", "43"), "123:TEST"), null);
  assert.equal(checkInitData(initData(undefined, String(Math.floor(Date.now() / 1000) - 2 * 86400)), "123:TEST"), null);
  assert.equal(checkInitData("", "123:TEST"), null);
});

test("карточка приходит в чат файлом, а ссылка из ответа её скачивает", async () => {
  const res = await call({ headers: { "x-init-data": initData() }, body: PNG });
  assert.equal(res.statusCode, 200);
  const { ok, name, url } = res.json();
  assert.ok(ok);
  assert.equal(name, "hadith-3362.png");

  const form = calls.find((c) => c.url.endsWith("/sendDocument")).opts.body;
  assert.equal(form.get("chat_id"), "42");
  assert.equal(form.get("document").name, "hadith-3362.png");
  assert.match(form.get("caption"), /Карточка хадиса №3362/);
  assert.match(form.get("caption"), /t\.me\/s_unnabot\?startapp=h3362_ru/);

  const link = new URL(url);
  assert.equal(link.host, "bot.test");
  const file = await call({ method: "GET", url: link.pathname + link.search });
  assert.equal(file.statusCode, 200);
  assert.equal(file.headers["content-type"], "image/png");
  assert.equal(file.headers["content-disposition"], 'attachment; filename="hadith-3362.png"');
  assert.deepEqual(file.body, PNG);

  // Подменить файл или имя в ссылке нельзя
  const forged = await call({ method: "GET", url: link.pathname + link.search.replace("FILE-1", "FILE-2") });
  assert.equal(forged.statusCode, 403);
});

test("без данных Telegram, не картинка, бот не запущен", async () => {
  assert.equal((await call({ body: PNG })).statusCode, 401);
  assert.equal((await call({ headers: { "x-init-data": initData() }, body: Buffer.from("<html>") })).json().error, "image");
  assert.equal((await call({ url: "/api/card?id=abc", headers: { "x-init-data": initData() }, body: PNG })).json().error, "id");
  telegramFails = true;
  const res = await call({ headers: { "x-init-data": initData() }, body: PNG });
  assert.equal(res.statusCode, 502);
  assert.equal(res.json().error, "chat");
});

test("запрос из мини-приложения разрешён (CORS)", async () => {
  const res = await call({ method: "OPTIONS" });
  assert.equal(res.statusCode, 204);
  assert.equal(res.headers["access-control-allow-origin"], "*");
  assert.match(res.headers["access-control-allow-headers"], /X-Init-Data/);
});

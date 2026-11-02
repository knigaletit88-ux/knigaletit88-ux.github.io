// Запасной режим: бот отвечает с ноутбука, пока сервер недоступен. Запуск: node poll.mjs
// Снимает webhook (иначе Telegram не отдаёт сообщения сюда) и забирает их сам. Ctrl+C — остановить.
// Вернуть бота на сервер — node deploy.mjs: он снова ставит webhook, и этот режим сам завершится.
// Настройки — из .env рядом (BOT_TOKEN, KV_REST_API_URL, KV_REST_API_TOKEN, ADMIN_IDS, …).
import { existsSync, readFileSync } from "node:fs";

const ENV = new URL(".env", import.meta.url);
if (existsSync(ENV)) {
  for (const line of readFileSync(ENV, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}
// настройки бот читает при загрузке, поэтому он подключается после .env
const { handleUpdate, telegram } = await import("./lib/bot.js");

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error("В .env нет BOT_TOKEN.");
  process.exit(1);
}
const tg = telegram(token);
const me = await tg("getMe");
if (!me) process.exit(1);
await tg("deleteWebhook");
console.log(`@${me.username} отвечает с ноутбука. Ctrl+C — остановить.`);

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let offset = 0;
for (;;) {
  const data = await tg.raw("getUpdates", { offset, timeout: 50, allowed_updates: ["message", "callback_query", "inline_query"] })
    .catch((err) => ({ ok: false, description: err.message }));
  if (!data.ok) {
    // webhook поставили снова (бот вернулся на сервер) — здесь больше делать нечего
    if (/webhook/i.test(data.description || "")) {
      console.log("Бот снова на сервере — запасной режим остановлен.");
      process.exit(0);
    }
    console.error("getUpdates:", data.description);
    await pause(5000);
    continue;
  }
  for (const update of data.result) {
    offset = update.update_id + 1;
    // не ждём: долгая рассылка из админки не должна задерживать остальных
    handleUpdate(update, tg, token).catch((err) => console.error(err));
  }
}

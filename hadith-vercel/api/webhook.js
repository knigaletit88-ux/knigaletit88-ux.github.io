// Сюда Telegram присылает сообщения боту (вебхук).
import { handleUpdate, telegram, webhookSecret } from "../lib/bot.js";

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return JSON.parse(raw || "{}");
}

export default async function handler(req, res) {
  const token = process.env.BOT_TOKEN;
  res.setHeader("Content-Type", "application/json");
  if (req.method !== "POST") {
    res.statusCode = 200;
    return res.end(JSON.stringify({ ok: true, info: "Вебхук бота «Энциклопедия хадисов». Настройка: /api/setup" }));
  }
  if (!token || req.headers["x-telegram-bot-api-secret-token"] !== webhookSecret(token)) {
    res.statusCode = 401;
    return res.end(JSON.stringify({ ok: false }));
  }
  try {
    await handleUpdate(await readBody(req), telegram(token));
  } catch (err) {
    console.error(err);
  }
  res.statusCode = 200;
  res.end(JSON.stringify({ ok: true }));
}

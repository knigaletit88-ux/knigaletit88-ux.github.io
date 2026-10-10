// Имя бота для мини-приложения: GET https://<проект>.vercel.app/api/info → {"username": "..."}
// Так приложение узнаёт, какой бот сейчас подключён, и ссылки «Поделиться» ведут на него.
import { telegram } from "../lib/bot.js";

let cached = null;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=86400");
  const token = process.env.BOT_TOKEN;
  if (!cached && token) {
    const me = await telegram(token)("getMe");
    if (me?.username) cached = { username: me.username, name: me.first_name };
  }
  res.statusCode = cached ? 200 : 503;
  res.end(JSON.stringify(cached || { ok: false }));
}

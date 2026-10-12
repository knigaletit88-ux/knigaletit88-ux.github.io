// Викторина дня: GET https://<проект>.vercel.app/api/quiz
// Вызывается по расписанию (GitHub Actions ровно в 12:00 по Москве и Vercel Cron как запасной вариант).
// Отправляет викторину один раз в день и не раньше 12:00, поэтому лишние вызовы ничего не ломают.
import { telegram } from "../lib/bot.js";
import { runDaily } from "../lib/quiz.js";

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  const token = process.env.BOT_TOKEN;
  if (!token) {
    res.statusCode = 500;
    return res.end(JSON.stringify({ status: "no-token" }));
  }
  try {
    const result = await runDaily(telegram(token));
    res.statusCode = 200;
    res.end(JSON.stringify(result));
  } catch (err) {
    console.error("Викторина:", err);
    res.statusCode = 500;
    res.end(JSON.stringify({ status: "error" }));
  }
}

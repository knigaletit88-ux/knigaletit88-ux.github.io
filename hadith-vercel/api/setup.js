// Открыть один раз после деплоя: https://<ваш-проект>.vercel.app/api/setup
// Подключает вебхук (Telegram начнёт присылать сообщения сюда) и список команд бота.
import { COMMANDS, telegram, webhookSecret } from "../lib/bot.js";

const page = (title, body) => `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f5efe3;color:#1b2822;font:16px/1.6 system-ui,sans-serif}
main{max-width:520px;margin:24px;padding:28px;border-radius:20px;background:#fffcf6;box-shadow:0 8px 30px -12px rgba(0,0,0,.3)}
h1{margin:0 0 8px;font-size:22px;color:#0f5a43}code{background:#efe6d4;padding:2px 6px;border-radius:6px}</style></head>
<body><main><h1>${title}</h1>${body}</main></body></html>`;

export default async function handler(req, res) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  const token = process.env.BOT_TOKEN;
  if (!token) {
    res.statusCode = 500;
    return res.end(page("Нет токена", "<p>Добавьте переменную <code>BOT_TOKEN</code> в настройках проекта Vercel (Settings → Environment Variables) и сделайте Redeploy.</p>"));
  }
  // Адреса отдельных сборок (…-abc123.vercel.app) закрыты защитой Vercel, и Telegram туда не попадёт,
  // поэтому вебхук всегда ставим на основной адрес проекта.
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL || req.headers["x-forwarded-host"] || req.headers.host;
  const url = `https://${host}/api/webhook`;
  const tg = telegram(token);
  const me = await tg("getMe");
  if (!me) {
    res.statusCode = 400;
    return res.end(page("Токен не подошёл", "<p>Telegram не принял токен. Проверьте <code>BOT_TOKEN</code> в настройках Vercel.</p>"));
  }
  const ok = await tg("setWebhook", {
    url,
    secret_token: webhookSecret(token),
    allowed_updates: ["message", "callback_query", "inline_query"],
    drop_pending_updates: true,
  });
  await tg("setMyCommands", { commands: COMMANDS });
  res.statusCode = ok ? 200 : 500;
  res.end(ok
    ? page("✅ Бот подключён", `<p>Бот <b>@${me.username}</b> теперь отвечает через Vercel.</p><p>Откройте Telegram и отправьте боту <code>/start</code>.</p><p style="font-size:13px;opacity:.6">Адрес вебхука: ${url}</p>`)
    : page("Не получилось", "<p>Telegram не принял адрес вебхука. Откройте эту страницу ещё раз через минуту.</p>"));
}

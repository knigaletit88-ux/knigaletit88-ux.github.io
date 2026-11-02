// Бот «Энциклопедия хадисов» на Deno Deploy (бесплатный тариф). Те же обработчики из api/, что
// работали на Vercel: req и res для них собирает lib/http.js. Главная страница — index.html.
// Раздел «Время намаза» (namaz/) встроен сюда же; его уведомления рассылает будильник ниже.
//
//   deno run -A server.js   — запустить у себя: http://localhost:8000
import card from "./api/card.js";
import channelPhoto from "./api/channel-photo.js";
import channels from "./api/channels.js";
import info from "./api/info.js";
import setup from "./api/setup.js";
import webhook from "./api/webhook.js";
import { telegram } from "./lib/bot.js";
import { runHandler } from "./lib/http.js";
import { runTick, tickSecret } from "./namaz/tick.js";

const ROUTES = {
  "/api/webhook": webhook, "/api/setup": setup, "/api/card": card,
  "/api/channels": channels, "/api/channel-photo": channelPhoto, "/api/info": info,
};

const token = process.env.BOT_TOKEN;
const namaz = token && process.env.NAMAZ_URL !== "off";
const tick = () => runTick(telegram(token), token);

// Уведомления о намазе. Будильник QStash (если задан QSTASH_TOKEN) будит бота ровно в минуту
// уведомления; Deno.cron — страховка: часто, если QStash нет, и раз в полчаса, если он есть.
if (namaz && typeof Deno.cron === "function") {
  Deno.cron("namaz-tick", process.env.QSTASH_TOKEN ? "*/30 * * * *" : "*/5 * * * *", async () => {
    console.log("Будильник намаза:", JSON.stringify(await tick()));
  });
}

async function namazTick(request) {
  if (!namaz || new URL(request.url).searchParams.get("key") !== tickSecret(token)) return new Response("Нет доступа", { status: 403 });
  return Response.json(await tick());
}

Deno.serve(async (request) => {
  const { pathname } = new URL(request.url);
  if (pathname === "/api/namaz-tick") return namazTick(request);
  const route = ROUTES[pathname.replace(/\/$/, "")];
  if (route) return runHandler(route, request);
  if (pathname === "/" || pathname === "/index.html") {
    return new Response(await Deno.readFile(new URL("./index.html", import.meta.url)),
      { headers: { "content-type": "text/html; charset=utf-8" } });
  }
  return new Response("Не найдено", { status: 404 });
});

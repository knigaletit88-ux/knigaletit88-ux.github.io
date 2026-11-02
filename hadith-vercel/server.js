// Бот «Энциклопедия хадисов» на Deno Deploy (бесплатный тариф). Те же обработчики из api/, что
// работали на Vercel: req и res для них собирает lib/http.js. Главная страница — index.html.
//
//   deno run -A server.js   — запустить у себя: http://localhost:8000
import card from "./api/card.js";
import channelPhoto from "./api/channel-photo.js";
import channels from "./api/channels.js";
import info from "./api/info.js";
import setup from "./api/setup.js";
import webhook from "./api/webhook.js";
import { runHandler } from "./lib/http.js";

const ROUTES = {
  "/api/webhook": webhook, "/api/setup": setup, "/api/card": card,
  "/api/channels": channels, "/api/channel-photo": channelPhoto, "/api/info": info,
};

Deno.serve(async (request) => {
  const { pathname } = new URL(request.url);
  const route = ROUTES[pathname.replace(/\/$/, "")];
  if (route) return runHandler(route, request);
  if (pathname === "/" || pathname === "/index.html") {
    return new Response(await Deno.readFile(new URL("./index.html", import.meta.url)),
      { headers: { "content-type": "text/html; charset=utf-8" } });
  }
  return new Response("Не найдено", { status: 404 });
});

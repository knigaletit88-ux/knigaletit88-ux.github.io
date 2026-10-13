// Аватарка из списков «Полезные каналы» (?c=<key>) и «Полезные боты» (?b=<key>).
// Картинку отдаёт Telegram по токену бота, поэтому она проходит через сервер (токен наружу не попадает).
import { telegram } from "../lib/bot.js";
import { getBots, getChannels } from "../lib/store.js";

// Маленькая аватарка: у канала — chat.photo, у бота — первое фото профиля (нужен его ID из пересланного сообщения)
async function photoFileId(tg, item, isBot) {
  if (isBot) {
    if (!item.userId) return null;
    const photos = await tg("getUserProfilePhotos", { user_id: item.userId, limit: 1 });
    const sizes = photos?.photos?.[0] || [];
    return (sizes.find((p) => p.width >= 160) || sizes.at(-1))?.file_id || null;
  }
  const chat = await tg("getChat", { chat_id: item.username ? "@" + item.username : item.chatId });
  return chat?.photo?.small_file_id || null;
}

export default async function handler(req, res) {
  const token = process.env.BOT_TOKEN;
  const params = new URL(req.url, "https://localhost").searchParams;
  const isBot = params.has("b");
  const key = params.get(isBot ? "b" : "c");
  const notFound = () => { res.statusCode = 404; res.setHeader("Cache-Control", "public, s-maxage=3600"); res.end(); };
  try {
    const item = token && key && (await (isBot ? getBots() : getChannels())).find((c) => c.key === key);
    if (!item) return notFound();
    const tg = telegram(token);
    const fileId = await photoFileId(tg, item, isBot);
    const file = fileId && (await tg("getFile", { file_id: fileId }));
    if (!file?.file_path) return notFound();
    const img = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`);
    if (!img.ok) return notFound();
    res.statusCode = 200;
    res.setHeader("Content-Type", img.headers.get("content-type")?.startsWith("image/") ? img.headers.get("content-type") : "image/jpeg");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800");
    res.end(Buffer.from(await img.arrayBuffer()));
  } catch (err) {
    console.error(err);
    res.statusCode = 502;
    res.end();
  }
}

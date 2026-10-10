// Аватарка канала из списка «Полезные каналы»: /api/channel-photo?c=<key>
// Картинку отдаёт Telegram по токену бота, поэтому она проходит через сервер (токен наружу не попадает).
import { telegram } from "../lib/bot.js";
import { getChannels } from "../lib/store.js";

export default async function handler(req, res) {
  const token = process.env.BOT_TOKEN;
  const key = new URL(req.url, "https://localhost").searchParams.get("c");
  const notFound = () => { res.statusCode = 404; res.setHeader("Cache-Control", "public, s-maxage=3600"); res.end(); };
  try {
    const channel = token && key && (await getChannels()).find((c) => c.key === key);
    if (!channel) return notFound();
    const tg = telegram(token);
    const chat = await tg("getChat", { chat_id: channel.username ? "@" + channel.username : channel.chatId });
    const file = chat?.photo && (await tg("getFile", { file_id: chat.photo.small_file_id }));
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

// Список «Полезные каналы» для мини-приложения: GET https://<проект>.vercel.app/api/channels
import { getChannels } from "../lib/store.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  try {
    const channels = (await getChannels()).map((c) => ({
      key: c.key,
      title: c.title,
      description: c.description || "",
      url: c.url,
      username: c.username || null,
      photo: c.photo ? `https://${host}/api/channel-photo?c=${encodeURIComponent(c.key)}` : null,
    }));
    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=3600");
    res.statusCode = 200;
    res.end(JSON.stringify({ channels }));
  } catch (err) {
    console.error(err);
    res.setHeader("Cache-Control", "no-store");
    res.statusCode = 503;
    res.end(JSON.stringify({ channels: [], error: "storage" }));
  }
}

// Списки «Полезные каналы» и «Полезные боты» для мини-приложения: GET https://<проект>.vercel.app/api/channels
import { getBots, getChannels } from "../lib/store.js";

const view = (host, type) => (c) => ({
  key: c.key,
  title: c.title,
  description: c.description || "",
  url: c.url,
  username: c.username || null,
  photo: c.photo ? `https://${host}/api/channel-photo?${type}=${encodeURIComponent(c.key)}` : null,
});

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  try {
    const [channels, bots] = await Promise.all([getChannels(), getBots()]);
    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=3600");
    res.statusCode = 200;
    res.end(JSON.stringify({ channels: channels.map(view(host, "c")), bots: bots.map(view(host, "b")) }));
  } catch (err) {
    console.error(err);
    res.setHeader("Cache-Control", "no-store");
    res.statusCode = 503;
    res.end(JSON.stringify({ channels: [], bots: [], error: "storage" }));
  }
}

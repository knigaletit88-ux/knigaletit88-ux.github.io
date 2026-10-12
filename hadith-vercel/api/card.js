// Сохранение карточки из мини-приложения. В Telegram ссылки «скачать» не работают, поэтому:
// POST /api/card?id=2962&lang=ru (картинка, заголовок X-Init-Data) — бот присылает карточку файлом
//   в чат этому пользователю и возвращает ссылку, по которой Telegram.WebApp.downloadFile её скачает;
// GET  /api/card?f=…&n=…&s=… — отдаёт этот файл (ссылка подписана, чужие файлы бота по ней не получить).
import { createHmac } from "node:crypto";
import { telegram } from "../lib/bot.js";
import { checkInitData } from "../lib/webapp.js";

const MAX = 4_400_000; // предел Vercel для тела запроса — 4,5 МБ
const sign = (token, f, n) => createHmac("sha256", `card:${token}`).update(`${f}:${n}`).digest("hex").slice(0, 24);
const typeOf = (buf) => (buf[0] === 0x89 && buf[1] === 0x50 ? "png" : buf[0] === 0xff && buf[1] === 0xd8 ? "jpg" : null);

async function readBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX) throw Object.assign(new Error("too-big"), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Init-Data");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  const token = process.env.BOT_TOKEN;
  if (!token) return json(res, 500, { ok: false, error: "no-token" });
  const url = new URL(req.url, "https://localhost");
  const q = (k) => url.searchParams.get(k) || "";

  if (req.method === "GET") {
    const [f, n, s] = [q("f"), q("n"), q("s")];
    if (!f || !/^hadith-\d{1,9}\.(png|jpg)$/.test(n) || s !== sign(token, f, n)) return json(res, 403, { ok: false });
    const file = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(f)}`).then((r) => r.json()).catch(() => null);
    const data = file?.ok && (await fetch(`https://api.telegram.org/file/bot${token}/${file.result.file_path}`).catch(() => null));
    if (!data?.ok) return json(res, 404, { ok: false });
    res.statusCode = 200;
    res.setHeader("Content-Type", n.endsWith(".png") ? "image/png" : "image/jpeg");
    res.setHeader("Content-Disposition", `attachment; filename="${n}"`);
    res.setHeader("Cache-Control", "private, max-age=3600");
    return res.end(Buffer.from(await data.arrayBuffer()));
  }
  if (req.method !== "POST") return json(res, 405, { ok: false });

  const user = checkInitData(req.headers["x-init-data"], token);
  if (!user) return json(res, 401, { ok: false, error: "auth" });
  const id = q("id");
  const lang = /^[a-z]{2,4}$/.test(q("lang")) ? q("lang") : "ru";
  if (!/^\d{1,9}$/.test(id)) return json(res, 400, { ok: false, error: "id" });
  let buf;
  try {
    buf = await readBody(req);
  } catch (err) {
    return json(res, err.status || 400, { ok: false, error: "body" });
  }
  const ext = buf.length <= MAX && typeOf(buf);
  if (!ext) return json(res, 400, { ok: false, error: "image" });

  const name = `hadith-${id}.${ext}`;
  const bot = process.env.BOT_USERNAME || (await telegram(token)("getMe"))?.username;
  const form = new FormData();
  form.append("chat_id", String(user.id));
  form.append("document", new Blob([buf], { type: ext === "png" ? "image/png" : "image/jpeg" }), name);
  form.append("caption", `🎨 Карточка хадиса №${id}\n\nЧтобы сохранить в галерею: откройте картинку → ⋮ → «Сохранить в галерею».${bot ? `\n\nhttps://t.me/${bot}?startapp=h${id}_${lang}` : ""}`);
  const sent = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, { method: "POST", body: form })
    .then((r) => r.json()).catch(() => ({}));
  if (!sent.ok) {
    console.error("Карточка:", sent.description);
    // 403 — человек ещё не запускал бота, писать ему бот не может
    return json(res, 502, { ok: false, error: sent.error_code === 403 ? "chat" : "send" });
  }
  const f = sent.result.document?.file_id;
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return json(res, 200, {
    ok: true,
    name,
    url: f ? `https://${host}/api/card?f=${encodeURIComponent(f)}&n=${name}&s=${sign(token, f, name)}` : null,
  });
}

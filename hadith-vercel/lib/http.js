// Обработчики в api/ написаны для Vercel: handler(req, res). Здесь они запускаются на Deno Deploy —
// из запроса собираются req и res с теми же полями и методами, а ответ превращается в Response.
import { Buffer } from "node:buffer";

export async function runHandler(handler, request) {
  const url = new URL(request.url);
  const headers = Object.fromEntries(request.headers); // имена заголовков уже строчными буквами
  const raw = Buffer.from(await request.arrayBuffer());
  const type = headers["content-type"] || "";
  // тело — как у Vercel: JSON разобран, текст строкой, остальное — Buffer
  let body = raw.length ? raw : undefined;
  if (raw.length && type.includes("json")) {
    try { body = JSON.parse(raw.toString("utf8")); } catch { body = raw.toString("utf8"); }
  } else if (raw.length && type.startsWith("text/")) {
    body = raw.toString("utf8");
  }
  const req = {
    method: request.method, url: url.pathname + url.search, headers, body,
    query: Object.fromEntries(url.searchParams),
    async *[Symbol.asyncIterator]() { if (raw.length) yield raw; },
  };

  const out = { status: 200, headers: new Headers(), body: null };
  const res = {
    get statusCode() { return out.status; },
    set statusCode(code) { out.status = code; },
    setHeader(name, value) { out.headers.set(name, String(value)); return res; },
    getHeader: (name) => out.headers.get(name),
    status(code) { out.status = code; return res; },
    json(value) {
      if (!out.headers.has("content-type")) out.headers.set("content-type", "application/json; charset=utf-8");
      return res.end(JSON.stringify(value));
    },
    send: (value) => (typeof value === "object" && !Buffer.isBuffer(value) ? res.json(value) : res.end(value)),
    end(chunk) { if (chunk !== undefined) out.body = chunk; return res; },
  };

  try {
    await handler(req, res);
  } catch (error) {
    console.error(url.pathname, error);
    return Response.json({ ok: false, error: "server" }, { status: 500 });
  }
  const empty = out.status === 204 || out.status === 304 || out.body === null;
  return new Response(empty ? null : out.body, { status: out.status, headers: out.headers });
}

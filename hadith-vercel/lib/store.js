// Хранилище списка «Полезные каналы»: Upstash Redis (Vercel → Storage → Upstash for Redis).
// При подключении Vercel сам добавляет переменные KV_REST_API_URL и KV_REST_API_TOKEN
// (или UPSTASH_REDIS_REST_URL и UPSTASH_REDIS_REST_TOKEN — подходят оба варианта, в том числе с приставкой).

const CHANNELS = "hadith:channels";
const BOTS = "hadith:bots";
const PENDING = (adminId) => `hadith:pending:${adminId}`;

function redisEnv(env = process.env) {
  const names = ["KV_REST_API_URL", "UPSTASH_REDIS_REST_URL", ...Object.keys(env).sort()];
  for (const name of names) {
    if (!/(_REST_API_URL|REDIS_REST_URL)$/.test(name) || !/^https:\/\//.test(env[name] || "")) continue;
    const token = env[name.replace(/_URL$/, "_TOKEN")];
    if (token) return { url: env[name].replace(/\/+$/, ""), token };
  }
  return null;
}

export const hasStore = () => Boolean(redisEnv());

async function redis(...command) {
  const env = redisEnv();
  if (!env) throw new Error("Хранилище не подключено");
  const res = await fetch(env.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(`Redis ${command[0]}: ${data.error || res.status}`);
  return data.result;
}

// Несколько команд одним запросом: [[команда, …], …] → [результат, …]
async function pipeline(commands) {
  const env = redisEnv();
  if (!env) throw new Error("Хранилище не подключено");
  const res = await fetch(`${env.url}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(commands),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !Array.isArray(data)) throw new Error(`Redis pipeline: ${res.status}`);
  return data.map((item, i) => {
    if (item.error) throw new Error(`Redis ${commands[i][0]}: ${item.error}`);
    return item.result;
  });
}

const parse = (raw, fallback) => { try { return JSON.parse(raw) ?? fallback; } catch { return fallback; } };

// ---------------------------------------------------- учёт пользователей (админка → «Пользователи»)
// Два набора «ID → время»: когда человек написал боту впервые и когда — в последний раз.
// Считаются только личные чаты; тех, кто пользовался ботом до появления учёта, он увидит при их следующем сообщении.
const JOINED = "hadith:joined";
const SEEN = "hadith:seen";
const DAY = 86400;

// Не бросает ошибок: сбой учёта не должен мешать боту отвечать
export function trackUser(userId, now = Date.now()) {
  if (!hasStore() || !userId) return Promise.resolve();
  const ts = Math.floor(now / 1000);
  return pipeline([["ZADD", JOINED, "NX", ts, String(userId)], ["ZADD", SEEN, ts, String(userId)]])
    .catch((err) => console.error("Учёт пользователей:", err.message));
}

export async function userStats(now = Date.now()) {
  const ts = Math.floor(now / 1000);
  const since = (days) => ts - days * DAY;
  const [total, new1, new7, active1, active7, active30, namaz, first] = await pipeline([
    ["ZCARD", JOINED],
    ["ZCOUNT", JOINED, since(1), "+inf"],
    ["ZCOUNT", JOINED, since(7), "+inf"],
    ["ZCOUNT", SEEN, since(1), "+inf"],
    ["ZCOUNT", SEEN, since(7), "+inf"],
    ["ZCOUNT", SEEN, since(30), "+inf"],
    ["SCARD", "namaz:users"], // раздел «Время намаза» ведёт этот список сам: те, кто указал город
    ["ZRANGE", JOINED, 0, 0, "WITHSCORES"],
  ]);
  return { total, new1, new7, active1, active7, active30, namaz, since: first?.[1] ? Number(first[1]) * 1000 : null };
}

// Для рассылки: ID пользователей по порядку прихода (новые добавляются в конец, поэтому
// рассылку можно продолжать с того же места) и их число
export const userIds = async (start, stop) => (await redis("ZRANGE", JOINED, start, stop)) || [];
export const usersCount = async () => Number(await redis("ZCARD", JOINED)) || 0;

// Небольшие записи со сроком жизни (черновик рассылки, её ход) и замок «уже идёт»
export const getJSON = async (key) => parse(await redis("GET", key), null);
export const setJSON = (key, value, ttl) => redis("SET", key, JSON.stringify(value), "EX", String(ttl));
export const delKeys = (...keys) => redis("DEL", ...keys);
export const takeLock = async (key, ttl) => (await redis("SET", key, "1", "NX", "EX", String(ttl))) === "OK";

// Раздел «Время намаза» (lib/namaz.js) хранит свои данные в этой же базе под ключами namaz:…
// Отсюда они только читаются: ждёт ли бот от человека название города и настроен ли у него намаз.
export async function namazContext(chatId, userId) {
  if (!hasStore()) return { waitingCity: false, known: false };
  const [state, user] = (await redis("MGET", `namaz:fsm:s:${chatId}:${userId}`, `namaz:user:${userId}`)) || [];
  return { waitingCity: state === "Place:waiting", known: Boolean(user) };
}

async function getList(key) {
  if (!hasStore()) return [];
  const list = parse(await redis("GET", key), []);
  return Array.isArray(list) ? list : [];
}

// Полезные каналы: [{key, title, description, url, username?, chatId?, photo, added}]
export const getChannels = () => getList(CHANNELS);
export const saveChannels = (list) => redis("SET", CHANNELS, JSON.stringify(list));

// Полезные боты: [{key, title, description, url, username, userId?, photo, added}]
export const getBots = () => getList(BOTS);
export const saveBots = (list) => redis("SET", BOTS, JSON.stringify(list));

// Канал, который админ прислал, но ещё не подтвердил кнопкой «Добавить» (хранится час)
export const setPending = (adminId, channel) => redis("SET", PENDING(adminId), JSON.stringify(channel), "EX", "3600");
export const getPending = async (adminId) => parse(await redis("GET", PENDING(adminId)), null);
export const clearPending = (adminId) => redis("DEL", PENDING(adminId));

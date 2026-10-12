// Хранилище списка «Полезные каналы»: Upstash Redis (Vercel → Storage → Upstash for Redis).
// При подключении Vercel сам добавляет переменные KV_REST_API_URL и KV_REST_API_TOKEN
// (или UPSTASH_REDIS_REST_URL и UPSTASH_REDIS_REST_TOKEN — подходят оба варианта, в том числе с приставкой).

const CHANNELS = "hadith:channels";
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

// Раздел «Время намаза» (lib/namaz.js) хранит свои данные в этой же базе под ключами namaz:…
// Отсюда они только читаются: ждёт ли бот от человека название города и настроен ли у него намаз.
export async function namazContext(chatId, userId) {
  if (!hasStore()) return { waitingCity: false, known: false };
  const [state, user] = (await redis("MGET", `namaz:fsm:s:${chatId}:${userId}`, `namaz:user:${userId}`)) || [];
  return { waitingCity: state === "Place:waiting", known: Boolean(user) };
}

// [{key, title, description, url, username?, chatId?, photo, added}]
export async function getChannels() {
  if (!hasStore()) return [];
  const list = parse(await redis("GET", CHANNELS), []);
  return Array.isArray(list) ? list : [];
}

export const saveChannels = (list) => redis("SET", CHANNELS, JSON.stringify(list));

// Канал, который админ прислал, но ещё не подтвердил кнопкой «Добавить» (хранится час)
export const setPending = (adminId, channel) => redis("SET", PENDING(adminId), JSON.stringify(channel), "EX", "3600");
export const getPending = async (adminId) => parse(await redis("GET", PENDING(adminId)), null);
export const clearPending = (adminId) => redis("DEL", PENDING(adminId));

// Простые команды Redis для викторины: подписчики, каналы, «сегодня уже отправлено»
export const kv = {
  get: async (key) => parse(await redis("GET", key), null),
  // Записать, только если ключа ещё нет; true — записали
  add: async (key, value, ttl) => (await redis("SET", key, JSON.stringify(value), "NX", "EX", String(ttl))) === "OK",
  del: (key) => redis("DEL", key),
  sadd: (key, member) => redis("SADD", key, String(member)),
  srem: (key, member) => redis("SREM", key, String(member)),
  sismember: async (key, member) => Number(await redis("SISMEMBER", key, String(member))) === 1,
  smembers: async (key) => (await redis("SMEMBERS", key)) || [],
  scard: async (key) => Number(await redis("SCARD", key)) || 0,
  hset: (key, field, value) => redis("HSET", key, String(field), JSON.stringify(value)),
  hdel: (key, field) => redis("HDEL", key, String(field)),
  hgetall: async (key) => {
    const flat = (await redis("HGETALL", key)) || [];
    const out = {};
    for (let i = 0; i < flat.length; i += 2) out[flat[i]] = parse(flat[i + 1], {});
    return out;
  },
};

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

const parse = (raw, fallback) => { try { return JSON.parse(raw) ?? fallback; } catch { return fallback; } };

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

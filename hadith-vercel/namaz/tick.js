// Уведомления о намазе (перенос namaz/notifier.py и «будильника» из namaz/cloud.py).
//
// runTick() рассылает всё, что наступило с прошлого срабатывания, и называет минуту следующего.
// Его вызывают:
//   • Deno.cron в server.js — раз в несколько минут, всегда (страховка);
//   • QStash (Upstash), если в настройках есть QSTASH_TOKEN, — ровно в минуту ближайшего уведомления,
//     как раньше очередь Vercel. Каждое срабатывание заводит следующее.
import { createHash } from "node:crypto";
import { redis } from "../lib/store.js";
import { dueEvents, nextEventTime } from "./events.js";
import { isReady } from "./models.js";
import { P, Store } from "./store.js";
import { fromWall } from "./time.js";

const MINUTE = 60_000;
const MAX_LATE = 10 * MINUTE; // после простоя более старые уведомления не досылаются
const HEARTBEAT = 15 * MINUTE; // даже без уведомлений будильник срабатывает не реже

const floorMinute = (ms) => Math.floor(ms / MINUTE) * MINUTE;
// В формате Python-версии (datetime.isoformat()), чтобы обе версии читали ключ одинаково
const iso = (ms) => new Date(ms).toISOString().replace(".000Z", "+00:00");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Пароль адреса будильника: выводится из токена бота, как остальные секреты. */
export const tickSecret = (token) => createHash("sha256").update(`namaz-tick:${token}`).digest("hex").slice(0, 40);

async function send(tg, store, user, text) {
  let res = await tg.raw("sendMessage", { chat_id: user.id, text, parse_mode: "HTML" });
  if (res.error_code === 429) {
    await pause(((res.parameters?.retry_after || 1) + 1) * 1000);
    res = await tg.raw("sendMessage", { chat_id: user.id, text, parse_mode: "HTML" });
  }
  if (res.error_code === 403) {
    // пользователь заблокировал бота — больше не пишем, пока он сам не вернётся
    user.active = false;
    store.save(user);
  } else if (!res.ok) {
    console.error("Уведомление", user.id, res.description);
  }
}

async function notify(tg, store, after, until) {
  let sent = 0;
  for (const user of store.users.values()) {
    if (!user.active || !isReady(user.s)) continue;
    let events;
    try {
      events = dueEvents(user, after, until);
    } catch (err) {
      console.error("Расчёт уведомлений для", user.id, err);
      continue;
    }
    for (const e of events) {
      await send(tg, store, user, e.text);
      sent += 1;
      await pause(40); // лимит Telegram — около 30 сообщений в секунду
    }
  }
  return sent;
}

/** Одно срабатывание: разослать наступившее и завести следующее. → { sent, next } (next — мс UTC). */
export async function runTick(tg, token, now = Date.now()) {
  now = floorMinute(now);
  let next = now + MINUTE; // если ниже что-то сорвётся — повторим через минуту
  let sent = 0;
  try {
    // SET … GET атомарно забирает интервал: повторное срабатывание в ту же минуту ничего не разошлёт
    const prev = await redis("SET", `${P}last_tick`, iso(now), "GET");
    const last = prev ? Math.max(Date.parse(prev), now - MAX_LATE) : now - MINUTE;
    const store = new Store();
    await store.loadAll();
    if (now > last) {
      sent = await notify(tg, store, last, now);
      await store.flush();
    }
    next = now + HEARTBEAT;
    for (const user of store.users.values()) {
      if (!user.active || !isReady(user.s)) continue;
      const wall = nextEventTime(user, now);
      if (wall !== null) next = Math.min(next, floorMinute(fromWall(user.s.tz, wall)));
    }
  } finally {
    await scheduleTick(next, token).catch((err) => console.error("Будильник:", err.message));
  }
  return { sent, next };
}

/** Завести срабатывание QStash на минуту at (мс UTC). Без QSTASH_TOKEN — ничего: хватает Deno.cron. */
export async function scheduleTick(at, token) {
  const qstash = process.env.QSTASH_TOKEN;
  const host = process.env.APP_HOST;
  if (!qstash || !host || !token) return false;
  const target = `https://${host}/api/namaz-tick?key=${tickSecret(token)}`;
  const res = await fetch(`${process.env.QSTASH_URL || "https://qstash.upstash.io"}/v2/publish/${target}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${qstash}`,
      "Upstash-Not-Before": String(Math.ceil(at / 1000) + 1),
      // одна заявка на минуту: повторные QStash отбрасывает сам
      "Upstash-Deduplication-Id": `namaz-tick-${Math.floor(at / MINUTE)}`,
      "Upstash-Retries": "2",
    },
  });
  if (!res.ok) throw new Error(`QStash ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return true;
}

/** Будильник ещё жив? Если молчит дольше 20 минут — заводит заново (вызывается из Deno.cron). */
export async function keepAlive(token) {
  const last = await redis("GET", `${P}last_tick`);
  const stale = !last || Date.now() - Date.parse(last) > 20 * MINUTE;
  if (stale) await scheduleTick(floorMinute(Date.now()), token).catch((err) => console.error("Будильник:", err.message));
  return stale;
}

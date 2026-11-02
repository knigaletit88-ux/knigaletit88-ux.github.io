// «Время намаза» — второй раздел бота. Здесь решается, какие сообщения относятся к намазу; их
// обрабатывает раздел из папки namaz/ (перенос Python-проекта namaz-bot, который жил на Vercel),
// всё остальное — бот хадисов.
import { createHash } from "node:crypto";
import { handleNamaz } from "../namaz/bot.js";
import { scheduleTick } from "../namaz/tick.js";
import { namazContext } from "./store.js";

// По умолчанию раздел встроен в этого бота. NAMAZ_URL=https://… — передавать обновления отдельному
// серверу раздела (так было на Vercel), NAMAZ_URL=off — отключить раздел целиком.
export const NAMAZ_URL = (process.env.NAMAZ_URL ?? "").replace(/\/+$/, "");
export const namazEnabled = () => NAMAZ_URL !== "off";

export const NAMAZ_BUTTON = { text: "🕌 Время намаза", callback_data: "nz:menu" };
export const HADITH_BUTTON = "📖 Хадисы"; // кнопка в меню намаза: вернуться к хадисам
export const NAMAZ_DOWN = "⚠️ Раздел «Время намаза» сейчас недоступен. Попробуйте, пожалуйста, чуть позже.";

// То, что раздел намаза считает своим (должно совпадать с namaz/bot.js и namaz/keyboards.js)
const CALLBACKS = /^(nz|day|ml|mo|mf|n|s|c|place):/;
const COMMANDS = new Set(["namaz", "tomorrow", "month", "calc", "notify", "calendar", "settings"]);
const MENU = new Set(["🕌 Сегодня", "🌄 Завтра", "🗓 Месяц", "🧮 Калькулятор", "🔔 Уведомления", "⚙️ Настройки", "📷 Мой календарь"]);
const DATE = /^\s*\d{1,2}[./-]\d{1,2}([./-]\d{2,4})?\s*$/; // 25.12.2026 — времена намаза на дату
const TWO_TIMES = /^\s*\d{1,2}[:.]\d{2}\s*([-–—,;]|\s)\s*\d{1,2}[:.]\d{2}\s*$/; // 16:43 03:50 — середина и трети ночи
const TIME = /(?<![\d:])([01]?\d|2[0-3])\s?:\s?[0-5]\d(?![\d:])/g;
const looksLikeTimetable = (text) => text.split("\n").filter((line) => (line.match(TIME) || []).length >= 3).length >= 5;

// Относится ли обновление к намазу. Только личный чат: в группах раздел намаза не работает.
export async function isNamaz(update) {
  if (!namazEnabled()) return false;
  const cq = update.callback_query;
  if (cq) return cq.message?.chat?.type === "private" && CALLBACKS.test(cq.data || "");
  const msg = update.message;
  if (!msg || msg.chat?.type !== "private") return false;

  const text = (msg.text || "").trim();
  if (text.startsWith("/")) return COMMANDS.has(text.slice(1).split(/[\s@]/)[0].toLowerCase());
  if (MENU.has(text) || msg.location) return true;

  // Дальше — обычный текст и картинки: для хадисов это поиск, поэтому намазу они уходят,
  // только если человек им уже пользуется или бот прямо сейчас ждёт от него название города.
  const image = Boolean(msg.photo || /^image\//.test(msg.document?.mime_type || ""));
  if (!text && !image) return false;
  const { waitingCity, known } = await namazContext(msg.chat.id, msg.from?.id).catch(() => ({}));
  if (waitingCity) return Boolean(text);
  if (!known) return false;
  return image || DATE.test(text) || TWO_TIMES.test(text) || looksLikeTimetable(text);
}

// Секрет, по которому отдельный сервер раздела узнаёт своего: тот же расчёт, что в namaz/cloud.py (secret("webhook"))
export const namazSecret = (token) => createHash("sha256").update(`webhook:${token}`).digest("hex").slice(0, 40);

/** Обновление — разделу намаза: встроенному или (NAMAZ_URL) отдельному серверу. */
export async function toNamaz(update, tg, token) {
  if (/^https:\/\//.test(NAMAZ_URL)) return forwardToNamaz(update, token);
  // Настройки изменились — ближайшее уведомление могло стать другим: пусть будильник пересчитает.
  if (await handleNamaz(update, tg, token)) await scheduleTick(Date.now() + 60_000, token).catch(() => {});
}

export async function forwardToNamaz(update, token) {
  const res = await fetch(`${NAMAZ_URL}/api/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": namazSecret(token) },
    body: JSON.stringify(update),
    signal: AbortSignal.timeout(55_000),
  });
  if (!res.ok) throw new Error(`Раздел намаза ответил ${res.status}`);
}

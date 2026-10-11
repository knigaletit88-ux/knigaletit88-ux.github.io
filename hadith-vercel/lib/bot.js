// Логика бота: отвечает на сообщения, кнопки и inline-запросы.
import { createHash } from "node:crypto";
import { adminCallback, adminCommand, adminMessage, channelRef, isAdmin, sendChannels } from "./channels.js";
import { dailyId, getArabic, getHadith, neighbors, randomId, search, splitIntro } from "./hadith.js";
import { parts, snippet } from "./search.js";
import { getChannels } from "./store.js";

export const APP_URL = process.env.APP_URL || "https://knigaletit88-ux.github.io/hadith/";
const SITE = (id) => `https://sarhaan.com/hadeeth/ru/${id}/`;
const LIMIT = 4000;

export function telegram(token) {
  return async (method, params = {}) => {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) console.error(`Telegram ${method}:`, data.description || res.status);
    return data.result;
  };
}

// Секрет для заголовка X-Telegram-Bot-Api-Secret-Token: так бот принимает запросы только от Telegram
export const webhookSecret = (token) => createHash("sha256").update(`hadith:${token}`).digest("hex").slice(0, 48);

const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
const shorten = (s, n) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s; };

export function splitText(text, limit = LIMIT) {
  const parts = [];
  let rest = text.trim();
  while (rest.length > limit) {
    let cut = -1;
    for (const sep of ["\n\n", "\n", " "]) {
      cut = rest.lastIndexOf(sep, limit);
      if (cut > limit / 3) break;
    }
    if (cut <= 0) cut = limit;
    parts.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) parts.push(rest);
  return parts;
}

// В личном чате кнопка открывает мини-приложение сразу, в группах — через ссылку на бота
function appButton(text, start, ctx) {
  const url = start ? `${APP_URL}?startapp=${start}` : APP_URL;
  if (ctx.private) return { text, web_app: { url } };
  return { text, url: `https://t.me/${ctx.username}?startapp${start ? "=" + start : ""}` };
}

const shareUrl = (url, text) => `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;

// ------------------------------------------------------------------ тексты

const GREETING = (name) => `<b>السلام عليكم ورحمة الله وبركاته</b>

Ас-саляму алейкум ва рахматуллахи ва баракятух${name ? `, ${esc(name)}` : ""}! 🌿

Добро пожаловать в <b>«Энциклопедию хадисов Пророка ﷺ»</b>:
📖 хадисы с разъяснениями и полезными выводами
🌍 переводы на 72 языка
🔍 поиск по словам и номеру хадиса
🎨 карточки с хадисами, которыми можно делиться

Нажмите <b>«Открыть энциклопедию»</b> или просто напишите мне слово — например, <i>намерение</i>, <i>родители</i>, <i>молитва</i> — или номер хадиса.

💚 <i>Указавший на благое получает такую же награду, как и совершивший его.</i>`;

const HELP = `<b>Как пользоваться</b>

📖 Кнопка «Открыть» внизу — вся энциклопедия: разделы, поиск, разъяснения, карточки, 72 языка
🔍 Напишите слово или фразу — я найду хадисы (слово ищется с любыми окончаниями: <i>мать</i> — <i>матери</i>, <i>матерью</i>)
🔢 Напишите номер, например <code>2962</code>, — пришлю хадис
⬅️ ➡️ Под хадисом — листать хадисы по порядку, 🕌 «Оригинал» — текст на арабском
🌅 /today — хадис дня
🎲 /random — случайный хадис
📢 /channels — полезные каналы
📤 В любом чате напишите <code>@{bot} слово</code>, чтобы отправить хадис другу`;

function hadithMessage(h, title) {
  const [intro, matn] = splitIntro(h);
  const parts = [title || `📜 <b>Хадис №${esc(h.id)}</b>`];
  parts.push((intro ? `<i>${esc(intro)}</i>\n` : "") + esc(matn));
  const meta = [];
  if (h.attribution) meta.push(`📚 ${esc(h.attribution)}`);
  if (h.grade) meta.push(`✅ ${esc(h.grade)}`);
  if (meta.length) parts.push(meta.join("\n"));
  return parts.join("\n\n");
}

function hadithKeyboard(h, ctx, near) {
  const share = { text: "📤 Поделиться", switch_inline_query: String(h.id) };
  return {
    inline_keyboard: [
      [appButton("📖 Разъяснение и польза", `h${h.id}_ru`, ctx)],
      [{ text: "🕌 Оригинал", callback_data: `ar:${h.id}` }, appButton("🎨 Карточка", `c${h.id}_ru`, ctx)],
      near
        ? [{ text: "⬅️ Пред.", callback_data: `go:${near.prev}` }, share, { text: "След. ➡️", callback_data: `go:${near.next}` }]
        : [share],
      [{ text: "🎲 Случайный", callback_data: "rnd" }, { text: "🌐 На сайте", url: SITE(h.id) }],
    ],
  };
}

// Запрос для мини-приложения: ?startapp=q<base64url> (Telegram пропускает до 64 знаков)
function searchParam(query) {
  const encoded = Buffer.from(query.trim(), "utf8").toString("base64url");
  return encoded.length <= 63 ? `q${encoded}` : "";
}

// ---------------------------------------------------------------- действия

async function sendHadith(tg, chatId, id, ctx, title) {
  const h = await getHadith(id);
  if (!h) {
    await tg("sendMessage", { chat_id: chatId, text: `😔 Хадис №${esc(id)} не найден. Проверьте номер или поищите по словам.`, parse_mode: "HTML" });
    return;
  }
  const chunks = splitText(hadithMessage(h, title));
  const keyboard = hadithKeyboard(h, ctx, await neighbors(h.id).catch(() => null));
  for (const [i, chunk] of chunks.entries()) {
    await tg("sendMessage", {
      chat_id: chatId,
      text: chunk,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      ...(i === chunks.length - 1 ? { reply_markup: keyboard } : {}),
    });
  }
}

// «Пред.» / «След.»: если хадис помещается в одно сообщение — меняем текущее, иначе присылаем новое
async function showNeighbor(tg, cq, id, ctx) {
  const msg = cq.message;
  const h = await getHadith(id);
  const text = h && hadithMessage(h);
  if (text && text.length <= LIMIT && /^(📜 Хадис №|🌅 Хадис дня)/.test(msg.text || "")) {
    const done = await tg("editMessageText", {
      chat_id: msg.chat.id,
      message_id: msg.message_id,
      text,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: hadithKeyboard(h, ctx, await neighbors(h.id).catch(() => null)),
    });
    if (done) return;
  }
  return sendHadith(tg, msg.chat.id, id, ctx);
}

// «Оригинал»: арабский текст хадиса ответом на сообщение с переводом
async function sendArabic(tg, chatId, id, replyTo) {
  const ar = await getArabic(id);
  const reply = replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {};
  if (!ar?.text) return tg("sendMessage", { chat_id: chatId, text: `😔 Оригинальный текст хадиса №${id} не найден.`, ...reply });
  const meta = [ar.attribution && `📚 ${esc(ar.attribution)}`, ar.grade && `✅ ${esc(ar.grade)}`].filter(Boolean).join("\n");
  const chunks = splitText(`🕌 <b>Хадис №${esc(id)} — оригинал</b>\n\n${esc(ar.text)}${meta ? `\n\n${meta}` : ""}`);
  const source = ar.reference ? `<blockquote expandable>📕 ${esc(ar.reference)}</blockquote>` : "";
  if (source && chunks.at(-1).length + source.length + 2 <= LIMIT) chunks[chunks.length - 1] += `\n\n${source}`;
  else if (source) chunks.push(source);
  for (const [i, chunk] of chunks.entries()) {
    await tg("sendMessage", { chat_id: chatId, text: chunk, parse_mode: "HTML", ...(i ? {} : reply) });
  }
}

async function sendGreeting(tg, msg, ctx) {
  const channels = await getChannels().catch(() => []);
  const share = shareUrl(`https://t.me/${ctx.username}`, "🌿 Энциклопедия хадисов Пророка ﷺ: хадисы с разъяснениями и полезными выводами на 72 языках.");
  await tg("sendMessage", {
    chat_id: msg.chat.id,
    text: GREETING(msg.from?.first_name),
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [appButton("📖 Открыть энциклопедию", "", ctx)],
        [{ text: "🌅 Хадис дня", callback_data: "day" }, { text: "🎲 Случайный", callback_data: "rnd" }],
        ...(channels.length ? [[{ text: "📢 Полезные каналы", callback_data: "channels" }]] : []),
        [{ text: "💚 Поделиться ботом", url: share }],
      ],
    },
  });
}

async function sendSearch(tg, chatId, query, ctx) {
  const { total, items, query: q } = await search(query, 10);
  if (!total) {
    await tg("sendMessage", {
      chat_id: chatId,
      parse_mode: "HTML",
      text: `😔 По запросу «${esc(shorten(query, 60))}» ничего не нашлось.\n\nПроверьте написание или попробуйте другое слово — например, <i>молитва</i>, <i>родители</i>, <i>терпение</i>.`,
    });
    return;
  }
  // Показываем то место, где нашлось слово, и выделяем его
  const lines = items.map((r, i) => {
    const place = r.inTitle ? r.title : r.inText ? r.text : `${r.intro} ${r.text}`;
    const text = parts(snippet(place, q, 170), q).map(([part, hit]) => (hit ? `<b>${esc(part)}</b>` : esc(part))).join("");
    return `<b>${i + 1}.</b> ${text} <i>(№${r.id})</i>`;
  });
  const buttons = items.map((r, i) => ({ text: String(i + 1), callback_data: `h:${r.id}` }));
  const keyboard = [];
  for (let i = 0; i < buttons.length; i += 5) keyboard.push(buttons.slice(i, i + 5));
  if (total > items.length) keyboard.push([appButton(`🔍 Все ${total} — в энциклопедии`, searchParam(query), ctx)]);
  await tg("sendMessage", {
    chat_id: chatId,
    parse_mode: "HTML",
    text: `🔍 Найдено: <b>${total}</b>${total > items.length ? ` (показаны первые ${items.length})` : ""}\n\n${lines.join("\n\n")}\n\nНажмите номер, чтобы открыть хадис.`,
    reply_markup: { inline_keyboard: keyboard },
  });
}

async function onMessage(tg, msg, ctx) {
  // Админ пересылает пост из канала или присылает ссылку — предложить добавить в «Полезные каналы»
  if (ctx.private && isAdmin(msg.from?.id) && !(msg.text || "").startsWith("/")) {
    const ref = channelRef(msg);
    if (ref) return adminMessage(tg, msg, ref);
  }
  const text = (msg.text || "").trim();
  if (!text) return;
  const [command, ...rest] = text.split(/\s+/);
  const cmd = command.startsWith("/") ? command.slice(1).split("@")[0].toLowerCase() : "";
  const chatId = msg.chat.id;

  if (cmd === "start") {
    const m = /^[hc](\d+)/.exec(rest[0] || "");
    if (m) return sendHadith(tg, chatId, m[1], ctx);
    return sendGreeting(tg, msg, ctx);
  }
  if (cmd === "help") return tg("sendMessage", { chat_id: chatId, parse_mode: "HTML", text: HELP.replace("{bot}", ctx.username) });
  if (cmd === "today" || cmd === "daily") return sendHadith(tg, chatId, await dailyId(), ctx, "🌅 <b>Хадис дня</b>");
  if (cmd === "random") return sendHadith(tg, chatId, await randomId(), ctx);
  if (cmd === "app") {
    return tg("sendMessage", { chat_id: chatId, text: "📖 Энциклопедия хадисов:", reply_markup: { inline_keyboard: [[appButton("Открыть энциклопедию", "", ctx)]] } });
  }
  if (cmd === "search") return rest.length ? sendSearch(tg, chatId, rest.join(" "), ctx) : undefined;
  if (cmd === "channels") return sendChannels(tg, chatId);
  if (cmd === "id") return tg("sendMessage", { chat_id: chatId, parse_mode: "HTML", text: `Ваш Telegram ID: <code>${esc(msg.from?.id)}</code>` });
  if (cmd === "admin") return ctx.private ? adminCommand(tg, msg) : undefined;
  if (cmd || !ctx.private) return; // в группах отвечаем только на команды

  const number = text.replace(/^[№#\s]+/, "");
  if (/^\d{1,9}$/.test(number)) return sendHadith(tg, chatId, number, ctx);
  if (/^(салам|ас-?салям|assalam|السلام)/i.test(text)) {
    return tg("sendMessage", { chat_id: chatId, parse_mode: "HTML", text: "<b>وعليكم السلام ورحمة الله وبركاته</b>\nВа алейкум ас-салям ва рахматуллахи ва баракятух! 🌿\n\nНапишите слово или номер хадиса — я найду его." });
  }
  await tg("sendChatAction", { chat_id: chatId, action: "typing" });
  return sendSearch(tg, chatId, text.slice(0, 100), ctx);
}

async function onCallback(tg, cq, ctx) {
  const chatId = cq.message?.chat?.id;
  const data = cq.data || "";
  if (data.startsWith("ch:")) return adminCallback(tg, cq);
  await tg("answerCallbackQuery", { callback_query_id: cq.id });
  if (!chatId) return;
  if (data === "rnd") return sendHadith(tg, chatId, await randomId(), ctx);
  if (data === "day") return sendHadith(tg, chatId, await dailyId(), ctx, "🌅 <b>Хадис дня</b>");
  if (data.startsWith("h:")) return sendHadith(tg, chatId, data.slice(2), ctx);
  if (data.startsWith("go:")) return showNeighbor(tg, cq, data.slice(3), ctx);
  if (data.startsWith("ar:")) return sendArabic(tg, chatId, data.slice(3), cq.message.message_id);
  if (data === "channels") return sendChannels(tg, chatId);
}

async function onInline(tg, iq, ctx) {
  const q = (iq.query || "").trim();
  const number = q.replace(/^[№#\s]+/, "");
  let ids;
  if (/^\d{1,9}$/.test(number)) ids = [number];
  else if (!q) ids = [await dailyId(), await randomId(), await randomId()];
  else ids = (await search(q, 10)).items.map((r) => r.id);

  const found = await Promise.all([...new Set(ids)].map((id) => getHadith(id).catch(() => null)));
  const results = found.filter(Boolean).map((h) => {
    const text = hadithMessage(h);
    return {
      type: "article",
      id: String(h.id),
      title: `№${h.id} · ${shorten(h.title || h.hadeeth, 80)}`,
      description: shorten(splitIntro(h)[1], 150),
      input_message_content: {
        message_text: text.length > LIMIT ? splitText(text)[0] + " …" : text,
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
      },
      reply_markup: {
        inline_keyboard: [[
          { text: "📖 Разъяснение", url: `https://t.me/${ctx.username}?startapp=h${h.id}_ru` },
          { text: "🌐 На сайте", url: SITE(h.id) },
        ]],
      },
    };
  });
  await tg("answerInlineQuery", {
    inline_query_id: iq.id,
    results,
    cache_time: 300,
    button: { text: "📖 Открыть энциклопедию хадисов", start_parameter: "inline" },
  });
}

let botUsername = process.env.BOT_USERNAME || "";

export async function handleUpdate(update, tg) {
  if (!botUsername) botUsername = (await tg("getMe"))?.username || "";
  const chat = update.message?.chat || update.callback_query?.message?.chat;
  const ctx = { username: botUsername, private: !chat || chat.type === "private" };
  try {
    if (update.message) await onMessage(tg, update.message, ctx);
    else if (update.callback_query) await onCallback(tg, update.callback_query, ctx);
    else if (update.inline_query) await onInline(tg, update.inline_query, ctx);
  } catch (err) {
    console.error("Ошибка обработки:", err);
    if (chat) await tg("sendMessage", { chat_id: chat.id, text: "⚠️ Не получилось загрузить хадисы. Попробуйте, пожалуйста, чуть позже." });
  }
}

export const COMMANDS = [
  { command: "start", description: "Приветствие и меню" },
  { command: "today", description: "Хадис дня" },
  { command: "random", description: "Случайный хадис" },
  { command: "app", description: "Открыть энциклопедию" },
  { command: "channels", description: "Полезные каналы" },
  { command: "help", description: "Как пользоваться" },
];

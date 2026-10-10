// Раздел «Полезные каналы»: список для всех (/channels, мини-приложение) и админка в чате с ботом (/admin).
import { clearPending, getChannels, getPending, hasStore, saveChannels, setPending } from "./store.js";

const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
const shorten = (s, n) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s; };

// Админы — Telegram ID через запятую в переменной ADMIN_IDS (узнать свой ID: /id)
const adminIds = () => String(process.env.ADMIN_IDS || "").split(/[\s,;]+/).filter(Boolean);
export const isAdmin = (userId) => userId != null && adminIds().includes(String(userId));

// ------------------------------------------------------------ распознавание

const LINK = /(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog)\/(?:s\/)?(\+[\w-]+|joinchat\/[\w-]+|[a-z]\w{3,31})(?:\/\d+)?\/?(?:\?\S*)?/i;
const MENTION = /(?:^|\s)@([a-z]\w{3,31})(?![\w@.])/i;
const RESERVED = new Set(["addstickers", "addemoji", "addtheme", "addlist", "share", "proxy", "socks", "setlanguage", "login", "confirmphone", "invoice", "boost", "contact", "joinchat"]);

// Пересланный пост из канала, ссылка t.me/… или @username. Текст после ссылки — своё описание.
export function channelRef(msg) {
  const fwd = msg.forward_origin?.type === "channel" ? msg.forward_origin.chat
    : msg.forward_from_chat?.type === "channel" ? msg.forward_from_chat : null;
  if (fwd) return { forward: fwd, note: "" };
  const text = msg.text || msg.caption || "";
  const link = LINK.exec(text);
  if (link) {
    const path = link[1];
    const note = text.replace(link[0], "").trim();
    if (/^(\+|joinchat\/)/i.test(path)) return { invite: "+" + path.replace(/^(\+|joinchat\/)/i, ""), note };
    if (!RESERVED.has(path.toLowerCase())) return { username: path, note };
  }
  const mention = MENTION.exec(text);
  if (mention) return { username: mention[1], note: text.replace(`@${mention[1]}`, "").trim() };
  return null;
}

async function buildChannel(tg, ref) {
  const lines = ref.note.split("\n").map((s) => s.trim()).filter(Boolean);
  if (ref.forward && !ref.forward.username) return { needLink: true, title: ref.forward.title };
  if (ref.invite) {
    if (!lines.length) return { needTitle: true };
    return { key: ref.invite, title: shorten(lines[0], 80), description: shorten(lines.slice(1).join(" "), 300), url: `https://t.me/${ref.invite}`, photo: false };
  }
  const name = ref.forward ? ref.forward.username : ref.username;
  const chat = await tg("getChat", { chat_id: "@" + name });
  const username = chat?.username || name;
  const base = { key: username.toLowerCase(), username, url: `https://t.me/${username}` };
  if (chat) {
    return { ...base, chatId: chat.id, title: shorten(chat.title || chat.first_name || "@" + username, 80), description: shorten(lines.join(" ") || chat.description || "", 300), photo: Boolean(chat.photo) };
  }
  // Боты и скрытые чаты Telegram не отдаёт — берём название из текста админа
  return { ...base, title: shorten(lines[0] || "@" + username, 80), description: shorten(lines.slice(1).join(" "), 300), photo: false };
}

// -------------------------------------------------------------------- тексты

const STORAGE_HELP = `⚠️ <b>Хранилище для каналов ещё не подключено.</b>

1. Vercel → ваш проект → вкладка <b>Storage</b> → <b>Create Database</b>
2. Выберите <b>Upstash for Redis</b> (бесплатный план) → <b>Create</b>
3. <b>Connect</b> — подключите к этому проекту
4. <b>Deployments</b> → ⋯ → <b>Redeploy</b>

Потом снова отправьте /admin.`;

const ADMIN_HELP = (id) => `⚙️ <b>Как стать админом бота</b>

1. Ваш Telegram ID: <code>${id}</code> (нажмите, чтобы скопировать)
2. Vercel → проект → <b>Settings → Environment Variables</b>
   имя <code>ADMIN_IDS</code>, значение — этот номер → <b>Save</b>
3. <b>Deployments</b> → ⋯ → <b>Redeploy</b>
4. Снова отправьте /admin`;

const HOW_TO_ADD = `➕ <b>Добавить канал:</b> перешлите сюда любой пост из канала или пришлите ссылку — <code>@username</code> или <code>t.me/username</code>.
✏️ Своё описание — на следующей строке после ссылки. Так же можно поменять описание у канала из списка.
🔒 Закрытый канал: ссылка-приглашение <code>t.me/+…</code>, на следующей строке — название.`;

function panel(list) {
  const lines = list.map((c, i) => `${i + 1}. ${esc(c.title)}${c.username ? ` — @${esc(c.username)}` : ""}`);
  const text = `⚙️ <b>Админка · Полезные каналы</b>

${list.length ? `В списке: <b>${list.length}</b>\n${lines.join("\n")}\n\nНажмите на канал, чтобы поднять, опустить или удалить его.` : "Список пока пуст."}

${HOW_TO_ADD}`;
  const keyboard = list.map((c, i) => [{ text: `${i + 1}. ${shorten(c.title, 40)}`, callback_data: `ch:item:${c.key}` }]);
  if (list.length) keyboard.push([{ text: "👀 Как видят подписчики", callback_data: "channels" }]);
  return { text, reply_markup: { inline_keyboard: keyboard } };
}

const describe = (c) => [
  `<b>${esc(c.title)}</b>`,
  c.username ? `@${esc(c.username)}` : esc(c.url),
  c.description ? `<i>${esc(c.description)}</i>` : "",
].filter(Boolean).join("\n");

function itemView(list, key) {
  const i = list.findIndex((c) => c.key === key);
  if (i < 0) return panel(list);
  const c = list[i];
  const move = [];
  if (i > 0) move.push({ text: "⬆️ Выше", callback_data: `ch:up:${c.key}` });
  if (i < list.length - 1) move.push({ text: "⬇️ Ниже", callback_data: `ch:down:${c.key}` });
  return {
    text: `${describe(c)}\n\nМесто в списке: ${i + 1} из ${list.length}`,
    reply_markup: {
      inline_keyboard: [
        ...(move.length ? [move] : []),
        [{ text: "🗑 Удалить", callback_data: `ch:del:${c.key}` }, { text: "🔗 Открыть", url: c.url }],
        [{ text: "« Все каналы", callback_data: "ch:list" }],
      ],
    },
  };
}

// --------------------------------------------------------------- для всех

export function channelsMessage(list) {
  if (!list.length) return { text: "📢 Здесь скоро появятся полезные каналы — загляните чуть позже." };
  const build = (withAbout) => `📢 <b>Полезные каналы</b>\n\n${list.map((c) => `• <b>${esc(c.title)}</b>${withAbout && c.description ? ` — ${esc(shorten(c.description, 140))}` : ""}`).join(withAbout ? "\n\n" : "\n")}\n\nНажмите на канал, чтобы открыть его 👇`;
  let text = build(true);
  if (text.length > 4000) text = build(false);
  return { text, reply_markup: { inline_keyboard: list.slice(0, 90).map((c) => [{ text: shorten(c.title, 60), url: c.url }]) } };
}

export async function sendChannels(tg, chatId) {
  const list = await getChannels().catch((err) => { console.error(err); return []; });
  return tg("sendMessage", { chat_id: chatId, parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...channelsMessage(list) });
}

// ------------------------------------------------------------------ админка

export async function adminCommand(tg, msg) {
  const chatId = msg.chat.id;
  const reply = (text) => tg("sendMessage", { chat_id: chatId, parse_mode: "HTML", text });
  if (!adminIds().length) return reply(ADMIN_HELP(msg.from?.id));
  if (!isAdmin(msg.from?.id)) return reply("Эта команда только для администратора бота.");
  if (!hasStore()) return reply(STORAGE_HELP);
  return tg("sendMessage", { chat_id: chatId, parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...panel(await getChannels()) });
}

// Админ прислал пересланный пост или ссылку → карточка канала с кнопкой «Добавить»
export async function adminMessage(tg, msg, ref) {
  const chatId = msg.chat.id;
  const reply = (text, extra = {}) => tg("sendMessage", { chat_id: chatId, parse_mode: "HTML", link_preview_options: { is_disabled: true }, text, ...extra });
  if (!hasStore()) return reply(STORAGE_HELP);
  const channel = await buildChannel(tg, ref);
  if (channel.needLink) {
    return reply(`🔒 «${esc(channel.title)}» — закрытый канал, у него нет публичной ссылки.\n\nПришлите ссылку-приглашение (<code>t.me/+…</code>), а на следующей строке — название канала.`);
  }
  if (channel.needTitle) return reply("✏️ Напишите название канала на следующей строке после ссылки-приглашения.");
  await setPending(msg.from.id, channel);
  const exists = (await getChannels()).some((c) => c.key === channel.key);
  return reply(`${exists ? "✏️ <b>Этот канал уже в списке — данные обновятся</b>" : "📢 <b>Добавить в «Полезные каналы»?</b>"}\n\n${describe(channel)}`, {
    reply_markup: {
      inline_keyboard: [[
        { text: exists ? "✅ Сохранить" : "✅ Добавить", callback_data: `ch:add:${channel.key}` },
        { text: "✖️ Отмена", callback_data: "ch:cancel" },
      ]],
    },
  });
}

export async function adminCallback(tg, cq) {
  const answer = (text) => tg("answerCallbackQuery", { callback_query_id: cq.id, ...(text ? { text } : {}) });
  const message = cq.message;
  if (!isAdmin(cq.from?.id) || !message?.chat) return answer("Только для администратора");
  if (!hasStore()) return answer("Хранилище не подключено — отправьте /admin");
  const edit = (view) => tg("editMessageText", {
    chat_id: message.chat.id, message_id: message.message_id, parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...view,
  });
  const [, action, ...rest] = cq.data.split(":");
  const key = rest.join(":");
  const list = await getChannels();
  const i = list.findIndex((c) => c.key === key);

  if (action === "add") {
    const pending = await getPending(cq.from.id);
    if (!pending || pending.key !== key) {
      await answer("Карточка устарела — пришлите ссылку ещё раз");
      return edit({ text: "⌛ Карточка устарела. Пришлите ссылку на канал ещё раз." });
    }
    if (i >= 0) list[i] = { ...list[i], ...pending };
    else list.push({ ...pending, added: Date.now() });
    await saveChannels(list);
    await clearPending(cq.from.id);
    await answer(i >= 0 ? "Сохранено" : "Канал добавлен");
    return edit({
      text: `✅ «${esc(pending.title)}» ${i >= 0 ? "обновлён" : "добавлен"} в «Полезные каналы». Сейчас в списке: ${list.length}.`,
      reply_markup: { inline_keyboard: [[{ text: "⚙️ Все каналы", callback_data: "ch:list" }, { text: "👀 Как видят подписчики", callback_data: "channels" }]] },
    });
  }
  if (action === "cancel") {
    await clearPending(cq.from.id);
    await answer("Отменено");
    return edit({ text: "✖️ Канал не добавлен." });
  }
  if ((action === "up" || action === "down") && i >= 0) {
    const j = action === "up" ? i - 1 : i + 1;
    if (j >= 0 && j < list.length) {
      [list[i], list[j]] = [list[j], list[i]];
      await saveChannels(list);
    }
    await answer(action === "up" ? "Поднят выше" : "Опущен ниже");
    return edit(itemView(list, key));
  }
  if (action === "del" && i >= 0) {
    await answer();
    return edit({
      text: `🗑 Удалить «${esc(list[i].title)}» из полезных каналов?`,
      reply_markup: { inline_keyboard: [[{ text: "🗑 Да, удалить", callback_data: `ch:rm:${key}` }, { text: "« Нет", callback_data: `ch:item:${key}` }]] },
    });
  }
  if (action === "rm" && i >= 0) {
    list.splice(i, 1);
    await saveChannels(list);
    await answer("Удалено");
    return edit(panel(list));
  }
  await answer();
  return edit(action === "item" ? itemView(list, key) : panel(list));
}

// Разделы «Полезные каналы» и «Полезные боты»: списки для всех (/channels, /bots, мини-приложение)
// и админка в чате с ботом (/admin).
import { clearPending, getBots, getChannels, getPending, hasStore, saveBots, saveChannels, setPending, userStats } from "./store.js";

const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
const shorten = (s, n) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s; };

// Админы — Telegram ID через запятую в переменной ADMIN_IDS (узнать свой ID: /id)
const adminIds = () => String(process.env.ADMIN_IDS || "").split(/[\s,;]+/).filter(Boolean);
export const isAdmin = (userId) => userId != null && adminIds().includes(String(userId));

// ------------------------------------------------------------ распознавание

const LINK = /(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog)\/(?:s\/)?(\+[\w-]+|joinchat\/[\w-]+|[a-z]\w{3,31})(?:\/\d+)?\/?(?:\?\S*)?/i;
const MENTION = /(?:^|\s)@([a-z]\w{3,31})(?![\w@.])/i;
const RESERVED = new Set(["addstickers", "addemoji", "addtheme", "addlist", "share", "proxy", "socks", "setlanguage", "login", "confirmphone", "invoice", "boost", "contact", "joinchat"]);

// Имена всех ботов в Telegram заканчиваются на «bot» — так бот отличается от канала
const isBotName = (name) => /bot$/i.test(name);

// Пересланный пост из канала или сообщение от бота, ссылка t.me/… или @username.
// Текст после ссылки — своё описание (у ботов: первая строка — название, дальше — описание).
export function channelRef(msg) {
  const fwd = msg.forward_origin?.type === "channel" ? msg.forward_origin.chat
    : msg.forward_from_chat?.type === "channel" ? msg.forward_from_chat : null;
  if (fwd) return { forward: fwd, note: "" };
  const fromBot = msg.forward_origin?.type === "user" ? msg.forward_origin.sender_user : msg.forward_from;
  if (fromBot?.is_bot && fromBot.username) return { bot: true, user: fromBot, username: fromBot.username, note: "" };
  const text = msg.text || msg.caption || "";
  const link = LINK.exec(text);
  if (link) {
    const path = link[1];
    const note = text.replace(link[0], "").trim();
    if (/^(\+|joinchat\/)/i.test(path)) return { invite: "+" + path.replace(/^(\+|joinchat\/)/i, ""), note };
    if (!RESERVED.has(path.toLowerCase())) return isBotName(path) ? { bot: true, username: path, note } : { username: path, note };
  }
  const mention = MENTION.exec(text);
  if (mention) {
    const note = text.replace(`@${mention[1]}`, "").trim();
    return isBotName(mention[1]) ? { bot: true, username: mention[1], note } : { username: mention[1], note };
  }
  return null;
}

// Бот: название и аватарку Telegram отдаёт, только если переслать сообщение от него.
// По ссылке — название из первой строки текста админа (или прежнее, если бот уже в списке).
async function buildBot(tg, ref, existing) {
  const lines = ref.note.split("\n").map((s) => s.trim()).filter(Boolean);
  const username = ref.username;
  const old = existing.find((b) => b.key === username.toLowerCase());
  const userId = ref.user?.id || old?.userId;
  const photos = userId && (await tg("getUserProfilePhotos", { user_id: userId, limit: 1 }));
  const title = ref.user ? ref.user.first_name : lines[0] || old?.title || "@" + username;
  const description = lines.slice(1).join(" ") || old?.description || "";
  return {
    key: username.toLowerCase(),
    username,
    ...(userId ? { userId } : {}),
    url: `https://t.me/${username}`,
    title: shorten(title, 80),
    description: shorten(description, 300),
    photo: photos ? photos.total_count > 0 : Boolean(old?.photo),
  };
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

// Два списка с одинаковой админкой: ch — каналы, bt — боты
const KINDS = {
  ch: {
    name: "Полезные каналы", icon: "📢", one: "канал", acc: "канал", all: "« Все каналы", from: "из полезных каналов",
    load: getChannels, save: saveChannels, show: "channels",
    empty: "📢 Здесь скоро появятся полезные каналы — загляните чуть позже.",
  },
  bt: {
    name: "Полезные боты", icon: "🤖", one: "бот", acc: "бота", all: "« Все боты", from: "из полезных ботов",
    load: getBots, save: saveBots, show: "bots",
    empty: "🤖 Здесь скоро появятся полезные боты — загляните чуть позже.",
  },
};

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

const HOW_TO_ADD_BOT = `➕ <b>Добавить бота:</b> перешлите сюда любое сообщение от этого бота — подтянутся его название и аватарка. Или пришлите ссылку — <code>@имя_bot</code> или <code>t.me/имя_bot</code>, на следующей строке — название, ниже — описание.
✏️ Чтобы поменять название или описание, пришлите ссылку на бота ещё раз с новым текстом.`;

function panel(list, kind = "ch", count = 0) {
  const K = KINDS[kind];
  const lines = list.map((c, i) => `${i + 1}. ${esc(c.title)}${c.username ? ` — @${esc(c.username)}` : ""}`);
  const text = `⚙️ <b>Админка · ${K.name}</b>

${list.length ? `В списке: <b>${list.length}</b>\n${lines.join("\n")}\n\nНажмите на ${K.acc}, чтобы сделать его первым, поднять, опустить или удалить.` : "Список пока пуст."}

${kind === "bt" ? HOW_TO_ADD_BOT : HOW_TO_ADD}`;
  const keyboard = list.map((c, i) => [{ text: `${i + 1}. ${shorten(c.title, 40)}`, callback_data: `${kind}:item:${c.key}` }]);
  if (list.length) keyboard.push([{ text: "👀 Как видят подписчики", callback_data: K.show }]);
  if (kind === "ch") {
    keyboard.push([{ text: `🤖 Полезные боты${count ? ` (${count})` : ""}`, callback_data: "bt:list" }]);
    keyboard.push([{ text: "📣 Рассылка", callback_data: "bc:start" }, { text: "👥 Пользователи", callback_data: "ch:users" }]);
  } else {
    keyboard.push([{ text: "« Полезные каналы", callback_data: "ch:list" }]);
  }
  return { text, reply_markup: { inline_keyboard: keyboard } };
}

// Админка открывается со списка каналов; в нём кнопка «Полезные боты» с их числом
const channelsPanel = async () => panel(await getChannels(), "ch", (await getBots()).length);

// «Пользователи»: сколько людей пользуется ботом (учёт ведёт lib/store.js)
const num = (n) => Number(n || 0).toLocaleString("ru-RU");

async function usersView() {
  const s = await userStats();
  const since = s.since ? new Date(s.since).toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" }) : "";
  const text = `👥 <b>Пользователи бота</b>

Всего: <b>${num(s.total)}</b>
Новых: за сутки <b>${num(s.new1)}</b> · за 7 дней <b>${num(s.new7)}</b>
Писали боту: за сутки <b>${num(s.active1)}</b> · за 7 дней <b>${num(s.active7)}</b> · за 30 дней <b>${num(s.active30)}</b>
🕌 Настроили время намаза: <b>${num(s.namaz)}</b>

<i>${since ? `Учёт ведётся с ${since}: считаются` : "Учёт только начался: будут считаться"} те, кто написал боту или нажал кнопку в личном чате. Кто пользовался ботом раньше, попадёт в счёт при следующем сообщении.</i>`;
  return {
    text,
    reply_markup: { inline_keyboard: [[{ text: "🔄 Обновить", callback_data: "ch:users" }, { text: "« Админка", callback_data: "ch:list" }]] },
  };
}

const describe = (c) => [
  `<b>${esc(c.title)}</b>`,
  c.username ? `@${esc(c.username)}` : esc(c.url),
  c.description ? `<i>${esc(c.description)}</i>` : "",
].filter(Boolean).join("\n");

function itemView(list, key, kind = "ch") {
  const i = list.findIndex((c) => c.key === key);
  if (i < 0) return panel(list, kind);
  const c = list[i];
  const move = [];
  if (i > 0) move.push({ text: "⬆️ Выше", callback_data: `${kind}:up:${c.key}` });
  if (i < list.length - 1) move.push({ text: "⬇️ Ниже", callback_data: `${kind}:down:${c.key}` });
  return {
    text: `${describe(c)}\n\nМесто в списке: ${i + 1} из ${list.length}${i === 0 ? " — показывается первым" : ""}`,
    reply_markup: {
      inline_keyboard: [
        ...(i > 0 ? [[{ text: "📌 Показывать первым", callback_data: `${kind}:top:${c.key}` }]] : []),
        ...(move.length ? [move] : []),
        [{ text: "🗑 Удалить", callback_data: `${kind}:del:${c.key}` }, { text: "🔗 Открыть", url: c.url }],
        [{ text: KINDS[kind].all, callback_data: `${kind}:list` }],
      ],
    },
  };
}

// --------------------------------------------------------------- для всех

export function channelsMessage(list, kind = "ch") {
  const K = KINDS[kind];
  if (!list.length) return { text: K.empty };
  const build = (withAbout) => `${K.icon} <b>${K.name}</b>\n\n${list.map((c) => `• <b>${esc(c.title)}</b>${withAbout && c.description ? ` — ${esc(shorten(c.description, 140))}` : ""}`).join(withAbout ? "\n\n" : "\n")}\n\nНажмите на ${K.acc}, чтобы открыть его 👇`;
  let text = build(true);
  if (text.length > 4000) text = build(false);
  return { text, reply_markup: { inline_keyboard: list.slice(0, 90).map((c) => [{ text: shorten(c.title, 60), url: c.url }]) } };
}

async function sendList(tg, chatId, kind) {
  const list = await KINDS[kind].load().catch((err) => { console.error(err); return []; });
  return tg("sendMessage", { chat_id: chatId, parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...channelsMessage(list, kind) });
}
export const sendChannels = (tg, chatId) => sendList(tg, chatId, "ch");
export const sendBots = (tg, chatId) => sendList(tg, chatId, "bt");

// ------------------------------------------------------------------ админка

export async function adminCommand(tg, msg) {
  const chatId = msg.chat.id;
  const reply = (text) => tg("sendMessage", { chat_id: chatId, parse_mode: "HTML", text });
  if (!adminIds().length) return reply(ADMIN_HELP(msg.from?.id));
  if (!isAdmin(msg.from?.id)) return reply("Эта команда только для администратора бота.");
  if (!hasStore()) return reply(STORAGE_HELP);
  return tg("sendMessage", { chat_id: chatId, parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...(await channelsPanel()) });
}

// /users — та же сводка, что по кнопке «Пользователи» в админке
export async function usersCommand(tg, msg) {
  const reply = (view) => tg("sendMessage", { chat_id: msg.chat.id, parse_mode: "HTML", ...view });
  if (!adminIds().length) return reply({ text: ADMIN_HELP(msg.from?.id) });
  if (!isAdmin(msg.from?.id)) return reply({ text: "Эта команда только для администратора бота." });
  if (!hasStore()) return reply({ text: STORAGE_HELP });
  return reply(await usersView());
}

// Админ прислал пересланный пост или ссылку → карточка канала (или бота) с кнопкой «Добавить»
export async function adminMessage(tg, msg, ref) {
  const chatId = msg.chat.id;
  const reply = (text, extra = {}) => tg("sendMessage", { chat_id: chatId, parse_mode: "HTML", link_preview_options: { is_disabled: true }, text, ...extra });
  if (!hasStore()) return reply(STORAGE_HELP);
  if (ref.bot) {
    const bots = await getBots();
    const bot = await buildBot(tg, ref, bots);
    await setPending(msg.from.id, { ...bot, kind: "bt" });
    const exists = bots.some((b) => b.key === bot.key);
    return reply(`${exists ? "✏️ <b>Этот бот уже в списке — данные обновятся</b>" : "🤖 <b>Добавить в «Полезные боты»?</b>"}\n\n${describe(bot)}${ref.user ? "" : "\n\n<i>Чтобы была аватарка, перешлите сюда любое сообщение от этого бота.</i>"}`, {
      reply_markup: {
        inline_keyboard: [[
          { text: exists ? "✅ Сохранить" : "✅ Добавить", callback_data: `bt:add:${bot.key}` },
          { text: "✖️ Отмена", callback_data: "bt:cancel" },
        ]],
      },
    });
  }
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
  const kind = cq.data.startsWith("bt:") ? "bt" : "ch";
  const K = KINDS[kind];
  const answer = (text) => tg("answerCallbackQuery", { callback_query_id: cq.id, ...(text ? { text } : {}) });
  const message = cq.message;
  if (!isAdmin(cq.from?.id) || !message?.chat) return answer("Только для администратора");
  if (!hasStore()) return answer("Хранилище не подключено — отправьте /admin");
  const edit = (view) => tg("editMessageText", {
    chat_id: message.chat.id, message_id: message.message_id, parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...view,
  });
  const [, action, ...rest] = cq.data.split(":");
  const key = rest.join(":");
  if (action === "users") {
    await answer();
    return edit(await usersView());
  }
  const list = await K.load();
  const i = list.findIndex((c) => c.key === key);
  const listView = async () => (kind === "ch" ? channelsPanel() : panel(list, kind));

  if (action === "add") {
    const pending = await getPending(cq.from.id);
    if (!pending || pending.key !== key || (pending.kind || "ch") !== kind) {
      await answer("Карточка устарела — пришлите ссылку ещё раз");
      return edit({ text: `⌛ Карточка устарела. Пришлите ссылку на ${K.acc} ещё раз.` });
    }
    const { kind: _, ...item } = pending;
    if (i >= 0) list[i] = { ...list[i], ...item };
    else list.push({ ...item, added: Date.now() });
    await K.save(list);
    await clearPending(cq.from.id);
    await answer(i >= 0 ? "Сохранено" : `${K.one[0].toUpperCase()}${K.one.slice(1)} добавлен`);
    return edit({
      text: `✅ «${esc(item.title)}» ${i >= 0 ? "обновлён" : "добавлен"} в «${K.name}». Сейчас в списке: ${list.length}.`,
      reply_markup: { inline_keyboard: [[{ text: `⚙️ ${K.all.slice(2)}`, callback_data: `${kind}:list` }, { text: "👀 Как видят подписчики", callback_data: K.show }]] },
    });
  }
  if (action === "cancel") {
    await clearPending(cq.from.id);
    await answer("Отменено");
    return edit({ text: `✖️ ${K.one[0].toUpperCase()}${K.one.slice(1)} не добавлен.` });
  }
  if (action === "top" && i >= 0) {
    list.unshift(...list.splice(i, 1));
    await K.save(list);
    await answer("Теперь показывается первым");
    return edit(itemView(list, key, kind));
  }
  if ((action === "up" || action === "down") && i >= 0) {
    const j = action === "up" ? i - 1 : i + 1;
    if (j >= 0 && j < list.length) {
      [list[i], list[j]] = [list[j], list[i]];
      await K.save(list);
    }
    await answer(action === "up" ? "Поднят выше" : "Опущен ниже");
    return edit(itemView(list, key, kind));
  }
  if (action === "del" && i >= 0) {
    await answer();
    return edit({
      text: `🗑 Удалить «${esc(list[i].title)}» ${K.from}?`,
      reply_markup: { inline_keyboard: [[{ text: "🗑 Да, удалить", callback_data: `${kind}:rm:${key}` }, { text: "« Нет", callback_data: `${kind}:item:${key}` }]] },
    });
  }
  if (action === "rm" && i >= 0) {
    list.splice(i, 1);
    await K.save(list);
    await answer("Удалено");
    return edit(await listView());
  }
  await answer();
  return edit(action === "item" ? itemView(list, key, kind) : await listView());
}

// «📣 Рассылка» в админке: админ присылает сообщение (текст, фото или видео с подписью, голосовое…),
// бот показывает, как его увидят, и после подтверждения копирует его всем, кто пользовался ботом.
// За один заход Vercel даёт около минуты; если людей много, рассылка встаёт на паузу
// и продолжается кнопкой «▶️ Продолжить» — с того же места, без повторов.
import { isAdmin } from "./channels.js";
import { delKeys, getJSON, hasStore, setJSON, takeLock, userIds, usersCount } from "./store.js";

const WAIT = (adminId) => `hadith:bcast:wait:${adminId}`; // ждём от админа сообщение для рассылки
const DRAFT = (adminId) => `hadith:bcast:draft:${adminId}`; // сообщение, которое разослать
const JOB = "hadith:bcast:job"; // ход рассылки: сколько отправлено и с кого продолжать
const LOCK = "hadith:bcast:lock"; // рассылка прямо сейчас идёт
const BATCH = 30;
const PARALLEL = 3;
const budget = () => Number(process.env.BROADCAST_BUDGET_MS ?? 40_000);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const num = (n) => Number(n || 0).toLocaleString("ru-RU");

const CANCEL = { text: "✖️ Отмена", callback_data: "bc:cancel" };
// Сколько человек получит рассылку: все из учёта, кроме самого админа (он тоже в учёте — пишет боту)
const recipients = async () => Math.max(0, (await usersCount()) - 1);

export const broadcastWaiting = async (adminId) => hasStore() && Boolean(await getJSON(WAIT(adminId)));

async function promptView() {
  const total = await recipients();
  return {
    text: `📣 <b>Рассылка</b>

Получат: <b>${num(total)}</b> — все, кто писал боту или нажимал его кнопки (кроме вас).

Пришлите сюда сообщение для рассылки: текст, фото или видео с подписью, голосовое, файл. Можно с жирным шрифтом и ссылками. Я покажу, как его увидят, и спрошу подтверждение.`,
    reply_markup: { inline_keyboard: [[CANCEL]] },
  };
}

// /broadcast — то же, что кнопка «📣 Рассылка» в /admin
export async function broadcastCommand(tg, msg) {
  const reply = (text) => tg("sendMessage", { chat_id: msg.chat.id, text });
  if (!isAdmin(msg.from?.id)) return reply("Эта команда только для администратора бота.");
  if (!hasStore()) return reply("⚠️ Сначала подключите хранилище — подробнее в /admin.");
  return broadcastStart(tg, msg.chat.id, msg.from.id);
}

export async function broadcastStart(tg, chatId, adminId, messageId) {
  await setJSON(WAIT(adminId), 1, 3600);
  const view = await promptView();
  if (messageId) return tg("editMessageText", { chat_id: chatId, message_id: messageId, parse_mode: "HTML", ...view });
  return tg("sendMessage", { chat_id: chatId, parse_mode: "HTML", ...view });
}

// Админ прислал сообщение для рассылки → показать, как оно будет выглядеть, и спросить «Отправить?»
export async function broadcastDraft(tg, msg) {
  const chatId = msg.chat.id;
  if (msg.media_group_id) {
    return tg("sendMessage", { chat_id: chatId, text: "Альбом из нескольких фото разослать не получится — пришлите одно фото или видео с подписью." });
  }
  await delKeys(WAIT(msg.from.id));
  await setJSON(DRAFT(msg.from.id), { chat: chatId, id: msg.message_id }, 86400);
  const total = await recipients();
  await tg("sendMessage", { chat_id: chatId, text: "👇 Так сообщение увидят пользователи:" });
  await tg("copyMessage", { chat_id: chatId, from_chat_id: chatId, message_id: msg.message_id });
  return tg("sendMessage", {
    chat_id: chatId,
    parse_mode: "HTML",
    text: `📣 Отправить это сообщение <b>${num(total)}</b> пользователям?\n\n<i>Не удаляйте своё сообщение, пока рассылка не закончится.</i>`,
    reply_markup: { inline_keyboard: [[{ text: "✅ Отправить всем", callback_data: "bc:send" }, CANCEL]] },
  });
}

// Отправка одному человеку: true — доставлено, false — нет (остановил бота и т. п.),
// "gone" — админ удалил исходное сообщение. Если Telegram просит подождать — ждём и пробуем снова.
async function deliver(tg, userId, draft) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = tg.raw
      ? await tg.raw("copyMessage", { chat_id: userId, from_chat_id: draft.chat, message_id: draft.id })
      : { ok: Boolean(await tg("copyMessage", { chat_id: userId, from_chat_id: draft.chat, message_id: draft.id })) };
    if (res.ok) return true;
    if (/message to copy not found/i.test(res.description || "")) return "gone";
    const wait = res.parameters?.retry_after;
    if (res.error_code !== 429 || !wait) return false;
    await sleep(wait * 1000);
  }
  return false;
}

const progressText = (job, total) => `📣 Рассылка идёт… Отправлено ${num(job.sent + job.failed)} из ${num(total)}.`;

async function run(tg, cq) {
  const edit = (text, keyboard) => tg("editMessageText", {
    chat_id: cq.message.chat.id, message_id: cq.message.message_id, parse_mode: "HTML", text,
    ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
  });
  let job = await getJSON(JOB);
  if (!job) {
    job = { draft: await getJSON(DRAFT(cq.from.id)), by: cq.from.id, cursor: 0, sent: 0, failed: 0, started: Date.now() };
    await setJSON(JOB, job, 7 * 86400);
  }
  const total = await recipients();
  const until = Date.now() + budget();
  let shown = Date.now();
  await edit(progressText(job, total));
  while (true) {
    const ids = await userIds(job.cursor, job.cursor + BATCH - 1);
    if (!ids.length) break;
    for (let i = 0; i < ids.length; i += PARALLEL) {
      const group = ids.slice(i, i + PARALLEL).filter((id) => String(id) !== String(job.by)); // автору — не нужно
      const results = await Promise.all(group.map((id) => deliver(tg, id, job.draft)));
      if (results.includes("gone")) {
        await delKeys(JOB, DRAFT(job.by));
        return edit(`⚠️ Исходное сообщение удалено, рассылка остановлена. Отправлено: ${num(job.sent)}.\n\nЧтобы разослать заново, нажмите «📣 Рассылка» в /admin.`);
      }
      job.sent += results.filter((ok) => ok === true).length;
      job.failed += results.filter((ok) => ok === false).length;
    }
    job.cursor += ids.length;
    await setJSON(JOB, job, 7 * 86400); // с этого места продолжим, если заход прервётся
    if (ids.length < BATCH) break; // это была последняя пачка
    if (Date.now() - shown > 5000) {
      shown = Date.now();
      await edit(progressText(job, total));
    }
    if (Date.now() >= until) {
      return edit(`⏸ Отправлено ${num(job.sent + job.failed)} из ${num(total)}. За один раз Telegram не даёт отправить больше — нажмите «Продолжить».`, [
        [{ text: "▶️ Продолжить", callback_data: "bc:send" }, { text: "⏹ Остановить", callback_data: "bc:stop" }],
      ]);
    }
  }
  await delKeys(JOB, DRAFT(job.by));
  return edit(`✅ <b>Рассылка завершена</b>\n\nДоставлено: <b>${num(job.sent)}</b>${job.failed ? `\nНе доставлено: <b>${num(job.failed)}</b> — эти люди остановили бота или удалили аккаунт` : ""}`);
}

export async function broadcastCallback(tg, cq) {
  const answer = (text) => tg("answerCallbackQuery", { callback_query_id: cq.id, ...(text ? { text } : {}) });
  const message = cq.message;
  if (!isAdmin(cq.from?.id) || !message?.chat) return answer("Только для администратора");
  if (!hasStore()) return answer("Хранилище не подключено — отправьте /admin");
  const action = cq.data.split(":")[1];
  const edit = (text) => tg("editMessageText", { chat_id: message.chat.id, message_id: message.message_id, parse_mode: "HTML", text });

  if (action === "start") {
    await answer();
    return broadcastStart(tg, message.chat.id, cq.from.id, message.message_id);
  }
  if (action === "cancel") {
    await delKeys(WAIT(cq.from.id), DRAFT(cq.from.id));
    await answer("Отменено");
    return edit("✖️ Рассылка отменена.");
  }
  if (action === "stop") {
    const job = await getJSON(JOB);
    await delKeys(JOB, ...(job ? [DRAFT(job.by)] : []));
    await answer("Остановлено");
    return edit(`⏹ Рассылка остановлена.${job ? ` Отправлено: ${num(job.sent + job.failed)}.` : ""}`);
  }
  if (action === "send") {
    // Одна рассылка за раз; замок снимается сам, даже если заход оборвётся
    if (!(await takeLock(LOCK, Math.ceil(budget() / 1000) + 30))) return answer("Рассылка уже идёт");
    // Уже разослано или отменено (например, Telegram повторил нажатие) — итог в сообщении не трогаем
    if (!(await getJSON(JOB)) && !(await getJSON(DRAFT(cq.from.id)))) {
      await delKeys(LOCK);
      return answer("Нечего отправлять: рассылка уже закончена или отменена");
    }
    await answer("Начинаю рассылку");
    try {
      return await run(tg, cq);
    } finally {
      await delKeys(LOCK);
    }
  }
  return answer();
}

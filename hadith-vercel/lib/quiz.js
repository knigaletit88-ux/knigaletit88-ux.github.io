// «Викторина дня»: каждый день в 12:00 (по Москве) — опрос-викторина Telegram по хадисам
// в подключённые каналы и группы и всем, кто подписался в боте.
// Вопросы составляются из самой энциклопедии: «продолжите хадис» или «кто из имамов привёл хадис».
// Только достоверные хадисы (صحيح) — и в вопросе, и в неправильных вариантах ответа.
import { isAdmin } from "./channels.js";
import { getHadith, hashStr, isSahih, sahihIds, searchItems } from "./hadith.js";
import { hasStore, kv } from "./store.js";

const TZ = process.env.QUIZ_TZ || "Europe/Moscow";
const TIME = process.env.QUIZ_TIME || "12:00";
const TZ_LABEL = TZ === "Europe/Moscow" ? "по Москве" : TZ;
const CHATS = "hadith:quiz:chats"; // каналы и группы: chatId → {title, type}
const SUBS = "hadith:quiz:subs"; // подписчики в личке
const USED = "hadith:quiz:used"; // хадисы, которые уже были в викторине
const DAY = (date) => `hadith:quiz:day:${date}`;
const SENT = (date) => `hadith:quiz:sent:${date}`;
const KEEP = 3 * 86400;

const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
const shorten = (s, n) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s; };

// Дата и минуты от полуночи по времени викторины
export function localTime(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}
const quizMinutes = () => { const [h, m] = TIME.split(":").map(Number); return h * 60 + (m || 0); };

// ---------------------------------------------------------- составление

function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(list, rand) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Текст для вопроса: без кавычек, косых черт и пояснений переводчика в [скобках]
const quizText = (s) => String(s || "").replace(/\s*\[[^\]]*\]/g, "").replace(/[«»“”„"/]/g, "").replace(/\s+/g, " ").trim();

// Делим хадис на начало (вопрос) и окончание (ответ до 95 знаков), лучше — по запятой или двоеточию.
// В начале должно быть не меньше 30 знаков самих слов хадиса, а не только «Такой-то передаёт:».
const LEAD = /^.{0,160}?(?:переда[её]т(?:ся)?|сказал[аи]?|говорил[аи]?|сообщил[аи]?|рассказал[аи]?|спросил[аи]?)[^:]{0,90}:\s*/i;
function cut(text) {
  if (text.length < 70 || text.length > 260) return null;
  const speech = LEAD.exec(text)?.[0].length || 0;
  let best = null;
  for (const m of text.matchAll(/([,;:—–]\s+)|(\s+)/g)) {
    const start = text.slice(0, m.index).replace(/[\s,;:—–-]+$/, "");
    const end = text.slice(m.index + m[0].length).replace(/[\s.!?…]+$/, "").trim();
    if (start.length < 40 || start.length - speech < 30 || end.length < 20 || end.length > 95 || !/^\p{L}/u.test(end)) continue;
    const score = (m[1] ? 0 : 25) + Math.abs(end.length - 55);
    if (!best || score < best.score) best = { start, end, score };
  }
  return best;
}

const BOTH = "Аль-Бухари и Муслим";
const SOURCES = new Map([
  ["согласован аль-бухари и муслимом", BOTH], ["привели аль-бухари и муслим", BOTH], ["передали аль-бухари и муслим", BOTH],
  ["передал аль-бухари", "Аль-Бухари"], ["передал муслим", "Муслим"], ["передал абу давуд", "Абу Дауд"],
  ["передал абу дауд", "Абу Дауд"], ["передал ат-тирмизи", "Ат-Тирмизи"], ["передал ан-насаи", "Ан-Насаи"],
  ["передал ибн маджа", "Ибн Маджа"], ["передал ахмад", "Ахмад"],
]);
const OTHERS = ["Абу Дауд", "Ат-Тирмизи", "Ан-Насаи", "Ибн Маджа", "Ахмад"];
const sourceOf = (attribution) => SOURCES.get(String(attribution || "").toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim()) || null;

function finish(id, question, correct, wrong, h, rand) {
  const options = shuffle([correct, ...wrong], rand);
  const upper = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
  const about = [h.grade && `✅ ${h.grade}`, upper(h.attribution)].filter(Boolean).join(". ");
  const explanation = shorten(`${about}. Хадис №${id} — разъяснение по кнопке под опросом.`, 200);
  return { id: String(id), question, options, correct: options.indexOf(correct), explanation };
}

async function continueQuiz(items, order, rand) {
  const parts = new Map();
  for (const [id, title, text] of items) {
    const p = cut(quizText(text || title));
    if (p) parts.set(String(id), p);
  }
  let tries = 0;
  for (const [pickId] of order) {
    const id = String(pickId);
    if (!parts.has(id)) continue;
    if (++tries > 15) break;
    const h = await getHadith(id).catch(() => null);
    if (!isSahih(h)) continue;
    const { start, end } = parts.get(id);
    const wrong = [];
    for (const [other, p] of shuffle([...parts], rand)) {
      if (other === id || p.end.length < end.length * 0.6 || p.end.length > end.length * 1.7) continue;
      if (!wrong.includes(`…${p.end}`) && p.end !== end) wrong.push(`…${p.end}`);
      if (wrong.length === 3) break;
    }
    const question = `🧩 Викторина дня: продолжите хадис\n\n«${start} …»`;
    if (wrong.length < 3 || question.length > 300) continue;
    return { kind: "continue", ...finish(id, question, `…${end}`, wrong, h, rand) };
  }
  return null;
}

async function sourceQuiz(order, rand) {
  let tries = 0;
  for (const [id, title, text] of order) {
    const t = quizText(text || title);
    if (t.length < 40 || t.length > 230) continue;
    if (++tries > 15) break;
    const h = await getHadith(id).catch(() => null);
    const source = isSahih(h) && sourceOf(h.attribution);
    if (!source) continue;
    // Без «почти правильных» вариантов: если ответ — Бухари и/или Муслим, остальные варианты — другие сборники
    const pool = [BOTH, "Аль-Бухари", "Муслим"].includes(source) ? OTHERS : [...OTHERS.filter((s) => s !== source), BOTH];
    const question = `🧩 Викторина дня: кто из имамов привёл этот хадис?\n\n«${t}»`;
    if (question.length > 300) continue;
    return { kind: "source", ...finish(id, question, source, shuffle(pool, rand).slice(0, 3), h, rand) };
  }
  return null;
}

// Викторина на дату: через день — «продолжите хадис» и «кто привёл»; без повторов, пока есть новые хадисы
export async function buildQuiz(date, used = new Set()) {
  const rand = random(hashStr(`${date}:quiz`));
  // Только достоверные; если списка нет — каждый хадис всё равно проверяется перед вопросом
  const sahih = await sahihIds();
  const items = (await searchItems()).filter(([id]) => !sahih || sahih.has(String(id)));
  const order = shuffle(items, rand).filter(([id]) => !used.has(String(id)));
  const day = Math.floor(Date.parse(`${date}T00:00:00Z`) / 864e5);
  for (const kind of day % 2 ? ["source", "continue"] : ["continue", "source"]) {
    const quiz = kind === "continue" ? await continueQuiz(items, order, rand) : await sourceQuiz(order, rand);
    if (quiz) return { date, ...quiz };
  }
  throw new Error(`Не получилось составить викторину на ${date}`);
}

// Одна викторина на весь день — для каналов, подписчиков и кнопки «Викторина дня»
export async function todayQuiz(now = new Date()) {
  const { date } = localTime(now);
  if (!hasStore()) return buildQuiz(date);
  const saved = await kv.get(DAY(date));
  if (saved) return saved;
  const used = new Set(await kv.smembers(USED));
  if (used.size > 600) { await kv.del(USED); used.clear(); }
  const quiz = await buildQuiz(date, used);
  if (await kv.add(DAY(date), quiz, KEEP)) {
    await kv.sadd(USED, quiz.id);
    return quiz;
  }
  return (await kv.get(DAY(date))) || quiz;
}

// ------------------------------------------------------------- отправка

const SUB_ON = { text: `🔔 Присылать каждый день в ${TIME}`, callback_data: "qz:sub" };
const SUB_OFF = { text: "🔕 Не присылать каждый день", callback_data: "qz:unsub" };

// subscribe: "on" — подписан (кнопка «отписаться»), "off" — нет (кнопка «подписаться»)
export function sendQuiz(tg, chatId, quiz, { username, subscribe } = {}) {
  const rows = [];
  if (username) rows.push([{ text: "📖 Разъяснение хадиса", url: `https://t.me/${username}?startapp=h${quiz.id}_ru` }]);
  if (subscribe) rows.push([subscribe === "on" ? SUB_OFF : SUB_ON]);
  return tg("sendPoll", {
    chat_id: chatId,
    question: quiz.question,
    options: quiz.options.map((text) => ({ text })),
    type: "quiz",
    correct_option_id: quiz.correct,
    explanation: quiz.explanation,
    is_anonymous: true,
    ...(rows.length ? { reply_markup: { inline_keyboard: rows } } : {}),
  });
}

// Ежедневная рассылка. Вызывается по расписанию (несколько раз — на всякий случай),
// но отправляет один раз в день и не раньше 12:00.
export async function runDaily(tg, { now = new Date() } = {}) {
  if (!hasStore()) return { status: "no-store" };
  const { date, minutes } = localTime(now);
  if (minutes < quizMinutes()) return { status: "early", date };
  if (await kv.get(SENT(date))) return { status: "already", date };
  const quiz = await todayQuiz(now); // если не получилось — отметки нет, следующий вызов попробует снова
  if (!(await kv.add(SENT(date), Date.now(), KEEP))) return { status: "already", date };
  const username = process.env.BOT_USERNAME || (await tg("getMe"))?.username || "";
  let sent = 0;
  let failed = 0;
  for (const chatId of Object.keys(await kv.hgetall(CHATS))) {
    if (await sendQuiz(tg, chatId, quiz, { username })) sent++;
    else failed++;
  }
  for (const userId of await kv.smembers(SUBS)) {
    if (await sendQuiz(tg, userId, quiz, { username, subscribe: "on" })) { sent++; continue; }
    failed++;
    if (tg.lastError?.error_code === 403) await kv.srem(SUBS, userId); // пользователь остановил бота
  }
  return { status: "sent", date, hadith: quiz.id, sent, failed };
}

// ------------------------------------------------------------ в чате бота

export async function sendPersonalQuiz(tg, chatId, ctx, userId) {
  const quiz = await todayQuiz();
  const subscribe = ctx.private && hasStore() ? ((await kv.sismember(SUBS, userId)) ? "on" : "off") : undefined;
  return sendQuiz(tg, chatId, quiz, { username: ctx.username, subscribe });
}

async function adminView() {
  const chats = Object.entries(await kv.hgetall(CHATS));
  const subs = await kv.scard(SUBS);
  const text = `🧩 <b>Викторина дня</b>

Каждый день в ${TIME} (${TZ_LABEL}) бот присылает опрос-викторину по хадисам: «продолжите хадис» или «кто из имамов привёл хадис». Правильный ответ и источник видны сразу после ответа.

<b>Куда отправляется:</b>
${chats.length ? chats.map(([, c]) => `• ${c.type === "channel" ? "📣" : "👥"} ${esc(c.title)}`).join("\n") : "• пока ни в один канал"}
• 🔔 подписчикам в боте: ${subs}

➕ <b>Добавить канал или группу:</b> сделайте бота администратором с правом публиковать сообщения — я спрошу здесь подтверждение. Если бот уже там: <code>/quiz_add @имя_канала</code>`;
  return {
    text,
    reply_markup: {
      inline_keyboard: [
        ...chats.map(([id, c]) => [{ text: `🗑 Убрать «${shorten(c.title, 30)}»`, callback_data: `qz:rm:${id}` }]),
        [{ text: "▶️ Пробная викторина — мне", callback_data: "qz:test" }],
        [{ text: "« Полезные каналы", callback_data: "ch:list" }],
      ],
    },
  };
}

const canPost = (chat, member) => member?.status === "administrator"
  ? chat.type !== "channel" || member.can_post_messages !== false
  : member?.status === "member" && chat.type !== "channel";

async function addChat(chat) {
  await kv.hset(CHATS, chat.id, { title: chat.title || String(chat.id), type: chat.type });
}

export async function quizCallback(tg, cq, ctx) {
  const data = cq.data;
  const msg = cq.message;
  const answer = (text) => tg("answerCallbackQuery", { callback_query_id: cq.id, ...(text ? { text } : {}) });
  const edit = (view) => tg("editMessageText", { chat_id: msg.chat.id, message_id: msg.message_id, parse_mode: "HTML", ...view });

  if (data === "quiz") {
    await answer();
    return sendPersonalQuiz(tg, msg.chat.id, ctx, cq.from.id);
  }
  if (data === "qz:sub" || data === "qz:unsub") {
    if (!hasStore()) return answer("Подписка пока недоступна");
    const on = data === "qz:sub";
    await (on ? kv.sadd(SUBS, cq.from.id) : kv.srem(SUBS, cq.from.id));
    await answer(on ? `🔔 Буду присылать викторину каждый день в ${TIME}` : "🔕 Больше не буду присылать");
    const rows = (msg.reply_markup?.inline_keyboard || []).filter((row) => !row.some((b) => b.callback_data?.startsWith("qz:")));
    return tg("editMessageReplyMarkup", { chat_id: msg.chat.id, message_id: msg.message_id, reply_markup: { inline_keyboard: [...rows, [on ? SUB_OFF : SUB_ON]] } });
  }

  if (!isAdmin(cq.from?.id)) return answer("Только для администратора");
  if (!hasStore()) return answer("Хранилище не подключено — отправьте /admin");
  const [, action, id] = data.split(":");
  if (action === "test") {
    await answer("Отправляю пробную викторину");
    return sendQuiz(tg, cq.from.id, await todayQuiz(), { username: ctx.username });
  }
  if (action === "add") {
    const chat = await tg("getChat", { chat_id: id });
    if (!chat) {
      await answer();
      return edit({ text: "⚠️ Не получилось открыть этот чат. Проверьте, что бот всё ещё администратор, и добавьте его заново." });
    }
    await addChat(chat);
    await answer("Готово");
    return edit({
      text: `✅ Викторина будет приходить в «${esc(chat.title)}» каждый день в ${TIME} (${TZ_LABEL}).`,
      reply_markup: { inline_keyboard: [[{ text: "🧩 Настройки викторины", callback_data: "qz:admin" }]] },
    });
  }
  if (action === "no") {
    await answer();
    return edit({ text: "Хорошо, туда викторину отправлять не буду." });
  }
  if (action === "rm") await kv.hdel(CHATS, id);
  await answer(action === "rm" ? "Убрано" : undefined);
  return edit(await adminView());
}

// Бота добавили в канал/группу или убрали оттуда
export async function onChatMember(tg, update) {
  const { chat, from, new_chat_member: member } = update;
  if (!chat || chat.type === "private" || !hasStore()) return;
  if (!canPost(chat, member)) {
    await kv.hdel(CHATS, chat.id);
    if (member?.status === "administrator" && isAdmin(from?.id)) {
      return tg("sendMessage", { chat_id: from.id, parse_mode: "HTML", text: `🧩 Чтобы публиковать викторину в «${esc(chat.title)}», дайте боту право <b>«Публикация сообщений»</b>.` });
    }
    return;
  }
  if (!isAdmin(from?.id) || (await kv.hgetall(CHATS))[chat.id]) return;
  return tg("sendMessage", {
    chat_id: from.id,
    parse_mode: "HTML",
    text: `🧩 Меня добавили в ${chat.type === "channel" ? "канал" : "группу"} «${esc(chat.title)}».\n\nПубликовать там викторину по хадисам каждый день в ${TIME} (${TZ_LABEL})?`,
    reply_markup: { inline_keyboard: [[{ text: "✅ Да, публиковать", callback_data: `qz:add:${chat.id}` }, { text: "Нет", callback_data: "qz:no" }]] },
  });
}

// /quiz_add @канал — если бот уже был администратором до подключения викторины
export async function quizAddCommand(tg, msg, arg) {
  const reply = (text) => tg("sendMessage", { chat_id: msg.chat.id, parse_mode: "HTML", text });
  if (!isAdmin(msg.from?.id)) return reply("Эта команда только для администратора бота.");
  if (!hasStore()) return reply("⚠️ Сначала подключите хранилище — подробнее в /admin.");
  const name = String(arg || "").replace(/^(https?:\/\/)?(t\.me|telegram\.me)\//i, "").replace(/^@/, "").split(/[/?]/)[0];
  if (!name) return reply("Напишите так: <code>/quiz_add @имя_канала</code>");
  const chat = await tg("getChat", { chat_id: `@${name}` });
  if (!chat) return reply(`😔 Не нашёл @${esc(name)}. Проверьте имя канала.`);
  const me = await tg("getMe");
  const member = me && (await tg("getChatMember", { chat_id: chat.id, user_id: me.id }));
  if (!canPost(chat, member)) {
    return reply(`Сначала сделайте бота администратором «${esc(chat.title)}» с правом <b>«Публикация сообщений»</b>, потом повторите команду.`);
  }
  await addChat(chat);
  return reply(`✅ Викторина будет приходить в «${esc(chat.title)}» каждый день в ${TIME} (${TZ_LABEL}).`);
}

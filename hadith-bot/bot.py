"""Telegram-бот «Энциклопедия хадисов Пророка ﷺ».

Запуск:
    pip install -r requirements.txt
    cp .env.example .env      # и вписать BOT_TOKEN от @BotFather
    python bot.py
"""
from __future__ import annotations

import asyncio
import logging

from telegram import (
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    InlineQueryResultArticle,
    InlineQueryResultsButton,
    InputTextMessageContent,
    LinkPreviewOptions,
    ReplyParameters,
    Update,
)
from telegram.constants import ChatAction, ChatType, ParseMode
from telegram.error import BadRequest, Forbidden, TelegramError
from telegram.ext import (
    Application,
    ApplicationBuilder,
    CallbackQueryHandler,
    CommandHandler,
    ContextTypes,
    Defaults,
    InlineQueryHandler,
    MessageHandler,
    filters,
)
from telegram.request import BaseRequest

import texts
import views
from cards import CardRenderer
from config import Config
from hadeethenc import ApiError, HadeethEncClient, NotFound
from storage import UserStore

log = logging.getLogger("hadith_bot")

SECTIONS = ("exp", "hint", "wm", "ar")


class HadithBot:
    def __init__(self, config: Config, client: HadeethEncClient, store: UserStore, cards: CardRenderer) -> None:
        self.config = config
        self.client = client
        self.store = store
        self.cards = cards

    # ------------------------------------------------------------ helpers

    def lang_of(self, chat_id: int) -> str:
        return self.store.get_lang(chat_id) or self.config.default_language

    def fallbacks(self, lang: str) -> list[str]:
        return [lang, self.config.default_language, "ar"]

    def site_url(self, h: dict) -> str:
        return self.config.hadith_url_template.format(lang=h["lang"], id=h["id"])

    async def warm_index(self, lang: str) -> None:
        try:
            await self.client.index(lang)
        except ApiError:
            log.warning("Не удалось подготовить поиск для языка %s", lang, exc_info=True)

    async def send_hadeeth(self, bot, chat_id: int, hid: str, lang: str, *, title: str | None = None) -> None:
        h = await self.client.hadeeth_any(hid, self.fallbacks(lang))
        fallback = await self.client.language_name(h["lang"]) if h["lang"] != lang else None
        text = views.hadeeth_text(h, title=title, fallback_lang=fallback)
        markup = views.hadeeth_keyboard(
            h,
            site_url=self.site_url(h),
            bot_username=bot.username,
            inline_enabled=bool(bot.supports_inline_queries),
        )
        chunks = views.split_text(text)
        for chunk in chunks[:-1]:
            await bot.send_message(chat_id, chunk)
        await bot.send_message(chat_id, chunks[-1], reply_markup=markup)

    async def show_hadeeth(self, update: Update, context: ContextTypes.DEFAULT_TYPE, hid: str,
                           lang: str | None = None) -> None:
        chat_id = update.effective_chat.id
        await context.bot.send_chat_action(chat_id, ChatAction.TYPING)
        await self.send_hadeeth(context.bot, chat_id, hid, lang or self.lang_of(chat_id))

    @staticmethod
    async def edit(query, text: str, markup: InlineKeyboardMarkup | None) -> None:
        try:
            await query.edit_message_text(text, reply_markup=markup)
        except BadRequest as exc:
            if "not modified" not in str(exc).lower():
                raise

    # ----------------------------------------------------------- commands

    async def start(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        self.store.touch(update.effective_chat.id)
        arg = context.args[0] if context.args else ""
        if arg.startswith("h") and arg[1:].isdigit():
            await self.show_hadeeth(update, context, arg[1:])
            return
        await update.effective_message.reply_text(texts.WELCOME, reply_markup=views.main_menu())

    async def help(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        await update.effective_message.reply_text(texts.HELP, reply_markup=views.main_menu())

    async def about(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        await update.effective_message.reply_text(texts.ABOUT.format(site_url=views.esc(self.config.site_url)))

    async def share(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        link = views.bot_link(context.bot.username) or self.config.site_url
        markup = InlineKeyboardMarkup(
            [[InlineKeyboardButton(texts.SHARE_BUTTON, url=views.share_url(link, texts.SHARE_BOT_TEXT))]]
        )
        await update.effective_message.reply_text(texts.SHARE_BOT.format(bot_link=link), reply_markup=markup)

    async def random(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        lang = self.lang_of(update.effective_chat.id)
        hid = await self.client.random_id(lang)
        await self.show_hadeeth(update, context, hid, lang)

    async def categories(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        cats = await self.client.categories(self.lang_of(update.effective_chat.id))
        text, markup = views.categories_view(cats, None)
        await update.effective_message.reply_text(text, reply_markup=markup)

    async def language(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        current = self.lang_of(update.effective_chat.id)
        langs = await self.client.languages()
        position = next((i for i, l in enumerate(langs) if l["code"] == current), 0)
        text, markup = views.languages_view(langs, position // views.LANGUAGES_PAGE_SIZE + 1, current)
        await update.effective_message.reply_text(text, reply_markup=markup)

    async def daily(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        chat_id = update.effective_chat.id
        enabled = not self.store.is_daily(chat_id)
        self.store.set_daily(chat_id, enabled)
        if enabled:
            text = texts.DAILY_ON.format(
                time=self.config.daily_time.strftime("%H:%M"), tz=self.config.daily_time.tzinfo
            )
        else:
            text = texts.DAILY_OFF
        await update.effective_message.reply_text(text)

    async def search_command(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        query = " ".join(context.args or []).strip()
        if query:
            await self.search(update, context, query)
        else:
            await update.effective_message.reply_text(texts.SEARCH_PROMPT)

    async def on_text(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        text = (update.effective_message.text or "").strip()
        menu = {
            texts.BTN_CATEGORIES: self.categories,
            texts.BTN_RANDOM: self.random,
            texts.BTN_DAILY: self.daily,
            texts.BTN_LANGUAGE: self.language,
            texts.BTN_SHARE: self.share,
        }
        if text in menu:
            await menu[text](update, context)
        elif text == texts.BTN_SEARCH:
            await update.effective_message.reply_text(texts.SEARCH_PROMPT)
        elif text:
            await self.search(update, context, text)

    # ------------------------------------------------------------- search

    async def search(self, update: Update, context: ContextTypes.DEFAULT_TYPE, query: str) -> None:
        number = query.lstrip("№#").strip()
        if number.isdigit():
            await self.show_hadeeth(update, context, number)
            return

        chat_id = update.effective_chat.id
        lang = self.lang_of(chat_id)
        query = query[:100]
        notice = None
        if not self.client.index_ready(lang):
            notice = await update.effective_message.reply_text(texts.SEARCH_PREPARING)
        await context.bot.send_chat_action(chat_id, ChatAction.TYPING)
        try:
            results = await self.client.search(lang, query)
        finally:
            if notice:
                try:
                    await notice.delete()
                except TelegramError:
                    pass

        if not results:
            await update.effective_message.reply_text(texts.SEARCH_NOTHING.format(query=views.esc(query)))
            return
        context.user_data["search"] = {
            "query": query,
            "lang": lang,
            "items": [{"id": r["id"], "title": views.shorten(r["title"], 200)} for r in results],
        }
        text, markup = self.search_page(context.user_data["search"], 1)
        await update.effective_message.reply_text(text, reply_markup=markup)

    @staticmethod
    def search_page(data: dict, page: int) -> tuple[str, InlineKeyboardMarkup]:
        items = data["items"]
        last_page = max(1, -(-len(items) // views.LIST_PAGE_SIZE))
        page = min(max(1, page), last_page)
        chunk = items[(page - 1) * views.LIST_PAGE_SIZE : page * views.LIST_PAGE_SIZE]
        header = texts.SEARCH_RESULTS.format(query=views.esc(data["query"]), total=len(items))
        return views.hadeeth_list(header, chunk, page, last_page, lang=data["lang"], nav="srch:", back=None)

    # ---------------------------------------------------------- callbacks

    async def on_callback(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        query = update.callback_query
        action, _, rest = (query.data or "").partition(":")
        args = rest.split(":") if rest else []

        if action == "cat":
            await query.answer()
            await self.cb_category(update, args[0])
        elif action == "lst":
            await self.cb_list(update, args[0], int(args[1]))
        elif action == "srch":
            data = context.user_data.get("search")
            if not data:
                await query.answer(texts.SEARCH_EXPIRED, show_alert=True)
                return
            await query.answer()
            text, markup = self.search_page(data, int(args[0]))
            await self.edit(query, text, markup)
        elif action == "h":
            await query.answer()
            await self.show_hadeeth(update, context, args[0], args[1])
        elif action in SECTIONS:
            await query.answer()
            await self.cb_section(update, context, action, args[0], args[1])
        elif action == "card":
            await query.answer(texts.CARD_PREPARING)
            await self.cb_card(update, context, args[0], args[1])
        elif action == "lang":
            await self.cb_set_language(update, context, args[0])
        elif action == "langp":
            await query.answer()
            langs = await self.client.languages()
            text, markup = views.languages_view(langs, int(args[0]), self.lang_of(update.effective_chat.id))
            await self.edit(query, text, markup)
        else:
            await query.answer()

    async def cb_category(self, update: Update, category_id: str) -> None:
        query = update.callback_query
        lang = self.lang_of(update.effective_chat.id)
        cats = await self.client.categories(lang)
        category = next((c for c in cats if c["id"] == category_id), None)
        if category is None:
            text, markup = views.categories_view(cats, None)
        elif any(c["parent_id"] == category_id and c["count"] > 0 for c in cats):
            text, markup = views.categories_view(cats, category)
        else:
            await self.cb_list(update, category_id, 1, answered=True)
            return
        await self.edit(query, text, markup)

    async def cb_list(self, update: Update, category_id: str, page: int, *, answered: bool = False) -> None:
        query = update.callback_query
        lang = self.lang_of(update.effective_chat.id)
        cats = await self.client.categories(lang)
        category = next((c for c in cats if c["id"] == category_id), None)
        result = await self.client.hadeeths_page(lang, category_id, page, views.LIST_PAGE_SIZE)
        if not result["items"] or category is None:
            if not answered:
                await query.answer(texts.NO_HADEETHS, show_alert=True)
            return
        if not answered:
            await query.answer()
        has_children = any(c["parent_id"] == category_id and c["count"] > 0 for c in cats)
        back = f"cat:{category_id}" if has_children else f"cat:{category['parent_id'] or 0}"
        header = texts.CATEGORY_LIST.format(title=views.esc(category["title"]), total=result["total"])
        text, markup = views.hadeeth_list(
            header, result["items"], page, result["last_page"], lang=lang, nav=f"lst:{category_id}:", back=back
        )
        await self.edit(query, text, markup)

    async def cb_section(self, update: Update, context: ContextTypes.DEFAULT_TYPE, kind: str, hid: str,
                         lang: str) -> None:
        chat_id = update.effective_chat.id
        await context.bot.send_chat_action(chat_id, ChatAction.TYPING)
        if kind == "ar":
            h = await self.client.hadeeth("ar", hid)
        else:
            h = await self.client.hadeeth_any(hid, self.fallbacks(lang))
        message = update.callback_query.message
        reply = ReplyParameters(message.message_id, allow_sending_without_reply=True) if message else None
        for i, chunk in enumerate(views.split_text(views.section_text(kind, h))):
            await context.bot.send_message(chat_id, chunk, reply_parameters=reply if i == 0 else None)

    async def cb_card(self, update: Update, context: ContextTypes.DEFAULT_TYPE, hid: str, lang: str) -> None:
        chat_id = update.effective_chat.id
        await context.bot.send_chat_action(chat_id, ChatAction.UPLOAD_PHOTO)
        h = await self.client.hadeeth_any(hid, self.fallbacks(lang))
        note = ""
        if not self.cards.can_render(h["hadeeth"] or h["title"]):
            h = await self.client.hadeeth_any(hid, [self.config.default_language, "en", "ar"])
            note = texts.CARD_FALLBACK.format(lang=views.esc(await self.client.language_name(h["lang"]))) + "\n\n"
        attribution = " · ".join(x for x in (h["attribution"], h["grade"]) if x)
        png = await asyncio.to_thread(
            self.cards.render,
            text=h["hadeeth"] or h["title"],
            attribution=attribution,
            footer_title=texts.CARD_FOOTER_TITLE,
            footer_note=texts.CARD_FOOTER_NOTE.format(id=hid),
        )
        caption = note + texts.CARD_CAPTION.format(id=hid, bot_link=views.bot_link(context.bot.username))
        await context.bot.send_photo(chat_id, photo=png, caption=caption)

    async def cb_set_language(self, update: Update, context: ContextTypes.DEFAULT_TYPE, code: str) -> None:
        query = update.callback_query
        langs = await self.client.languages()
        language = next((l for l in langs if l["code"] == code), None)
        if language is None:
            await query.answer()
            return
        self.store.set_lang(update.effective_chat.id, code)
        await query.answer("✅ " + language["native"])
        await self.edit(query, texts.LANGUAGE_SET.format(lang=views.esc(language["native"])), None)
        context.application.create_task(self.warm_index(code))

    # ------------------------------------------------------------- inline

    async def on_inline(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        inline = update.inline_query
        text = inline.query.strip()
        lang = self.store.get_lang(inline.from_user.id) or self.config.default_language
        button = InlineQueryResultsButton(text=texts.INLINE_OPEN_BOT, start_parameter="inline")

        number = text.lstrip("№#").strip()
        if number.isdigit():
            ids = [number]
        elif not text:
            ids = self.client.sample(lang, 5) or [await self.client.random_id(lang)]
        elif self.client.index_ready(lang):
            ids = [r["id"] for r in (await self.client.search(lang, text))[:8]]
        else:
            context.application.create_task(self.warm_index(lang))
            await inline.answer([], cache_time=5, button=button)
            return

        found = await asyncio.gather(
            *(self.client.hadeeth_any(hid, self.fallbacks(lang)) for hid in ids), return_exceptions=True
        )
        results = []
        for h in found:
            if isinstance(h, Exception):
                continue
            message = views.hadeeth_text(h)
            if len(message) > views.MESSAGE_LIMIT:
                message = views.split_text(message)[0] + " …"
            results.append(
                InlineQueryResultArticle(
                    id=f"{h['id']}-{h['lang']}",
                    title=f"№{h['id']} · {views.shorten(h['title'] or h['hadeeth'], 80)}",
                    description=views.shorten(h["hadeeth"], 150),
                    input_message_content=InputTextMessageContent(
                        message, parse_mode=ParseMode.HTML, link_preview_options=LinkPreviewOptions(is_disabled=True)
                    ),
                    reply_markup=views.public_keyboard(
                        h, site_url=self.site_url(h), bot_username=context.bot.username
                    ),
                )
            )
        await inline.answer(results, cache_time=60, is_personal=True, button=button)

    # -------------------------------------------------------------- daily

    async def daily_job(self, context: ContextTypes.DEFAULT_TYPE) -> None:
        default = self.config.default_language
        try:
            hid = await self.client.random_id(default)
        except ApiError:
            log.exception("Хадис дня: сайт недоступен")
            return
        title = texts.DAILY_TITLE.format(id=hid)

        sent = 0
        for chat_id, lang in self.store.daily_subscribers():
            try:
                await self.send_hadeeth(context.bot, chat_id, hid, lang or default, title=title)
                sent += 1
            except Forbidden:
                self.store.set_daily(chat_id, False)
            except BadRequest as exc:
                if "chat not found" in str(exc).lower():
                    self.store.set_daily(chat_id, False)
                else:
                    log.warning("Хадис дня для %s: %s", chat_id, exc)
            except (ApiError, TelegramError) as exc:
                log.warning("Хадис дня для %s: %s", chat_id, exc)
            await asyncio.sleep(0.05)
        log.info("Хадис дня №%s отправлен %d подписчикам", hid, sent)

        if self.config.channel_id:
            try:
                h = await self.client.hadeeth_any(hid, self.fallbacks(default))
                chunks = views.split_text(views.hadeeth_text(h, title=title))
                markup = views.public_keyboard(h, site_url=self.site_url(h), bot_username=context.bot.username)
                for chunk in chunks[:-1]:
                    await context.bot.send_message(self.config.channel_id, chunk)
                await context.bot.send_message(self.config.channel_id, chunks[-1], reply_markup=markup)
            except (ApiError, TelegramError):
                log.exception("Не удалось отправить хадис дня в канал %s", self.config.channel_id)

    # ------------------------------------------------------------ service

    async def on_error(self, update: object, context: ContextTypes.DEFAULT_TYPE) -> None:
        error = context.error
        if isinstance(error, ApiError):
            log.warning("Ошибка API: %s", error)
        else:
            log.error("Ошибка при обработке обновления", exc_info=error)
        if not isinstance(update, Update):
            return
        if update.callback_query:
            try:
                await update.callback_query.answer()
            except TelegramError:
                pass
        chat = update.effective_chat
        if chat is None or chat.type == ChatType.CHANNEL:
            return
        if isinstance(error, NotFound):
            text = texts.NOT_FOUND
        elif isinstance(error, ApiError):
            text = texts.API_ERROR
        else:
            text = texts.UNKNOWN_ERROR
        try:
            await context.bot.send_message(chat.id, text)
        except TelegramError:
            pass

    async def post_init(self, app: Application) -> None:
        try:
            await app.bot.set_my_commands(texts.COMMANDS)
        except TelegramError:
            log.warning("Не удалось установить список команд", exc_info=True)
        app.job_queue.run_daily(self.daily_job, time=self.config.daily_time, name="daily-hadeeth")
        app.create_task(self.warm_index(self.config.default_language))
        log.info("Бот @%s запущен", app.bot.username)

    async def post_shutdown(self, app: Application) -> None:
        await self.client.close()
        self.store.close()

    def register(self, app: Application) -> None:
        private = filters.ChatType.PRIVATE
        app.add_handler(CommandHandler("start", self.start))
        app.add_handler(CommandHandler("help", self.help))
        app.add_handler(CommandHandler("about", self.about))
        app.add_handler(CommandHandler("share", self.share))
        app.add_handler(CommandHandler("random", self.random))
        app.add_handler(CommandHandler("categories", self.categories))
        app.add_handler(CommandHandler("language", self.language))
        app.add_handler(CommandHandler("daily", self.daily))
        app.add_handler(CommandHandler("search", self.search_command))
        app.add_handler(MessageHandler(private & filters.TEXT & ~filters.COMMAND, self.on_text))
        app.add_handler(CallbackQueryHandler(self.on_callback))
        app.add_handler(InlineQueryHandler(self.on_inline))
        app.add_error_handler(self.on_error)


def build_application(
    config: Config,
    client: HadeethEncClient,
    store: UserStore,
    cards: CardRenderer | None = None,
    request: BaseRequest | None = None,
) -> Application:
    bot = HadithBot(config, client, store, cards or CardRenderer())
    builder = (
        ApplicationBuilder()
        .token(config.bot_token)
        .defaults(Defaults(parse_mode=ParseMode.HTML, link_preview_options=LinkPreviewOptions(is_disabled=True)))
        .concurrent_updates(True)
        .post_init(bot.post_init)
        .post_shutdown(bot.post_shutdown)
    )
    if request is not None:
        builder = builder.request(request).get_updates_request(request)
    app = builder.build()
    bot.register(app)
    app.bot_data["hadith_bot"] = bot
    return app


def main() -> None:
    logging.basicConfig(format="%(asctime)s %(levelname)s %(name)s: %(message)s", level=logging.INFO)
    # httpx пишет в лог полные адреса запросов, а в них есть токен бота
    logging.getLogger("httpx").setLevel(logging.WARNING)

    config = Config.from_env()
    client = HadeethEncClient(config.api_base, config.data_dir / "cache")
    store = UserStore(config.data_dir / "users.sqlite3")
    app = build_application(config, client, store)
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()

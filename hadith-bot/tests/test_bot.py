"""Сквозные сценарии: обновления от «пользователя» → обработчики → запросы к Bot API."""
import pytest

import texts
from bot import build_application
from conftest import FakeTelegram, Updates


@pytest.fixture
async def bot_env(config, client, store):
    telegram = FakeTelegram()
    app = build_application(config, client, store, request=telegram)
    async with app:
        yield app, telegram, Updates(app.bot), store


def texts_of(telegram, method="sendMessage"):
    return [p.get("text") or p.get("caption") or "" for p in telegram.named(method)]


async def test_start_shows_menu(bot_env):
    app, tg, up, _ = bot_env
    await app.process_update(up.message("/start"))
    sent = tg.named("sendMessage")[-1]
    assert sent["text"] == texts.WELCOME
    assert sent["reply_markup"]["keyboard"][0][0]["text"] == texts.BTN_CATEGORIES


async def test_deep_link_opens_hadeeth(bot_env):
    app, tg, up, _ = bot_env
    await app.process_update(up.message("/start h2"))
    assert "Хадис №2" in texts_of(tg)[-1]


async def test_search_then_open_and_sections(bot_env):
    app, tg, up, _ = bot_env
    await app.process_update(up.message("намерениям"))
    result = tg.named("sendMessage")[-1]
    assert "Найдено" in result["text"]
    button = result["reply_markup"]["inline_keyboard"][0][0]
    assert button["callback_data"] == "h:1:ru"

    await app.process_update(up.callback(button["callback_data"]))
    hadeeth = tg.named("sendMessage")[-1]
    assert "Хадис №1" in hadeeth["text"]
    assert "&lt;с символами &amp; и &gt;" in hadeeth["text"]
    callbacks = [b.get("callback_data") for row in hadeeth["reply_markup"]["inline_keyboard"] for b in row]
    assert {"exp:1:ru", "hint:1:ru", "ar:1:ru", "card:1:ru"} <= set(callbacks)

    before = len(tg.named("sendMessage"))
    await app.process_update(up.callback("exp:1:ru"))
    explanation = tg.named("sendMessage")[before:]
    assert len(explanation) >= 2  # длинное разъяснение разбито на части
    assert all(len(m["text"]) <= 4096 for m in explanation)
    assert explanation[0]["reply_parameters"]["message_id"] == 7

    await app.process_update(up.callback("hint:1:ru"))
    assert "▪️ Важность намерения." in texts_of(tg)[-1]

    await app.process_update(up.callback("ar:1:ru"))
    assert "إنما الأعمال بالنيات" in texts_of(tg)[-1]


async def test_search_pagination_and_nothing_found(bot_env):
    app, tg, up, _ = bot_env
    await app.process_update(up.message("благом нраве"))
    first = tg.named("sendMessage")[-1]
    assert "Стр. 1 из 3" in first["text"]

    await app.process_update(up.callback("srch:2"))
    assert "Стр. 2 из 3" in tg.named("editMessageText")[-1]["text"]

    await app.process_update(up.message("абракадабра"))
    assert "ничего не найдено" in texts_of(tg)[-1]


async def test_number_opens_hadeeth_and_unknown_number(bot_env):
    app, tg, up, _ = bot_env
    await app.process_update(up.message("№3"))
    assert "Хадис №3" in texts_of(tg)[-1]

    await app.process_update(up.message("777777"))
    assert texts_of(tg)[-1] == texts.NOT_FOUND


async def test_fallback_language_notice(bot_env):
    app, tg, up, _ = bot_env
    await app.process_update(up.message("99"))
    assert "показан перевод: العربية" in texts_of(tg)[-1]


async def test_categories_navigation(bot_env):
    app, tg, up, _ = bot_env
    await app.process_update(up.message(texts.BTN_CATEGORIES))
    roots = tg.named("sendMessage")[-1]["reply_markup"]["inline_keyboard"]
    assert [r[0]["callback_data"] for r in roots] == ["cat:1", "cat:3"]

    await app.process_update(up.callback("cat:1"))  # есть подраздел
    sub = tg.named("editMessageText")[-1]["reply_markup"]["inline_keyboard"]
    assert [r[0]["callback_data"] for r in sub] == ["cat:2", "lst:1:1", "cat:0"]

    await app.process_update(up.callback("cat:3"))  # подразделов нет — сразу список
    listing = tg.named("editMessageText")[-1]
    assert "Нравы" in listing["text"] and "Стр. 1 из 3" in listing["text"]

    await app.process_update(up.callback("lst:3:3"))
    assert "Стр. 3 из 3" in tg.named("editMessageText")[-1]["text"]


async def test_card_is_sent_as_photo(bot_env):
    app, tg, up, _ = bot_env
    await app.process_update(up.callback("card:1:ru"))
    photo = tg.named("sendPhoto")[-1]
    assert "Карточка хадиса №1" in photo["caption"]


async def test_language_and_daily_settings(bot_env):
    app, tg, up, store = bot_env
    await app.process_update(up.message(texts.BTN_LANGUAGE))
    assert "Русский" in texts_of(tg)[-1]

    await app.process_update(up.callback("langp:2"))
    await app.process_update(up.callback("lang:en"))
    assert store.get_lang(42) == "en"

    await app.process_update(up.message("/daily"))
    assert store.is_daily(42)
    assert "08:00" in texts_of(tg)[-1]
    await app.process_update(up.message("/daily"))
    assert not store.is_daily(42)


async def test_daily_job_sends_to_subscribers_and_channel(bot_env):
    app, tg, up, store = bot_env
    store.set_daily(42, True)
    store.set_daily(43, True)
    store.set_lang(43, "en")
    hadith_bot = app.bot_data["hadith_bot"]

    class Ctx:
        bot = app.bot

    await hadith_bot.daily_job(Ctx())
    sent = tg.named("sendMessage")
    recipients = [m["chat_id"] for m in sent]
    assert recipients.count(42) == 1 and recipients.count(43) == 1
    assert "@hadith_channel" in recipients
    channel = next(m for m in sent if m["chat_id"] == "@hadith_channel")
    assert all("url" in b for row in channel["reply_markup"]["inline_keyboard"] for b in row)


async def test_inline_mode(bot_env):
    app, tg, up, _ = bot_env
    await app.process_update(up.inline("2"))
    answer = tg.named("answerInlineQuery")[-1]
    assert answer["results"][0]["id"] == "2-ru"

    await app.process_update(up.inline("намерения"))  # индекс ещё не готов — пустой ответ
    await app.bot_data["hadith_bot"].client.index("ru")
    await app.process_update(up.inline("намерения"))
    answer = tg.named("answerInlineQuery")[-1]
    assert [r["id"] for r in answer["results"]] == ["1-ru"]


async def test_api_down_message(bot_env, fake_api):
    app, tg, up, _ = bot_env
    fake_api.down = True
    await app.process_update(up.message(texts.BTN_RANDOM))
    assert texts_of(tg)[-1] == texts.API_ERROR

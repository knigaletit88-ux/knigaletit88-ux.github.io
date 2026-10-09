"""Общие заглушки для тестов: имитация API HadeethEnc и Bot API Telegram."""
from __future__ import annotations

import itertools
import json
from datetime import time
from zoneinfo import ZoneInfo

import httpx
import pytest
from telegram import Update
from telegram.request import BaseRequest

from config import Config
from hadeethenc import HadeethEncClient
from storage import UserStore

API = "https://hadeethenc.test/api/v1"

LANGUAGES = [{"code": "ar", "native": "العربية"}, {"code": "ru", "native": "Русский"}, {"code": "en", "native": "English"}]
LANGUAGES += [{"code": f"x{i}", "native": f"Язык {i}"} for i in range(30)]

CATEGORIES = [
    {"id": "1", "title": "Вероубеждение", "hadeeths_count": "3", "parent_id": None},
    {"id": "2", "title": "Единобожие", "hadeeths_count": "2", "parent_id": "1"},
    {"id": "3", "title": "Нравы", "hadeeths_count": "25", "parent_id": None},
]
CATEGORY_ITEMS = {"1": ["1", "2", "3"], "2": ["1", "2"], "3": [str(i) for i in range(10, 35)]}

TITLES = {
    "1": "Поистине, дела оцениваются только по намерениям",
    "2": "Ислам основан на пяти столпах",
    "3": "Вера — это семьдесят с лишним ветвей, и стыдливость — ветвь веры",
}
TITLES.update({str(i): f"Хадис о благом нраве номер {i}" for i in range(10, 35)})
TITLES["20"] = "Лучшие из вас — лучшие нравом, и ещё: Ёмкое слово"

AR = {"99": "حديث بالعربية فقط"}


def hadeeth_json(hid: str, lang: str) -> dict:
    if lang == "ar":
        return {
            "id": hid, "title": "إنما الأعمال بالنيات", "hadeeth": "إنما الأعمال بالنيات وإنما لكل امرئ ما نوى",
            "attribution": "متفق عليه", "grade": "صحيح", "explanation": "شرح", "hints": ["فائدة"],
            "words_meanings": [{"word": "النيات", "meaning": "القصد"}], "reference": "صحيح البخاري",
        }
    return {
        "id": hid,
        "title": TITLES[hid],
        "hadeeth": TITLES[hid] + ". Полный текст хадиса <с символами & и >.",
        "attribution": "Передали аль-Бухари и Муслим",
        "grade": "Достоверный",
        "explanation": "Разъяснение. " * 600,  # длиннее одного сообщения Telegram
        "hints": ["Важность намерения.", "Дела зависят от намерений."],
        "translations": ["ar", "ru", "en"],
        "hadeeth_ar": "إنما الأعمال بالنيات",
    }


class FakeApi:
    def __init__(self) -> None:
        self.calls: list[str] = []
        self.down = False

    def __call__(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path.removeprefix("/api/v1/").strip("/")
        q = request.url.params
        self.calls.append(f"{path}?{q}")
        if self.down:
            return httpx.Response(503)
        lang = q.get("language")
        if path == "languages":
            return httpx.Response(200, json=LANGUAGES)
        if path == "categories/list":
            return httpx.Response(200, json=CATEGORIES if lang != "zz" else [])
        if path == "hadeeths/list":
            ids = CATEGORY_ITEMS.get(q["category_id"], [])
            page, per_page = int(q.get("page", 1)), int(q.get("per_page", 20))
            chunk = ids[(page - 1) * per_page : page * per_page]
            return httpx.Response(200, json={
                "data": [{"id": i, "title": TITLES[i], "translations": ["ru"]} for i in chunk],
                "meta": {"current_page": str(page), "last_page": max(1, -(-len(ids) // per_page)),
                         "total_items": len(ids), "per_page": str(per_page)},
            })
        if path == "hadeeths/one":
            hid = q["id"]
            if lang == "ar" and (hid in TITLES or hid in AR):
                return httpx.Response(200, json=hadeeth_json(hid, "ar"))
            if lang in ("ru", "en") and hid in TITLES:
                return httpx.Response(200, json=hadeeth_json(hid, lang))
            return httpx.Response(404, json={"message": "not found"})
        return httpx.Response(404)


class FakeTelegram(BaseRequest):
    """Перехватывает все запросы к Bot API и запоминает их."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, dict]] = []
        self._ids = itertools.count(100)

    async def initialize(self) -> None:
        pass

    async def shutdown(self) -> None:
        pass

    @property
    def read_timeout(self) -> float:
        return 5

    async def do_request(self, url, method, request_data=None, **kwargs):
        name = url.rsplit("/", 1)[-1]
        params = request_data.parameters if request_data else {}
        self.calls.append((name, params))
        if name == "getMe":
            result = {
                "id": 1, "is_bot": True, "first_name": "Hadith", "username": "hadith_test_bot",
                "can_join_groups": True, "can_read_all_group_messages": False, "supports_inline_queries": True,
            }
        elif name in ("sendMessage", "sendPhoto", "editMessageText"):
            result = {
                "message_id": next(self._ids), "date": 0,
                "chat": {"id": params.get("chat_id", 1), "type": "private"},
                "text": params.get("text", ""),
            }
        elif name == "getUpdates":
            result = []
        else:
            result = True
        return 200, json.dumps({"ok": True, "result": result}).encode()

    def named(self, name: str) -> list[dict]:
        return [params for n, params in self.calls if n == name]


@pytest.fixture
def fake_api() -> FakeApi:
    return FakeApi()


@pytest.fixture
async def client(tmp_path, fake_api):
    c = HadeethEncClient(API, tmp_path / "cache", transport=httpx.MockTransport(fake_api), retry_delay=0)
    yield c
    await c.close()


@pytest.fixture
def config(tmp_path) -> Config:
    return Config(
        bot_token="123456:TEST",
        default_language="ru",
        data_dir=tmp_path,
        api_base=API,
        hadith_url_template="https://sarhaan.com/hadeeth/{lang}/{id}/",
        site_url="https://sarhaan.com/hadeeth/ru/",
        daily_time=time(8, 0, tzinfo=ZoneInfo("Europe/Moscow")),
        channel_id="@hadith_channel",
    )


@pytest.fixture
def store(tmp_path):
    s = UserStore(tmp_path / "users.sqlite3")
    yield s


class Updates:
    """Фабрика входящих обновлений от пользователя."""

    def __init__(self, bot, user_id: int = 42) -> None:
        self.bot = bot
        self.user = {"id": user_id, "is_bot": False, "first_name": "Абдулла"}
        self.chat = {"id": user_id, "type": "private"}
        self._ids = itertools.count(1)

    def message(self, text: str) -> Update:
        msg = {"message_id": next(self._ids), "date": 0, "chat": self.chat, "from": self.user, "text": text}
        if text.startswith("/"):
            msg["entities"] = [{"type": "bot_command", "offset": 0, "length": len(text.split()[0])}]
        return Update.de_json({"update_id": next(self._ids), "message": msg}, self.bot)

    def callback(self, data: str) -> Update:
        return Update.de_json({
            "update_id": next(self._ids),
            "callback_query": {
                "id": str(next(self._ids)), "from": self.user, "chat_instance": "ci", "data": data,
                "message": {"message_id": 7, "date": 0, "chat": self.chat, "text": "…"},
            },
        }, self.bot)

    def inline(self, query: str) -> Update:
        return Update.de_json({
            "update_id": next(self._ids),
            "inline_query": {"id": str(next(self._ids)), "from": self.user, "query": query, "offset": ""},
        }, self.bot)

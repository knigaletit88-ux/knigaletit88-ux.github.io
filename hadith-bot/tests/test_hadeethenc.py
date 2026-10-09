import httpx
import pytest

from conftest import API
from hadeethenc import ApiError, HadeethEncClient, NotFound, normalize


async def test_languages_and_categories(client):
    langs = await client.languages()
    assert {"code": "ru", "native": "Русский"} in langs

    cats = await client.categories("ru")
    assert cats[0] == {"id": "1", "title": "Вероубеждение", "count": 3, "parent_id": None}
    assert cats[1]["parent_id"] == "1"


async def test_hadeeths_page_reads_meta(client):
    page = await client.hadeeths_page("ru", "3", page=2, per_page=10)
    assert [it["id"] for it in page["items"]] == [str(i) for i in range(20, 30)]
    assert page["last_page"] == 3
    assert page["total"] == 25


async def test_hadeeth_and_language_fallback(client):
    h = await client.hadeeth("ru", "1")
    assert h["lang"] == "ru"
    assert h["hints"] == ["Важность намерения.", "Дела зависят от намерений."]

    h = await client.hadeeth_any("99", ["ru", "ru", "ar"])
    assert h["lang"] == "ar"

    with pytest.raises(NotFound):
        await client.hadeeth_any("12345", ["ru", "ar"])


async def test_index_crawls_every_page_once(client, fake_api):
    items = await client.index("ru")
    assert len(items) == 28  # 1, 2, 3 и 10…34 без повторов
    assert client.index_ready("ru")

    calls = len(fake_api.calls)
    await client.index("ru")
    assert len(fake_api.calls) == calls  # второй раз — из памяти


async def test_index_is_saved_to_disk(tmp_path, fake_api):
    first = HadeethEncClient(API, tmp_path, transport=httpx.MockTransport(fake_api), retry_delay=0)
    await first.index("ru")
    await first.close()

    fake_api.down = True
    second = HadeethEncClient(API, tmp_path, transport=httpx.MockTransport(fake_api), retry_delay=0)
    assert len(await second.index("ru")) == 28
    await second.close()


async def test_search(client):
    assert [r["id"] for r in await client.search("ru", "НАМЕРЕНИЯМ")] == ["1"]
    # ё и е не различаются, слова ищутся в любом порядке
    assert [r["id"] for r in await client.search("ru", "емкое лучшие")] == ["20"]
    results = await client.search("ru", "нраве благом")
    assert len(results) == 24
    assert await client.search("ru", "!!!") == []


async def test_random_id_without_and_with_index(client):
    assert await client.random_id("ru") in {"1", "2", "3", *map(str, range(10, 35))}
    await client.index("ru")
    assert await client.random_id("ru") in {it["id"] for it in await client.index("ru")}


async def test_api_errors(client, fake_api):
    fake_api.down = True
    with pytest.raises(ApiError):
        await client.languages()


def test_normalize():
    assert normalize("  Ёлка, «Привет»!  ") == "елка привет"
    assert normalize("إِنَّمَا الأَعْمَالُ") == "انما الاعمال"

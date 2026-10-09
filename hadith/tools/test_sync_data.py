"""Проверка sync_data.py на имитации API: python -m pytest hadith/tools"""
import json

import pytest

import sync_data

CATS = [
    {"id": "1", "title": "Вероубеждение", "hadeeths_count": "3", "parent_id": None},
    {"id": "2", "title": "Единобожие", "hadeeths_count": "2", "parent_id": "1"},
    {"id": "3", "title": "Нравы", "hadeeths_count": "1", "parent_id": None},
]
LISTS = {"1": ["10", "11", "12"], "3": ["12", "13"]}
HADITH_CATS = {"10": ["2"], "11": ["2"], "12": ["1", "3"], "13": ["3"]}


def fake_get(path, **params):
    if path == "languages":
        return [{"code": "ru", "native": "Русский"}, {"code": "ar", "native": "العربية"}]
    if path == "categories/list/":
        return CATS
    if path == "hadeeths/list/":
        ids = LISTS[params["category_id"]]
        return {"data": [{"id": i, "title": f"Хадис {i}"} for i in ids], "meta": {"last_page": 1}}
    if path == "hadeeths/one/":
        hid = params["id"]
        if hid == "13" and params["language"] == "ru":
            raise sync_data.NotFound(hid)
        if params["language"] == "ar":
            return {"id": hid, "reference": "صحيح البخاري\r\n(1)"}
        return {"id": hid, "title": f"Хадис {hid}", "hadeeth": "Текст\r\n", "hints": ["Вывод\r", ""],
                "categories": HADITH_CATS[hid], "words_meanings_ar": []}
    raise AssertionError(path)


@pytest.fixture(autouse=True)
def api(monkeypatch):
    monkeypatch.setattr(sync_data, "get", fake_get)


def test_sync(tmp_path, monkeypatch):
    monkeypatch.setattr("sys.argv", ["sync", "--langs", "ru", "--out", str(tmp_path)])
    sync_data.main()

    index = json.loads((tmp_path / "ru/index.json").read_text())
    assert index == [["10", "Хадис 10"], ["11", "Хадис 11"], ["12", "Хадис 12"]]  # 13 не переведён
    cats = {c["id"]: c["ids"] for c in json.loads((tmp_path / "ru/categories.json").read_text())}
    assert cats == {"1": ["10", "11", "12"], "2": ["10", "11"], "3": ["12"]}

    h = json.loads((tmp_path / "ru/h/12.json").read_text())
    assert h["hadeeth"] == "Текст" and h["hints"] == ["Вывод"]
    assert h["reference"] == "صحيح البخاري\n(1)"
    assert "words_meanings_ar" not in h
    meta = json.loads((tmp_path / "meta.json").read_text())
    assert meta["stats"] == {"ru": {"hadeeths": 3}}

    # Повторный запуск без изменений не трогает файлы
    before = (tmp_path / "meta.json").read_text()
    sync_data.main()
    assert (tmp_path / "meta.json").read_text() == before

"""Клиент открытого API HadeethEnc.com — «Энциклопедии переведённых хадисов».

Документация API: https://documenter.getpostman.com/view/5211979/TVev3j7q
Используемые методы:
    GET /languages
    GET /categories/list/?language=ru
    GET /hadeeths/list/?language=ru&category_id=1&page=1&per_page=20
    GET /hadeeths/one/?language=ru&id=2962

У API нет метода поиска, поэтому бот один раз скачивает список всех
хадисов выбранного языка (номер + заголовок), сохраняет его на диск
и ищет по нему локально.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import random
import re
import time
import unicodedata
from collections import OrderedDict
from pathlib import Path
from typing import Any, Awaitable, Callable

import httpx

log = logging.getLogger(__name__)


class ApiError(Exception):
    """Сайт недоступен или вернул ошибку."""


class NotFound(ApiError):
    """Хадис не найден (или не переведён на этот язык)."""


_ARABIC_MARKS = re.compile(r"[ؐ-ًؚ-ٰٟۖ-ۭـ]")
_ALEF_FORMS = re.compile("[إأآٱ]")


def normalize(text: str) -> str:
    """Приводит текст к виду для поиска: регистр, ё/е, огласовки, пунктуация."""
    text = unicodedata.normalize("NFKC", text).casefold().replace("ё", "е")
    text = _ARABIC_MARKS.sub("", text)
    text = _ALEF_FORMS.sub("ا", text).replace("ى", "ي")
    text = "".join(
        " " if unicodedata.category(ch)[0] in "PSZC" else ch for ch in text
    )
    return " ".join(text.split())


def _text(value: Any) -> str:
    if not value:
        return ""
    return str(value).replace("\r\n", "\n").replace("\r", "\n").strip()


def _int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _clean_hadeeth(raw: dict, lang: str) -> dict:
    hints = raw.get("hints") or []
    if isinstance(hints, str):
        hints = [hints]
    # В API поле называется words_meanings (значения слов есть только в арабской версии)
    words = raw.get("words_meanings") or raw.get("words_meaning") or []
    if not isinstance(words, list):
        words = []
    return {
        "id": str(raw.get("id", "")),
        "lang": lang,
        "title": _text(raw.get("title")),
        "hadeeth": _text(raw.get("hadeeth")),
        "attribution": _text(raw.get("attribution")),
        "grade": _text(raw.get("grade")),
        "explanation": _text(raw.get("explanation")),
        "hints": [_text(h) for h in hints if _text(h)],
        "words_meaning": [
            {"word": _text(w.get("word")), "meaning": _text(w.get("meaning"))}
            for w in words
            if isinstance(w, dict) and _text(w.get("word"))
        ],
        "reference": _text(raw.get("reference")),
        "hadeeth_ar": _text(raw.get("hadeeth_ar")),
        "attribution_ar": _text(raw.get("attribution_ar")),
        "grade_ar": _text(raw.get("grade_ar")),
        "translations": [str(t) for t in raw.get("translations") or []],
    }


class HadeethEncClient:
    LANGUAGES_TTL = 7 * 24 * 3600
    CATEGORIES_TTL = 24 * 3600
    INDEX_TTL = 7 * 24 * 3600
    LIST_TTL = 3600
    HADEETH_CACHE_SIZE = 500

    def __init__(
        self,
        base_url: str,
        cache_dir: Path,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
        timeout: float = 20.0,
        concurrency: int = 4,
        retry_delay: float = 0.7,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self._http = httpx.AsyncClient(
            timeout=timeout,
            transport=transport,
            follow_redirects=True,
            headers={
                "User-Agent": "HadithTelegramBot/1.0 (+https://hadeethenc.com)",
                "Accept": "application/json",
            },
        )
        self._sem = asyncio.Semaphore(concurrency)
        self._retry_delay = retry_delay
        self._memory: dict[str, tuple[float, Any]] = {}
        self._hadeeths: OrderedDict[tuple[str, str], dict] = OrderedDict()
        self._indexes: dict[str, tuple[float, list[dict]]] = {}
        self._index_locks: dict[str, asyncio.Lock] = {}

    async def close(self) -> None:
        await self._http.aclose()

    # ------------------------------------------------------------------ HTTP

    async def _get(self, path: str, **params: Any) -> Any:
        url = f"{self.base_url}/{path.lstrip('/')}"
        last_error: Exception | None = None
        for attempt in range(3):
            try:
                async with self._sem:
                    resp = await self._http.get(url, params=params)
                if resp.status_code == 404:
                    raise NotFound(f"{path} {params}")
                if resp.status_code >= 500:
                    last_error = ApiError(f"HTTP {resp.status_code} {path}")
                elif resp.status_code >= 400:
                    raise ApiError(f"HTTP {resp.status_code} {path} {params}")
                else:
                    return resp.json()
            except (httpx.TransportError, ValueError) as exc:
                last_error = exc
            if attempt < 2:
                await asyncio.sleep(self._retry_delay * 2**attempt)
        raise ApiError(f"Не удалось получить {path}: {last_error}") from last_error

    # ----------------------------------------------------------------- cache

    def _cache_path(self, key: str) -> Path:
        return self.cache_dir / f"{key}.json"

    def _save(self, key: str, data: Any) -> None:
        path = self._cache_path(key)
        tmp = path.with_suffix(".tmp")
        try:
            tmp.write_text(
                json.dumps({"saved_at": time.time(), "data": data}, ensure_ascii=False),
                encoding="utf-8",
            )
            os.replace(tmp, path)
        except OSError:
            log.warning("Не удалось сохранить кеш %s", path, exc_info=True)

    async def _cached(self, key: str, ttl: float, loader: Callable[[], Awaitable[Any]]) -> Any:
        now = time.time()
        hit = self._memory.get(key)
        if hit and now - hit[0] < ttl:
            return hit[1]

        stale = None
        try:
            stored = json.loads(self._cache_path(key).read_text(encoding="utf-8"))
            if now - stored["saved_at"] < ttl:
                self._memory[key] = (stored["saved_at"], stored["data"])
                return stored["data"]
            stale = stored["data"]
        except (OSError, ValueError, KeyError, TypeError):
            pass

        try:
            data = await loader()
        except ApiError:
            if stale is not None:
                log.warning("Сайт недоступен, использую старый кеш %s", key)
                return stale
            raise
        self._save(key, data)
        self._memory[key] = (now, data)
        return data

    # ------------------------------------------------------------------- API

    async def languages(self) -> list[dict]:
        async def load() -> list[dict]:
            raw = await self._get("languages")
            return [
                {"code": str(item["code"]), "native": _text(item.get("native")) or str(item["code"])}
                for item in raw
                if isinstance(item, dict) and item.get("code")
            ]

        return await self._cached("languages", self.LANGUAGES_TTL, load)

    async def language_name(self, code: str) -> str:
        try:
            for lang in await self.languages():
                if lang["code"] == code:
                    return lang["native"]
        except ApiError:
            pass
        return code

    async def categories(self, lang: str) -> list[dict]:
        async def load() -> list[dict]:
            raw = await self._get("categories/list/", language=lang)
            result = []
            for item in raw:
                if not isinstance(item, dict) or item.get("id") in (None, ""):
                    continue
                parent = item.get("parent_id")
                result.append(
                    {
                        "id": str(item["id"]),
                        "title": _text(item.get("title")),
                        "count": _int(item.get("hadeeths_count")),
                        "parent_id": str(parent) if parent not in (None, "", 0, "0") else None,
                    }
                )
            return result

        return await self._cached(f"categories_{lang}", self.CATEGORIES_TTL, load)

    async def hadeeths_page(
        self, lang: str, category_id: str, page: int = 1, per_page: int = 10, *, use_cache: bool = True
    ) -> dict:
        key = f"list_{lang}_{category_id}_{page}_{per_page}"
        hit = self._memory.get(key)
        if use_cache and hit and time.time() - hit[0] < self.LIST_TTL:
            return hit[1]

        raw = await self._get(
            "hadeeths/list/", language=lang, category_id=category_id, page=page, per_page=per_page
        )
        if isinstance(raw, list):  # на случай ответа без обёртки data/meta
            raw = {"data": raw}
        items = [
            {"id": str(it["id"]), "title": _text(it.get("title"))}
            for it in raw.get("data") or []
            if isinstance(it, dict) and it.get("id") not in (None, "")
        ]
        meta = raw.get("meta") or {}
        total = _int(meta.get("total_items"), len(items))
        last_page = max(1, _int(meta.get("last_page"), 1))
        result = {
            "items": items,
            "page": _int(meta.get("current_page"), page),
            "last_page": last_page,
            "total": total,
        }
        if use_cache:
            self._memory[key] = (time.time(), result)
        return result

    async def hadeeth(self, lang: str, hadeeth_id: str) -> dict:
        key = (lang, str(hadeeth_id))
        if key in self._hadeeths:
            self._hadeeths.move_to_end(key)
            return self._hadeeths[key]

        raw = await self._get("hadeeths/one/", language=lang, id=hadeeth_id)
        if not isinstance(raw, dict) or not (raw.get("hadeeth") or raw.get("title")):
            raise NotFound(f"Хадис {hadeeth_id} ({lang}) не найден")
        data = _clean_hadeeth(raw, lang)
        data["id"] = data["id"] or str(hadeeth_id)

        self._hadeeths[key] = data
        if len(self._hadeeths) > self.HADEETH_CACHE_SIZE:
            self._hadeeths.popitem(last=False)
        return data

    async def hadeeth_any(self, hadeeth_id: str, languages: list[str]) -> dict:
        """Хадис на первом языке из списка, на который он переведён."""
        last_error: ApiError | None = None
        for lang in dict.fromkeys(languages):
            try:
                return await self.hadeeth(lang, hadeeth_id)
            except NotFound as exc:
                last_error = exc
        raise last_error or NotFound(hadeeth_id)

    # ---------------------------------------------------------- поиск/индекс

    def index_ready(self, lang: str) -> bool:
        loaded = self._indexes.get(lang)
        return bool(loaded) and time.time() - loaded[0] < self.INDEX_TTL

    async def _build_index(self, lang: str) -> list[dict]:
        log.info("Строю поисковый индекс для языка %s…", lang)
        categories = await self.categories(lang)
        titles: dict[str, str] = {}

        async def crawl(category_id: str) -> None:
            page, last_page = 1, 1
            while page <= last_page:
                result = await self.hadeeths_page(lang, category_id, page, 1000, use_cache=False)
                for item in result["items"]:
                    titles.setdefault(item["id"], item["title"])
                last_page = result["last_page"]
                page += 1

        # Список корневого раздела содержит хадисы всех его подразделов,
        # поэтому достаточно обойти корни (7 запросов вместо сотен).
        roots = [c for c in categories if c["parent_id"] is None]
        targets = [c["id"] for c in roots if c["count"] > 0] or [c["id"] for c in categories]
        results = await asyncio.gather(*(crawl(cid) for cid in targets), return_exceptions=True)
        errors = [r for r in results if isinstance(r, Exception)]
        if errors:
            log.warning("Индекс %s: %d разделов не загрузились: %s", lang, len(errors), errors[0])
        if not titles or len(errors) > max(1, len(targets) // 10):
            raise ApiError(f"Не удалось построить индекс для языка {lang}")

        items = [{"id": hid, "title": title} for hid, title in titles.items()]
        items.sort(key=lambda it: _int(it["id"]))
        log.info("Индекс %s готов: %d хадисов", lang, len(items))
        return items

    async def index(self, lang: str) -> list[dict]:
        if self.index_ready(lang):
            return self._indexes[lang][1]
        lock = self._index_locks.setdefault(lang, asyncio.Lock())
        async with lock:
            if self.index_ready(lang):
                return self._indexes[lang][1]
            items = await self._cached(f"index_{lang}", self.INDEX_TTL, lambda: self._build_index(lang))
            prepared = [dict(it, norm=normalize(it["title"])) for it in items]
            self._indexes[lang] = (time.time(), prepared)
            return prepared

    async def search(self, lang: str, query: str, limit: int = 200) -> list[dict]:
        phrase = normalize(query)
        words = phrase.split()
        if not words:
            return []
        exact, partial = [], []
        for item in await self.index(lang):
            text = item["norm"]
            if phrase in text:
                exact.append(item)
            elif all(word in text for word in words):
                partial.append(item)
        return [{"id": it["id"], "title": it["title"]} for it in (exact + partial)[:limit]]

    def sample(self, lang: str, k: int) -> list[str]:
        """Номера k случайных хадисов из готового индекса (пусто, если индекса нет)."""
        if not self.index_ready(lang):
            return []
        items = self._indexes[lang][1]
        return [it["id"] for it in random.sample(items, min(k, len(items)))]

    async def random_id(self, lang: str) -> str:
        """Номер случайного хадиса. Если индекс ещё не готов — через случайный раздел."""
        if self.index_ready(lang):
            return self.sample(lang, 1)[0]

        roots = [c for c in await self.categories(lang) if c["parent_id"] is None and c["count"] > 0]
        if not roots:
            roots = [c for c in await self.categories(lang) if c["count"] > 0]
        if not roots:
            raise NotFound(f"Нет хадисов на языке {lang}")
        for _ in range(3):
            category = random.choices(roots, weights=[c["count"] for c in roots])[0]
            page = random.randint(1, category["count"])
            result = await self.hadeeths_page(lang, category["id"], page, 1)
            if result["items"]:
                return result["items"][0]["id"]
        result = await self.hadeeths_page(lang, roots[0]["id"], 1, 20)
        if not result["items"]:
            raise NotFound(f"Нет хадисов на языке {lang}")
        return random.choice(result["items"])["id"]

#!/usr/bin/env python3
"""Скачивает энциклопедию HadeethEnc.com в статичные JSON-файлы для мини-приложения.

Зачем: приложение на GitHub Pages берёт данные с того же сайта, поэтому работает,
даже если hadeethenc.com медленно открывается у пользователя. Тексты не меняются.

Запуск (только стандартная библиотека Python 3.10+):
    python hadith/tools/sync_data.py --langs ru --out hadith/data

Что получается:
    data/languages.json             — языки энциклопедии
    data/<lang>/categories.json     — разделы: id, title, parent, ids (номера хадисов)
    data/<lang>/index.json          — [[номер, заголовок], …] для поиска и списков
    data/<lang>/h/<номер>.json      — хадис целиком (+ reference из арабской версии)
    data/meta.json                  — дата обновления и список языков
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

API = "https://hadeethenc.com/api/v1"
UA = "HadithMiniApp-sync/1.0 (+https://knigaletit88-ux.github.io/hadith/)"
REFRESH_PARTS = 4  # каждую неделю обновляется ¼ хадисов, все — примерно раз в месяц


class NotFound(Exception):
    pass


def get(path: str, **params):
    url = f"{API}/{path}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    delay = 1.0
    for attempt in range(5):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=60) as resp:
                return json.load(resp)
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                raise NotFound(url) from exc
            if attempt == 4:
                raise
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
            if attempt == 4:
                raise
        time.sleep(delay)
        delay *= 2
    raise RuntimeError("unreachable")


def write_json(path: Path, data) -> bool:
    """Записывает файл, только если содержимое изменилось. Возвращает True при изменении."""
    raw = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    if path.exists() and path.read_text(encoding="utf-8") == raw:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(raw, encoding="utf-8")
    tmp.replace(path)
    return True


def clean_hadeeth(raw: dict) -> dict:
    keep = (
        "id", "title", "hadeeth", "hadeeth_intro", "attribution", "grade", "explanation", "hints",
        "categories", "translations", "words_meanings", "reference",
        "hadeeth_ar", "hadeeth_intro_ar", "explanation_ar", "hints_ar", "words_meanings_ar",
        "attribution_ar", "grade_ar",
    )
    data = {k: raw[k] for k in keep if raw.get(k) not in (None, "", [])}
    for key in ("hints", "hints_ar"):
        if key in data:
            data[key] = [h.replace("\r", "").strip() for h in data[key] if h and h.strip()]
    for key in ("explanation", "explanation_ar", "hadeeth", "hadeeth_ar", "reference"):
        if key in data and isinstance(data[key], str):
            data[key] = data[key].replace("\r\n", "\n").replace("\r", "\n").strip()
    data["id"] = str(raw["id"])
    return data


def sync_language(lang: str, out: Path, workers: int) -> dict:
    base = out / lang
    raw_cats = get("categories/list/", language=lang)
    cats = [
        {
            "id": str(c["id"]),
            "title": (c.get("title") or "").strip(),
            "parent": str(c["parent_id"]) if c.get("parent_id") not in (None, "", 0, "0") else None,
        }
        for c in raw_cats
    ]
    roots = [c for c in cats if c["parent"] is None]

    # Список корневого раздела содержит хадисы всех его подразделов.
    titles: dict[str, str] = {}
    for root in roots:
        page, last = 1, 1
        while page <= last:
            res = get("hadeeths/list/", language=lang, category_id=root["id"], page=page, per_page=2000)
            for item in res.get("data") or []:
                titles.setdefault(str(item["id"]), (item.get("title") or "").strip())
            last = int((res.get("meta") or {}).get("last_page") or 1)
            page += 1
    if not titles:
        raise RuntimeError(f"Пустой список хадисов для языка {lang}")
    ids = list(titles)
    print(f"[{lang}] разделов: {len(cats)}, хадисов: {len(ids)}", flush=True)

    week = dt.date.today().isocalendar()[1]
    hdir = base / "h"
    todo = [i for i in ids if not (hdir / f"{i}.json").exists() or int(i) % REFRESH_PARTS == week % REFRESH_PARTS]

    def fetch(hid: str):
        try:
            data = clean_hadeeth(get("hadeeths/one/", language=lang, id=hid))
        except NotFound:
            return hid, None
        if lang != "ar":
            try:
                ref = get("hadeeths/one/", language="ar", id=hid).get("reference")
                if ref:
                    data["reference"] = ref.replace("\r\n", "\n").replace("\r", "\n").strip()
            except NotFound:
                pass
        return hid, data

    changed = 0
    failed = 0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for n, (hid, data) in enumerate(pool.map(lambda i: _safe(fetch, i), todo), 1):
            if data is None:
                failed += 1
                continue
            changed += write_json(hdir / f"{hid}.json", data)
            if n % 250 == 0:
                print(f"[{lang}] хадисы: {n}/{len(todo)}", flush=True)
    print(f"[{lang}] загружено {len(todo) - failed}, изменено {changed}, ошибок {failed}", flush=True)
    if failed > max(10, len(todo) // 10):
        raise RuntimeError(f"[{lang}] слишком много ошибок загрузки: {failed}")

    # Принадлежность к разделам — из поля categories каждого хадиса, с подъёмом к родителям.
    parent = {c["id"]: c["parent"] for c in cats}
    members: dict[str, list[str]] = {c["id"]: [] for c in cats}
    available = []
    for hid in ids:
        path = hdir / f"{hid}.json"
        if not path.exists():
            continue
        available.append(hid)
        seen = set()
        for cid in json.loads(path.read_text(encoding="utf-8")).get("categories") or []:
            cid = str(cid)
            while cid and cid not in seen and cid in members:
                seen.add(cid)
                members[cid].append(hid)
                cid = parent.get(cid)
    for c in cats:
        c["ids"] = members[c["id"]]

    changed += write_json(base / "categories.json", [c for c in cats if c["ids"]])
    changed += write_json(base / "index.json", [[hid, titles[hid]] for hid in available])

    keep = {f"{hid}.json" for hid in ids}
    for path in hdir.glob("*.json"):
        if path.name not in keep:
            path.unlink()
            changed += 1
    return {"hadeeths": len(available)}, changed > 0


def _safe(fn, arg):
    try:
        return fn(arg)
    except Exception as exc:  # одна ошибка не должна останавливать всю синхронизацию
        print(f"Ошибка для {arg}: {exc}", file=sys.stderr, flush=True)
        return arg, None


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--langs", default="ru", help="языки через пробел или запятую, например: ru uz tg")
    parser.add_argument("--out", default="hadith/data", type=Path)
    parser.add_argument("--workers", default=6, type=int)
    args = parser.parse_args()

    langs = [l for l in args.langs.replace(",", " ").split() if l]
    args.out.mkdir(parents=True, exist_ok=True)
    languages = [{"code": l["code"], "native": l["native"]} for l in get("languages")]
    changed = write_json(args.out / "languages.json", languages)

    stats = {}
    for lang in langs:
        stats[lang], lang_changed = sync_language(lang, args.out, args.workers)
        changed = changed or lang_changed

    meta_path = args.out / "meta.json"
    old = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
    if changed or old.get("langs") != langs or "updated" not in old:
        updated = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%MZ")
        write_json(meta_path, {"updated": updated, "langs": langs, "stats": stats})
    print("Готово" + ("" if changed else ", изменений нет"))


if __name__ == "__main__":
    main()

"""Сборка сообщений и клавиатур (без обращения к сети — удобно тестировать)."""
from __future__ import annotations

from html import escape
from urllib.parse import quote

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, KeyboardButton, ReplyKeyboardMarkup

import texts

MESSAGE_LIMIT = 4000
LIST_PAGE_SIZE = 10
LANGUAGES_PAGE_SIZE = 24


def esc(text: str) -> str:
    return escape(text, quote=False)


def shorten(text: str, limit: int) -> str:
    text = " ".join(text.split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def split_text(text: str, limit: int = MESSAGE_LIMIT) -> list[str]:
    """Делит длинный текст на части не длиннее limit — по абзацам, строкам, пробелам."""
    chunks: list[str] = []
    rest = text.strip()
    while len(rest) > limit:
        cut = -1
        for sep in ("\n\n", "\n", " "):
            cut = rest.rfind(sep, 0, limit)
            if cut > limit // 3:
                break
        if cut <= 0:
            cut = limit
            amp = rest.rfind("&", 0, cut)
            if amp > rest.rfind(";", 0, cut):  # не разрываем HTML-сущность (&amp; и т.п.)
                cut = amp
        chunks.append(rest[:cut].rstrip())
        rest = rest[cut:].lstrip()
    if rest:
        chunks.append(rest)
    return chunks


def main_menu() -> ReplyKeyboardMarkup:
    return ReplyKeyboardMarkup(
        [
            [KeyboardButton(texts.BTN_CATEGORIES), KeyboardButton(texts.BTN_SEARCH)],
            [KeyboardButton(texts.BTN_RANDOM), KeyboardButton(texts.BTN_DAILY)],
            [KeyboardButton(texts.BTN_LANGUAGE), KeyboardButton(texts.BTN_SHARE)],
        ],
        resize_keyboard=True,
        is_persistent=True,
    )


def share_url(url: str, text: str) -> str:
    return f"https://t.me/share/url?url={quote(url, safe='')}&text={quote(text, safe='')}"


def bot_link(username: str | None, start: str | None = None) -> str:
    if not username:
        return ""
    return f"https://t.me/{username}" + (f"?start={start}" if start else "")


# ------------------------------------------------------------------- хадис


def hadeeth_text(h: dict, *, title: str | None = None, fallback_lang: str | None = None) -> str:
    parts = [title or texts.HADEETH_TITLE.format(id=h["id"])]
    if fallback_lang:
        parts.append(texts.FALLBACK_LANG.format(lang=esc(fallback_lang)))
    parts.append(esc(h["hadeeth"] or h["title"]))
    meta = []
    if h["attribution"]:
        meta.append("📚 " + esc(h["attribution"]))
    if h["grade"]:
        meta.append(texts.GRADE.format(grade=esc(h["grade"])))
    if meta:
        parts.append("\n".join(meta))
    return "\n\n".join(parts)


def hadeeth_keyboard(
    h: dict, *, site_url: str, bot_username: str | None, inline_enabled: bool
) -> InlineKeyboardMarkup:
    hid, lang = h["id"], h["lang"]
    rows = []
    row = []
    if h["explanation"]:
        row.append(InlineKeyboardButton(texts.BTN_EXPLANATION, callback_data=f"exp:{hid}:{lang}"))
    if h["hints"]:
        row.append(InlineKeyboardButton(texts.BTN_HINTS, callback_data=f"hint:{hid}:{lang}"))
    if row:
        rows.append(row)
    row = [InlineKeyboardButton(texts.BTN_ARABIC, callback_data=f"ar:{hid}:{lang}")]
    if h["words_meaning"]:
        row.append(InlineKeyboardButton(texts.BTN_WORDS, callback_data=f"wm:{hid}:{lang}"))
    rows.append(row)

    share_text = shorten(h["hadeeth"] or h["title"], 200)
    link = bot_link(bot_username, f"h{hid}") or site_url
    row = [
        InlineKeyboardButton(texts.BTN_CARD, callback_data=f"card:{hid}:{lang}"),
        InlineKeyboardButton(texts.BTN_SEND, url=share_url(link, share_text)),
    ]
    rows.append(row)
    row = []
    if inline_enabled:
        row.append(InlineKeyboardButton(texts.BTN_INLINE, switch_inline_query=hid))
    row.append(InlineKeyboardButton(texts.BTN_SITE, url=site_url))
    rows.append(row)
    return InlineKeyboardMarkup(rows)


def public_keyboard(h: dict, *, site_url: str, bot_username: str | None) -> InlineKeyboardMarkup:
    """Кнопки-ссылки для каналов и inline-режима (без callback-кнопок)."""
    row = []
    if bot_username:
        row.append(InlineKeyboardButton(texts.BTN_OPEN_IN_BOT, url=bot_link(bot_username, f"h{h['id']}")))
    row.append(InlineKeyboardButton(texts.BTN_SITE, url=site_url))
    return InlineKeyboardMarkup([row])


def section_text(kind: str, h: dict) -> str:
    hid = h["id"]
    if kind == "exp":
        body = esc(h["explanation"])
        title = texts.EXPLANATION_TITLE
    elif kind == "hint":
        body = "\n\n".join(f"▪️ {esc(hint)}" for hint in h["hints"])
        title = texts.HINTS_TITLE
    elif kind == "wm":
        body = "\n\n".join(f"<b>{esc(w['word'])}</b> — {esc(w['meaning'])}" for w in h["words_meaning"])
        title = texts.WORDS_TITLE
    elif kind == "ar":
        lines = [esc(h["hadeeth"])]
        meta = [x for x in (h["attribution"], h["grade"]) if x]
        if meta:
            lines.append("📚 " + esc(" — ".join(meta)))
        if h.get("reference"):
            lines.append(texts.REFERENCE.format(reference=esc(h["reference"])))
        body = "\n\n".join(lines)
        title = texts.ARABIC_TITLE
    else:
        raise ValueError(kind)
    return f"{title.format(id=hid)}\n\n{body or texts.NO_SECTION}"


# ----------------------------------------------------------------- списки


def hadeeth_list(
    header: str, items: list[dict], page: int, last_page: int, *, lang: str, nav: str, back: str | None
) -> tuple[str, InlineKeyboardMarkup]:
    """Список хадисов: текст с заголовками + кнопки-номера + навигация.

    nav — префикс callback для листания, к нему добавляется номер страницы.
    """
    start = (page - 1) * LIST_PAGE_SIZE
    lines = [header, texts.PAGE.format(page=page, last=last_page), ""]
    buttons = []
    for i, item in enumerate(items, start=start + 1):
        lines.append(f"<b>{i}.</b> {esc(shorten(item['title'], 180))}")
        buttons.append(InlineKeyboardButton(str(i), callback_data=f"h:{item['id']}:{lang}"))

    rows = [buttons[i : i + 5] for i in range(0, len(buttons), 5)]
    nav_row = []
    if page > 1:
        nav_row.append(InlineKeyboardButton("◀️", callback_data=f"{nav}{page - 1}"))
    if last_page > 1:
        nav_row.append(InlineKeyboardButton(f"{page}/{last_page}", callback_data="noop"))
    if page < last_page:
        nav_row.append(InlineKeyboardButton("▶️", callback_data=f"{nav}{page + 1}"))
    if nav_row:
        rows.append(nav_row)
    if back:
        rows.append([InlineKeyboardButton(texts.BACK, callback_data=back)])
    return "\n".join(lines), InlineKeyboardMarkup(rows)


def categories_view(categories: list[dict], parent: dict | None) -> tuple[str, InlineKeyboardMarkup]:
    parent_id = parent["id"] if parent else None
    children = [c for c in categories if c["parent_id"] == parent_id and c["count"] > 0]
    rows = [
        [InlineKeyboardButton(f"{c['title']} · {c['count']}", callback_data=f"cat:{c['id']}")]
        for c in children
    ]
    if parent is None:
        return texts.CATEGORIES_TITLE, InlineKeyboardMarkup(rows)

    rows.append(
        [InlineKeyboardButton(texts.ALL_IN_CATEGORY.format(count=parent["count"]), callback_data=f"lst:{parent_id}:1")]
    )
    rows.append([InlineKeyboardButton(texts.BACK, callback_data=f"cat:{parent['parent_id'] or 0}")])
    return texts.CATEGORY_TITLE.format(title=esc(parent["title"])), InlineKeyboardMarkup(rows)


def languages_view(languages: list[dict], page: int, current: str) -> tuple[str, InlineKeyboardMarkup]:
    last_page = max(1, -(-len(languages) // LANGUAGES_PAGE_SIZE))
    page = min(max(1, page), last_page)
    chunk = languages[(page - 1) * LANGUAGES_PAGE_SIZE : page * LANGUAGES_PAGE_SIZE]
    buttons = [
        InlineKeyboardButton(("✅ " if lang["code"] == current else "") + lang["native"], callback_data=f"lang:{lang['code']}")
        for lang in chunk
    ]
    rows = [buttons[i : i + 3] for i in range(0, len(buttons), 3)]
    nav = []
    if page > 1:
        nav.append(InlineKeyboardButton("◀️", callback_data=f"langp:{page - 1}"))
    if last_page > 1:
        nav.append(InlineKeyboardButton(f"{page}/{last_page}", callback_data="noop"))
    if page < last_page:
        nav.append(InlineKeyboardButton("▶️", callback_data=f"langp:{page + 1}"))
    if nav:
        rows.append(nav)
    current_name = next((l["native"] for l in languages if l["code"] == current), current)
    return texts.LANGUAGE_TITLE.format(current=esc(current_name)), InlineKeyboardMarkup(rows)

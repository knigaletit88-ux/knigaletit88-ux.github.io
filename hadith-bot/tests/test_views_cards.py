import io

from PIL import Image

import views
from cards import CardRenderer
from conftest import TITLES, hadeeth_json
from hadeethenc import _clean_hadeeth


def test_split_text_limits():
    text = ("Абзац " * 300 + "\n\n") * 5
    chunks = views.split_text(text, 1000)
    assert all(len(c) <= 1000 for c in chunks)
    assert " ".join(" ".join(chunks).split()) == " ".join(text.split())


def test_split_text_keeps_html_entities():
    text = "&amp;" * 500
    chunks = views.split_text(text, 1001)
    assert all(c.endswith(";") for c in chunks)


def test_hadeeth_message_is_escaped_and_buttons_fit_telegram():
    h = _clean_hadeeth(hadeeth_json("1", "ru"), "ru")
    text = views.hadeeth_text(h)
    assert "&lt;с символами &amp; и &gt;" in text
    markup = views.hadeeth_keyboard(h, site_url="https://example.com", bot_username="b", inline_enabled=True)
    for row in markup.inline_keyboard:
        for button in row:
            if button.callback_data:
                assert len(button.callback_data.encode()) <= 64


def test_hadeeth_list_numbering_and_navigation():
    items = [{"id": str(i), "title": TITLES[str(i)]} for i in range(20, 30)]
    text, markup = views.hadeeth_list("Заголовок", items, 2, 3, lang="ru", nav="lst:3:", back="cat:0")
    assert "<b>11.</b>" in text
    rows = markup.inline_keyboard
    assert rows[0][0].callback_data == "h:20:ru"
    assert [b.callback_data for b in rows[2]] == ["lst:3:1", "noop", "lst:3:3"]
    assert rows[3][0].callback_data == "cat:0"


def test_languages_pages():
    langs = [{"code": f"l{i}", "native": f"L{i}"} for i in range(72)]
    text, markup = views.languages_view(langs, 3, "l50")
    assert "L50" in text
    buttons = [b for row in markup.inline_keyboard for b in row]
    assert "✅ L50" in [b.text for b in buttons]
    assert buttons[-1].callback_data == "langp:2" or buttons[-2].callback_data == "langp:2"


def test_cards_render_various_texts():
    renderer = CardRenderer()
    heights = []
    for text in (
        "Посланник Аллаха ﷺ сказал: «Поистине, дела оцениваются только по намерениям»." * 2,
        "إنما الأعمال بالنيات وإنما لكل امرئ ما نوى",
        "The Prophet ﷺ said. " * 120,
        "Очень длинный хадис. " * 300,  # не помещается в 1920 — карточка вытягивается
    ):
        png = renderer.render(text=text, attribution="Передал аль-Бухари · Достоверный",
                              footer_title="Энциклопедия хадисов Пророка ﷺ", footer_note="HadeethEnc.com · №1")
        width, height = Image.open(io.BytesIO(png)).size
        assert width == 1080 and 1350 <= height <= CardRenderer.MAX_HEIGHT
        heights.append(height)
    assert heights[0] == 1350 and heights[-1] > 1920

    assert renderer.can_render("Привет, мир")
    assert not renderer.can_render("真主的使者说")

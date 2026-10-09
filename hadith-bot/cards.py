"""Карточки с хадисами — картинки 1080×1350, для длинных текстов выше (1920 и больше).

Шрифты Noto (лицензия SIL OFL, см. fonts/OFL.txt):
    NotoSerif     — текст хадиса (латиница, кириллица, греческий);
    NotoSans      — подписи;
    NotoNaskhArabic — арабская вязь (арабский, урду, фарси, пушту…) и знак ﷺ.

Для арабской вязи нужен движок raqm в Pillow (есть в стандартных сборках
Pillow; на Linux дополнительно нужен системный пакет libfribidi0).
"""
from __future__ import annotations

import io
import threading
import unicodedata
from dataclasses import dataclass
from pathlib import Path

from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFont, ImageOps, features

FONTS_DIR = Path(__file__).resolve().parent / "fonts"

BG_TOP = (10, 52, 40)
BG_BOTTOM = (24, 96, 69)
PATTERN = (255, 255, 255, 16)
PANEL = (251, 246, 233)
GOLD = (190, 152, 66)
TEXT = (32, 42, 36)
MUTED = (110, 100, 80)
LIGHT = (238, 228, 196)

ARABIC_HEADER = "موسوعة الأحاديث النبوية"


def _is_arabic(ch: str) -> bool:
    cp = ord(ch)
    return 0x0600 <= cp <= 0x06FF or 0x0750 <= cp <= 0x077F or 0x08A0 <= cp <= 0x08FF


def _needs_shaping(ch: str) -> bool:
    """Буквы, которым нужен движок raqm: арабское письмо и индийские письменности."""
    return _is_arabic(ch) or 0x0900 <= ord(ch) <= 0x0DFF


@dataclass
class _Line:
    words: list[list[tuple[str, ImageFont.FreeTypeFont]]]
    widths: list[float]
    space: float

    @property
    def width(self) -> float:
        return sum(self.widths) + self.space * max(0, len(self.widths) - 1)


class CardRenderer:
    WIDTH = 1080
    HEIGHTS = (1350, 1920)
    MAX_HEIGHT = 4320  # Telegram: ширина + высота фото не больше 10000
    MARGIN = 60
    FOOTER = 170

    def __init__(self, fonts_dir: Path = FONTS_DIR) -> None:
        self.raqm = features.check("raqm")
        self._paths = {
            "serif": fonts_dir / "NotoSerif-Regular.ttf",
            "sans": fonts_dir / "NotoSans-Regular.ttf",
            "sans_bold": fonts_dir / "NotoSans-Bold.ttf",
            "naskh": fonts_dir / "NotoNaskhArabic-Regular.ttf",
            "naskh_bold": fonts_dir / "NotoNaskhArabic-Bold.ttf",
        }
        self._cmaps = {
            name: set(TTFont(str(path), lazy=True).getBestCmap()) for name, path in self._paths.items()
        }
        self._fonts: dict[tuple[str, int], ImageFont.FreeTypeFont] = {}
        self._lock = threading.Lock()  # FreeType-шрифты нельзя использовать из двух потоков сразу

    # --------------------------------------------------------------- шрифты

    def _font(self, name: str, size: int) -> ImageFont.FreeTypeFont:
        key = (name, size)
        if key not in self._fonts:
            engine = ImageFont.Layout.RAQM if self.raqm else ImageFont.Layout.BASIC
            self._fonts[key] = ImageFont.truetype(str(self._paths[name]), size, layout_engine=engine)
        return self._fonts[key]

    def _covered(self, ch: str) -> bool:
        if _needs_shaping(ch) and not self.raqm:
            return False
        return any(ord(ch) in cmap for cmap in self._cmaps.values())

    def can_render(self, text: str) -> bool:
        """Есть ли в наших шрифтах почти все буквы текста."""
        letters = [ch for ch in unicodedata.normalize("NFC", text) if ch.isalpha()]
        if not letters:
            return True
        covered = sum(1 for ch in letters if self._covered(ch))
        return covered / len(letters) >= 0.97

    @staticmethod
    def is_rtl(text: str) -> bool:
        letters = [ch for ch in text if ch.isalpha()]
        return bool(letters) and sum(map(_is_arabic, letters)) / len(letters) > 0.5

    def _length(self, text: str, font: ImageFont.FreeTypeFont, rtl: bool) -> float:
        if self.raqm and rtl:
            return font.getlength(text, direction="rtl")
        return font.getlength(text)

    # ---------------------------------------------------------------- вёрстка

    def _runs(self, word: str, families: tuple[str, ...], size: int):
        runs: list[list[str]] = []
        for ch in word:
            name = next((f for f in families if ord(ch) in self._cmaps[f]), None)
            if name is None:
                continue
            if runs and runs[-1][1] == name:
                runs[-1][0] += ch
            else:
                runs.append([ch, name])
        return [(text, self._font(name, size)) for text, name in runs]

    def _layout(self, text: str, families: tuple[str, ...], size: int, max_width: float, rtl: bool):
        """Разбивает текст на строки. None в результате — граница абзаца."""
        space = self._font(families[0], size).getlength(" ")
        lines: list[_Line | None] = []
        for paragraph in text.split("\n"):
            words = paragraph.split()
            if not words:
                continue
            if lines:
                lines.append(None)
            current: list = []
            widths: list[float] = []
            for word in words:
                runs = self._runs(word, families, size)
                if not runs:
                    continue
                width = sum(self._length(t, f, rtl) for t, f in runs)
                if current and sum(widths) + space * len(widths) + width > max_width:
                    lines.append(_Line(current, widths, space))
                    current, widths = [], []
                current.append(runs)
                widths.append(width)
            if current:
                lines.append(_Line(current, widths, space))
        return lines

    @staticmethod
    def _height(lines, line_height: float) -> float:
        return sum(line_height if line else line_height * 0.45 for line in lines)

    def _fit(self, text, families, rtl, max_width, max_height, sizes, line_factor, truncate):
        for size in sizes:
            lines = self._layout(text, families, size, max_width, rtl)
            if self._height(lines, size * line_factor) <= max_height:
                return size, lines
        if not truncate:
            return None

        size = sizes[-1]
        line_height = size * line_factor
        kept: list = []
        for line in self._layout(text, families, size, max_width, rtl):
            if self._height(kept + [line], line_height) > max_height:
                break
            kept.append(line)
        while kept and kept[-1] is None:
            kept.pop()
        if kept:
            last = kept[-1]
            ellipsis = self._runs("…", families, size)
            ellipsis_width = sum(self._length(t, f, rtl) for t, f in ellipsis)
            while len(last.words) > 1 and last.width + last.space + ellipsis_width > max_width:
                last.words.pop()
                last.widths.pop()
            last.words.append(ellipsis)
            last.widths.append(ellipsis_width)
        return size, kept

    def _draw_lines(self, draw, lines, cx, top, size, line_factor, rtl, fill, metrics_font):
        line_height = size * line_factor
        ascent, descent = metrics_font.getmetrics()
        y = top
        for line in lines:
            if line is None:
                y += line_height * 0.45
                continue
            baseline = y + (line_height - (ascent + descent)) / 2 + ascent
            if rtl:
                x = cx + line.width / 2
                for runs, width in zip(line.words, line.widths):
                    xr = x
                    for text, font in runs:
                        run_width = self._length(text, font, True)
                        draw.text(
                            (xr - run_width, baseline), text, font=font, fill=fill, anchor="ls",
                            direction="rtl" if self.raqm else None,
                        )
                        xr -= run_width
                    x -= width + line.space
            else:
                x = cx - line.width / 2
                for runs, width in zip(line.words, line.widths):
                    xl = x
                    for text, font in runs:
                        draw.text((xl, baseline), text, font=font, fill=fill, anchor="ls")
                        xl += self._length(text, font, False)
                    x += width + line.space
            y += line_height
        return y

    # --------------------------------------------------------------- рисунок

    @staticmethod
    def _star(draw, cx, cy, r, **kwargs):
        """Восьмиконечная звезда из двух квадратов (руб аль-хизб)."""
        square = [(cx - r, cy - r), (cx + r, cy - r), (cx + r, cy + r), (cx - r, cy + r)]
        diamond = [(cx, cy - r * 1.414), (cx + r * 1.414, cy), (cx, cy + r * 1.414), (cx - r * 1.414, cy)]
        draw.polygon(square, **kwargs)
        draw.polygon(diamond, **kwargs)

    def _divider(self, draw, cx, y):
        draw.line([(cx - 210, y), (cx - 30, y)], fill=GOLD, width=2)
        draw.line([(cx + 30, y), (cx + 210, y)], fill=GOLD, width=2)
        self._star(draw, cx, y, 10, outline=GOLD, width=2)

    def _background(self, height: int) -> Image.Image:
        gradient = Image.linear_gradient("L").resize((self.WIDTH, height))
        image = ImageOps.colorize(gradient, BG_TOP, BG_BOTTOM).convert("RGBA")
        overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
        pattern = ImageDraw.Draw(overlay)
        step = 120
        for row, y in enumerate(range(0, height + step, step)):
            offset = step // 2 if row % 2 else 0
            for x in range(-step, self.WIDTH + step, step):
                self._star(pattern, x + offset, y, 26, outline=PATTERN, width=2)
        return Image.alpha_composite(image, overlay)

    def render(self, *, text: str, attribution: str, footer_title: str, footer_note: str) -> bytes:
        """Рисует карточку и возвращает PNG."""
        with self._lock:
            return self._render(text, attribution, footer_title, footer_note)

    def _render(self, text: str, attribution: str, footer_title: str, footer_note: str) -> bytes:
        text = unicodedata.normalize("NFC", text).strip()
        attribution = unicodedata.normalize("NFC", attribution).strip()
        rtl = self.is_rtl(text)
        body_families = ("naskh", "serif", "sans") if rtl else ("serif", "naskh", "sans")
        meta_rtl = self.is_rtl(attribution)
        meta_families = ("naskh", "sans") if meta_rtl else ("sans", "naskh")
        body_factor = 1.75 if rtl else 1.5
        meta_size, meta_factor = 30, (1.7 if meta_rtl else 1.45)

        cx = self.WIDTH // 2
        max_width = self.WIDTH - 2 * self.MARGIN - 140
        body_top = self.MARGIN + 190

        meta_lines = self._layout(attribution, meta_families, meta_size, max_width, meta_rtl)[:5]
        meta_height = self._height(meta_lines, meta_size * meta_factor)
        # всё, что на карточке занимает место по вертикали, кроме текста хадиса
        reserved = body_top + 70 + meta_height + 60 + self.FOOTER

        fitted = None
        for height, min_size in zip(self.HEIGHTS, (34, 28)):
            sizes = list(range(54, min_size - 1, -2))
            fitted = self._fit(text, body_families, rtl, max_width, height - reserved, sizes, body_factor, False)
            if fitted:
                break
        if fitted is None:
            # Очень длинный хадис: карточка вытягивается в высоту, чтобы текст поместился целиком.
            size = 28
            lines = self._layout(text, body_families, size, max_width, rtl)
            needed = self._height(lines, size * body_factor)
            height = min(self.MAX_HEIGHT, int(needed + reserved) + 1)
            fitted = self._fit(text, body_families, rtl, max_width, height - reserved, [size], body_factor, True)
        size, body_lines = fitted
        panel_bottom = height - self.FOOTER
        body_bottom = height - reserved + body_top

        image = self._background(height)
        draw = ImageDraw.Draw(image)

        # Панель с рамкой
        panel = (self.MARGIN, self.MARGIN, self.WIDTH - self.MARGIN, panel_bottom)
        draw.rounded_rectangle(panel, radius=36, fill=PANEL, outline=GOLD, width=4)
        inner = (panel[0] + 16, panel[1] + 16, panel[2] - 16, panel[3] - 16)
        draw.rounded_rectangle(inner, radius=26, outline=GOLD, width=1)

        # Заголовок
        if self.raqm:
            header_font = self._font("naskh_bold", 40)
            draw.text((cx, self.MARGIN + 85), ARABIC_HEADER, font=header_font, fill=GOLD,
                      anchor="mm", direction="rtl")
            self._divider(draw, cx, self.MARGIN + 145)
        else:
            self._divider(draw, cx, self.MARGIN + 110)

        # Текст хадиса — по центру свободного места
        body_height = self._height(body_lines, size * body_factor)
        top = body_top + (body_bottom - body_top - body_height) / 2
        self._draw_lines(
            draw, body_lines, cx, top, size, body_factor, rtl, TEXT, self._font(body_families[0], size)
        )

        # Источник и степень достоверности
        divider_y = body_bottom + 30
        self._divider(draw, cx, divider_y)
        self._draw_lines(
            draw, meta_lines, cx, divider_y + 30, meta_size, meta_factor, meta_rtl,
            MUTED, self._font(meta_families[0], meta_size),
        )

        # Подвал на зелёном фоне
        for line_text, families, font_size, color, y in (
            (footer_title, ("sans_bold", "naskh_bold"), 34, LIGHT, panel_bottom + 28),
            (footer_note, ("sans", "naskh"), 26, GOLD, panel_bottom + 90),
        ):
            lines = self._layout(line_text, families, font_size, self.WIDTH - 2 * self.MARGIN, False)[:1]
            self._draw_lines(draw, lines, cx, y, font_size, 1.4, False, color, self._font(families[0], font_size))

        buffer = io.BytesIO()
        image.convert("RGB").save(buffer, format="PNG")
        return buffer.getvalue()

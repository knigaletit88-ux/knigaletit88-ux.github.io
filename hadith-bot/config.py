"""Настройки бота: читаются из переменных окружения или файла .env."""
from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import time
from pathlib import Path
from zoneinfo import ZoneInfo

BASE_DIR = Path(__file__).resolve().parent


def load_dotenv(path: Path) -> None:
    """Простой загрузчик .env: строки KEY=VALUE, # — комментарии.

    Уже заданные переменные окружения не перезаписываются.
    """
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if key.startswith("export "):
            key = key[len("export "):].strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        os.environ.setdefault(key, value)


@dataclass(frozen=True)
class Config:
    bot_token: str
    default_language: str
    data_dir: Path
    api_base: str
    hadith_url_template: str
    site_url: str
    daily_time: time
    channel_id: str | None

    @classmethod
    def from_env(cls) -> "Config":
        load_dotenv(BASE_DIR / ".env")

        token = os.environ.get("BOT_TOKEN", "").strip()
        if not token:
            raise SystemExit(
                "Не задан BOT_TOKEN. Скопируйте .env.example в .env и вставьте "
                "токен, полученный у @BotFather."
            )

        tz = ZoneInfo(os.environ.get("TIMEZONE", "Europe/Moscow"))
        hours, minutes = os.environ.get("DAILY_TIME", "08:00").split(":")
        daily_time = time(int(hours), int(minutes), tzinfo=tz)

        data_dir = Path(os.environ.get("DATA_DIR", BASE_DIR / "data"))
        data_dir.mkdir(parents=True, exist_ok=True)

        return cls(
            bot_token=token,
            default_language=os.environ.get("DEFAULT_LANGUAGE", "ru").strip() or "ru",
            data_dir=data_dir,
            api_base=os.environ.get("API_BASE", "https://hadeethenc.com/api/v1"),
            hadith_url_template=os.environ.get(
                "HADITH_URL_TEMPLATE", "https://hadeethenc.com/{lang}/browse/hadith/{id}"
            ),
            site_url=os.environ.get("SITE_URL", "https://sarhaan.com/hadeeth/ru/"),
            daily_time=daily_time,
            channel_id=os.environ.get("CHANNEL_ID", "").strip() or None,
        )

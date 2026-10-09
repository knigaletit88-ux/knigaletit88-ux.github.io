"""Хранение настроек пользователей (язык, подписка на хадис дня) в SQLite."""
from __future__ import annotations

import sqlite3
import time
from pathlib import Path


class UserStore:
    def __init__(self, path: Path) -> None:
        self._db = sqlite3.connect(str(path), check_same_thread=False)
        self._db.execute(
            """
            CREATE TABLE IF NOT EXISTS chats (
                chat_id    INTEGER PRIMARY KEY,
                lang       TEXT,
                daily      INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL
            )
            """
        )
        self._db.commit()

    def close(self) -> None:
        self._db.close()

    def touch(self, chat_id: int) -> None:
        self._db.execute(
            "INSERT OR IGNORE INTO chats (chat_id, created_at) VALUES (?, ?)",
            (chat_id, int(time.time())),
        )
        self._db.commit()

    def get_lang(self, chat_id: int) -> str | None:
        row = self._db.execute("SELECT lang FROM chats WHERE chat_id = ?", (chat_id,)).fetchone()
        return row[0] if row else None

    def set_lang(self, chat_id: int, lang: str) -> None:
        self.touch(chat_id)
        self._db.execute("UPDATE chats SET lang = ? WHERE chat_id = ?", (lang, chat_id))
        self._db.commit()

    def is_daily(self, chat_id: int) -> bool:
        row = self._db.execute("SELECT daily FROM chats WHERE chat_id = ?", (chat_id,)).fetchone()
        return bool(row and row[0])

    def set_daily(self, chat_id: int, enabled: bool) -> None:
        self.touch(chat_id)
        self._db.execute("UPDATE chats SET daily = ? WHERE chat_id = ?", (int(enabled), chat_id))
        self._db.commit()

    def daily_subscribers(self) -> list[tuple[int, str | None]]:
        return self._db.execute("SELECT chat_id, lang FROM chats WHERE daily = 1").fetchall()

    def stats(self) -> tuple[int, int]:
        total, daily = self._db.execute("SELECT COUNT(*), COALESCE(SUM(daily), 0) FROM chats").fetchone()
        return total, daily

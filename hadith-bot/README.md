# 🌿 Telegram-бот «Энциклопедия хадисов Пророка ﷺ»

Бот по материалам энциклопедии хадисов ([sarhaan.com/hadeeth/ru](https://sarhaan.com/hadeeth/ru/)).
Тексты берутся из открытого API [HadeethEnc.com](https://hadeethenc.com) — «Энциклопедии
переведённых хадисов Пророка»: хадисы с разъяснениями и полезными выводами, переводы на десятки языков.

## Что умеет бот

| | |
|---|---|
| 📚 **Разделы** | Разделы и подразделы энциклопедии, списки хадисов с листанием |
| 🔍 **Поиск** | Любое слово или фраза: *намерение*, *родители*, *соседи*. Номер хадиса (`2962`) сразу открывает его |
| 📖 **Хадис** | Текст, источник и степень достоверности. Кнопки: **Разъяснение**, **Полезные выводы**, **На арабском**, **Значение слов** |
| 🎨 **Карточки** | Красивая картинка 1080×1350 с текстом хадиса — для сторис, WhatsApp, Instagram. Поддерживается и арабская вязь |
| 📤 **Поделиться** | Отправка хадиса другу, ссылка на бота, inline-режим: в любом чате напишите `@ваш_бот слово` |
| 🔔 **Хадис дня** | Подписка `/daily` — хадис каждый день в выбранное время. Можно также публиковать в свой канал |
| 🌍 **Языки** | Перевод на любом из языков энциклопедии (русский, английский, арабский, узбекский, казахский, турецкий и др.) |

## 1. Создайте бота в Telegram

1. Откройте [@BotFather](https://t.me/BotFather) → `/newbot` → придумайте имя и username (должен оканчиваться на `bot`).
2. BotFather пришлёт **токен** вида `123456789:AAH...` — это пароль от бота. **Никому его не отправляйте и не выкладывайте в GitHub.**
3. Включите inline-режим (чтобы делиться хадисами в любом чате): `/setinline` → выберите бота → напишите подсказку, например `слово или номер хадиса…`.
4. По желанию оформите бота:
   - `/setdescription`: *Энциклопедия хадисов Пророка ﷺ: хадисы с разъяснениями и полезными выводами на 72 языках, поиск, карточки и хадис каждый день.*
   - `/setabouttext`: *Хадисы Пророка ﷺ с разъяснениями. Указавший на благое получает такую же награду, как и совершивший его 💚*
   - `/setuserpic`: аватарка бота.

## 2. Запуск на компьютере (для проверки)

Нужен Python 3.10 или новее ([python.org](https://www.python.org/downloads/), при установке на Windows отметьте *Add Python to PATH*).

```bash
cd hadith-bot
python -m venv .venv
# Windows:  .venv\Scripts\activate
# Linux/macOS:  source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env        # на Windows: copy .env.example .env
# откройте .env в блокноте и вставьте токен после BOT_TOKEN=

python bot.py
```

Откройте своего бота в Telegram и нажмите **Старт**. Пока окно с `python bot.py` открыто, бот работает.

> При первом поиске на каждом языке бот 1–2 минуты скачивает список хадисов с сайта. Потом список хранится
> в папке `data/` (обновляется раз в неделю), и поиск работает мгновенно.

## 3. Чтобы бот работал круглосуточно

Нужен сервер, который всегда включён, например недорогой VPS с Ubuntu. Подойдёт и любой хостинг с поддержкой Docker.

### Вариант А: VPS + systemd

```bash
sudo apt update && sudo apt install -y python3 python3-venv git libfribidi0
git clone https://github.com/knigaletit88-ux/knigaletit88-ux.github.io.git
cd knigaletit88-ux.github.io/hadith-bot
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env && nano .env      # вставить токен
```

Создайте службу `/etc/systemd/system/hadith-bot.service` (замените путь и пользователя на свои):

```ini
[Unit]
Description=Hadith Telegram bot
After=network-online.target

[Service]
User=ubuntu
WorkingDirectory=/home/ubuntu/knigaletit88-ux.github.io/hadith-bot
ExecStart=/home/ubuntu/knigaletit88-ux.github.io/hadith-bot/.venv/bin/python bot.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now hadith-bot
sudo journalctl -u hadith-bot -f       # логи
```

### Вариант Б: Docker

```bash
cd hadith-bot
docker build -t hadith-bot .
docker run -d --name hadith-bot --restart unless-stopped \
  --env-file .env -v hadith-bot-data:/data hadith-bot
```

## Настройки (.env)

| Переменная | Что значит | По умолчанию |
|---|---|---|
| `BOT_TOKEN` | Токен от @BotFather (**обязательно**) | — |
| `DEFAULT_LANGUAGE` | Язык перевода для новых пользователей | `ru` |
| `DAILY_TIME`, `TIMEZONE` | Время рассылки «Хадиса дня» и часовой пояс | `08:00`, `Europe/Moscow` |
| `CHANNEL_ID` | Канал для ежедневной публикации (`@mychannel`), бот должен быть его администратором | пусто |
| `SITE_URL` | Ссылка на сайт в разделе «О проекте» | `https://sarhaan.com/hadeeth/ru/` |
| `HADITH_URL_TEMPLATE` | Ссылка «На сайте» под хадисом | `https://hadeethenc.com/{lang}/browse/hadith/{id}` |
| `DATA_DIR` | Папка для базы пользователей и кеша | `./data` |

## Команды бота

`/start` — меню · `/categories` — разделы · `/search слово` — поиск · `/random` — случайный хадис ·
`/daily` — хадис каждый день (вкл/выкл) · `/language` — язык · `/share` — поделиться ботом · `/about` — о проекте · `/help`

## Устройство

```
bot.py          — обработчики команд, кнопок, inline-режима и ежедневной рассылки
hadeethenc.py   — клиент API HadeethEnc: кеш на диске, поисковый индекс, случайный хадис
views.py        — тексты сообщений и клавиатуры
cards.py        — рисование карточек (Pillow, шрифты Noto в папке fonts/)
storage.py      — настройки пользователей (SQLite)
texts.py        — все надписи бота — их можно править
config.py       — чтение настроек из .env
tests/          — тесты (pip install -r requirements-dev.txt && pytest)
```

## Источник и условия

Тексты хадисов, переводы, разъяснения и выводы принадлежат проекту **HadeethEnc.com**. Условия его API:
содержимое публикуется **без изменений, добавлений и сокращений**, с указанием источника. Бот так и делает:
показывает тексты как есть и ссылается на HadeethEnc.com. Для длинного хадиса карточка делается выше,
чтобы текст поместился целиком.

Шрифты Noto распространяются по лицензии SIL Open Font License (см. `fonts/OFL.txt`).

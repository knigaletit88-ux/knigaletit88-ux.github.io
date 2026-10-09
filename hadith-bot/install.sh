#!/usr/bin/env bash
# Установка Telegram-бота «Энциклопедия хадисов» на сервер Ubuntu/Debian.
#
#   curl -fsSL https://raw.githubusercontent.com/knigaletit88-ux/knigaletit88-ux.github.io/ccr-0045da50-p0vuyb/hadith-bot/install.sh -o install.sh
#   sudo bash install.sh
#
# Скрипт спросит токен от @BotFather, установит всё нужное и запустит бота
# как службу (он сам перезапускается после сбоев и перезагрузки сервера).
# Повторный запуск обновляет бота до последней версии; токен сохраняется.
set -euo pipefail

REPO="https://github.com/knigaletit88-ux/knigaletit88-ux.github.io.git"
BRANCH="${BRANCH:-ccr-0045da50-p0vuyb}"
APP_DIR="/opt/hadith-bot"
SRC_DIR="$APP_DIR/src"
BOT_DIR="$SRC_DIR/hadith-bot"
ENV_FILE="$APP_DIR/.env"
DATA_DIR="$APP_DIR/data"
SERVICE="hadith-bot"
BOT_USER="hadithbot"

say() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31mОшибка: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "запустите с правами администратора: sudo bash install.sh"
command -v apt-get >/dev/null || fail "нужен сервер с Ubuntu или Debian"

say "Устанавливаю системные пакеты (1–2 минуты)…"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git curl python3 python3-venv python3-pip libfribidi0 >/dev/null

python3 -c 'import sys; sys.exit(sys.version_info < (3, 10))' \
  || fail "нужен Python 3.10 или новее — выберите при заказе сервера Ubuntu 22.04 или 24.04"

id "$BOT_USER" >/dev/null 2>&1 || useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$BOT_USER"

say "Скачиваю бота…"
mkdir -p "$APP_DIR"
if [ -d "$SRC_DIR/.git" ]; then
  git -C "$SRC_DIR" fetch -q --depth 1 origin "$BRANCH"
  git -C "$SRC_DIR" reset -q --hard FETCH_HEAD
else
  git clone -q --depth 1 --branch "$BRANCH" "$REPO" "$SRC_DIR"
fi

say "Устанавливаю библиотеки Python…"
[ -x "$APP_DIR/venv/bin/python" ] || python3 -m venv "$APP_DIR/venv"
"$APP_DIR/venv/bin/pip" install -q --upgrade pip
"$APP_DIR/venv/bin/pip" install -q -r "$BOT_DIR/requirements.txt"

if [ ! -f "$ENV_FILE" ] || ! grep -Eq '^BOT_TOKEN=.+' "$ENV_FILE"; then
  TOKEN="${BOT_TOKEN:-}"
  until [[ "$TOKEN" =~ ^[0-9]+:[A-Za-z0-9_-]{30,}$ ]]; do
    [ -z "$TOKEN" ] || echo "Это не похоже на токен. Он выглядит так: 123456789:AAH…"
    read -r -p "Вставьте токен бота от @BotFather и нажмите Enter: " TOKEN </dev/tty
    TOKEN="$(printf '%s' "$TOKEN" | tr -d '[:space:]')"
  done
  cp "$BOT_DIR/.env.example" "$ENV_FILE"
  sed -i "s|^BOT_TOKEN=.*|BOT_TOKEN=$TOKEN|" "$ENV_FILE"
fi
chown root:"$BOT_USER" "$ENV_FILE"
chmod 640 "$ENV_FILE"

TOKEN="$(grep -E '^BOT_TOKEN=' "$ENV_FILE" | head -n1 | cut -d= -f2-)"
if ME="$(curl -fsS --max-time 15 "https://api.telegram.org/bot$TOKEN/getMe" 2>/dev/null)"; then
  BOT_NAME="$(printf '%s' "$ME" | sed -n 's/.*"username":"\([^"]*\)".*/\1/p')"
  say "Токен работает: бот @$BOT_NAME"
else
  echo "Не удалось проверить токен через api.telegram.org — проверьте токен и доступ сервера к Telegram."
  echo "Изменить токен: sudo nano $ENV_FILE, затем sudo systemctl restart $SERVICE"
fi

mkdir -p "$DATA_DIR"
chown -R "$BOT_USER":"$BOT_USER" "$DATA_DIR"

say "Настраиваю автозапуск…"
cat >/etc/systemd/system/$SERVICE.service <<EOF
[Unit]
Description=Telegram-бот «Энциклопедия хадисов»
After=network-online.target
Wants=network-online.target

[Service]
User=$BOT_USER
WorkingDirectory=$BOT_DIR
EnvironmentFile=$ENV_FILE
Environment=DATA_DIR=$DATA_DIR PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
ExecStart=$APP_DIR/venv/bin/python bot.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable -q "$SERVICE"
systemctl restart "$SERVICE"
sleep 6

if systemctl is-active -q "$SERVICE"; then
  say "Готово! Бот работает. Откройте его в Telegram и нажмите «Старт»."
else
  journalctl -u "$SERVICE" -n 30 --no-pager || true
  fail "бот не запустился — пришлите текст выше, разберёмся"
fi

cat <<EOF

Полезные команды:
  Логи бота:          sudo journalctl -u $SERVICE -f
  Перезапуск:         sudo systemctl restart $SERVICE
  Остановить:         sudo systemctl stop $SERVICE
  Настройки и токен:  sudo nano $ENV_FILE   (после правки — перезапуск)
  Обновить бота:      sudo bash install.sh
EOF

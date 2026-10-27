#!/bin/sh
set -eu

mkdir -p /run/nginx

(
  while :; do
    su-exec node node /usr/share/nginx/server/banner-together-signal.mjs || true
    sleep 1
  done
) &

(
  while :; do
    OPENBANNERS_INDEX_HTML=/usr/share/nginx/html/index.html \
      su-exec node node /usr/share/nginx/server/banner-meta.mts || true
    sleep 1
  done
) &

# Passphrase answers: SQLite on the /data volume; the moderation bot starts when
# OPENBANNERS_TELEGRAM_BOT_TOKEN is set (env_file in docker-compose).
mkdir -p /data
chown node:node /data
(
  while :; do
    OPENBANNERS_PASSPHRASES_DB="${OPENBANNERS_PASSPHRASES_DB:-/data/passphrases.sqlite}" \
    OPENBANNERS_PASSPHRASES_PORT=8789 \
      su-exec node node /usr/share/nginx/server/passphrases.mjs || true
    sleep 1
  done
) &

# "Join on Telegram": one-time codes in memory and the @OpenBannersBot invite
# bot (OPENBANNERS_JOIN_* from env_file /etc/openbanners/telegram-join-prod.env).
# Off until OPENBANNERS_JOIN_CHATS is set; no data on disk.
(
  while :; do
    OPENBANNERS_JOIN_PORT=8791 \
      su-exec node node /usr/share/nginx/server/telegram-join.mjs || true
    sleep 5
  done
) &

exec nginx -g "daemon off;"

#!/bin/sh
set -eu

mkdir -p /run/nginx

room_storage="${OPENBANNERS_BANNER_TOGETHER_STORAGE:-/var/lib/openbanners/banner-together}"

if [ "${OPENBANNERS_BANNER_TOGETHER_ENABLED:-0}" = "1" ]; then
  mkdir -p "$room_storage"
  chown -R www-data:www-data "$room_storage"
  chmod 0700 "$room_storage"
  printf '%s\n' "$room_storage" > /run/openbanners-banner-together-storage
  chmod 0444 /run/openbanners-banner-together-storage

  su-exec www-data php /usr/share/nginx/server/banner-together-maintenance.php
  (
    while sleep 900; do
      su-exec www-data php /usr/share/nginx/server/banner-together-maintenance.php || true
    done
  ) &
fi

php-fpm -D
exec nginx -g "daemon off;"

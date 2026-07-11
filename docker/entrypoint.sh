#!/bin/sh
set -eu

mkdir -p /run/nginx

(
  while :; do
    su-exec www-data node /usr/share/nginx/server/banner-together-signal.mjs || true
    sleep 1
  done
) &

php-fpm -D
exec nginx -g "daemon off;"

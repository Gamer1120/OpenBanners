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

exec nginx -g "daemon off;"

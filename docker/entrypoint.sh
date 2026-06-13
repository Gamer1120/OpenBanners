#!/bin/sh
set -eu

mkdir -p /run/nginx

php-fpm -D
exec nginx -g "daemon off;"

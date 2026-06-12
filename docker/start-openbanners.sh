#!/bin/sh
set -e

php-fpm -D
exec nginx -g "daemon off;"

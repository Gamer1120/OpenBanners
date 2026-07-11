FROM php:8.3-fpm-alpine

RUN apk add --no-cache nginx su-exec

COPY docker/nginx.conf /etc/nginx/http.d/default.conf
COPY docker/entrypoint.sh /usr/local/bin/openbanners-entrypoint
COPY dist /usr/share/nginx/html
COPY server/banner-meta.php /usr/share/nginx/server/banner-meta.php
COPY server/banner-together-store.php /usr/share/nginx/server/banner-together-store.php
COPY server/banner-together-api.php /usr/share/nginx/server/banner-together-api.php
COPY server/banner-together-maintenance.php /usr/share/nginx/server/banner-together-maintenance.php
COPY server/banner-together-self-test.php /usr/share/nginx/server/banner-together-self-test.php

RUN mkdir -p /run/nginx \
  && chmod +x /usr/local/bin/openbanners-entrypoint \
  && php -l /usr/share/nginx/server/banner-together-store.php \
  && php -l /usr/share/nginx/server/banner-together-api.php \
  && php -l /usr/share/nginx/server/banner-together-maintenance.php \
  && php -l /usr/share/nginx/server/banner-together-self-test.php \
  && php /usr/share/nginx/server/banner-together-self-test.php \
  && nginx -t

EXPOSE 80

CMD ["openbanners-entrypoint"]

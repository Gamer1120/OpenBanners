FROM php:8.3-fpm-alpine

RUN apk add --no-cache nginx

COPY docker/nginx.conf /etc/nginx/http.d/default.conf
COPY docker/entrypoint.sh /usr/local/bin/openbanners-entrypoint
COPY dist /usr/share/nginx/html
COPY server/banner-meta.php /usr/share/nginx/server/banner-meta.php

RUN chmod +x /usr/local/bin/openbanners-entrypoint

EXPOSE 80

CMD ["openbanners-entrypoint"]

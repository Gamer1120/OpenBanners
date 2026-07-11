FROM php:8.3-fpm-alpine

RUN apk add --no-cache nginx nodejs su-exec

COPY docker/nginx.conf /etc/nginx/http.d/default.conf
COPY docker/entrypoint.sh /usr/local/bin/openbanners-entrypoint
COPY dist /usr/share/nginx/html
COPY server/banner-meta.php /usr/share/nginx/server/banner-meta.php
COPY server/banner-together-signal.mjs /usr/share/nginx/server/banner-together-signal.mjs
COPY server/banner-together-signal-tests.mjs /usr/share/nginx/server/banner-together-signal-tests.mjs

RUN mkdir -p /run/nginx \
  && chmod +x /usr/local/bin/openbanners-entrypoint \
  && node --test /usr/share/nginx/server/banner-together-signal-tests.mjs \
  && rm /usr/share/nginx/server/banner-together-signal-tests.mjs \
  && nginx -t

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('node:http').get('http://127.0.0.1:8787/_openbanners/banner-together/v3/health',response=>process.exit(response.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["openbanners-entrypoint"]

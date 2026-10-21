FROM node:24-alpine

RUN apk add --no-cache nginx su-exec

COPY docker/nginx.conf /etc/nginx/http.d/default.conf
COPY docker/entrypoint.sh /usr/local/bin/openbanners-entrypoint
COPY dist /usr/share/nginx/html
COPY server/banner-meta.mts /usr/share/nginx/server/banner-meta.mts
COPY server/banner-meta-tests.mts /usr/share/nginx/server/banner-meta-tests.mts
COPY server/banner-together-signal.mjs /usr/share/nginx/server/banner-together-signal.mjs
COPY server/banner-together-signal-tests.mjs /usr/share/nginx/server/banner-together-signal-tests.mjs

RUN mkdir -p /run/nginx \
  && chmod +x /usr/local/bin/openbanners-entrypoint \
  && node --test /usr/share/nginx/server/banner-together-signal-tests.mjs /usr/share/nginx/server/banner-meta-tests.mts \
  && rm /usr/share/nginx/server/banner-together-signal-tests.mjs /usr/share/nginx/server/banner-meta-tests.mts \
  && if find /bin /sbin /usr/bin /usr/sbin /usr/local/bin /usr/local/sbin -name 'php*' | grep -q .; then echo "PHP must not be present in this image" >&2; exit 1; fi \
  && nginx -t

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "const h=require('node:http');const ok=(u)=>new Promise((r)=>h.get(u,(s)=>{s.resume();r(s.statusCode===200)}).on('error',()=>r(false)));Promise.all([ok('http://127.0.0.1:8787/_openbanners/banner-together/v3/health'),ok('http://127.0.0.1:8788/')]).then((a)=>process.exit(a.every(Boolean)?0:1))"

CMD ["openbanners-entrypoint"]

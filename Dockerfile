# syntax=docker/dockerfile:1.7

FROM node:20-alpine AS build

WORKDIR /app

COPY package.json yarn.lock ./
RUN corepack enable \
  && yarn install --frozen-lockfile

COPY . .
RUN yarn build

FROM php:8.3-fpm-alpine AS runtime

RUN apk add --no-cache libcurl nginx \
  && apk add --no-cache --virtual .build-deps $PHPIZE_DEPS curl-dev \
  && docker-php-ext-install curl \
  && apk del .build-deps \
  && mkdir -p /app/dist /app/server /run/nginx

WORKDIR /app

COPY --from=build /app/dist ./dist
COPY server/banner-meta.php ./server/banner-meta.php
COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY docker/start-openbanners.sh /usr/local/bin/start-openbanners

RUN chmod +x /usr/local/bin/start-openbanners

EXPOSE 80

CMD ["start-openbanners"]

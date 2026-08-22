# syntax=docker/dockerfile:1.12@sha256:93bfd3b68c109427185cd78b4779fc82b484b0b7618e36d0f104d4d801e66d25
# check=error=true

ARG PHP_IMAGE=php:8.5.8-fpm-bookworm@sha256:83c155135b9c4aa664fc6ce47020a10fe53576a0ed3468119cf2efec22fd16b9
ARG COMPOSER_IMAGE=composer:2.10.2@sha256:4d71c3c2109c61d5415544264b59ad4087e4c5b7244481723664138fd36d5040
ARG NODE_IMAGE=node:24.19.0-bookworm-slim@sha256:3638d9a6fe4030bd716be989438248074489337ba3275657f93595428be4fc03
ARG NGINX_IMAGE=nginx:1.28.0-alpine@sha256:30f1c0d78e0ad60901648be663a710bdadf19e4c10ac6782c235200619158284
ARG NPM_VERSION=12.0.2

FROM ${COMPOSER_IMAGE} AS composer-bin

FROM ${NODE_IMAGE} AS asset-dependencies
ARG NPM_VERSION
WORKDIR /app
RUN --mount=type=cache,target=/root/.npm npm install --global "npm@${NPM_VERSION}"
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

FROM asset-dependencies AS asset-build
COPY resource ./resource
COPY tsconfig.json vite.config.ts ./
RUN npm run typecheck && npm run build

FROM ${PHP_IMAGE} AS php-base
WORKDIR /app
COPY --from=composer-bin /usr/bin/composer /usr/local/bin/composer
COPY docker/php/conf.d/app.ini /usr/local/etc/php/conf.d/app.ini

FROM composer-bin AS php-dependencies
WORKDIR /app
COPY composer.json composer.lock ./
RUN --mount=type=cache,target=/tmp/composer-cache \
    COMPOSER_CACHE_DIR=/tmp/composer-cache composer install --no-interaction --no-progress --prefer-dist

FROM composer-bin AS php-production-dependencies
WORKDIR /app
COPY composer.json composer.lock ./
RUN --mount=type=cache,target=/tmp/composer-cache \
    COMPOSER_CACHE_DIR=/tmp/composer-cache composer install --no-dev --no-interaction --no-progress --prefer-dist --classmap-authoritative

FROM php-base AS php-build
COPY composer.json composer.lock ./
COPY --from=php-dependencies /app/vendor ./vendor
COPY bootstrap ./bootstrap
COPY config ./config
COPY public ./public
COPY resource/views ./resource/views
COPY src ./src
COPY tests ./tests
COPY --from=asset-build /app/public/build ./public/build
RUN composer dump-autoload --classmap-authoritative --no-interaction

FROM php-build AS php-test
RUN composer lint && composer analyse && composer test
USER www-data
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 CMD ["php-fpm", "-t"]
CMD ["php-fpm"]

FROM php-build AS php-development
ENV APP_ENV=development
USER www-data
EXPOSE 9000
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 CMD ["php-fpm", "-t"]
CMD ["php-fpm"]

FROM php-base AS php-production
ENV APP_ENV=production
COPY --from=php-production-dependencies --chown=www-data:www-data /app/vendor ./vendor
COPY --from=php-build --chown=www-data:www-data /app/bootstrap ./bootstrap
COPY --from=php-build --chown=www-data:www-data /app/config ./config
COPY --from=php-build --chown=www-data:www-data /app/public ./public
COPY --from=php-build --chown=www-data:www-data /app/resource/views ./resource/views
COPY --from=php-build --chown=www-data:www-data /app/src ./src
USER www-data
EXPOSE 9000
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 CMD ["php-fpm", "-t"]
CMD ["php-fpm"]

FROM ${NGINX_IMAGE} AS nginx-production
COPY docker/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=asset-build --chown=nginx:nginx /app/public/build /app/public/build
COPY --chown=nginx:nginx public /app/public
USER nginx
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 CMD ["wget", "--quiet", "--tries=1", "--spider", "http://127.0.0.1:8080/healthz"]
CMD ["nginx", "-g", "daemon off;"]

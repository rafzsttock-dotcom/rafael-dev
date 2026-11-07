FROM php:8.3-cli

# Ekstensi PHP yang dibutuhkan MadelineProto (installer otomatis urus lib sistemnya)
ADD https://github.com/mlocati/docker-php-extension-installer/releases/latest/download/install-php-extensions /usr/local/bin/
RUN chmod +x /usr/local/bin/install-php-extensions && \
    install-php-extensions gmp ffi sockets pcntl mbstring xml zip igbinary && \
    { echo "ffi.enable=true"; echo "memory_limit=1G"; } > /usr/local/etc/php/conf.d/kodo.ini

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

WORKDIR /app
COPY composer.json ./
RUN composer install --no-dev --no-interaction --prefer-dist --optimize-autoloader
COPY server.php login.php ./

ENV TELEGRAM_SERVICE_HOST=0.0.0.0 \
    TELEGRAM_SERVICE_PORT=8090 \
    TELEGRAM_SESSION_DIR=/data/tg

EXPOSE 8090
CMD ["php", "server.php"]

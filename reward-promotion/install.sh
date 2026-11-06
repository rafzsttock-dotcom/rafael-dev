#!/usr/bin/env bash
# Pasang di VPS Ubuntu/Debian:  sudo bash install.sh
set -euo pipefail
command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh
cd "$(dirname "$0")"
if [ ! -f .env ]; then
  cp .env.example .env
  sed -i "s|^ADMIN_USERNAME=.*|ADMIN_USERNAME=${ADMIN_USERNAME:-admin}|; s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=${ADMIN_PASSWORD:-$(openssl rand -base64 18 | tr -d '/+=')}|" .env
  sed -i "s|^APP_PATH=.*|APP_PATH=$(openssl rand -hex 5)|; s|^ADMIN_PATH=.*|ADMIN_PATH=$(openssl rand -hex 8)|" .env
  echo ">> .env dibuat (username/password admin ada di .env). Cek DOMAIN, lalu jalankan ulang script ini."
  exit 0
fi
docker compose up -d --build
D=$(grep ^DOMAIN= .env | cut -d= -f2 | cut -d' ' -f1)
echo ">> Selesai."
echo ">> Landing : https://$D/"
echo ">> Aplikasi: https://$D/$(grep ^APP_PATH= .env | cut -d= -f2)"
echo ">> Admin   : https://$D/$(grep ^ADMIN_PATH= .env | cut -d= -f2)   (rahasiakan)"

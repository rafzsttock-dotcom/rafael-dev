#!/usr/bin/env bash
# Pasang di VPS Ubuntu/Debian:  sudo bash install.sh
set -euo pipefail
command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh
cd "$(dirname "$0")"
if [ ! -f .env ]; then
  cp .env.example .env
  sed -i "s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=$(openssl rand -base64 18 | tr -d '/+=')|" .env
  echo ">> .env dibuat. Isi BOT_TOKEN, BOT_USERNAME, DOMAIN lalu jalankan ulang script ini."
  echo ">> Password admin ada di .env (baris ADMIN_PASSWORD)."
  exit 0
fi
grep -q '^BOT_TOKEN=.\+' .env || { echo "BOT_TOKEN di .env masih kosong"; exit 1; }
docker compose up -d --build
echo ">> Selesai. Buka https://\$(grep ^DOMAIN= .env | cut -d= -f2 | cut -d' ' -f1)/ , admin di /admin"

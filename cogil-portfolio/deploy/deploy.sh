#!/usr/bin/env bash
# Update aplikasi setelah ada perubahan di GitHub.
# Jalankan di VPS:  bash /var/www/rafael-dev/cogil-portfolio/deploy/deploy.sh
set -euo pipefail
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR"

echo "==> Tarik kode terbaru"
git pull --ff-only origin main

echo "==> Install dependency & build"
npm ci
npm run build

echo "==> Reload PM2 (tanpa downtime)"
pm2 reload ecosystem.config.cjs || pm2 start ecosystem.config.cjs
pm2 save
echo "✅ Deploy selesai"

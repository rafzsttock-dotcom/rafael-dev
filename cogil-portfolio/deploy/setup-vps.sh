#!/usr/bin/env bash
# Setup sekali jalan di VPS Ubuntu/Debian baru.
# Pemakaian:  sudo bash setup-vps.sh domainanda.com [email@anda.com]
set -euo pipefail

DOMAIN="${1:?Pakai: sudo bash setup-vps.sh domainanda.com [email]}"
EMAIL="${2:-}"
REPO_URL="${REPO_URL:-https://github.com/rafzsttock-dotcom/rafael-dev.git}"
APP_ROOT="/var/www/rafael-dev"
APP_DIR="$APP_ROOT/cogil-portfolio"
RUN_USER="${SUDO_USER:-root}"

echo "==> Install paket dasar"
apt-get update -y
apt-get install -y curl git nginx ufw ca-certificates

echo "==> Install Node.js 22"
if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1)" != "v22" ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

echo "==> Install PM2"
npm install -g pm2

echo "==> Clone repo"
mkdir -p /var/www
if [ ! -d "$APP_ROOT/.git" ]; then
  git clone "$REPO_URL" "$APP_ROOT"
fi
chown -R "$RUN_USER":"$RUN_USER" "$APP_ROOT"

echo "==> Build & jalankan app"
sudo -u "$RUN_USER" bash -c "cd '$APP_DIR' && npm ci && npm run build && (pm2 reload ecosystem.config.cjs || pm2 start ecosystem.config.cjs) && pm2 save"
env PATH="$PATH" pm2 startup systemd -u "$RUN_USER" --hp "$(eval echo ~"$RUN_USER")" >/dev/null

echo "==> Konfigurasi Nginx"
sed "s/DOMAIN_ANDA/$DOMAIN www.$DOMAIN/" "$APP_DIR/deploy/nginx.conf" > /etc/nginx/sites-available/cogil-portfolio
ln -sf /etc/nginx/sites-available/cogil-portfolio /etc/nginx/sites-enabled/cogil-portfolio
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo "==> Firewall"
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

echo "==> SSL (Let's Encrypt)"
apt-get install -y certbot python3-certbot-nginx
if [ -n "$EMAIL" ]; then
  certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect \
    || echo "!! Certbot gagal — pastikan DNS A record $DOMAIN & www.$DOMAIN sudah mengarah ke IP VPS, lalu jalankan ulang: sudo certbot --nginx -d $DOMAIN -d www.$DOMAIN"
else
  echo "   Lewati SSL (email tidak diisi). Jalankan nanti: sudo certbot --nginx -d $DOMAIN -d www.$DOMAIN"
fi

echo "✅ Selesai. Buka http://$DOMAIN"

# Deploy ke VPS (Ubuntu/Debian)

Stack: **Node.js 22 + PM2** (menjalankan Next.js di port 3000) → **Nginx** (reverse proxy) → **Let's Encrypt** (HTTPS).

## 0. Persiapan
- VPS Ubuntu 22.04/24.04 (minimal 1 GB RAM; kalau 512 MB, tambahkan swap dulu — lihat bawah).
- Domain: buat **A record** `@` dan `www` mengarah ke IP VPS.
- Kalau repo GitHub **private**, VPS butuh akses: pakai deploy key SSH atau Personal Access Token
  (`REPO_URL=https://<TOKEN>@github.com/rafzsttock-dotcom/rafael-dev.git`).

## 1. Setup pertama (sekali saja)
SSH ke VPS, lalu:
```bash
curl -fsSL https://raw.githubusercontent.com/rafzsttock-dotcom/rafael-dev/main/cogil-portfolio/deploy/setup-vps.sh -o setup-vps.sh
sudo bash setup-vps.sh domainanda.com email@anda.com
```
(Untuk repo private: clone manual dulu ke `/var/www/rafael-dev`, lalu jalankan
`sudo bash /var/www/rafael-dev/cogil-portfolio/deploy/setup-vps.sh domainanda.com email@anda.com`.)

Script ini: install Node 22, PM2, Nginx, clone repo ke `/var/www/rafael-dev`, build, jalankan app,
konfigurasi Nginx, aktifkan firewall (SSH + HTTP/HTTPS), dan pasang SSL.

## 2. Update setelah ada perubahan kode
```bash
bash /var/www/rafael-dev/cogil-portfolio/deploy/deploy.sh
```

## Perintah berguna
```bash
pm2 status                 # status app
pm2 logs cogil-portfolio   # lihat log
pm2 restart cogil-portfolio
sudo nginx -t && sudo systemctl reload nginx
sudo certbot renew --dry-run   # cek perpanjangan SSL otomatis
```

## VPS RAM kecil (≤1 GB) — tambah swap agar `npm run build` tidak gagal
```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## Jangan lupa
Ganti `https://cogil.dev` di `src/app/layout.tsx`, `src/app/sitemap.ts`, dan `src/app/robots.ts`
dengan domain Anda sendiri bila berbeda.

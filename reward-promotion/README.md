# KODO Rewards

Aplikasi misi + poin + reward dengan backend (Node.js + SQLite), login nomor HP + password + OTP via bot Telegram, dan admin panel. Penarikan poin diproses manual oleh admin.

## Pasang di VPS (Ubuntu/Debian)
1. Upload folder ini ke VPS (git clone branch `claude/deploy-reward-promotion`, lalu `cd reward-promotion`).
2. `sudo bash install.sh` — membuat `.env` dengan password admin acak lalu berhenti.
3. Edit `.env`: isi `BOT_TOKEN` dan `BOT_USERNAME`. `DOMAIN` sudah `rewardex.site` (ganti `:80` + `SECURE_COOKIE=0` jika tanpa domain).
4. `sudo bash install.sh` lagi — build dan jalan. Script mencetak URL landing, aplikasi, dan admin. Path aplikasi dan admin diacak otomatis (`APP_PATH`, `ADMIN_PATH` di `.env`); nama file asli tidak bisa diakses. Link referal tiap user berbentuk `/r/<kode>`.

Data tersimpan di `./data/app.db` (backup folder ini secara berkala).

## DNS
Di registrar `rewardex.site`: buat record **A** `@` → IP VPS (dan `www` → IP yang sama, opsional). Tunggu propagasi, pastikan port 80 dan 443 terbuka; Caddy mengurus sertifikat HTTPS otomatis.

## Perilaku penting
- Logout hanya mengakhiri sesi di perangkat itu; poin tetap di akun. Sesi berlaku 90 hari.
- Verifikasi OTP: user menekan Start di bot lalu membagikan kontak miliknya; kode 6 digit dikirim bot.
- Join channel dan start bot diverifikasi server (getChatMember); misi lain mengikuti tipe yang diatur admin.
- Semua angka di UI (bonus, nilai poin, minimal tarik) berasal dari database/pengaturan admin.

## Keamanan
- Token bot dan password admin hanya di `.env` (jangan commit). Ganti password VPS/SSH yang pernah dibagikan lewat chat.
- Pasang firewall (ufw allow 22,80,443) dan gunakan SSH key.

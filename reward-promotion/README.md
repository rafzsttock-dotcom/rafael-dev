# KODO Rewards

Aplikasi misi + poin + reward (Node.js + SQLite + **Telethon**).

- Login: username **atau** nomor HP + password + **2FA kode Telegram** (dikirim via Telethon)
- Admin panel: pengguna, sessions, penarikan, misi, reward
- OTP & cek channel memakai akun Telegram user (Telethon), bukan BotFather token

## Setup Telethon (wajib)

1. Buka https://my.telegram.org → API development tools → catat `api_id` + `api_hash`
2. Buat string session (sekali, interaktif):
   ```bash
   pip install telethon
   python telegram-service/make_session.py
   ```
3. Isi `.env`:
   ```
   TELEGRAM_API_ID=...
   TELEGRAM_API_HASH=...
   TELEGRAM_SESSION=...
   TELEGRAM_SERVICE_SECRET=ganti-rahasia
   ```
4. Deploy:
   ```bash
   sudo docker compose up -d --build
   ```

Akun yang login di Telethon **harus bisa mengirim pesan** ke user (privacy Telegram user boleh memblokir pesan dari non-kontak). Untuk cek join channel, akun Telethon idealnya **admin** di channel tersebut.

## Alur user

1. Daftar: username + nomor HP + password
2. Hubungkan `@username` Telegram → Telethon resolve + kirim kode
3. Masukkan kode 6 digit
4. Login berikutnya: username/HP + password + kode lagi

## Deploy VPS

Lihat `DEPLOY.txt`. Path app/admin acak di `.env` (`APP_PATH`, `ADMIN_PATH`).

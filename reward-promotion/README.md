# KODO Rewards

Aplikasi misi + poin + reward (Node.js + SQLite + **Telethon**).

- Login: **nomor HP → kode verifikasi → masuk** (akun dibuat otomatis kalau belum ada). Kode dikirim via Telegram (Telethon/MadelineProto)
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

1. Pilih negara + isi nomor HP (yang aktif di Telegram) -> `POST /api/auth/request-code`
2. Masukkan kode 6 digit dari Telegram -> `POST /api/auth/verify-code` (kirim juga `ref` kalau datang dari link referal)
3. Selesai: sesi 90 hari dibuat; akun baru otomatis terdaftar. Tidak ada password.

`DEV_SHOW_CODE=1` di `.env` (hanya uji coba!) membuat kode ikut dikembalikan di respons dan dimunculkan di toast. Jangan aktifkan di produksi.

## Deploy VPS

Lihat `DEPLOY.txt`. Path app/admin acak di `.env` (`APP_PATH`, `ADMIN_PATH`).

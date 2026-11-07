# KODO Rewards

Aplikasi misi + poin + reward (Node.js + SQLite + **Telethon**).

- Login: username **atau** nomor HP + password + **2FA kode Telegram** (dikirim via Telethon)
- Admin panel: pengguna, sessions, penarikan, misi, reward
- OTP & cek channel memakai akun Telegram user (Telethon), bukan BotFather token

## Setup Telethon (wajib)

1. Buka https://my.telegram.org → API development tools → catat `api_id` + `api_hash`
2. Isi `.env`:
   ```
   TELEGRAM_API_ID=...
   TELEGRAM_API_HASH=...
   TELEGRAM_SERVICE_SECRET=ganti-rahasia
   ```
3. Login akun Telegram untuk sidecar (interaktif, sekali per akun):
   ```bash
   docker compose run --rm telethon php login.php akun1
   ```
   Sesi tersimpan di `./data/tg` (bukan string session di `.env`).
4. Deploy:
   ```bash
   sudo docker compose up -d --build
   ```

Akun yang login di Telethon **harus bisa mengirim pesan** ke user (privacy Telegram user boleh memblokir pesan dari non-kontak). Untuk cek join channel, akun Telethon idealnya **admin** di channel tersebut.

## Telegram StringSession generator (GramJS)

Fitur di **Admin → Sessions → Telegram StringSession** untuk membuat `StringSession` Telegram per user. String ini bisa dipakai GramJS/bot untuk operasi atas nama akun tersebut.

- Sidecar: `telegram-session-generator/` (Node + GramJS, HTTP internal port `8091`, **tidak** diekspos ke publik).
- Alur: pilih user → masukkan nomor Telegram → kode Telegram → (jika ada) password 2FA → StringSession tersimpan.
- Session disimpan **terenkripsi AES-256-GCM** di tabel `tg_sessions`. Daftar session tidak pernah memuat string aslinya; admin harus klik **Copy** untuk mengambilnya.
- **Cabut** memanggil `auth.LogOut` di Telegram lalu menghapus record.
- StringSession setara password akun. Jangan pernah menaruhnya di log, screenshot, issue, atau repo.

Isi `.env` (selain API ID/HASH yang sudah ada):

```env
SESSION_GENERATOR_SECRET=ganti-rahasia-internal
SESSION_ENC_KEY=hasil-openssl-rand-base64-32
SESSION_GENERATOR_URL=http://session-generator:8091
```

Buat kunci enkripsi: `openssl rand -base64 32`. **Jangan mengganti `SESSION_ENC_KEY` setelah ada session tersimpan** — session lama tidak akan bisa dibuka.

Deploy ulang:

```bash
sudo docker compose up -d --build session-generator app
sudo docker compose logs -f session-generator --tail=50
```

Catatan: kalau `SESSION_ENC_KEY` kosong, fitur ini nonaktif (app tetap jalan). Generator bisa online tapi menolak login jika `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` belum diisi.

## Alur user

1. Daftar: username + nomor HP + password
2. Hubungkan `@username` Telegram → Telethon resolve + kirim kode
3. Masukkan kode 6 digit
4. Login berikutnya: username/HP + password + kode lagi

## Deploy VPS

Lihat `DEPLOY.txt`. Path app/admin acak di `.env` (`APP_PATH`, `ADMIN_PATH`).

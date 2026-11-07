# Telegram MTProto Login (Personal)

Tool pribadi untuk login ke **akun Telegram milik sendiri** lewat MTProto
(nomor telepon + OTP + password 2FA), lalu menghasilkan `StringSession`
yang disimpan **terenkripsi** secara lokal untuk dipakai/diuji ulang.

Ini **bukan** sistem multi-user dan **bukan** dashboard admin yang
mengumpulkan sesi akun orang lain. Satu instance = satu pemilik, untuk
pengujian akun Telegram sendiri saja.

## Fitur

- Login pakai nomor telepon (bukan QR), via MTProto (`gramjs`/`telegram`).
- Mendukung OTP dan password 2FA (cloud password).
- Menghasilkan `StringSession` dan menyimpannya **terenkripsi**
  (AES-256-GCM, kunci dari env, bukan ikut tersimpan di file data).
- Endpoint untuk **test** sesi (memanggil `getMe()`) dan **hapus/logout**
  sesi (`auth.LogOut` lalu dihapus dari penyimpanan lokal).
- Akses ke tool ini sendiri digembok dengan token akses (`APP_ACCESS_TOKEN`)
  karena ditujukan jalan di VPS publik.
- Siap jalan via Docker / Docker Compose.

## 1. Ambil API_ID & API_HASH

1. Buka <https://my.telegram.org>, login pakai nomor telepon kamu sendiri.
2. Masuk ke **API Development Tools**.
3. Buat aplikasi (nama & deskripsi bebas), lalu catat **App api_id** dan
   **App api_hash**.
4. Isi ke `.env` sebagai `TG_API_ID` dan `TG_API_HASH`.

## 2. Konfigurasi

```bash
cp .env.example .env
```

Isi minimal:

- `TG_API_ID`, `TG_API_HASH` — dari langkah 1.
- `APP_ACCESS_TOKEN` — token acak panjang buat gembok tool ini sendiri.
  Generate: `openssl rand -hex 24`
- `SESSION_ENCRYPTION_KEY` — kunci enkripsi StringSession, minimal 16
  karakter, idealnya panjang & acak. Generate: `openssl rand -hex 32`

Jangan commit file `.env` (sudah di-`.gitignore`).

## 3. Jalankan — Docker Compose (disarankan, buat di VPS)

```bash
docker compose up -d --build
```

Server dengerin di `127.0.0.1:8088` (dibatasi ke localhost). Untuk akses
dari luar, taruh di belakang reverse proxy HTTPS (mis. Caddy, seperti yang
sudah dipakai `reward-promotion/Caddyfile`), jangan expose port 8088
langsung ke internet.

Data (`sessions.json` terenkripsi) persist di folder `./data` lewat volume.

## 4. Jalankan — langsung dengan Node (dev/lokal)

```bash
cd server
npm install
node server.js
```

Buka `http://localhost:8088`.

## 5. Cara pakai

1. Buka halaman, masukkan `APP_ACCESS_TOKEN` di form **Akses Tool**.
2. Masukkan nomor telepon (pakai kode negara, contoh `+628123456789`) →
   **Kirim Kode OTP**.
3. Masukkan kode OTP yang masuk ke Telegram (atau SMS bila perlu) →
   **Verifikasi Kode**.
4. Kalau akun punya verifikasi dua langkah, form password 2FA muncul →
   isi cloud password-nya.
5. Setelah sukses, sesi muncul di daftar **Sesi Tersimpan** (StringSession
   tersimpan terenkripsi, tidak pernah ditampilkan mentah di UI/API).

## 6. Langkah pengujian

- **Test koneksi sesi:** klik tombol **Test** pada salah satu sesi di
  daftar → tool akan connect ulang pakai StringSession tersimpan dan
  memanggil `getMe()`. Kalau berhasil, muncul info akun (username/nama),
  membuktikan sesi masih valid.
- **Cabut sesi:** klik **Hapus** → tool memanggil `auth.LogOut()` ke
  Telegram (supaya device/sesi itu benar-benar logout dari sisi Telegram
  juga) lalu menghapus entri dari penyimpanan lokal.
- **Cek endpoint sehat:** `GET /api/health` → `{ "ok": true }`.

## Catatan keamanan

- `StringSession` setara kredensial penuh akun Telegram — jangan pernah
  dibagikan, dikirim lewat chat, atau disimpan di tempat yang bisa diakses
  banyak orang.
- Tool ini sengaja **tidak** punya mode multi-user/dashboard admin untuk
  mengumpulkan sesi akun lain. Kalau butuh integrasi login untuk aplikasi
  multi-user, pakai alur yang sudah ada di `reward-promotion` (Telegram
  Login Widget / OTP via bot), bukan StringSession per-user.
- `APP_ACCESS_TOKEN` dan `SESSION_ENCRYPTION_KEY` wajib panjang & acak,
  dan jangan pernah commit `.env` ke git.

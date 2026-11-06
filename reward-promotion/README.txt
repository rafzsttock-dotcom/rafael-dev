KODO Rewards — Demo UI (front-end only)
=======================================

Isi:
- index.html   : Landing page (hero, fitur, feed aktivitas live, tombol Daftar)
- app.html     : Aplikasi user lengkap (Landing -> Login nomor+kode -> Gabung channel
                 -> Dashboard -> Misi -> Reward -> Referal -> Tarik poin)
- admin.html   : Dashboard admin (KPI, grafik, pengguna, penarikan, misi, reward,
                 pengaturan metode, channel wajib join, konfigurasi bot)
- daftar.html  : Halaman pendaftaran/verifikasi (dipakai dari index.html)

Cara pakai:
- Buka file .html langsung di browser (klik dua kali), atau
- Jalankan server statis di folder ini, mis:
    python3 -m http.server 8080
  lalu buka http://localhost:8080/index.html

Catatan penting:
- Ini DEMO tampilan (front-end) saja. Tidak ada backend, tidak memproses
  login/pembayaran/data nyata, dan tidak terhubung ke Telegram.
- Bagian "login", "verifikasi kode", "tarik poin", "join channel", dan
  "konfigurasi bot token" semuanya simulasi di browser.
- JANGAN simpan bot token Telegram asli di front-end pada versi produksi —
  token harus disimpan di server tempat bot berjalan.

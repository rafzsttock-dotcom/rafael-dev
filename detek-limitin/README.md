# DetekLimitin — Telegram + WhatsApp Utility Bot

Bot Telegram berbasis **Telegraf** dengan multi-session WhatsApp (Baileys) untuk keperluan pengecekan akun, manajemen session, dan sistem premium.

> Source ini merupakan hasil deobfuscate dari build yang sebelumnya dilindungi (zero-width encoding).  
> Token Guard sudah **dinonaktifkan**.

---

## Fitur Utama

### User
| Fitur | Keterangan |
|-------|------------|
| **Cek Bio** | Pengecekan massal bio/about, foto profil, business profile, dan member since. Mode Simpel / Detail + speed mode. Output caption + file `.txt` / `.xlsx` |
| **Detect Realtime** | Pengecekan status nomor melalui endpoint WhatsApp (`/v2/exist`, `/v2/code`). Deteksi indikasi banned / restricted |
| **Limitin** | Pengecekan & trigger endpoint OTP WhatsApp (method: WA Old / SMS / Voice). Dilengkapi queue per user dan fitur cancel |
| **Cek Join** | Cek status join channel / group |
| **Cek Merah / Flag** | Deteksi indikasi flag pada akun |
| **Multi Sender** | Multi session WhatsApp. Connect via **QR Code** atau **Pairing Code**. Logout per session / semua session |
| **Premium System** | Paket 3 hari / 7 hari / 30 hari / Lifetime |
| **Payment** | Integrasi AustinPay QRIS (auto create invoice + auto poll status) |
| **Redeem Code** | Sistem penukaran kode premium / limit |
| **Referral** | Sistem undangan / invite |
| **Leaderboard & Stats** | Ranking penggunaan |
| **Panduan** | Guide interaktif per fitur |

### Owner Commands
| Command | Fungsi |
|---------|--------|
| `/ownermenu` `/owner` `/panel` | Panel admin |
| `/ban` `/unban` | Ban / unban user |
| `/bc` `/bcfd` `/bcpin` `/bcfdpin` | Broadcast |
| `/unpinmassal` | Unpin massal |
| `/fsub` `/addfsub` `/delfsub` `/togglefsub` | Force subscribe |
| `/setprem` `/delprem` | Set / hapus premium |
| `/addlimit` `/setlimit` | Atur limit user |
| `/cekuser` | Info user |
| `/createcode` `/listcode` `/delcode` | Kelola redeem code |
| `/logprem` | Log transaksi premium |
| `/backup` | Backup data |
| `/delsession` | Hapus session WA |
| `/modeperbaikan` | Maintenance mode |
| `/statistik` `/leaderboard` | Statistik bot |

---

## Struktur Folder

```
.
├── index.js                 # Entry point
├── config.js                # Konfigurasi
├── database.js              # Local JSON database
├── ecosystem.config.js      # PM2 config
├── package.json
├── assets/
│   ├── menu.jpg
│   ├── fix.jpg
│   └── canvas.html
├── core/
│   ├── context.js           # Global state & context
│   ├── wa.js                # WhatsApp manager (Baileys)
│   ├── payment.js           # AustinPay integration
│   ├── api.js
│   ├── utils.js
│   ├── logger.js
│   └── emojis.js
├── handlers/
│   ├── commands.js
│   ├── actions.js
│   └── events.js
└── data/
    ├── users.json
    ├── invoices.json
    ├── redeems.json
    └── settings.json
```

---

## Instalasi

### 1. Install dependencies
```bash
npm install
```

### 2. Konfigurasi

Salin dan edit file `.env` atau langsung edit `config.js`:

```env
BOT_TOKEN=your_telegram_bot_token
OWNER_ID=your_telegram_id
OWNER_NAME=Owner
OWNER_TELEGRAM=username_owner

# AustinPay (opsional)
AUSTINPAY_API_KEY=
AUSTINPAY_API_SECRET=
AUSTINPAY_BASE_URL=https://austinstore.id

# Proxy (opsional)
PROXY_ENABLED=false
PROXY_TIMEOUT=10000
PROXY_URLS=
```

### 3. Jalankan

```bash
# Langsung
node index.js

# Atau dengan PM2
pm2 start ecosystem.config.js
pm2 logs bot-cekbio
```

---

## Token Guard

**Token Guard sudah dinonaktifkan.**

Bot tidak lagi melakukan pengecekan registry remote. Cukup isi `BOT_TOKEN` lalu jalankan.

Untuk generate hash (jika dibutuhkan):
```bash
node index.js --hash
# atau
node index.js --hash 123456:ABCDEFxxxxxxxx
```

---

## Alur Kerja Singkat

### Cek Bio
1. User pilih menu Cek Bio → pilih mode
2. Kirim daftar nomor
3. Bot menggunakan session WA aktif
4. Hasil dikirim sebagai caption + file laporan

### Detect Realtime
1. User pilih Detect
2. Bot melakukan request ke endpoint WhatsApp
3. Response diklasifikasikan (normal / restricted / banned)

### Limitin
1. User pilih method
2. Bot melakukan request ke endpoint terkait
3. Progress dapat dibatalkan

### Payment Premium
1. User pilih paket → bot membuat invoice QRIS
2. Setelah pembayaran terdeteksi → premium diaktifkan otomatis

---

## Command Cepat

```
/menu              Menu utama
/buyprem           Beli premium
/referral          Kode referral
/redeem            Tukar kode
/panduan           Bantuan
/ownermenu         Panel owner
```

Sebagian besar fitur diakses melalui **inline button**.

---

## Catatan Teknis

- Menggunakan **Baileys** (termasuk fork `@dannteam/baileys`)
- Multi-session disimpan di folder session
- Database menggunakan **JSON lokal** (tidak membutuhkan MongoDB/MySQL)
- Proxy dapat diaktifkan untuk request ke endpoint WhatsApp
- Fitur yang berinteraksi dengan endpoint WhatsApp dapat melanggar Terms of Service. Gunakan dengan tanggung jawab sendiri.

---

## License

Source berasal dari build tertutup yang di-deobfuscate.  
Gunakan dan modifikasi dengan risiko sendiri.

---

## Credits

- Original: `@lakujr` / DetekLimitin
- Stack: Telegraf + Baileys + AustinPay

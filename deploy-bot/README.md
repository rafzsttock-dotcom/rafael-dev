# Deploy Bot

Telegram bot untuk manage deployment ke banyak VPS dari satu tempat.

## Requirements

- Node.js ≥ 18
- pm2 (optional, untuk jalanin bot terus-terusan)

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Buat file .env
cp .env.example .env

# 3. Isi .env dengan nilai yang bener
# BOT_TOKEN   → dapat dari @BotFather di Telegram
# OWNER_CHAT_ID → dapat dari @userinfobot (kirim /start ke bot-nya)

# 4. Jalanin bot
npm start
```

## Cara dapat BOT_TOKEN

1. Buka Telegram, cari **@BotFather**
2. Kirim `/newbot`
3. Ikutin instruksinya, pilih nama dan username bot
4. BotFather akan kasih token — copy ke `.env`

## Cara dapat OWNER_CHAT_ID

1. Cari **@userinfobot** di Telegram
2. Kirim `/start`
3. Bot akan balas dengan ID kamu — copy ke `.env`

## Jalanin dengan pm2

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup   # supaya auto-start setelah reboot
```

## Tambah Project ke VPS

Setelah VPS terdaftar, tambah project lewat tombol **🚀 Buka Panel** (butuh `PANEL_URL` di `.env`), atau langsung edit `data/config.json` (dibuat otomatis saat bot pertama jalan).

Format project di `data/config.json`:

```json
{
  "id": "proj1",
  "name": "Portfolio",
  "type": "website",
  "path": "/var/www/portfolio",
  "deployScript": "git pull && npm ci && npm run build && pm2 restart portfolio"
}
```

## Timpa Code lewat Telegram

Kirim file `.zip` (maks 20 MB) langsung ke bot di chat, lalu:

1. Pilih VPS → pilih project
2. Pilih **✅ Timpa & Deploy** (timpa file + jalanin script deploy) atau **📂 Timpa saja**

Aturan timpa: file dengan nama sama ditimpa, file lama yang tidak ada di ZIP dibiarkan, `.env` dan `data/` yang sudah ada di server tidak disentuh, `node_modules/` dan `.git` dilewati. Satu folder induk di dalam ZIP otomatis dibuka. Untuk file sampai 100 MB pakai Panel.

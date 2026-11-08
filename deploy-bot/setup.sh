#!/bin/bash
set -e

echo "🤖 Deploy Bot — Setup Script"
echo "================================"

if [ -f .env ]; then
  echo "ℹ️  .env sudah ada, dipakai apa adanya (hapus dulu kalau mau bikin ulang)."
else
  read -rp "Masukkan BOT_TOKEN (dari @BotFather): " BOT_TOKEN
  if [ -z "$BOT_TOKEN" ]; then
    echo "❌ BOT_TOKEN tidak boleh kosong!"
    exit 1
  fi

  read -rp "Masukkan OWNER_CHAT_ID (dari @userinfobot): " OWNER_CHAT_ID
  if ! [[ "$OWNER_CHAT_ID" =~ ^[0-9]+$ ]]; then
    echo "❌ OWNER_CHAT_ID harus angka!"
    exit 1
  fi

  # Mulai dari .env.example supaya variabel PANEL_* ikut terbawa
  cp .env.example .env
  sed -i "s|^BOT_TOKEN=.*|BOT_TOKEN=$BOT_TOKEN|; s|^OWNER_CHAT_ID=.*|OWNER_CHAT_ID=$OWNER_CHAT_ID|" .env
  chmod 600 .env
  echo "✅ File .env berhasil dibuat (cek PANEL_URL di dalamnya)"
fi

echo "📦 Installing dependencies..."
npm install

echo "🚀 Starting bot dengan pm2..."
pm2 start ecosystem.config.cjs
pm2 save

echo ""
echo "✅ Deploy Bot berhasil dijalankan!"
echo "   Kirim /start ke bot lo di Telegram"

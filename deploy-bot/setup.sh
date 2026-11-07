#!/bin/bash
set -e

echo "🤖 Deploy Bot — Setup Script"
echo "================================"

# Minta BOT_TOKEN
read -rp "Masukkan BOT_TOKEN (dari @BotFather): " BOT_TOKEN
if [ -z "$BOT_TOKEN" ]; then
  echo "❌ BOT_TOKEN tidak boleh kosong!"
  exit 1
fi

# Tulis OWNER_CHAT_ID langsung
OWNER_CHAT_ID=31303135

# Buat .env
cat > .env << EOF
BOT_TOKEN=$BOT_TOKEN
OWNER_CHAT_ID=$OWNER_CHAT_ID
EOF

echo "✅ File .env berhasil dibuat"

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Start dengan pm2
echo "🚀 Starting bot dengan pm2..."
pm2 start ecosystem.config.js
pm2 save

echo ""
echo "✅ Deploy Bot berhasil dijalankan!"
echo "   Kirim /start ke bot lo di Telegram"

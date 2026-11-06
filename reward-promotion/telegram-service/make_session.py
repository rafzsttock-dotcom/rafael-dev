#!/usr/bin/env python3
"""Jalankan SEKALI di laptop/VPS interaktif untuk membuat TELEGRAM_SESSION string.
Usage:
  pip install telethon
  python make_session.py
Lalu copy string ke .env sebagai TELEGRAM_SESSION=...
"""
from telethon.sync import TelegramClient
from telethon.sessions import StringSession

api_id = int(input("API_ID (my.telegram.org): ").strip())
api_hash = input("API_HASH: ").strip()
print("Login nomor HP akun Telegram yang akan mengirim OTP (format +62...).")
with TelegramClient(StringSession(), api_id, api_hash) as client:
    print("\n=== TELEGRAM_SESSION (simpan di .env, JANGAN share) ===\n")
    print(client.session.save())
    print("\n=======================================================\n")
    me = client.get_me()
    print(f"Login sebagai: {me.first_name} @{me.username} id={me.id}")

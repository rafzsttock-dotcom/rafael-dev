"use strict";
/**
 * Login SEKALI per akun userbot pengirim OTP.
 * Jalankan interaktif di VPS, mis:
 *   docker compose run --rm telethon node login.js akun1
 *   docker compose run --rm telethon node login.js akun2   (multi-akun)
 *
 * Butuh TELEGRAM_API_ID & TELEGRAM_API_HASH di environment (.env).
 * Sesi (StringSession) disimpan di TELEGRAM_SESSION_DIR/<nama>.session
 * (default /data/tg).
 */
const fs = require("node:fs");
const path = require("node:path");
const input = require("input");
const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
require("dotenv").config();

const apiId = parseInt(process.env.TELEGRAM_API_ID || process.env.API_ID, 10);
const apiHash = String(process.env.TELEGRAM_API_HASH || process.env.API_HASH || "").trim();
const dir = process.env.TELEGRAM_SESSION_DIR || "/data/tg";

if (!Number.isInteger(apiId) || apiId <= 0 || apiHash === "") {
  console.error("ERROR: TELEGRAM_API_ID / TELEGRAM_API_HASH belum diisi di .env");
  process.exit(1);
}

const name = (process.argv[2] || "akun1").replace(/[^A-Za-z0-9_-]/g, "") || "akun1";
fs.mkdirSync(dir, { recursive: true });
const sessionPath = path.join(dir, `${name}.session`);

(async () => {
  console.log(`== Login akun Telegram: ${name} ==`);
  console.log("Masukkan nomor HP akun pengirim OTP (format +62...), lalu kode dari Telegram.\n");

  const stringSession = new StringSession("");
  const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () => await input.text("Enter your phone number: "),
    password: async () => await input.text("Enter your 2FA password (if any): "),
    phoneCode: async () => await input.text("Enter the code you received: "),
    onError: (err) => console.error(err),
  });

  const me = await client.getMe();
  fs.writeFileSync(sessionPath, client.session.save(), { mode: 0o600 });

  console.log("\n== Berhasil login ==");
  console.log("Nama :", me.firstName || "");
  console.log("User : @" + (me.username || "-"));
  console.log("ID   :", me.id.toString());
  console.log("Sesi :", sessionPath);
  console.log("\nSelesai. Jalankan lagi dengan nama berbeda untuk menambah akun, atau 'docker compose up -d' untuk menjalankan layanan.");

  await client.disconnect();
  process.exit(0);
})();

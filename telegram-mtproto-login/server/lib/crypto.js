"use strict";

/**
 * Small helper to encrypt/decrypt the StringSession at rest using
 * AES-256-GCM with a key derived from SESSION_ENCRYPTION_KEY (env).
 *
 * This is a single-user personal tool: the key lives only in the
 * server's environment, never in the database file, so a leaked
 * sessions.json alone is not enough to recover a usable session.
 */

const crypto = require("crypto");

const SALT = "telegram-mtproto-login-v1"; // fixed, non-secret salt for key derivation

function deriveKey(passphrase) {
  if (!passphrase || passphrase.length < 16) {
    throw new Error(
      "SESSION_ENCRYPTION_KEY belum diset atau terlalu pendek (minimal 16 karakter). Isi di .env."
    );
  }
  return crypto.scryptSync(passphrase, SALT, 32);
}

function encrypt(plainText, passphrase) {
  const key = deriveKey(passphrase);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("hex"), tag.toString("hex"), enc.toString("hex")].join(":");
}

function decrypt(payload, passphrase) {
  const key = deriveKey(passphrase);
  const [ivHex, tagHex, encHex] = String(payload).split(":");
  if (!ivHex || !tagHex || !encHex) throw new Error("Data sesi tersimpan rusak/tidak valid");
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const enc = Buffer.from(encHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString("utf8");
}

function maskPhone(phone) {
  const s = String(phone || "");
  if (s.length <= 4) return "***";
  return s.slice(0, 3) + "*".repeat(Math.max(0, s.length - 5)) + s.slice(-2);
}

module.exports = { encrypt, decrypt, maskPhone };

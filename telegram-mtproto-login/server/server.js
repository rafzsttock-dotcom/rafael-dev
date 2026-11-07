"use strict";

/**
 * Telegram MTProto Login — personal tool
 * ----------------------------------------
 * Phone + OTP + 2FA login via MTProto (GramJS), generates a StringSession
 * for an account YOU own, and stores it encrypted locally for later reuse.
 *
 * This is intentionally single-user: there is no multi-account admin
 * dashboard, no collection of other people's sessions. Access to the
 * whole tool is gated by APP_ACCESS_TOKEN since it is meant to run on a
 * public VPS.
 */

require("dotenv").config();
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const { TelegramClient, Api } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { computeCheck } = require("telegram/Password");

const { encrypt, decrypt, maskPhone } = require("./lib/crypto");
const { SessionStore } = require("./lib/store");

const PORT = +process.env.PORT || 8088;
const API_ID = +process.env.TG_API_ID || 0;
const API_HASH = (process.env.TG_API_HASH || "").trim();
const APP_ACCESS_TOKEN = (process.env.APP_ACCESS_TOKEN || "").trim();
const SESSION_ENCRYPTION_KEY = (process.env.SESSION_ENCRYPTION_KEY || "").trim();
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");

if (!API_ID || !API_HASH) {
  console.error("TG_API_ID / TG_API_HASH belum diisi di .env — ambil dari https://my.telegram.org");
  process.exit(1);
}
if (!APP_ACCESS_TOKEN || APP_ACCESS_TOKEN.length < 12) {
  console.error("APP_ACCESS_TOKEN belum diisi atau terlalu pendek (min 12 karakter) di .env");
  process.exit(1);
}
try {
  // Fail fast on boot if the encryption key is missing/weak, not on first login attempt.
  encrypt("probe", SESSION_ENCRYPTION_KEY);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

const store = new SessionStore(path.join(DATA_DIR, "sessions.json"));

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

// ---------- tiny in-memory rate limiter ----------
const hits = new Map();
function limit(key, max, windowSec) {
  const now = Date.now();
  const row = hits.get(key) || { count: 0, reset: now + windowSec * 1000 };
  if (now > row.reset) { row.count = 0; row.reset = now + windowSec * 1000; }
  row.count++;
  hits.set(key, row);
  return row.count <= max;
}

// ---------- app-level access gate ----------
function requireAppToken(req, res, next) {
  const hdr = req.headers.authorization || "";
  const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : "";
  const a = Buffer.from(token.padEnd(64, "0"));
  const b = Buffer.from(APP_ACCESS_TOKEN.padEnd(64, "0"));
  if (token.length !== APP_ACCESS_TOKEN.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: "Token akses tidak valid" });
  }
  next();
}

app.post("/api/login", (req, res) => {
  if (!limit("applogin:" + req.ip, 10, 300)) {
    return res.status(429).json({ error: "Terlalu banyak percobaan, coba lagi nanti" });
  }
  const token = String(req.body.token || "");
  const a = Buffer.from(token.padEnd(64, "0"));
  const b = Buffer.from(APP_ACCESS_TOKEN.padEnd(64, "0"));
  if (token.length !== APP_ACCESS_TOKEN.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: "Token salah" });
  }
  res.json({ ok: true });
});

app.use("/api/auth", requireAppToken);
app.use("/api/sessions", requireAppToken);

// ---------- pending MTProto login flows (in-memory, short-lived) ----------
const PENDING_TTL_MS = 15 * 60 * 1000;
const pending = new Map(); // flowId -> { client, phone, phoneCodeHash, timer }

function cleanupFlow(flowId) {
  const f = pending.get(flowId);
  if (!f) return;
  clearTimeout(f.timer);
  pending.delete(flowId);
  f.client.disconnect().catch(() => {});
}

function scheduleCleanup(flowId) {
  const f = pending.get(flowId);
  if (!f) return;
  clearTimeout(f.timer);
  f.timer = setTimeout(() => cleanupFlow(flowId), PENDING_TTL_MS);
}

function rpcMessage(err) {
  return (err && (err.errorMessage || err.message)) || "Terjadi kesalahan";
}

// 1) Start login: send OTP to the phone's Telegram account
app.post("/api/auth/send-code", async (req, res) => {
  const phone = String(req.body.phone || "").trim();
  if (!/^\+?[0-9]{7,15}$/.test(phone)) {
    return res.status(400).json({ error: "Format nomor telepon tidak valid (pakai kode negara, contoh +62812xxxx)" });
  }
  if (!limit("sendcode:" + req.ip, 6, 900)) {
    return res.status(429).json({ error: "Terlalu banyak percobaan, coba lagi nanti" });
  }

  const client = new TelegramClient(new StringSession(""), API_ID, API_HASH, {
    connectionRetries: 5,
  });

  try {
    await client.connect();
    const result = await client.sendCode({ apiId: API_ID, apiHash: API_HASH }, phone);
    const flowId = crypto.randomUUID();
    pending.set(flowId, { client, phone, phoneCodeHash: result.phoneCodeHash, timer: null });
    scheduleCleanup(flowId);
    res.json({ flowId, isCodeViaApp: !!result.isCodeViaApp });
  } catch (err) {
    await client.disconnect().catch(() => {});
    res.status(400).json({ error: rpcMessage(err) });
  }
});

// 2) Submit the OTP code
app.post("/api/auth/submit-code", async (req, res) => {
  const { flowId } = req.body;
  const code = String(req.body.code || "").trim();
  const flow = pending.get(flowId);
  if (!flow) return res.status(400).json({ error: "Sesi login kedaluwarsa, mulai lagi dari nomor telepon" });
  if (!code) return res.status(400).json({ error: "Isi kode OTP" });
  if (!limit("submitcode:" + flowId, 6, 900)) return res.status(429).json({ error: "Terlalu banyak percobaan" });

  try {
    const result = await flow.client.invoke(
      new Api.auth.SignIn({
        phoneNumber: flow.phone,
        phoneCodeHash: flow.phoneCodeHash,
        phoneCode: code,
      })
    );
    await finishLogin(res, flowId, flow, result.user);
  } catch (err) {
    const msg = rpcMessage(err);
    if (msg === "SESSION_PASSWORD_NEEDED") {
      scheduleCleanup(flowId);
      return res.json({ status: "password_required" });
    }
    scheduleCleanup(flowId);
    res.status(400).json({ error: msg });
  }
});

// 3) Submit 2FA password (only if step 2 answered password_required)
app.post("/api/auth/submit-password", async (req, res) => {
  const { flowId } = req.body;
  const password = String(req.body.password || "");
  const flow = pending.get(flowId);
  if (!flow) return res.status(400).json({ error: "Sesi login kedaluwarsa, mulai lagi dari nomor telepon" });
  if (!password) return res.status(400).json({ error: "Isi password 2FA" });
  if (!limit("submitpw:" + flowId, 6, 900)) return res.status(429).json({ error: "Terlalu banyak percobaan" });

  try {
    const passwordInfo = await flow.client.invoke(new Api.account.GetPassword());
    const srpCheck = await computeCheck(passwordInfo, password);
    const result = await flow.client.invoke(new Api.auth.CheckPassword({ password: srpCheck }));
    await finishLogin(res, flowId, flow, result.user);
  } catch (err) {
    scheduleCleanup(flowId);
    res.status(400).json({ error: rpcMessage(err) });
  }
});

async function finishLogin(res, flowId, flow, user) {
  const stringSession = flow.client.session.save();
  const encryptedSession = encrypt(stringSession, SESSION_ENCRYPTION_KEY);
  const label = (user && (user.username ? "@" + user.username : [user.firstName, user.lastName].filter(Boolean).join(" "))) || maskPhone(flow.phone);
  const entry = store.add({ label, maskedPhone: maskPhone(flow.phone), encryptedSession });
  cleanupFlow(flowId);
  res.json({ status: "ok", session: entry });
}

// ---------- saved sessions management ----------
app.get("/api/sessions", (_req, res) => {
  res.json({ sessions: store.list() });
});

app.post("/api/sessions/:id/test", async (req, res) => {
  const row = store.get(req.params.id);
  if (!row) return res.status(404).json({ error: "Sesi tidak ditemukan" });
  let client;
  try {
    const stringSession = decrypt(row.encryptedSession, SESSION_ENCRYPTION_KEY);
    client = new TelegramClient(new StringSession(stringSession), API_ID, API_HASH, {
      connectionRetries: 3,
    });
    await client.connect();
    const me = await client.getMe();
    res.json({
      ok: true,
      account: {
        id: me.id?.toString?.() || String(me.id),
        username: me.username || null,
        firstName: me.firstName || null,
        lastName: me.lastName || null,
        phone: me.phone ? maskPhone(me.phone) : null,
      },
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: rpcMessage(err) });
  } finally {
    if (client) await client.disconnect().catch(() => {});
  }
});

app.delete("/api/sessions/:id", async (req, res) => {
  const row = store.get(req.params.id);
  if (!row) return res.status(404).json({ error: "Sesi tidak ditemukan" });
  let client;
  try {
    const stringSession = decrypt(row.encryptedSession, SESSION_ENCRYPTION_KEY);
    client = new TelegramClient(new StringSession(stringSession), API_ID, API_HASH, {
      connectionRetries: 3,
    });
    await client.connect();
    await client.invoke(new Api.auth.LogOut());
  } catch {
    // best-effort: still remove locally even if remote logout fails (e.g. already revoked)
  } finally {
    if (client) await client.disconnect().catch(() => {});
  }
  store.remove(req.params.id);
  res.json({ ok: true });
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`telegram-mtproto-login listening on :${PORT}`);
});

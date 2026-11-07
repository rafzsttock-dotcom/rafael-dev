"use strict";
/**
 * Telegram StringSession generator — HTTP sidecar untuk KODO/Rewex.
 *
 * Sidecar ini TIDAK menyimpan session. Tugasnya hanya:
 *   start (kirim kode) -> code (opsional 2FA) -> kembalikan StringSession
 *   logout (cabut session di Telegram)
 *
 * Semua request wajib menyertakan header `X-Service-Secret` yang sama dengan
 * SESSION_GENERATOR_SECRET. Hanya server aplikasi (bukan browser user) yang
 * boleh memanggil sidecar ini.
 *
 * StringSession setara password akun Telegram. Jangan pernah menulisnya ke log.
 */
const http = require("node:http");
const crypto = require("node:crypto");
const { TelegramClient, Api } = require("telegram");
const { StringSession } = require("telegram/sessions");

const PORT = +process.env.SESSION_GENERATOR_PORT || 8091;
const HOST = process.env.SESSION_GENERATOR_HOST || "0.0.0.0";
const SECRET = process.env.SESSION_GENERATOR_SECRET || process.env.TELEGRAM_SERVICE_SECRET || "";
const apiId = parseInt(process.env.TELEGRAM_API_ID || process.env.API_ID, 10);
const apiHash = String(process.env.TELEGRAM_API_HASH || process.env.API_HASH || "").trim();
const CONFIGURED = Number.isInteger(apiId) && apiId > 0 && apiHash.length > 0;

const FLOW_TTL_MS = 10 * 60 * 1000; // kode Telegram berlaku ±5 menit, beri kelonggaran
const MAX_FLOWS = 20;
const MAX_BODY = 16 * 1024;

/** flowId -> { client, phone, phoneCodeHash, createdAt, expires } */
const flows = new Map();

function log(...a) {
  // Jangan pernah log isi session / kode.
  console.log(new Date().toISOString(), ...a);
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ""));
  const y = Buffer.from(String(b || ""));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function telegramError(err) {
  const code = String((err && (err.errorMessage || err.message)) || "UNKNOWN");
  const map = {
    PHONE_NUMBER_INVALID: "Nomor Telegram tidak valid",
    PHONE_NUMBER_BANNED: "Nomor ini diblokir Telegram",
    PHONE_NUMBER_UNOCCUPIED: "Nomor belum terdaftar di Telegram",
    PHONE_CODE_INVALID: "Kode Telegram salah",
    PHONE_CODE_EXPIRED: "Kode Telegram sudah kedaluwarsa, minta kode baru",
    PHONE_CODE_EMPTY: "Kode Telegram kosong",
    PASSWORD_HASH_INVALID: "Password 2FA salah",
    SESSION_PASSWORD_NEEDED: "Akun memakai password 2FA",
    AUTH_KEY_UNREGISTERED: "Session sudah tidak aktif",
    AUTH_KEY_INVALID: "Session tidak valid",
    FLOOD: "Terlalu banyak percobaan ke Telegram, coba lagi nanti",
    FLOOD_WAIT: "Terlalu banyak percobaan ke Telegram, coba lagi nanti",
    API_ID_INVALID: "TELEGRAM_API_ID / TELEGRAM_API_HASH salah",
    API_ID_PUBLISHED_FLOOD: "API ID ini dibatasi Telegram, pakai API ID lain",
    TIMEOUT: "Koneksi ke Telegram timeout, coba lagi",
  };
  if (code.startsWith("FLOOD_WAIT_")) return map.FLOOD;
  return map[code] || ("Telegram error: " + code.slice(0, 120));
}

function clientFor(sessionString) {
  return new TelegramClient(new StringSession(sessionString || ""), apiId, apiHash, {
    connectionRetries: 3,
    requestRetries: 2,
    autoReconnect: false,
    retryDelay: 500,
    timeout: 30,
    deviceModel: "KODO Rewards",
    systemVersion: "1.0",
    appVersion: "1.0",
    langCode: "id",
  });
}

async function destroyFlow(id) {
  const f = flows.get(id);
  if (!f) return;
  flows.delete(id);
  try { await f.client.destroy(); } catch (_) { /* ignore */ }
}

async function ensureConnected(client) {
  if (!client.connected) await client.connect();
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(label || "TIMEOUT")), ms);
    if (timer.unref) timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function sweep() {
  const t = Date.now();
  for (const [id, f] of flows) {
    if (f.expires < t) {
      log("flow expired", id);
      destroyFlow(id);
    }
  }
}
setInterval(sweep, 60_000).unref();

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw new Error("body terlalu besar");
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch (_) { throw new Error("JSON tidak valid"); }
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: String(u.id || ""),
    username: u.username || "",
    first_name: u.firstName || "",
    last_name: u.lastName || "",
    phone: u.phone || "",
  };
}

async function handleStart(body) {
  if (!CONFIGURED) return [503, { error: "SESSION_GENERATOR belum dikonfigurasi: isi TELEGRAM_API_ID dan TELEGRAM_API_HASH" }];
  const phone = String(body.phone || "").replace(/[^\d+]/g, "").trim();
  if (!/^\+?\d{8,16}$/.test(phone)) return [400, { error: "Nomor Telegram tidak valid (contoh: +6281234567890)" }];
  if (flows.size >= MAX_FLOWS) return [429, { error: "Terlalu banyak proses login berjalan, coba lagi sebentar" }];

  const client = clientFor("");
  let sent;
  try {
    sent = await withTimeout((async () => {
      await client.connect();
      return client.sendCode({ apiId, apiHash }, phone);
    })(), 60_000, "TIMEOUT");
  } catch (e) {
    try { await client.destroy(); } catch (_) {}
    log("start failed", telegramError(e));
    return [400, { error: telegramError(e) }];
  }

  const id = crypto.randomBytes(24).toString("hex");
  flows.set(id, {
    client,
    phone,
    phoneCodeHash: sent.phoneCodeHash,
    createdAt: Date.now(),
    expires: Date.now() + FLOW_TTL_MS,
  });
  log("flow started", id.slice(0, 8), "user", String(body.user_id || "-"));
  return [200, {
    ok: true,
    flow_id: id,
    phone,
    is_code_via_app: !!sent.isCodeViaApp,
    expires_in: Math.floor(FLOW_TTL_MS / 1000),
  }];
}

async function finishLogin(id, f, user) {
  let session = "";
  try { session = f.client.session.save(); } catch (_) { session = ""; }
  await destroyFlow(id);
  if (!session) return [502, { error: "Gagal membuat StringSession" }];
  log("flow success", id.slice(0, 8));
  return [200, { ok: true, session_string: session, me: publicUser(user) }];
}

async function handleCode(body) {
  const id = String(body.flow_id || "");
  const code = String(body.code || "").replace(/[^\d]/g, "");
  const f = flows.get(id);
  if (!f) return [400, { error: "Sesi login tidak ditemukan atau sudah kedaluwarsa. Mulai ulang." }];
  if (f.expires < Date.now()) { await destroyFlow(id); return [400, { error: "Sesi login kedaluwarsa. Mulai ulang." }]; }
  if (!/^\d{4,7}$/.test(code)) return [400, { error: "Kode Telegram tidak valid" }];

  let result;
  try {
    result = await withTimeout((async () => {
      await ensureConnected(f.client);
      return f.client.invoke(new Api.auth.SignIn({
        phoneNumber: f.phone,
        phoneCodeHash: f.phoneCodeHash,
        phoneCode: code,
      }));
    })(), 60_000, "TIMEOUT");
  } catch (e) {
    const em = String((e && (e.errorMessage || e.message)) || "");
    if (em === "SESSION_PASSWORD_NEEDED") {
      // Pertahankan client; password dikirim pada request berikutnya.
      return [200, { ok: false, need_password: true, hint: "" }];
    }
    log("code failed", em);
    return [400, { error: telegramError(e) }];
  }

  if (result instanceof Api.auth.AuthorizationSignUpRequired) {
    await destroyFlow(id);
    return [400, { error: "Nomor ini belum punya akun Telegram. Buat akun dulu di aplikasi Telegram." }];
  }
  return finishLogin(id, f, result && result.user);
}

async function handlePassword(body) {
  const id = String(body.flow_id || "");
  const password = String(body.password || "");
  const f = flows.get(id);
  if (!f) return [400, { error: "Sesi login tidak ditemukan atau sudah kedaluwarsa. Mulai ulang." }];
  if (f.expires < Date.now()) { await destroyFlow(id); return [400, { error: "Sesi login kedaluwarsa. Mulai ulang." }]; }
  if (!password) return [400, { error: "Password 2FA wajib diisi" }];

  let user;
  try {
    user = await withTimeout((async () => {
      await ensureConnected(f.client);
      return f.client.signInWithPassword({ apiId, apiHash }, {
        password: async () => password,
        onError: (err) => {
          // false = coba lagi; tapi kita tidak mau loop tanpa akhir, jadi lempar.
          throw err;
        },
      });
    })(), 60_000, "TIMEOUT");
  } catch (e) {
    log("password failed", telegramError(e));
    return [400, { error: telegramError(e) }];
  }
  if (!user) return [400, { error: "Password 2FA salah" }];
  return finishLogin(id, f, user);
}

async function handleLogout(body) {
  if (!CONFIGURED) return [503, { error: "SESSION_GENERATOR belum dikonfigurasi" }];
  const sessionString = String(body.session_string || "");
  if (!sessionString || sessionString.length < 50) return [400, { error: "session_string tidak valid" }];
  let client;
  try { client = clientFor(sessionString); }
  catch (_) { return [400, { error: "session_string tidak valid / rusak" }]; }
  try {
    await withTimeout((async () => {
      await client.connect();
      await client.invoke(new Api.auth.LogOut());
    })(), 45_000, "TIMEOUT");
  } catch (e) {
    const em = String((e && (e.errorMessage || e.message)) || "");
    if (em !== "AUTH_KEY_UNREGISTERED") {
      log("logout failed", telegramError(e));
      try { await client.destroy(); } catch (_) {}
      return [400, { error: telegramError(e) }];
    }
  }
  try { await client.destroy(); } catch (_) {}
  log("logout ok");
  return [200, { ok: true }];
}

const server = http.createServer(async (req, res) => {
  if (!safeEqual(req.headers["x-service-secret"], SECRET) || !SECRET) {
    return json(res, 401, { error: "unauthorized" });
  }

  if (req.method === "GET" && req.url === "/health") {
    return json(res, 200, { ok: true, configured: CONFIGURED, flows: flows.size });
  }
  if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });

  let body;
  try { body = await readBody(req); }
  catch (e) { return json(res, 400, { error: e.message }); }

  try {
    let out;
    if (req.url === "/login/start") out = await handleStart(body);
    else if (req.url === "/login/code") out = await handleCode(body);
    else if (req.url === "/login/password") out = await handlePassword(body);
    else if (req.url === "/login/cancel") {
      const id = String(body.flow_id || "");
      await destroyFlow(id);
      out = [200, { ok: true }];
    } else if (req.url === "/logout") out = await handleLogout(body);
    else out = [404, { error: "not found" }];
    return json(res, out[0], out[1]);
  } catch (e) {
    log("unhandled", String(e && e.message || e));
    return json(res, 500, { error: "internal error" });
  }
});

server.listen(PORT, HOST, () => {
  log("session-generator listening on", HOST + ":" + PORT, CONFIGURED ? "(configured)" : "(NOT configured: set TELEGRAM_API_ID/TELEGRAM_API_HASH)");
  if (!SECRET) log("WARNING: SESSION_GENERATOR_SECRET kosong — semua request akan ditolak");
});

function shutdown() {
  for (const id of [...flows.keys()]) destroyFlow(id);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

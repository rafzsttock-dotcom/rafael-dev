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
const CODE_LEN = 6; // jumlah digit kode (sesuai jumlah kotak di UI)
const DEV_SHOW_CODE = process.env.DEV_SHOW_CODE === "1"; // HANYA untuk uji coba: kode ikut dikembalikan di respons
/** Buat kode baru untuk akun `phone`, simpan hash-nya, kirim via Telegram (Telethon). Return {sent, code}. */
async function sendOtp(phone) {
  const u = db.prepare("SELECT tg_id FROM users WHERE phone=?").get(phone);
  const row = db.prepare("SELECT sent FROM otps WHERE phone=?").get(phone);
  const code = String(crypto.randomInt(10 ** (CODE_LEN - 1), 10 ** CODE_LEN));
  db.prepare("INSERT INTO otps(phone,code_hash,expires,attempts,sent) VALUES(?,?,?,0,?) ON CONFLICT(phone) DO UPDATE SET code_hash=?,expires=?,attempts=0,sent=?")
    .run(phone, sha(code), now() + 300, ((row && row.sent) || 0) + 1, sha(code), now() + 300, ((row && row.sent) || 0) + 1);
  if (!u || !u.tg_id) return { sent: false, code };
  const r = await tgService("/send", {
    tg_id: +u.tg_id,
    text: `Kode verifikasi KODO Rewards: ${code}\nBerlaku 5 menit. Jangan bagikan ke siapa pun.`,
  });
  return { sent: !!r.ok, code };
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

// ====== Login: nomor HP -> kode -> masuk (akun dibuat otomatis jika belum ada) ======
// 1) request-code: {phone} -> {ok, phone, dev_code?}
app.post("/api/auth/request-code", async (req, res) => {
  const phone = normPhone(req.body.phone);
  if (!phone) return res.status(400).json({ ok: false, error: "Nomor HP tidak valid." });
  if (!limit("rc-ip:" + req.ip, 20, 900) || !limit("rc:" + phone, 5, 3600)) return res.status(429).json({ ok: false, error: "Terlalu banyak percobaan, coba lagi nanti." });
  let u = db.prepare("SELECT * FROM users WHERE phone=?").get(phone);
  if (!u || !u.tg_id) {
    // cari / hubungkan akun Telegram dari nomor ini (kode dikirim lewat Telegram)
    const r = await tgService("/resolve", { identifier: "+" + phone });
    const tgId = r.ok ? String(r.tg_id || "").replace(/[^\d]/g, "") : "";
    if (tgId) {
      const byTg = db.prepare("SELECT * FROM users WHERE tg_id=?").get(tgId);
      if (byTg) u = byTg; // akun lama (dibuat sebelum sistem ini) tetap dipakai
      else if (u) db.prepare("UPDATE users SET tg_id=?,tg_name=? WHERE id=?").run(tgId, r.tg_name || r.username || "", u.id);
      else {
        db.prepare("INSERT INTO users(phone,pass_hash,tg_id,tg_name,ref_code,created,reg_ip,verified) VALUES(?,?,?,?,?,?,?,0)")
          .run(phone, "", tgId, r.tg_name || r.username || "", crypto.randomBytes(4).toString("hex"), now(), req.ip);
      }
      u = db.prepare("SELECT * FROM users WHERE tg_id=?").get(tgId);
    } else if (DEV_SHOW_CODE && !u) {
      db.prepare("INSERT INTO users(phone,pass_hash,ref_code,created,reg_ip,verified) VALUES(?,?,?,?,?,0)")
        .run(phone, "", crypto.randomBytes(4).toString("hex"), now(), req.ip);
      u = db.prepare("SELECT * FROM users WHERE phone=?").get(phone);
    } else if (!u) {
      return res.status(400).json({ ok: false, error: "Nomor ini tidak terdaftar di Telegram. Pakai nomor yang aktif di Telegram." });
    }
  }
  if (u.banned) return res.status(403).json({ ok: false, error: "Akun diblokir." });
  const { sent, code } = await sendOtp(u.phone);
  if (!sent && !DEV_SHOW_CODE) return res.status(502).json({ ok: false, error: "Gagal mengirim kode. Pastikan privacy Telegram mengizinkan pesan dari non-kontak." });
  const out = { ok: true, phone: u.phone };
  if (DEV_SHOW_CODE) out.dev_code = code;
  res.json(out);
});
// 2) verify-code: {phone, code, ref} -> {ok, is_new, welcome_points}
app.post("/api/auth/verify-code", (req, res) => {
  const phone = String(req.body.phone || "").replace(/[^\d]/g, ""), code = String(req.body.code || "");
  if (!phone || !limit("vc:" + phone, 10, 900) || !limit("vc-ip:" + req.ip, 40, 900)) return res.status(429).json({ ok: false, error: "Terlalu banyak percobaan." });
  const o = db.prepare("SELECT * FROM otps WHERE phone=?").get(phone);
  if (!o || o.expires < now() || o.attempts >= 5) return res.status(400).json({ ok: false, error: "Kode kedaluwarsa, minta kode baru." });
  db.prepare("UPDATE otps SET attempts=attempts+1 WHERE phone=?").run(phone);
  const a = Buffer.from(sha(code)), b = Buffer.from(o.code_hash);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(400).json({ ok: false, error: "Kode salah." });
  db.prepare("DELETE FROM otps WHERE phone=?").run(phone);
  const u = db.prepare("SELECT * FROM users WHERE phone=?").get(phone);
  if (!u) return res.status(404).json({ ok: false, error: "Akun tidak ditemukan." });
  if (u.banned) return res.status(403).json({ ok: false, error: "Akun diblokir." });
  const isNew = !u.verified;
  let welcome = 0;
  if (isNew) {
    // anti multi-akun kasar: batasi akun baru terverifikasi per IP per hari
    const fromIp = db.prepare("SELECT COUNT(*) c FROM users WHERE reg_ip=? AND verified=1 AND created>?").get(req.ip, now() - 86400).c;
    if (fromIp >= 5) return res.status(429).json({ ok: false, error: "Terlalu banyak pendaftaran dari jaringan ini hari ini, coba lagi besok." });
    let refId = u.referred_by;
    const refCode = String(req.body.ref || "").trim();
    if (!refId && /^[a-f0-9]{8}$/.test(refCode)) {
      const rr = db.prepare("SELECT id FROM users WHERE ref_code=? AND verified=1 AND id<>?").get(refCode, u.id);
      refId = rr ? rr.id : null;
    }
    tx(() => {
      db.prepare("UPDATE users SET verified=1,referred_by=? WHERE id=?").run(refId || null, u.id);
      if (refId) { addPoints(refId, 10000, "referral:" + u.id); addPoints(u.id, 2000, "bonus referral"); welcome = 2000; }
    });
  }
  db.prepare("UPDATE users SET last_login=?,last_ip=? WHERE id=?").run(now(), req.ip, u.id);
  newSession(res, u.id, req);
  res.json({ ok: true, is_new: isNew, welcome_points: welcome });
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
  index: page("index.html").replace(/href="app\.html"/g, `href="/${APP_PATH}"`),
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

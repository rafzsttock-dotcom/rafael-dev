"use strict";
const express = require("express");
const crypto = require("node:crypto");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const PORT = +process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data", "app.db");
const BOT_TOKEN = process.env.BOT_TOKEN || "";
const BOT_USERNAME = process.env.BOT_USERNAME || "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const SESSION_DAYS = +process.env.SESSION_DAYS || 90;
const SECURE_COOKIE = process.env.SECURE_COOKIE === "1";
const STATIC_DIR = process.env.STATIC_DIR || path.join(__dirname, "..", "public");

if (ADMIN_PASSWORD.length < 10) {
  console.error("ADMIN_PASSWORD wajib diisi (min 10 karakter) di .env");
  process.exit(1);
}
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
`);
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
function normPhone(p) {
  let d = String(p || "").replace(/[^\d]/g, "");
  if (d.startsWith("0")) d = "62" + d.slice(1); else if (d.startsWith("8")) d = "62" + d;
  return /^62\d{8,13}$/.test(d) ? d : null;
}
function addPoints(uid, delta, reason) {
  db.prepare("UPDATE users SET points=points+? WHERE id=?").run(delta, uid);
  db.prepare("INSERT INTO ledger(user_id,delta,reason,ts) VALUES(?,?,?,?)").run(uid, delta, reason, now());
}

/* ---- Telegram ---- */
async function tg(method, body) {
  if (!BOT_TOKEN) return { ok: false, description: "BOT_TOKEN kosong" };
  try {
    const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) });
    return await r.json();
  } catch (e) { return { ok: false, description: String(e) }; }
}
async function sendOtp(phone) {
  const u = db.prepare("SELECT tg_id FROM users WHERE phone=?").get(phone);
  if (!u || !u.tg_id) return false;
  const row = db.prepare("SELECT sent FROM otps WHERE phone=?").get(phone);
  const code = String(crypto.randomInt(100000, 1000000));
  db.prepare("INSERT INTO otps(phone,code_hash,expires,attempts,sent) VALUES(?,?,?,0,?) ON CONFLICT(phone) DO UPDATE SET code_hash=?,expires=?,attempts=0,sent=?")
    .run(phone, sha(code), now() + 300, 1, sha(code), now() + 300, ((row && row.sent) || 0) + 1);
  const r = await tg("sendMessage", { chat_id: u.tg_id, text: `Kode verifikasi kamu: ${code}\nBerlaku 5 menit. Jangan bagikan ke siapa pun.` });
  return !!r.ok;
}
let offset = 0;
async function poll() {
  if (!BOT_TOKEN) return console.warn("BOT_TOKEN kosong: bot Telegram nonaktif");
  for (;;) {
    const r = await tg("getUpdates", { offset, timeout: 25, allowed_updates: ["message"] });
    if (!r.ok) { await new Promise((s) => setTimeout(s, 5000)); continue; }
    for (const up of r.result) {
      offset = up.update_id + 1;
      const m = up.message; if (!m) continue;
      try {
        if (m.contact) {
          // hanya terima kontak milik pengirim sendiri
          if (m.contact.user_id !== m.from.id) { await tg("sendMessage", { chat_id: m.chat.id, text: "Bagikan kontak milikmu sendiri lewat tombol." }); continue; }
          const phone = normPhone(m.contact.phone_number);
          const u = phone && db.prepare("SELECT id FROM users WHERE phone=?").get(phone);
          if (!u) { await tg("sendMessage", { chat_id: m.chat.id, text: "Nomor ini belum terdaftar. Daftar dulu di website.", reply_markup: { remove_keyboard: true } }); continue; }
          db.prepare("UPDATE users SET tg_id=?,tg_name=? WHERE id=?").run(String(m.from.id), m.from.username || m.from.first_name || "", u.id);
          const ok = await sendOtp(phone);
          if (!ok) await tg("sendMessage", { chat_id: m.chat.id, text: "Gagal mengirim kode, coba lagi." });
        } else if (m.text && m.text.startsWith("/start")) {
          await tg("sendMessage", { chat_id: m.chat.id, text: "Halo! Tekan tombol di bawah untuk membagikan nomor HP-mu dan terima kode verifikasi.",
            reply_markup: { keyboard: [[{ text: "Bagikan nomor HP", request_contact: true }]], resize_keyboard: true, one_time_keyboard: true } });
        }
      } catch (e) { console.error("bot error", e); }
    }
  }
}

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
function newSession(res, uid) {
  const tok = crypto.randomBytes(32).toString("hex");
  db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(sha(tok), uid, now() + SESSION_DAYS * 86400);
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
  if (!e || e < Date.now()) return res.status(401).json({ error: "admin" });
  next();
}
const pub = (u) => ({ id: u.id, phone: u.phone, points: u.points, ref_code: u.ref_code, bot: BOT_USERNAME });

app.get("/api/config", (_q, res) => res.json({ bot: BOT_USERNAME, min_withdraw: +setting("min_withdraw"), channel: setting("channel"), methods: setting("methods").split(",").filter(Boolean) }));

app.post("/api/register", (req, res) => {
  const phone = normPhone(req.body.phone), pw = String(req.body.password || "");
  if (!phone) return res.status(400).json({ error: "Nomor HP tidak valid" });
  if (pw.length < 8) return res.status(400).json({ error: "Password minimal 8 karakter" });
  if (!limit("reg:" + req.ip, 10, 3600)) return res.status(429).json({ error: "Terlalu banyak percobaan" });
  const ex = db.prepare("SELECT id,verified FROM users WHERE phone=?").get(phone);
  if (ex && ex.verified) return res.status(409).json({ error: "Nomor sudah terdaftar, silakan login" });
  let ref = null;
  if (req.body.ref) { const r = db.prepare("SELECT id FROM users WHERE ref_code=? AND verified=1").get(String(req.body.ref)); ref = r && r.id; }
  if (ex) db.prepare("UPDATE users SET pass_hash=? WHERE id=?").run(hashPw(pw), ex.id);
  else db.prepare("INSERT INTO users(phone,pass_hash,ref_code,referred_by,created) VALUES(?,?,?,?,?)").run(phone, hashPw(pw), crypto.randomBytes(4).toString("hex"), ref, now());
  res.json({ ok: true, bot: BOT_USERNAME });
});
app.post("/api/otp/resend", async (req, res) => {
  const phone = normPhone(req.body.phone);
  if (!phone || !limit("otp:" + phone, 5, 3600)) return res.status(429).json({ error: "Terlalu banyak permintaan" });
  const u = db.prepare("SELECT tg_id FROM users WHERE phone=?").get(phone);
  if (!u) return res.status(404).json({ error: "Nomor belum terdaftar" });
  if (!u.tg_id) return res.json({ ok: false, need_bot: true, bot: BOT_USERNAME });
  res.json({ ok: await sendOtp(phone) });
});
app.post("/api/verify", (req, res) => {
  const phone = normPhone(req.body.phone), code = String(req.body.code || "");
  if (!phone || !limit("ver:" + phone, 10, 900)) return res.status(429).json({ error: "Terlalu banyak percobaan" });
  const o = db.prepare("SELECT * FROM otps WHERE phone=?").get(phone);
  if (!o || o.expires < now() || o.attempts >= 5) return res.status(400).json({ error: "Kode kedaluwarsa, minta kode baru" });
  db.prepare("UPDATE otps SET attempts=attempts+1 WHERE phone=?").run(phone);
  const a = Buffer.from(sha(code)), b = Buffer.from(o.code_hash);
  if (!crypto.timingSafeEqual(a, b)) return res.status(400).json({ error: "Kode salah" });
  db.prepare("DELETE FROM otps WHERE phone=?").run(phone);
  const u = db.prepare("SELECT * FROM users WHERE phone=?").get(phone);
  tx(() => {
    if (!u.verified) {
      db.prepare("UPDATE users SET verified=1 WHERE id=?").run(u.id);
      if (u.referred_by) { addPoints(u.referred_by, 10000, "referral:" + u.id); addPoints(u.id, 2000, "bonus referral"); }
    }
  });
  newSession(res, u.id);
  res.json({ ok: true });
});
app.post("/api/login", (req, res) => {
  const phone = normPhone(req.body.phone), pw = String(req.body.password || "");
  if (!limit("login:" + req.ip, 20, 900) || (phone && !limit("loginp:" + phone, 8, 900))) return res.status(429).json({ error: "Terlalu banyak percobaan, coba lagi nanti" });
  const u = phone && db.prepare("SELECT * FROM users WHERE phone=? AND verified=1").get(phone);
  if (!u || !checkPw(pw, u.pass_hash) || u.banned) return res.status(401).json({ error: "Nomor atau password salah" });
  newSession(res, u.id); res.json({ ok: true });
});
app.post("/api/logout", auth, (req, res) => {
  // Logout hanya menghapus sesi di perangkat ini. Poin TIDAK dihapus.
  db.prepare("DELETE FROM sessions WHERE token_hash=?").run(sha(cookies(req).sid));
  res.append("Set-Cookie", "sid=; Path=/; Max-Age=0"); res.json({ ok: true });
});
app.get("/api/me", auth, (req, res) => {
  const u = req.user, d = today();
  const missions = db.prepare("SELECT * FROM missions WHERE active=1").all().map((m) => ({
    id: m.id, title: m.title, descr: m.descr, reward: m.reward, type: m.type, link: m.link,
    claimed: !!db.prepare("SELECT 1 FROM claims WHERE user_id=? AND mission_id=? AND day=?").get(u.id, m.id, m.type === "daily" ? d : "once"),
    tapped: !!db.prepare("SELECT 1 FROM taps WHERE user_id=? AND mission_id=?").get(u.id, m.id) }));
  const refs = db.prepare("SELECT COUNT(*) c FROM users WHERE referred_by=? AND verified=1").get(u.id).c;
  res.json({ user: pub(u), missions,
    rewards: db.prepare("SELECT id,title,cost FROM rewards WHERE active=1").all(),
    referrals: refs, history: db.prepare("SELECT delta,reason,ts FROM ledger WHERE user_id=? ORDER BY id DESC LIMIT 30").all(u.id),
    withdrawals: db.prepare("SELECT id,points,method,status,note,ts FROM withdrawals WHERE user_id=? ORDER BY id DESC LIMIT 20").all(u.id) });
});
app.post("/api/missions/:id/tap", auth, (req, res) => {
  db.prepare("INSERT OR IGNORE INTO taps VALUES(?,?,?)").run(req.user.id, +req.params.id, now()); res.json({ ok: true });
});
app.post("/api/missions/:id/claim", auth, async (req, res) => {
  const u = req.user, m = db.prepare("SELECT * FROM missions WHERE id=? AND active=1").get(+req.params.id);
  if (!m) return res.status(404).json({ error: "Misi tidak ada" });
  if (m.type === "join_channel") {
    const ch = m.link || setting("channel");
    const r = u.tg_id && ch ? await tg("getChatMember", { chat_id: ch.startsWith("@") ? ch : "@" + ch.replace(/^https?:\/\/t\.me\//, ""), user_id: u.tg_id }) : null;
    if (!r || !r.ok || !["member", "administrator", "creator"].includes(r.result.status)) return res.status(400).json({ error: "Kamu belum bergabung ke channel" });
  } else if (m.type === "start_bot") {
    if (!u.tg_id) return res.status(400).json({ error: "Bot belum di-start" });
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
  if (!limit("adm:" + req.ip, 5, 900)) return res.status(429).json({ error: "Terlalu banyak percobaan" });
  const a = Buffer.from(sha(String(req.body.password || ""))), b = Buffer.from(sha(ADMIN_PASSWORD));
  if (!crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: "Password salah" });
  const t = crypto.randomBytes(32).toString("hex"); adminTokens.set(sha(t), Date.now() + 12 * 3600e3);
  setCookie(res, "adm", t, 0.5); res.json({ ok: true });
});
app.get("/api/admin/overview", adminAuth, (_q, res) => res.json({
  users: db.prepare("SELECT COUNT(*) c FROM users WHERE verified=1").get().c,
  points_outstanding: db.prepare("SELECT COALESCE(SUM(points),0) s FROM users").get().s,
  pending_withdrawals: db.prepare("SELECT COUNT(*) c FROM withdrawals WHERE status='pending'").get().c,
  settings: Object.fromEntries(db.prepare("SELECT k,v FROM settings").all().map((r) => [r.k, r.v])) }));
app.get("/api/admin/users", adminAuth, (_q, res) => res.json(db.prepare("SELECT id,phone,tg_name,points,banned,created FROM users WHERE verified=1 ORDER BY id DESC LIMIT 500").all()));
app.post("/api/admin/users/:id/ban", adminAuth, (req, res) => { db.prepare("UPDATE users SET banned=? WHERE id=?").run(req.body.banned ? 1 : 0, +req.params.id); res.json({ ok: true }); });
app.get("/api/admin/withdrawals", adminAuth, (_q, res) => res.json(db.prepare("SELECT w.*,u.phone FROM withdrawals w JOIN users u ON u.id=w.user_id ORDER BY (w.status='pending') DESC, w.id DESC LIMIT 300").all()));
app.post("/api/admin/withdrawals/:id", adminAuth, (req, res) => {
  const w = db.prepare("SELECT * FROM withdrawals WHERE id=?").get(+req.params.id), st = req.body.status;
  if (!w || w.status !== "pending" || !["paid", "rejected"].includes(st)) return res.status(400).json({ error: "Tidak valid" });
  tx(() => {
    db.prepare("UPDATE withdrawals SET status=?,note=? WHERE id=?").run(st, String(req.body.note || "").slice(0, 200), w.id);
    if (st === "rejected") addPoints(w.user_id, w.points, "penarikan ditolak, poin dikembalikan");
  });
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
  for (const k of ["min_withdraw", "channel", "methods"]) if (k in req.body) db.prepare("INSERT INTO settings VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=?").run(k, String(req.body[k]), String(req.body[k]));
  res.json({ ok: true });
});

/* ---- static ---- */
app.use(express.static(STATIC_DIR, { extensions: ["html"], index: "index.html", dotfiles: "ignore" }));
app.use((e, _q, res, _n) => { console.error(e); res.status(500).json({ error: "server" }); });

app.listen(PORT, () => console.log("listening", PORT));
poll();

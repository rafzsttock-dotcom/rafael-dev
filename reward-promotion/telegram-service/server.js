"use strict";
/**
 * GramJS HTTP sidecar untuk KODO / Rewardex.
 * Kontrak HTTP SAMA seperti versi MadelineProto sebelumnya, jadi server.js
 * (app utama) tidak perlu berubah:
 *   GET  /health                      -> {ok:true}
 *   GET  /status   (X-Service-Secret) -> {ok, configured, accounts, me}
 *   POST /resolve  {identifier}       -> {ok, tg_id, username, tg_name}
 *   POST /send     {tg_id, text}      -> {ok}
 *   POST /member   {tg_id, channel}   -> {ok, member}
 *
 * Multi-akun: semua file sesi (*.session) di TELEGRAM_SESSION_DIR dimuat.
 * - /resolve "menghangatkan" peer di SEMUA akun (import kontak / getEntity)
 *   agar akun mana pun bisa kirim.
 * - /send di-rotasi (round-robin) ke semua akun untuk menyebar beban &
 *   hindari limit.
 * - /member & /status pakai akun pertama.
 */
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const crypto = require("node:crypto");
const { TelegramClient, Api } = require("telegram");
const { StringSession } = require("telegram/sessions");
require("dotenv").config();

const API_ID = parseInt(process.env.TELEGRAM_API_ID, 10);
const API_HASH = String(process.env.TELEGRAM_API_HASH || "").trim();
const SECRET = String(process.env.TELEGRAM_SERVICE_SECRET || "changeme").trim();
const HOST = process.env.TELEGRAM_SERVICE_HOST || "0.0.0.0";
const PORT = +process.env.TELEGRAM_SERVICE_PORT || 8090;
const SESS_DIR = process.env.TELEGRAM_SESSION_DIR || "/data/tg";
const MAX_BODY = 16 * 1024;

fs.mkdirSync(SESS_DIR, { recursive: true });

function log(...a) {
  console.log(new Date().toISOString(), ...a);
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ""));
  const y = Buffer.from(String(b || ""));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
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

/** Load semua sesi (*.session) yang sudah login. */
async function loadClients(dir, apiId, apiHash) {
  const clients = [];
  const me = [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".session"));
  for (const file of files) {
    const sessionStr = fs.readFileSync(path.join(dir, file), "utf8").trim();
    if (!sessionStr) continue;
    try {
      const client = new TelegramClient(new StringSession(sessionStr), apiId, apiHash, {
        connectionRetries: 5,
      });
      await client.connect();
      if (!(await client.checkAuthorization())) {
        log("[tg] lewati (belum login):", file);
        await client.disconnect();
        continue;
      }
      const self = await client.getMe();
      clients.push(client);
      me.push({
        id: self.id.toString(),
        username: self.username || "",
        first_name: self.firstName || "",
        phone: self.phone || "",
      });
      log("[tg] akun aktif: @" + (self.username || "") + " id=" + self.id.toString());
    } catch (e) {
      log("[tg] gagal muat " + file + ":", e.message);
    }
  }
  return [clients, me];
}

(async () => {
  const [CLIENTS, ME] = await loadClients(SESS_DIR, API_ID, API_HASH);
  log("[tg] total akun aktif:", CLIENTS.length);

  let rr = 0;
  function nextClient() {
    if (!CLIENTS.length) return null;
    const c = CLIENTS[rr % CLIENTS.length];
    rr++;
    return c;
  }

  const isPhone = (s) => /^\+?\d{8,15}$/.test(String(s || "").replace(/\s/g, ""));

  /** Import nomor sebagai kontak di 1 akun, balik user entity atau null. */
  async function importByPhone(client, phone) {
    try {
      const entity = await client.getEntity(phone);
      if (entity) return entity;
    } catch (e) {
      // lanjut import
    }
    const res = await client.invoke(
      new Api.contacts.ImportContacts({
        contacts: [
          new Api.InputPhoneContact({
            clientId: BigInt(0),
            phone,
            firstName: "kodo",
            lastName: "user",
          }),
        ],
      })
    );
    const users = res.users || [];
    return users[0] || null;
  }

  async function infoUser(client, peer) {
    try {
      return await client.getEntity(peer);
    } catch (e) {
      return null;
    }
  }

  async function resolveIdentifier(identifier) {
    identifier = String(identifier || "").trim();
    if (!identifier) return { error: "identifier kosong" };
    if (!CLIENTS.length) return { error: "Tidak ada akun Telegram aktif" };

    const phone = isPhone(identifier);
    let resolved = null;

    for (const client of CLIENTS) {
      try {
        let u;
        if (phone) {
          const p = identifier[0] === "+" ? identifier : "+" + identifier.replace(/\D/g, "");
          u = await importByPhone(client, p);
        } else {
          u = await infoUser(client, identifier.replace(/^@/, ""));
        }
        if (u && !resolved) resolved = u;
      } catch (e) {
        // abaikan, coba akun berikutnya
      }
    }

    if (!resolved) {
      return {
        error: phone
          ? "Nomor tidak terdaftar di Telegram, atau privasi user menolak dicari lewat nomor."
          : "Akun Telegram tidak ditemukan. Cek @username / nomor kamu.",
      };
    }

    return { user: resolved };
  }

  async function handleResolve(data) {
    const r = await resolveIdentifier(data.identifier);
    if (r.error) return [400, { ok: false, error: r.error }];
    const u = r.user;
    const uid = u.id.toString();
    const uname = u.username || "";
    const fname = u.firstName || "";
    return [
      200,
      {
        ok: true,
        tg_id: uid,
        username: uname,
        tg_name: uname || fname || uid,
      },
    ];
  }

  async function handleSend(data) {
    const tgId = String(data.tg_id || "");
    const text = String(data.text || "");
    if (!tgId || !text) return [400, { ok: false, error: "tg_id / text kosong" }];
    const client = nextClient();
    if (!client) return [503, { ok: false, error: "Tidak ada akun Telegram aktif" }];
    try {
      const entity = await client.getEntity(tgId);
      await client.sendMessage(entity, { message: text });
      return [200, { ok: true }];
    } catch (e) {
      return [500, { ok: false, error: e.message }];
    }
  }

  async function handleMember(data) {
    const tgId = String(data.tg_id || "");
    const channel = String(data.channel || "");
    if (!tgId || !channel) return [400, { ok: false, error: "tg_id / channel kosong" }];
    const client = CLIENTS[0];
    if (!client) return [503, { ok: false, error: "Tidak ada akun Telegram aktif" }];
    try {
      await client.invoke(
        new Api.channels.GetParticipant({
          channel: channel.replace(/^@/, ""),
          participant: tgId,
        })
      );
      return [200, { ok: true, member: true }];
    } catch (e) {
      if (String(e.message || "").includes("USER_NOT_PARTICIPANT")) {
        return [200, { ok: true, member: false }];
      }
      return [500, { ok: false, error: e.message }];
    }
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const p = url.pathname;

    if (p === "/health") return json(res, 200, { ok: true });

    const hdr = req.headers["x-service-secret"] || "";
    if (!SECRET || !safeEqual(SECRET, hdr)) {
      return json(res, 401, { ok: false, error: "unauthorized" });
    }

    if (p === "/status") {
      const ok = CLIENTS.length > 0;
      return json(res, 200, {
        ok,
        configured: ok,
        accounts: CLIENTS.length,
        me: ME[0] || null,
      });
    }

    let body = "";
    let tooLarge = false;
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY) tooLarge = true;
    });
    req.on("end", async () => {
      if (tooLarge) return json(res, 413, { ok: false, error: "payload too large" });
      let data = {};
      try {
        data = body ? JSON.parse(body) : {};
      } catch (e) {
        data = {};
      }

      try {
        let result;
        if (p === "/resolve") result = await handleResolve(data);
        else if (p === "/send") result = await handleSend(data);
        else if (p === "/member") result = await handleMember(data);
        else return json(res, 404, { error: "not found" });

        return json(res, result[0], result[1]);
      } catch (e) {
        return json(res, 500, { ok: false, error: e.message });
      }
    });
  });

  server.listen(PORT, HOST, () => {
    log(`[tg] listening ${HOST}:${PORT}`);
  });
})();

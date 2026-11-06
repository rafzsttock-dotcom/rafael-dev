#!/usr/bin/env python3
"""Telethon sidecar untuk KODO Rewards: kirim OTP + cek member channel."""
from __future__ import annotations

import asyncio
import json
import os
import re
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Optional
from urllib.parse import urlparse

from telethon import TelegramClient
from telethon.errors import (
    FloodWaitError,
    PeerFloodError,
    UserPrivacyRestrictedError,
    UsernameInvalidError,
    UsernameNotOccupiedError,
)
from telethon.sessions import StringSession
from telethon.tl.functions.channels import GetParticipantRequest
from telethon.tl.types import ChannelParticipant, ChannelParticipantAdmin, ChannelParticipantCreator

API_ID = int(os.environ.get("TELEGRAM_API_ID") or "0")
API_HASH = (os.environ.get("TELEGRAM_API_HASH") or "").strip()
SESSION = (os.environ.get("TELEGRAM_SESSION") or "").strip()
SECRET = (os.environ.get("TELEGRAM_SERVICE_SECRET") or "changeme").strip()
HOST = os.environ.get("TELEGRAM_SERVICE_HOST") or "0.0.0.0"
PORT = int(os.environ.get("TELEGRAM_SERVICE_PORT") or "8090")

client: Optional[TelegramClient] = None
client_me: Optional[dict] = None
loop = asyncio.new_event_loop()
asyncio.set_event_loop(loop)


def ok_secret(headers) -> bool:
    auth = headers.get("X-Service-Secret") or headers.get("x-service-secret") or ""
    return auth == SECRET and bool(SECRET)


async def ensure_client() -> TelegramClient:
    global client, client_me
    if client and client.is_connected():
        return client
    if not API_ID or not API_HASH:
        raise RuntimeError("TELEGRAM_API_ID / TELEGRAM_API_HASH belum diisi di .env")
    if not SESSION:
        raise RuntimeError(
            "TELEGRAM_SESSION kosong. Buat string session dulu (lihat README), lalu isi di .env"
        )
    client = TelegramClient(StringSession(SESSION), API_ID, API_HASH)
    await client.connect()
    if not await client.is_user_authorized():
        raise RuntimeError("Session Telethon tidak valid / belum login")
    me = await client.get_me()
    client_me = {
        "id": me.id,
        "username": me.username or "",
        "first_name": me.first_name or "",
        "phone": me.phone or "",
    }
    print("telethon connected as", client_me, flush=True)
    return client


async def resolve_entity(identifier: str):
    """Resolve @username, t.me link, atau numeric id / phone."""
    c = await ensure_client()
    raw = (identifier or "").strip()
    if not raw:
        raise ValueError("identifier kosong")
    # t.me/username
    m = re.search(r"(?:t\.me/|telegram\.me/)([A-Za-z0-9_]+)", raw)
    if m:
        raw = m.group(1)
    if raw.startswith("@"):
        raw = raw[1:]
    # numeric telegram id
    if re.fullmatch(r"-?\d{5,}", raw):
        return await c.get_entity(int(raw))
    # phone E.164-ish
    if re.fullmatch(r"\+?\d{8,15}", raw.replace(" ", "")):
        phone = raw if raw.startswith("+") else "+" + re.sub(r"\D", "", raw)
        return await c.get_entity(phone)
    return await c.get_entity(raw)


async def send_message(tg_id: int, text: str) -> dict:
    c = await ensure_client()
    try:
        await c.send_message(tg_id, text)
        return {"ok": True}
    except UserPrivacyRestrictedError:
        return {"ok": False, "error": "Privacy user memblokir pesan dari non-kontak"}
    except PeerFloodError:
        return {"ok": False, "error": "Flood limit Telegram — coba lagi nanti"}
    except FloodWaitError as e:
        return {"ok": False, "error": f"FloodWait {e.seconds}s"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def check_member(tg_id: int, channel: str) -> dict:
    c = await ensure_client()
    ch = (channel or "").strip()
    if not ch:
        return {"ok": True, "member": True}
    if ch.startswith("https://") or ch.startswith("http://"):
        m = re.search(r"t\.me/([A-Za-z0-9_]+)", ch)
        ch = m.group(1) if m else ch
    if ch.startswith("@"):
        ch = ch[1:]
    try:
        entity = await c.get_entity(ch)
        # GetParticipant hanya jalan jika akun Telethon admin/di channel
        try:
            part = await c(GetParticipantRequest(entity, tg_id))
            p = part.participant
            member = isinstance(
                p, (ChannelParticipant, ChannelParticipantAdmin, ChannelParticipantCreator)
            ) or True
            # jika request sukses, user adalah participant
            return {"ok": True, "member": True}
        except Exception:
            # fallback: iter participants (mahal) — skip, anggap bukan member
            return {"ok": True, "member": False}
    except Exception as e:
        return {"ok": False, "error": str(e), "member": False}


async def link_and_profile(identifier: str) -> dict:
    try:
        ent = await resolve_entity(identifier)
    except (UsernameNotOccupiedError, UsernameInvalidError):
        return {"ok": False, "error": "Username Telegram tidak ditemukan"}
    except Exception as e:
        return {"ok": False, "error": f"Gagal resolve: {e}"}
    tg_id = int(ent.id)
    username = getattr(ent, "username", None) or ""
    first = getattr(ent, "first_name", None) or ""
    return {
        "ok": True,
        "tg_id": str(tg_id),
        "tg_name": username or first or str(tg_id),
        "username": username,
    }


def run_coro(coro):
    return loop.run_until_complete(coro)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        sys.stderr.write("[tg] " + (fmt % args) + "\n")

    def _read_json(self) -> dict:
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0:
            return {}
        raw = self.rfile.read(n)
        try:
            return json.loads(raw.decode("utf-8"))
        except Exception:
            return {}

    def _send(self, code: int, obj: Any):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/health":
            return self._send(200, {"ok": True})
        if path == "/status":
            if not ok_secret(self.headers):
                return self._send(401, {"ok": False, "error": "unauthorized"})
            try:
                run_coro(ensure_client())
                return self._send(
                    200,
                    {
                        "ok": True,
                        "configured": True,
                        "me": client_me,
                    },
                )
            except Exception as e:
                return self._send(
                    200,
                    {"ok": False, "configured": False, "error": str(e)},
                )
        return self._send(404, {"error": "not found"})

    def do_POST(self):
        path = urlparse(self.path).path
        if not ok_secret(self.headers):
            return self._send(401, {"ok": False, "error": "unauthorized"})
        data = self._read_json()
        try:
            if path == "/resolve":
                r = run_coro(link_and_profile(str(data.get("identifier") or "")))
                return self._send(200 if r.get("ok") else 400, r)
            if path == "/send":
                tg_id = int(data.get("tg_id") or 0)
                text = str(data.get("text") or "")
                if not tg_id or not text:
                    return self._send(400, {"ok": False, "error": "tg_id dan text wajib"})
                r = run_coro(send_message(tg_id, text))
                return self._send(200 if r.get("ok") else 502, r)
            if path == "/member":
                tg_id = int(data.get("tg_id") or 0)
                channel = str(data.get("channel") or "")
                if not tg_id:
                    return self._send(400, {"ok": False, "error": "tg_id wajib"})
                r = run_coro(check_member(tg_id, channel))
                return self._send(200, r)
            return self._send(404, {"error": "not found"})
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})


def main():
    print(f"telethon service on {HOST}:{PORT}", flush=True)
    if API_ID and API_HASH and SESSION:
        try:
            run_coro(ensure_client())
        except Exception as e:
            print("warn: belum connect:", e, flush=True)
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    httpd.serve_forever()


if __name__ == "__main__":
    main()

# DetekLimitin API Documentation

## Overview
REST API untuk fitur Cek Bio, Detect OTP Status, dan manajemen API Key.

**Syarat:** Hanya user Premium atau Owner yang bisa menggunakan API.

Base URL: `https://api.wspro.id`

---

## Authentication

Semua endpoint (kecuali `/api/docs` dan `/api/generate-key`) butuh API Key:

| Cara | Format |
|------|--------|
| Header | `X-API-Key: dl_xxxxxxxxxxxxxxxx` |
| Query param | `?api_key=dl_xxx` |
| Request body | `"api_key": "dl_xxx"` |

---

## Rate Limit
**30 request per menit** per API Key. Jika melebihi, server mengembalikan `429`.

---

## Endpoints

### GET /api/docs
Dokumentasi JSON ini. Tidak butuh auth.

---

### POST /api/generate-key
Generate atau regenerate API Key. Butuh akun Premium.

**Body:**
```json
{ "telegram_id": 123456789 }
```

**Response (200):**
```json
{
  "success": true,
  "api_key": "dl_xxxxxxxxxxxxxxxx",
  "regenerated": false,
  "message": "Simpan API Key ini — hanya ditampilkan sekali."
}
```

**Error:**
- `400` — `telegram_id` kosong
- `403` — User belum Premium
- `404` — User tidak ditemukan (belum pernah /start bot)

---

### DELETE /api/revoke-key
Revoke API Key aktif. Setelah ini, key tidak bisa dipakai lagi.

**Header:** `X-API-Key: dl_xxx`

**Response (200):**
```json
{ "success": true, "message": "API Key berhasil di-revoke." }
```

---

### GET /api/me
Info akun dan sisa rate limit.

**Header:** `X-API-Key: dl_xxx`

**Response (200):**
```json
{
  "success": true,
  "userId": 123456789,
  "username": "namauser",
  "premium": true,
  "premiumUntil": "2025-01-01T00:00:00.000Z",
  "limit": 5,
  "apiKeyCreatedAt": "2024-11-08T10:00:00.000Z",
  "rateLimit": {
    "remaining": 28,
    "max": 30,
    "window": "60s"
  }
}
```

---

### GET /api/sessions
Status sesi WhatsApp yang terhubung ke akun kamu.

**Header:** `X-API-Key: dl_xxx`

**Response (200):**
```json
{
  "success": true,
  "status": "CONNECTED",
  "ready": true,
  "sessions": [
    { "sessionId": 1, "phone": "628123456789" }
  ],
  "hint": "Sesi aktif. Siap untuk Cek Bio."
}
```

> Jika `ready: false`, connect WA dulu lewat bot Telegram sebelum pakai `/api/cek-bio`.

---

### POST /api/cek-bio
Cek bio massal. **Butuh sesi WhatsApp aktif** (connect dulu lewat bot).

**Header:** `X-API-Key: dl_xxx`

**Body:**
```json
{
  "numbers": ["6281234567890", "6289876543210"],
  "mode": "simple"
}
```

| Field | Tipe | Wajib | Nilai |
|-------|------|-------|-------|
| `numbers` | array string | ✅ | Maks 50 nomor |
| `mode` | string | ❌ | `"simple"` (default) atau `"detail"` |
| `speed` | string | ❌ | `"normal"` (default) atau `"brutal"` |

**Response (200):**
```json
{
  "success": true,
  "mode": "simple",
  "summary": {
    "total": 2,
    "registered": 1,
    "unregistered": 1,
    "business": 0,
    "private": 1,
    "repe": 0,
    "cancelled": false,
    "interrupted": false
  },
  "results": {
    "business": [],
    "private": [
      {
        "number": "6281234567890",
        "registered": true,
        "type": "private",
        "name": null,
        "bio": "Halo!",
        "hasBio": true,
        "profilePic": true,
        "isVerified": false
      }
    ],
    "repe": [],
    "unregistered": [
      { "number": "6289876543210", "registered": false }
    ]
  }
}
```

**Error:**
- `400` — Array kosong / nomor tidak valid / melebihi 50
- `503` — Sesi WA belum aktif
- `504` — Timeout (kurangi jumlah nomor)

---

### POST /api/detect
Cek status cooldown OTP nomor WhatsApp. Tidak butuh sesi WA.

**Header:** `X-API-Key: dl_xxx`

**Body:**
```json
{ "number": "6281234567890" }
```

**Response (200):**
```json
{
  "success": true,
  "number": "6281234567890",
  "status": "ready",
  "formatted": "6281234567890 — SMS: READY | WA OLD: COOLDOWN 2m 30s",
  "sms": {
    "status": "ready",
    "waitSec": 0,
    "cooldownFmt": "READY"
  },
  "wa_old": {
    "available": true,
    "status": "cooldown",
    "waitSec": 150,
    "cooldownFmt": "COOLDOWN 2m 30s"
  },
  "isWaOldAvailable": true
}
```

Nilai `status`: `ready` | `cooldown` | `banned` | `invalid`

---

## Cara Dapat API Key

1. Beli Premium lewat bot Telegram (`/start` → Beli Premium)
2. Panggil `POST /api/generate-key` dengan `telegram_id` kamu
3. Simpan API Key yang diberikan — **tidak bisa dilihat lagi**
4. Kalau lupa / mau ganti, panggil endpoint yang sama lagi (key lama langsung tidak berlaku)

---

## Error Codes

| Kode | Arti |
|------|------|
| `400` | Bad request — input salah |
| `401` | API Key tidak ada / tidak valid |
| `403` | Belum Premium atau Premium kadaluarsa |
| `404` | User tidak ditemukan |
| `429` | Rate limit (30 req/menit) |
| `500` | Server error |
| `503` | Layanan tidak tersedia (sesi WA belum aktif) |
| `504` | Gateway timeout |

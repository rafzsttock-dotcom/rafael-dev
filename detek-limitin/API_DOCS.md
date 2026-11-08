# DetekLimitin API Documentation

## Overview
REST API untuk fitur Cek Bio, Detect OTP, dan lainnya.
**API Key hanya bisa didapat setelah beli Premium.**

Base URL: `http://your-server:5055/api`

## Authentication
Semua endpoint (kecuali docs & generate-key) butuh API Key:

```
Header: X-API-Key: dl_xxxxxxxxxxxxxxxx
```
atau query: `?api_key=dl_xxx`
atau body: `"api_key": "dl_xxx"`

## Endpoints

### 1. Dokumentasi
```
GET /api/docs
```
Tidak butuh auth.

### 2. Generate API Key
```
POST /api/generate-key
Content-Type: application/json

{
  "telegram_id": 31303135
}
```
**Syarat:** User harus sudah Premium (atau Owner).

Response:
```json
{
  "success": true,
  "api_key": "dl_xxxxxxxx...",
  "message": "Simpan API Key ini. Hanya ditampilkan sekali."
}
```

### 3. Info User
```
GET /api/me
X-API-Key: dl_xxx
```

### 4. Cek Bio
```
POST /api/cek-bio
X-API-Key: dl_xxx
Content-Type: application/json

{
  "numbers": ["6281234567890", "6289876543210"],
  "mode": "simple"
}
```
Max 50 nomor per request. Butuh session WA aktif.

### 5. Detect / OTP
```
POST /api/detect
X-API-Key: dl_xxx
Content-Type: application/json

{
  "number": "6281234567890",
  "method": "sms"
}
```
Method: `sms`, `voice`, `wa`

## Rate Limit
30 request per menit per API Key.

## Cara Dapat API Key
1. Beli Premium lewat bot Telegram (`/start` → Beli Premium)
2. Setelah premium aktif, call endpoint `/api/generate-key` dengan `telegram_id` kamu
3. Simpan API Key yang dikasih

## Error Codes
- `401` - API Key missing / invalid
- `403` - Belum Premium
- `429` - Rate limit
- `400` - Bad request
- `500` - Server error

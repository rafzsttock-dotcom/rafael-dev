import crypto from 'node:crypto'

/**
 * Verifikasi initData dari Telegram Mini App (HMAC pakai bot token).
 * Balikin objek user kalau tanda tangan valid dan belum kedaluwarsa, selain itu null.
 */
export function verifyInitData(initData, botToken, maxAgeSec = 24 * 3600, nowSec = Date.now() / 1000) {
  if (!initData || !botToken) return null
  const params = new URLSearchParams(initData)
  const hash = params.get('hash')
  if (!hash || !/^[a-f0-9]{64}$/.test(hash)) return null
  params.delete('hash')

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest()
  const expected = crypto.createHmac('sha256', secret).update(dataCheckString).digest()
  if (!crypto.timingSafeEqual(expected, Buffer.from(hash, 'hex'))) return null

  const authDate = Number(params.get('auth_date'))
  if (!authDate || nowSec - authDate > maxAgeSec) return null

  try {
    const user = JSON.parse(params.get('user') || 'null')
    return user && user.id ? user : null
  } catch {
    return null
  }
}

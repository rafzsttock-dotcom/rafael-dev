import crypto from 'node:crypto'
import { verifyInitData } from '../src/panel/auth.js'

const TOKEN = '123456:TEST-TOKEN'
const NOW = 1_800_000_000

function sign(fields, token = TOKEN) {
  const params = new URLSearchParams(fields)
  const dcs = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n')
  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest()
  params.set('hash', crypto.createHmac('sha256', secret).update(dcs).digest('hex'))
  return params.toString()
}

const user = JSON.stringify({ id: 31303135, first_name: 'Rafael' })

test('accepts correctly signed, fresh initData', () => {
  const data = sign({ auth_date: String(NOW - 60), user, query_id: 'AAA' })
  expect(verifyInitData(data, TOKEN, 86400, NOW)).toMatchObject({ id: 31303135 })
})

test('rejects initData signed with another bot token', () => {
  const data = sign({ auth_date: String(NOW - 60), user }, '999:OTHER')
  expect(verifyInitData(data, TOKEN, 86400, NOW)).toBeNull()
})

test('rejects tampered user field', () => {
  const data = sign({ auth_date: String(NOW - 60), user }).replace('31303135', '11111111')
  expect(verifyInitData(data, TOKEN, 86400, NOW)).toBeNull()
})

test('rejects expired initData', () => {
  const data = sign({ auth_date: String(NOW - 2 * 86400), user })
  expect(verifyInitData(data, TOKEN, 86400, NOW)).toBeNull()
})

test('rejects missing or malformed hash', () => {
  expect(verifyInitData('', TOKEN)).toBeNull()
  expect(verifyInitData(`auth_date=${NOW}&user=${encodeURIComponent(user)}&hash=zz`, TOKEN, 86400, NOW)).toBeNull()
})

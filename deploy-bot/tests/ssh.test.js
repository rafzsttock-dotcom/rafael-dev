import { jest } from '@jest/globals'

const mockSSH = {
  connect: jest.fn().mockResolvedValue(undefined),
  execCommand: jest.fn().mockResolvedValue({ stdout: 'ok', stderr: '', code: 0 }),
  dispose: jest.fn()
}
jest.unstable_mockModule('node-ssh', () => ({ NodeSSH: jest.fn(() => mockSSH) }))

const { connectSSH, runCommand, testConnection, disconnectSSH } = await import('../src/services/ssh.js')

const vpsConfig = { host: '1.2.3.4', port: 22, user: 'root', authType: 'password', password: 'pass' }

test('connectSSH calls ssh.connect with correct params', async () => {
  await connectSSH(vpsConfig)
  expect(mockSSH.connect).toHaveBeenCalledWith({ host: '1.2.3.4', port: 22, username: 'root', password: 'pass' })
})

test('runCommand returns stdout and code', async () => {
  const result = await runCommand(mockSSH, 'ls', '/var/www')
  expect(result).toMatchObject({ stdout: 'ok', code: 0 })
})

test('testConnection returns ok:true on success', async () => {
  const result = await testConnection(vpsConfig)
  expect(result.ok).toBe(true)
})

test('testConnection returns ok:false on SSH error', async () => {
  mockSSH.connect.mockRejectedValueOnce(new Error('auth failed'))
  const result = await testConnection(vpsConfig)
  expect(result.ok).toBe(false)
  expect(result.error).toMatch(/auth failed/)
})

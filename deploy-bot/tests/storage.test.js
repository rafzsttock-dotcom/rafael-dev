import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const tmpDir = mkdtempSync(join(tmpdir(), 'deploy-bot-'))
process.env.CONFIG_PATH = join(tmpDir, 'config.json')
writeFileSync(process.env.CONFIG_PATH, JSON.stringify({ vps: [] }))

const { addVPS, listVPS, getVPS, removeVPS, addProject, removeProject } = await import('../src/services/storage.js')

test('addVPS returns vps with id', () => {
  const vps = addVPS({ name: 'VPS1', host: '1.2.3.4', port: 22, user: 'root', authType: 'password', password: 'pass' })
  expect(vps.id).toBeDefined()
  expect(vps.name).toBe('VPS1')
  expect(vps.projects).toEqual([])
})

test('listVPS returns added vps', () => {
  expect(listVPS().length).toBeGreaterThan(0)
})

test('getVPS returns vps by id', () => {
  const vps = listVPS()[0]
  expect(getVPS(vps.id)).toMatchObject({ name: 'VPS1' })
})

test('addProject adds project to vps', () => {
  const vps = listVPS()[0]
  const proj = addProject(vps.id, { name: 'Portfolio', type: 'website', path: '/var/www', deployScript: 'git pull' })
  expect(proj.id).toBeDefined()
  expect(getVPS(vps.id).projects).toHaveLength(1)
})

test('removeProject removes project', () => {
  const vps = listVPS()[0]
  const proj = getVPS(vps.id).projects[0]
  removeProject(vps.id, proj.id)
  expect(getVPS(vps.id).projects).toHaveLength(0)
})

test('removeVPS removes vps', () => {
  const vps = listVPS()[0]
  removeVPS(vps.id)
  expect(listVPS()).toHaveLength(0)
})

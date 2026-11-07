import express from 'express'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { verifyInitData } from './auth.js'
import { listVPS, getVPS, addVPS, removeVPS, addProject, removeProject, updateProject } from '../services/storage.js'
import { connectSSH, runCommand, streamCommand, testConnection, disconnectSSH } from '../services/ssh.js'

const PANEL_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../panel')
const PM2_NAME = /^[\w.@-]{1,64}$/
const PM2_ACTIONS = new Set(['restart', 'reload', 'stop', 'start'])

// Satu SSH, satu kali jalan: daftar proses pm2 + beban CPU, RAM, disk, uptime host.
const STATUS_CMD = [
  'echo __PM2__',
  '(pm2 jlist 2>/dev/null || echo NOPM2)',
  'echo',
  'echo __SYS__',
  'cat /proc/loadavg',
  'nproc',
  "free -b | awk '/^Mem:/{print $2\" \"$7}'",
  "df -B1 / | awk 'NR==2{print $2\" \"$3}'",
  'cat /proc/uptime'
].join('; ')

const publicVps = (v) => ({
  id: v.id, name: v.name, host: v.host, port: v.port, user: v.user, authType: v.authType,
  projects: (v.projects || []).map(p => ({
    id: p.id, name: p.name, path: p.path, deployScript: p.deployScript, lastDeploy: p.lastDeploy || null
  }))
})

export function parseStatus(out, now = Date.now()) {
  const [pm2Part = '', sysPart = ''] = String(out).split('__SYS__')
  const pm2Raw = pm2Part.replace('__PM2__', '').trim()
  let processes = null
  if (!pm2Raw.includes('NOPM2')) {
    const start = pm2Raw.indexOf('[')
    const end = pm2Raw.lastIndexOf(']')
    if (start >= 0 && end > start) {
      try {
        processes = JSON.parse(pm2Raw.slice(start, end + 1)).map(p => ({
          name: p.name,
          id: p.pm_id,
          status: p.pm2_env?.status || 'unknown',
          cpu: p.monit?.cpu ?? 0,
          mem: p.monit?.memory ?? 0,
          uptime: p.pm2_env?.status === 'online' && p.pm2_env?.pm_uptime ? now - p.pm2_env.pm_uptime : 0,
          restarts: p.pm2_env?.restart_time ?? 0
        }))
      } catch { processes = null }
    }
  }
  const lines = sysPart.trim().split('\n').map(l => l.trim())
  const num = (s) => (Number.isFinite(Number(s)) ? Number(s) : null)
  const [memTotal, memAvail] = (lines[2] || '').split(' ').map(num)
  const [diskTotal, diskUsed] = (lines[3] || '').split(' ').map(num)
  return {
    processes,
    system: {
      load1: num((lines[0] || '').split(' ')[0]),
      cores: num(lines[1]),
      memTotal, memUsed: memTotal != null && memAvail != null ? memTotal - memAvail : null,
      diskTotal, diskUsed,
      uptime: num((lines[4] || '').split(' ')[0])
    }
  }
}

function validateVps(b) {
  const vps = {
    name: String(b.name || '').trim(),
    host: String(b.host || '').trim(),
    port: Number(b.port || 22),
    user: String(b.user || '').trim(),
    authType: b.authType === 'key' ? 'key' : 'password'
  }
  if (!vps.name || vps.name.length > 40) return { error: 'Nama VPS wajib, maksimal 40 karakter' }
  if (!/^[A-Za-z0-9.:-]{1,253}$/.test(vps.host)) return { error: 'Host / IP tidak valid' }
  if (!Number.isInteger(vps.port) || vps.port < 1 || vps.port > 65535) return { error: 'Port harus 1–65535' }
  if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,31}$/.test(vps.user)) return { error: 'Username SSH tidak valid' }
  if (vps.authType === 'password') {
    vps.password = String(b.password || '')
    if (!vps.password) return { error: 'Password SSH wajib diisi' }
  } else {
    vps.keyPath = String(b.keyPath || '').trim()
    if (!vps.keyPath.startsWith('/')) return { error: 'Path private key harus absolut (mulai dengan /)' }
  }
  return { vps }
}

function validateProject(b) {
  const p = {
    name: String(b.name || '').trim(),
    path: String(b.path || '').trim(),
    deployScript: String(b.deployScript || '').trim()
  }
  if (!p.name || p.name.length > 40) return { error: 'Nama project wajib, maksimal 40 karakter' }
  if (!p.path.startsWith('/') || p.path.length > 300) return { error: 'Folder project harus path absolut (mulai dengan /)' }
  if (!p.deployScript || p.deployScript.length > 4000) return { error: 'Script deploy wajib, maksimal 4000 karakter' }
  return { project: p }
}

async function withSSH(vps, fn) {
  let ssh
  try {
    ssh = await connectSSH(vps)
    return await fn(ssh)
  } finally {
    if (ssh) disconnectSSH(ssh)
  }
}

/** Kirim output command ke browser baris per baris (NDJSON) selagi command jalan. */
async function streamExec(req, res, vps, cmd, cwd) {
  res.set({ 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' })
  res.flushHeaders()
  const send = (t, d) => { if (!res.writableEnded) res.write(JSON.stringify({ t, d }) + '\n') }
  const started = Date.now()
  let result
  try {
    send('info', `Menghubungkan ke ${vps.user}@${vps.host}:${vps.port}…`)
    result = await withSSH(vps, async (ssh) => {
      send('info', cwd ? `Terhubung. Menjalankan di ${cwd}` : 'Terhubung. Menjalankan…')
      return streamCommand(ssh, cmd, cwd, send)
    })
  } catch (err) {
    result = { code: -1, error: err.message }
  }
  const done = { code: result.code ?? -1, ms: Date.now() - started, error: result.error || null }
  send('done', done)
  res.end()
  return done
}

export function createPanelApp({ botToken, ownerId }) {
  const app = express()
  app.set('trust proxy', 1)
  app.disable('x-powered-by')
  app.use(express.json({ limit: '32kb' }))

  const api = express.Router()
  api.use((req, res, next) => {
    const user = verifyInitData(req.get('x-init-data'), botToken)
    if (!user) return res.status(401).json({ error: 'Sesi Telegram tidak valid. Buka panel lewat bot.' })
    if (String(user.id) !== String(ownerId)) return res.status(403).json({ error: 'Panel ini khusus pemilik bot.' })
    req.tgUser = user
    next()
  })

  const findVps = (req, res) => {
    const vps = getVPS(req.params.id)
    if (!vps) res.status(404).json({ error: 'VPS tidak ditemukan' })
    return vps
  }

  api.get('/me', (req, res) => res.json({ user: { id: req.tgUser.id, first_name: req.tgUser.first_name || '' } }))

  api.get('/vps', (req, res) => res.json({ vps: listVPS().map(publicVps) }))

  api.post('/vps/test', async (req, res) => {
    const { vps, error } = validateVps(req.body)
    if (error) return res.status(400).json({ error })
    res.json(await testConnection(vps))
  })

  api.post('/vps', async (req, res) => {
    const { vps, error } = validateVps(req.body)
    if (error) return res.status(400).json({ error })
    const test = await testConnection(vps)
    if (!test.ok) return res.status(400).json({ error: `Gagal konek SSH: ${test.error}` })
    res.json({ vps: publicVps(addVPS(vps)) })
  })

  api.delete('/vps/:id', (req, res) => {
    if (!findVps(req, res)) return
    removeVPS(req.params.id)
    res.json({ ok: true })
  })

  api.get('/vps/:id/status', async (req, res) => {
    const vps = findVps(req, res); if (!vps) return
    const started = Date.now()
    try {
      const out = await withSSH(vps, (ssh) => runCommand(ssh, STATUS_CMD, undefined))
      res.json({ online: true, latency: Date.now() - started, ...parseStatus(out.stdout) })
    } catch (err) {
      res.json({ online: false, error: err.message })
    }
  })

  api.post('/vps/:id/pm2/:name/:action', async (req, res) => {
    const vps = findVps(req, res); if (!vps) return
    const { name, action } = req.params
    if (!PM2_NAME.test(name) || !PM2_ACTIONS.has(action)) return res.status(400).json({ error: 'Aksi tidak valid' })
    try {
      const r = await withSSH(vps, (ssh) => runCommand(ssh, `pm2 ${action} ${name}`, undefined))
      if (r.code !== 0) return res.status(400).json({ error: (r.stderr || r.stdout || 'pm2 gagal').slice(-500) })
      res.json({ ok: true })
    } catch (err) {
      res.status(502).json({ error: err.message })
    }
  })

  api.get('/vps/:id/pm2/:name/logs', async (req, res) => {
    const vps = findVps(req, res); if (!vps) return
    if (!PM2_NAME.test(req.params.name)) return res.status(400).json({ error: 'Nama proses tidak valid' })
    try {
      const r = await withSSH(vps, (ssh) =>
        runCommand(ssh, `pm2 logs ${req.params.name} --lines 150 --nostream --raw 2>&1 | tail -n 300`, undefined))
      res.json({ log: r.stdout || r.stderr || '' })
    } catch (err) {
      res.status(502).json({ error: err.message })
    }
  })

  api.post('/vps/:id/projects', (req, res) => {
    const vps = findVps(req, res); if (!vps) return
    const { project, error } = validateProject(req.body)
    if (error) return res.status(400).json({ error })
    res.json({ project: addProject(vps.id, project) })
  })

  api.delete('/vps/:id/projects/:pid', (req, res) => {
    const vps = findVps(req, res); if (!vps) return
    removeProject(vps.id, req.params.pid)
    res.json({ ok: true })
  })

  const running = new Set()
  api.post('/vps/:id/projects/:pid/deploy', async (req, res) => {
    const vps = findVps(req, res); if (!vps) return
    const project = vps.projects.find(p => p.id === req.params.pid)
    if (!project) return res.status(404).json({ error: 'Project tidak ditemukan' })
    const key = `${vps.id}:${project.id}`
    if (running.has(key)) return res.status(409).json({ error: 'Deploy project ini masih berjalan' })
    running.add(key)
    try {
      // Deploy tetap jalan sampai selesai walau panel ditutup di tengah jalan.
      const done = await streamExec(req, res, vps, project.deployScript, project.path)
      updateProject(vps.id, project.id, { lastDeploy: { at: Date.now(), code: done.code, ms: done.ms } })
    } finally {
      running.delete(key)
    }
  })

  api.post('/vps/:id/exec', async (req, res) => {
    const vps = findVps(req, res); if (!vps) return
    const cmd = String(req.body.cmd || '').trim()
    if (!cmd || cmd.length > 2000) return res.status(400).json({ error: 'Command kosong atau terlalu panjang' })
    const cwd = typeof req.body.cwd === 'string' && req.body.cwd.startsWith('/') ? req.body.cwd : undefined
    await streamExec(req, res, vps, cmd, cwd)
  })

  app.use('/api', api)
  app.use('/api', (req, res) => res.status(404).json({ error: 'Tidak ditemukan' }))
  app.use(express.static(PANEL_DIR, { setHeaders: (res) => res.set('Cache-Control', 'no-cache') }))
  app.use((err, req, res, _next) => {
    console.error('[panel]', err)
    if (!res.headersSent) res.status(500).json({ error: 'Terjadi kesalahan di server panel' })
  })
  return app
}

export function startPanel({ botToken, ownerId, host, port }) {
  const app = createPanelApp({ botToken, ownerId })
  const server = app.listen(port, host, () => console.log(`🖥  Deploy Panel listening on http://${host}:${port}`))
  server.on('error', (err) => console.error(`❌ Panel gagal listen di ${host}:${port}: ${err.message}`))
  return server
}

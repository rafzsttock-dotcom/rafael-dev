import express from 'express'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { createWriteStream, mkdirSync, rmSync } from 'node:fs'
import { verifyInitData } from './auth.js'
import { listVPS, getVPS, addVPS, removeVPS, addProject, removeProject, updateProject } from '../services/storage.js'
import { connectSSH, runCommand, streamCommand, testConnection, disconnectSSH } from '../services/ssh.js'

const PANEL_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../panel')
const PM2_NAME = /^[\w.@-]{1,64}$/
const PM2_ACTIONS = new Set(['restart', 'reload', 'stop', 'start'])
const MAX_UPLOAD = 100 * 1024 * 1024
const UPLOAD_TTL = 30 * 60 * 1000

const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`

// Ekstrak ZIP di server tujuan pakai python3 (ada di Ubuntu bawaan, nggak perlu unzip).
// Satu folder induk otomatis dibuka; .env dan data/ yang sudah ada tidak ditimpa;
// node_modules/.git dilewati; path yang keluar dari folder tujuan (zip-slip) ditolak.
const EXTRACT_PY = `
import zipfile, sys, os, shutil
zp, dest = sys.argv[1], sys.argv[2]
z = zipfile.ZipFile(zp)
infos = [i for i in z.infolist() if not i.filename.startswith('__MACOSX/')]
names = [i.filename for i in infos if i.filename.strip('/')]
tops = {n.split('/', 1)[0] for n in names}
prefix = next(iter(tops)) + '/' if len(tops) == 1 and all('/' in n for n in names) else ''
os.makedirs(dest, exist_ok=True)
root = os.path.realpath(dest)
kept, count = set(), 0
for i in infos:
    rel = i.filename[len(prefix):] if prefix else i.filename
    if not rel or rel.endswith('/'):
        continue
    parts = rel.split('/')
    if any(p in ('node_modules', '.git') for p in parts):
        continue
    if parts[0] in ('.env', 'data') and os.path.exists(os.path.join(dest, parts[0])):
        kept.add(parts[0]); continue
    target = os.path.realpath(os.path.join(dest, rel))
    if not target.startswith(root + os.sep):
        continue
    os.makedirs(os.path.dirname(target), exist_ok=True)
    with z.open(i) as src, open(target, 'wb') as out:
        shutil.copyfileobj(src, out)
    mode = (i.external_attr >> 16) & 0o777
    if mode:
        os.chmod(target, mode)
    count += 1
msg = f"{count} file diekstrak ke {dest}"
if prefix:
    msg += f" (folder {prefix.rstrip('/')} dibuka)"
if kept:
    msg += ". Dipertahankan: " + ", ".join(sorted(kept))
print(msg)
`
export const extractCmd = (zipPath, dest) =>
  `python3 - ${shq(zipPath)} ${shq(dest)} <<'PANEL_PY'\n${EXTRACT_PY}\nPANEL_PY\nstatus=$?; rm -f ${shq(zipPath)}; exit $status`

// Jalankan script di folder project; kalau folder tidak ada, berhenti (jangan jalan di home).
const inFolder = (path, script) => `cd ${shq(path)} || exit 1\n${script}`

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
async function streamSession(res, vps, run) {
  res.set({ 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' })
  res.flushHeaders()
  const send = (t, d) => { if (!res.writableEnded) res.write(JSON.stringify({ t, d }) + '\n') }
  const started = Date.now()
  let result
  try {
    send('info', `Menghubungkan ke ${vps.user}@${vps.host}:${vps.port}…`)
    result = await withSSH(vps, async (ssh) => {
      send('info', 'Terhubung.')
      return run(ssh, send)
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

  mkdirSync(join(tmpdir(), 'deploy-panel-uploads'), { recursive: true })
  const uploads = new Map()
  const dropUpload = (id) => {
    const u = uploads.get(id)
    if (u) { uploads.delete(id); rmSync(u.path, { force: true }) }
  }
  setInterval(() => {
    for (const [id, u] of uploads) if (Date.now() - u.at > UPLOAD_TTL) dropUpload(id)
  }, 10 * 60 * 1000).unref()

  // Terima file ZIP mentah (body = isi file), simpan sementara di server bot.
  api.post('/vps/:id/projects/:pid/upload', (req, res) => {
    const vps = findVps(req, res); if (!vps) return
    const project = vps.projects.find(p => p.id === req.params.pid)
    if (!project) return res.status(404).json({ error: 'Project tidak ditemukan' })
    if (Number(req.get('content-length') || 0) > MAX_UPLOAD) return res.status(413).json({ error: 'File terlalu besar (maks 100 MB)' })

    const id = randomUUID()
    const path = join(tmpdir(), 'deploy-panel-uploads', `${id}.zip`)
    const out = createWriteStream(path)
    let size = 0
    let head = null
    let failed = false
    const fail = (status, error) => {
      if (failed) return
      failed = true
      req.unpipe(out); out.destroy(); rmSync(path, { force: true })
      if (!res.headersSent) res.status(status).json({ error })
    }
    req.on('data', (chunk) => {
      if (!head) head = chunk.subarray(0, 4)
      size += chunk.length
      if (size > MAX_UPLOAD) { fail(413, 'File terlalu besar (maks 100 MB)'); req.destroy() }
    })
    req.on('aborted', () => fail(400, 'Upload terputus'))
    out.on('error', () => fail(500, 'Gagal menyimpan file upload'))
    out.on('finish', () => {
      if (failed) return
      if (!head || head.toString('hex') !== '504b0304') return fail(400, 'File bukan ZIP yang valid')
      uploads.set(id, { path, size, vpsId: vps.id, pid: project.id, at: Date.now() })
      res.json({ uploadId: id, size })
    })
    req.pipe(out)
  })

  const running = new Set()
  api.post('/vps/:id/projects/:pid/deploy', async (req, res) => {
    const vps = findVps(req, res); if (!vps) return
    const project = vps.projects.find(p => p.id === req.params.pid)
    if (!project) return res.status(404).json({ error: 'Project tidak ditemukan' })
    const uploadId = req.body?.uploadId
    const upload = uploadId ? uploads.get(uploadId) : null
    if (uploadId && (!upload || upload.vpsId !== vps.id || upload.pid !== project.id)) {
      return res.status(400).json({ error: 'File upload tidak ditemukan atau kedaluwarsa. Upload ulang.' })
    }
    const key = `${vps.id}:${project.id}`
    if (running.has(key)) return res.status(409).json({ error: 'Deploy project ini masih berjalan' })
    running.add(key)
    try {
      // Deploy tetap jalan sampai selesai walau panel ditutup di tengah jalan.
      const done = await streamSession(res, vps, async (ssh, send) => {
        if (upload) {
          const remote = `/tmp/deploy-panel-${uploadId}.zip`
          send('info', `Mengirim file ZIP (${(upload.size / 1048576).toFixed(1)} MB) ke server…`)
          await ssh.putFile(upload.path, remote)
          send('info', `Mengekstrak ke ${project.path}…`)
          const ex = await streamCommand(ssh, extractCmd(remote, project.path), undefined, send)
          if (ex.code !== 0) return { code: ex.code, error: 'Gagal mengekstrak ZIP' }
        }
        send('info', `Menjalankan script deploy di ${project.path}`)
        return streamCommand(ssh, inFolder(project.path, project.deployScript), undefined, send)
      })
      updateProject(vps.id, project.id, { lastDeploy: { at: Date.now(), code: done.code, ms: done.ms } })
    } finally {
      running.delete(key)
      if (uploadId) dropUpload(uploadId)
    }
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

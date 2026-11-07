(() => {
  'use strict'
  const tg = window.Telegram?.WebApp
  const INIT = tg?.initData || ''
  const $ = (sel, root = document) => root.querySelector(sel)
  const view = $('#view')

  /* ---------- util ---------- */
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const fmtBytes = (n) => {
    if (n == null) return '—'
    const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++ }
    return `${n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1)} ${u[i]}`
  }
  const fmtUptime = (ms) => {
    if (!ms || ms < 0) return '—'
    const m = Math.floor(ms / 60000)
    if (m < 1) return '<1m'
    if (m < 60) return `${m}m`
    const h = Math.floor(m / 60)
    return h < 24 ? `${h}j ${m % 60}m` : `${Math.floor(h / 24)}h ${h % 24}j`
  }
  const fmtSec = (ms) => `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} dtk`
  const ago = (ts) => {
    const m = Math.floor((Date.now() - ts) / 60000)
    if (m < 1) return 'barusan'
    if (m < 60) return `${m} menit lalu`
    const h = Math.floor(m / 60)
    return h < 24 ? `${h} jam lalu` : `${Math.floor(h / 24)} hari lalu`
  }
  const percent = (part, whole) => (part != null && whole ? Math.min(100, Math.max(0, (part / whole) * 100)) : null)
  const severity = (p) => (p == null ? '' : p >= 90 ? 'bad' : p >= 70 ? 'warn' : '')
  const procTone = (s) => (s === 'online' ? 'good' : s === 'launching' ? 'warn' : s === 'stopped' || s === 'stopping' ? '' : 'bad')
  const procLabel = (s) => ({ online: 'online', stopped: 'berhenti', stopping: 'berhenti…', errored: 'error', launching: 'mulai…' }[s] || s)

  let toastTimer
  function toast(msg) {
    const el = $('#toast'); el.textContent = msg; el.classList.add('on')
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('on'), 2600)
  }
  function setHeader(title, sub = '') { $('#title').textContent = title; $('#subtitle').textContent = sub; document.title = title }

  /* ---------- telegram ---------- */
  const haptic = {
    tap: () => tg?.HapticFeedback?.impactOccurred('light'),
    pick: () => tg?.HapticFeedback?.selectionChanged(),
    ok: () => tg?.HapticFeedback?.notificationOccurred('success'),
    fail: () => tg?.HapticFeedback?.notificationOccurred('error')
  }
  let mainCb = null
  function mainButton(text, cb) {
    if (!tg) return
    if (mainCb) tg.MainButton.offClick(mainCb)
    mainCb = cb
    tg.MainButton.setParams({ text, is_visible: true, is_active: true })
    tg.MainButton.onClick(cb)
  }
  function mainBusy(on) {
    if (!tg) return
    if (on) { tg.MainButton.showProgress(false); tg.MainButton.disable() } else { tg.MainButton.hideProgress(); tg.MainButton.enable() }
  }
  function hideMainButton() {
    if (!tg) return
    if (mainCb) tg.MainButton.offClick(mainCb)
    mainCb = null; tg.MainButton.hideProgress(); tg.MainButton.hide()
  }
  const confirmAsk = (msg) => new Promise((resolve) => (tg?.showConfirm ? tg.showConfirm(msg, (ok) => resolve(!!ok)) : resolve(window.confirm(msg))))

  /* ---------- api ---------- */
  async function api(path, { method = 'GET', body } = {}) {
    const r = await fetch('/api' + path, { method, headers: { 'content-type': 'application/json', 'x-init-data': INIT }, body: body ? JSON.stringify(body) : undefined })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.error || `Gagal (${r.status})`)
    return j
  }
  async function apiStream(path, onEvent) {
    const r = await fetch('/api' + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-init-data': INIT }, body: '{}' })
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `Gagal (${r.status})`) }
    const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let nl
      while ((nl = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, nl); buf = buf.slice(nl + 1); if (line) onEvent(JSON.parse(line)) }
    }
    if (buf.trim()) onEvent(JSON.parse(buf))
  }

  /* ---------- log box ---------- */
  const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g
  function logBox(host, label, placeholder) {
    host.innerHTML = `<div class="term"><div class="head"><span class="led"></span><span>${esc(label)}</span><span class="clock"></span></div><pre><span class="dim">${esc(placeholder)}</span></pre></div>`
    const pre = $('pre', host); const led = $('.led', host); const clock = $('.clock', host)
    let follow = true; let started = 0; let tick = null; let blank = true
    pre.addEventListener('scroll', () => { follow = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 40 })
    const write = (text, cls) => {
      if (blank) { pre.textContent = ''; blank = false }
      const span = document.createElement('span')
      if (cls) span.className = cls
      span.textContent = String(text).replace(ANSI, '').replace(/\r\n?/g, '\n')
      pre.appendChild(span)
      while (pre.childNodes.length > 5000) pre.removeChild(pre.firstChild)
      if (follow) pre.scrollTop = pre.scrollHeight
    }
    return {
      write,
      line: (t, cls) => write(t + '\n', cls),
      reset: () => { pre.textContent = ''; blank = false },
      fill: (t) => { pre.textContent = ''; blank = false; write(t || '(kosong)', t ? '' : 'dim'); pre.scrollTop = pre.scrollHeight },
      running: (on) => {
        led.classList.toggle('on', on); clearInterval(tick)
        if (on) { started = Date.now(); tick = setInterval(() => { clock.textContent = fmtSec(Date.now() - started) }, 100) }
      }
    }
  }

  /* ---------- action sheet ---------- */
  function sheet(caption, options) {
    return new Promise((resolve) => {
      const shade = $('#shade'); const drawer = $('#drawer')
      $('#drawerInner').innerHTML = `<div class="grp">${caption ? `<div class="cap">${caption}</div>` : ''}${options.map((o, i) => `<button class="opt${o.danger ? ' bad' : ''}" data-i="${i}">${esc(o.text)}</button>`).join('')}</div><div class="grp"><button class="opt close" data-i="-1">Batal</button></div>`
      shade.hidden = false
      requestAnimationFrame(() => { shade.classList.add('on'); drawer.classList.add('on') })
      const close = (i) => {
        shade.classList.remove('on'); drawer.classList.remove('on')
        setTimeout(() => { shade.hidden = true }, 220)
        drawer.onclick = null; shade.onclick = null
        resolve(i >= 0 ? options[i].value : null)
      }
      drawer.onclick = (e) => { const b = e.target.closest('[data-i]'); if (b) { haptic.pick(); close(Number(b.dataset.i)) } }
      shade.onclick = () => close(-1)
    })
  }

  /* ---------- shared pieces ---------- */
  const gauge = (k, value, sub, p) => `<div class="gauge"><div class="k">${k}</div><div class="v">${value}${sub ? ` <small>${sub}</small>` : ''}</div><div class="meter"><i class="${severity(p)}" style="width:${p == null ? 0 : p.toFixed(0)}%"></i></div></div>`
  function gaugesHtml(sys) {
    const cpu = sys.load1 != null && sys.cores ? percent(sys.load1, sys.cores) : null
    const ram = percent(sys.memUsed, sys.memTotal)
    const disk = percent(sys.diskUsed, sys.diskTotal)
    return `<div class="gauges">
      ${gauge('CPU', cpu == null ? '—' : cpu.toFixed(0) + '%', sys.cores ? `${sys.cores} core` : '', cpu)}
      ${gauge('RAM', ram == null ? '—' : ram.toFixed(0) + '%', fmtBytes(sys.memTotal), ram)}
      ${gauge('Disk', disk == null ? '—' : disk.toFixed(0) + '%', fmtBytes(sys.diskTotal), disk)}
    </div>`
  }
  const blankState = (icon, title, text, button) => `<div class="blank"><div class="ico"><svg><use href="#ic-${icon}"/></svg></div><h3>${esc(title)}</h3><p>${esc(text)}</p>${button || ''}</div>`
  const skeleton = (n, h = 58) => `<div class="list">${Array.from({ length: n }, () => `<div class="item"><div class="ghost" style="width:100%;height:${h - 26}px"></div></div>`).join('')}</div>`

  /* ---------- screens ---------- */
  const cache = { vps: null, status: {} }
  async function loadVps(force) {
    if (!cache.vps || force) cache.vps = (await api('/vps')).vps
    return cache.vps
  }
  async function loadStatus(id, force) {
    if (!cache.status[id] || force) cache.status[id] = await api(`/vps/${id}/status`)
    return cache.status[id]
  }

  async function homeScreen(force) {
    setHeader('Deploy Panel', 'Semua server kamu')
    hideMainButton()
    view.innerHTML = `<div class="screen"><div id="sum"><div class="summary"><div class="ghost" style="height:88px"></div></div></div>
      <div class="label">Server <button id="addVps">+ Tambah</button></div><div id="servers">${skeleton(2)}</div></div>`
    $('#addVps').onclick = () => { haptic.tap(); go('#/tambah-vps') }
    const list = await loadVps(force)
    if (!list.length) {
      $('#sum').innerHTML = ''
      $('#servers').innerHTML = blankState('server', 'Belum ada server', 'Tambahkan VPS pertama kamu buat mulai deploy dari sini.', '<button class="btn" id="firstVps">Tambah VPS</button>')
      $('#firstVps').onclick = () => go('#/tambah-vps')
      return
    }
    $('#servers').innerHTML = `<div class="list">${list.map((v) => `
      <button class="item" data-id="${esc(v.id)}">
        <span class="dot" id="dot-${esc(v.id)}"></span>
        <div class="body"><div class="name">${esc(v.name)}</div>
          <div class="meta num">${esc(v.user)}@${esc(v.host)} · <span id="meta-${esc(v.id)}">memeriksa…</span></div>
          <div class="minis" id="mini-${esc(v.id)}"></div></div>
        <svg class="go"><use href="#ic-go"/></svg>
      </button>`).join('')}</div>`
    view.querySelectorAll('[data-id]').forEach((b) => { b.onclick = () => { haptic.tap(); go(`#/vps/${b.dataset.id}`) } })

    const results = await Promise.all(list.map(async (v) => {
      let s
      try { s = await loadStatus(v.id, force) } catch (e) { s = { online: false, error: e.message } }
      const dot = $(`#dot-${CSS.escape(v.id)}`); const meta = $(`#meta-${CSS.escape(v.id)}`); const mini = $(`#mini-${CSS.escape(v.id)}`)
      if (!dot) return s
      if (!s.online) { dot.className = 'dot bad'; meta.textContent = 'tidak terhubung'; return s }
      const procs = s.processes || []
      const down = procs.filter((p) => p.status !== 'online').length
      dot.className = `dot ${down ? 'warn' : 'good'}`
      meta.textContent = s.processes == null ? 'pm2 tidak terpasang' : `${procs.length - down}/${procs.length} proses jalan`
      const ram = percent(s.system.memUsed, s.system.memTotal)
      const cpu = s.system.cores ? percent(s.system.load1, s.system.cores) : null
      mini.innerHTML = `<div class="meter"><i class="${severity(cpu)}" style="width:${(cpu || 0).toFixed(0)}%"></i></div><div class="meter"><i class="${severity(ram)}" style="width:${(ram || 0).toFixed(0)}%"></i></div>`
      return s
    }))

    const procs = results.flatMap((s) => (s.online && s.processes) || [])
    const on = procs.filter((p) => p.status === 'online').length
    const err = procs.filter((p) => p.status === 'errored').length
    const off = procs.length - on - err
    const reach = results.filter((s) => s.online).length
    const w = (n) => (procs.length ? (n / procs.length) * 100 : 0)
    $('#sum').innerHTML = `<div class="summary">
      <div class="k">Proses berjalan</div>
      <div class="big">${on}<small> / ${procs.length}</small></div>
      <div class="tags">
        <span class="tag ${reach === list.length ? 'good' : 'bad'}">${reach}/${list.length} server terhubung</span>
        ${err ? `<span class="tag bad">${err} error</span>` : ''}${off ? `<span class="tag">${off} berhenti</span>` : ''}
      </div>
      <div class="split"><i style="width:${w(on)}%;background:var(--good)"></i><i style="width:${w(err)}%;background:var(--bad)"></i><i style="width:${w(off)}%;background:var(--idle)"></i></div>
    </div>`
  }

  let currentTab = 'proses'
  async function vpsScreen(id, force) {
    const vps = (await loadVps(force)).find((v) => v.id === id)
    if (!vps) { toast('Server tidak ditemukan'); return go('#/') }
    setHeader(vps.name, `${vps.user}@${vps.host}:${vps.port}`)
    hideMainButton()
    view.innerHTML = `<div class="screen">
      <div class="summary" id="hostCard"><div class="ghost" style="height:96px"></div></div>
      <div class="tabs"><button data-tab="proses">Proses</button><button data-tab="project">Project</button></div>
      <div id="tabBody"></div>
      <div class="label">Pengaturan</div>
      <div class="list"><button class="item" id="delVps"><div class="body"><div class="name" style="color:var(--bad)">Hapus server ini</div><div class="meta">Data project ikut terhapus dari panel</div></div></button></div>
    </div>`
    $('#delVps').onclick = async () => {
      if (!(await confirmAsk(`Hapus ${vps.name} dari panel? Server-nya sendiri tidak disentuh.`))) return
      try { await api(`/vps/${id}`, { method: 'DELETE' }); haptic.ok(); toast('Server dihapus'); cache.vps = null; go('#/') } catch (e) { haptic.fail(); toast(e.message) }
    }
    const tabs = view.querySelectorAll('[data-tab]')
    const showTab = (name) => {
      currentTab = name
      tabs.forEach((t) => t.classList.toggle('on', t.dataset.tab === name))
      if (name === 'project') renderProjects(vps); else renderProcesses(vps, status)
    }
    tabs.forEach((t) => { t.onclick = () => { haptic.pick(); showTab(t.dataset.tab) } })

    let status = null
    $('#tabBody').innerHTML = skeleton(3)
    showTab(currentTab)
    try { status = await loadStatus(id, force) } catch (e) { status = { online: false, error: e.message } }
    if (location.hash !== `#/vps/${id}`) return
    $('#hostCard').innerHTML = status.online
      ? `<div class="k">Kondisi server</div>
         <div class="tags"><span class="tag good">terhubung · ${status.latency} ms</span><span class="tag">uptime ${fmtUptime((status.system.uptime || 0) * 1000)}</span></div>
         ${gaugesHtml(status.system)}`
      : `<div class="k">Kondisi server</div><div class="tags"><span class="tag bad">tidak terhubung</span></div><p class="note">${esc(status.error || '')}</p>`
    if (currentTab === 'proses') renderProcesses(vps, status)
  }

  function renderProcesses(vps, status) {
    const body = $('#tabBody'); if (!body) return
    if (!status) { body.innerHTML = `<div class="gap"></div>${skeleton(3)}`; return }
    if (!status.online) { body.innerHTML = `<div class="gap"></div>${blankState('server', 'Server tidak bisa dihubungi', status.error || 'Cek koneksi SSH.')}`; return }
    if (status.processes == null) { body.innerHTML = `<div class="gap"></div>${blankState('box', 'pm2 belum terpasang', 'Pasang pm2 di server ini buat lihat dan atur proses.')}`; return }
    if (!status.processes.length) { body.innerHTML = `<div class="gap"></div>${blankState('box', 'Belum ada proses pm2', 'Proses yang dijalankan lewat pm2 bakal muncul di sini.')}`; return }
    body.innerHTML = `<div class="gap"></div><div class="list">${status.processes.map((p) => `
      <button class="item" data-proc="${esc(p.name)}">
        <span class="dot ${procTone(p.status)}"></span>
        <div class="body"><div class="name">${esc(p.name)}</div>
          <div class="meta num">${p.status === 'online' ? `cpu ${p.cpu}% · ${fmtBytes(p.mem)} · up ${fmtUptime(p.uptime)}` : esc(procLabel(p.status))}${p.restarts ? ` · ↻${p.restarts}` : ''}</div></div>
        <span class="tag ${procTone(p.status)}">${esc(procLabel(p.status))}</span>
      </button>`).join('')}</div>`
    body.querySelectorAll('[data-proc]').forEach((b) => { b.onclick = () => processMenu(vps, status.processes.find((p) => p.name === b.dataset.proc)) })
  }

  async function processMenu(vps, p) {
    haptic.tap()
    const isOn = p.status === 'online'
    const choice = await sheet(`<b>${esc(p.name)}</b>${esc(procLabel(p.status))}`, [
      { text: 'Lihat log', value: 'logs' },
      { text: 'Restart', value: 'restart' },
      ...(isOn ? [{ text: 'Reload (tanpa downtime)', value: 'reload' }, { text: 'Stop', value: 'stop', danger: true }] : [{ text: 'Start', value: 'start' }])
    ])
    if (!choice) return
    if (choice === 'logs') return go(`#/vps/${vps.id}/log/${encodeURIComponent(p.name)}`)
    if (choice === 'stop' && !(await confirmAsk(`Stop ${p.name}? Prosesnya bakal mati sampai di-start lagi.`))) return
    toast(`${choice} ${p.name}…`)
    try {
      await api(`/vps/${vps.id}/pm2/${encodeURIComponent(p.name)}/${choice}`, { method: 'POST' })
      haptic.ok(); toast(`${p.name}: ${choice} berhasil`)
      delete cache.status[vps.id]; vpsScreen(vps.id)
    } catch (e) { haptic.fail(); toast(e.message) }
  }

  function renderProjects(vps) {
    const body = $('#tabBody'); if (!body) return
    const add = '<button class="btn soft wide" id="addProject" style="margin-top:10px">+ Tambah project</button>'
    if (!vps.projects.length) {
      body.innerHTML = `<div class="gap"></div>${blankState('box', 'Belum ada project', 'Daftarkan folder project dan script deploy-nya, nanti tinggal sekali tap.', '<button class="btn" id="addProject">Tambah project</button>')}`
    } else {
      body.innerHTML = `<div class="gap"></div>${vps.projects.map((p) => {
        const d = p.lastDeploy
        const last = d ? `<span class="tag ${d.code === 0 ? 'good' : 'bad'}">${d.code === 0 ? '✓' : '✗'} ${ago(d.at)} · ${fmtSec(d.ms)}</span>` : '<span class="tag">belum pernah deploy</span>'
        return `<div class="card"><div class="top"><div style="flex:1;min-width:0"><div class="title">${esc(p.name)}</div><div class="path">${esc(p.path)}</div></div>
          <button class="round" data-more="${esc(p.id)}" aria-label="Opsi"><svg><use href="#ic-more"/></svg></button></div>
          <div class="actions">${last}<span style="flex:1"></span><button class="btn" data-deploy="${esc(p.id)}"><svg><use href="#ic-up"/></svg>Deploy</button></div></div>`
      }).join('')}${add}`
    }
    $('#addProject').onclick = () => { haptic.tap(); go(`#/vps/${vps.id}/tambah-project`) }
    body.querySelectorAll('[data-deploy]').forEach((b) => { b.onclick = () => { haptic.tap(); go(`#/vps/${vps.id}/deploy/${b.dataset.deploy}`) } })
    body.querySelectorAll('[data-more]').forEach((b) => {
      b.onclick = async () => {
        const p = vps.projects.find((x) => x.id === b.dataset.more)
        const pick = await sheet(`<b>${esc(p.name)}</b>${esc(p.path)}`, [{ text: 'Hapus project dari panel', value: 'del', danger: true }])
        if (pick !== 'del' || !(await confirmAsk(`Hapus project ${p.name} dari panel? File di server tidak disentuh.`))) return
        try { await api(`/vps/${vps.id}/projects/${p.id}`, { method: 'DELETE' }); haptic.ok(); toast('Project dihapus'); cache.vps = null; vpsScreen(vps.id) } catch (e) { haptic.fail(); toast(e.message) }
      }
    })
  }

  async function deployScreen(id, pid) {
    const vps = (await loadVps()).find((v) => v.id === id)
    const project = vps?.projects.find((p) => p.id === pid)
    if (!project) { toast('Project tidak ditemukan'); return go(`#/vps/${id}`) }
    setHeader(`Deploy ${project.name}`, vps.name)
    view.innerHTML = `<div class="screen">
      <div class="card"><div class="title">${esc(project.name)}</div><div class="path">${esc(project.path)}</div><div class="script">${esc(project.deployScript)}</div></div>
      <div class="label">Log deploy</div><div id="log"></div><div id="verdict"></div></div>`
    const log = logBox($('#log'), `${vps.user}@${vps.host}`, 'Tekan "Deploy sekarang" buat mulai. Log muncul di sini secara live.')
    let busy = false
    const start = async () => {
      if (busy) return
      if (!(await confirmAsk(`Deploy ${project.name} ke ${vps.name} sekarang?`))) return
      busy = true; mainBusy(true); haptic.tap(); $('#verdict').innerHTML = ''
      log.reset(); log.running(true)
      let result = { code: -1, ms: 0, error: 'Koneksi ke panel terputus' }
      try {
        await apiStream(`/vps/${id}/projects/${pid}/deploy`, (ev) => {
          if (ev.t === 'info') log.line('› ' + ev.d, 'dim')
          else if (ev.t === 'out') log.write(ev.d)
          else if (ev.t === 'err') log.write(ev.d, 'err')
          else if (ev.t === 'done') result = ev.d
        })
      } catch (e) { result = { code: -1, ms: 0, error: e.message } }
      log.running(false)
      const ok = result.code === 0
      if (result.error) log.line('\n✗ ' + result.error, 'fail')
      log.line(ok ? `\n✓ Selesai · ${fmtSec(result.ms)}` : `\n✗ Gagal (exit ${result.code}) · ${fmtSec(result.ms)}`, ok ? 'ok' : 'fail')
      $('#verdict').innerHTML = `<div class="verdict ${ok ? 'good' : 'bad'}">${ok ? '✓' : '✗'}<div>${ok ? 'Deploy berhasil' : 'Deploy gagal'}<small>${ok ? fmtSec(result.ms) : esc(result.error || `exit code ${result.code}`)}</small></div></div>`
      ok ? haptic.ok() : haptic.fail()
      cache.vps = null; delete cache.status[id]
      busy = false; mainBusy(false); mainButton('Deploy lagi', start)
    }
    mainButton('Deploy sekarang', start)
  }

  async function logScreen(id, name) {
    const vps = (await loadVps()).find((v) => v.id === id)
    if (!vps) return go('#/')
    setHeader(name, `Log pm2 · ${vps.name}`)
    hideMainButton()
    view.innerHTML = `<div class="screen"><div class="gap"></div><div id="log"></div><p class="note">150 baris terakhir dari pm2. Tekan tombol muat ulang di atas buat ambil yang terbaru.</p></div>`
    const log = logBox($('#log'), `pm2 logs ${name}`, 'Mengambil log…')
    log.running(true)
    try { const r = await api(`/vps/${id}/pm2/${encodeURIComponent(name)}/logs`); log.fill(r.log) } catch (e) { log.fill(''); log.line('✗ ' + e.message, 'fail') }
    log.running(false)
  }

  function addVpsScreen() {
    setHeader('Tambah server', 'Panel konek lewat SSH')
    view.innerHTML = `<div class="screen"><div class="gap"></div>
      <div class="form">
        <label class="field"><span>Nama</span><input id="fName" placeholder="VPS Production" maxlength="40"></label>
        <label class="field"><span>Host / IP</span><input id="fHost" class="mono" placeholder="13.140.65.8" inputmode="url" autocapitalize="off" autocorrect="off"></label>
        <label class="field"><span>Port SSH</span><input id="fPort" class="mono" value="22" inputmode="numeric"></label>
        <label class="field"><span>Username</span><input id="fUser" class="mono" value="root" autocapitalize="off" autocorrect="off"></label>
      </div>
      <div class="tabs" style="position:static"><button data-auth="password" class="on">Password</button><button data-auth="key">Private key</button></div>
      <div class="form" style="margin-top:10px">
        <label class="field" id="pwField"><span>Password SSH</span><input id="fPass" type="password" autocomplete="off"></label>
        <label class="field" id="keyField" hidden><span>Path private key di server bot</span><input id="fKey" class="mono" placeholder="/root/.ssh/id_ed25519" autocapitalize="off"></label>
      </div>
      <p class="note">Panel bakal tes koneksi SSH dulu sebelum nyimpen. Password disimpan di server bot (data/config.json).</p>
      <div class="oops" id="oops" hidden></div></div>`
    let auth = 'password'
    view.querySelectorAll('[data-auth]').forEach((b) => {
      b.onclick = () => {
        haptic.pick(); auth = b.dataset.auth
        view.querySelectorAll('[data-auth]').forEach((x) => x.classList.toggle('on', x === b))
        $('#pwField').hidden = auth !== 'password'; $('#keyField').hidden = auth !== 'key'
      }
    })
    mainButton('Tes koneksi & simpan', async () => {
      const oops = $('#oops'); oops.hidden = true
      const body = { name: $('#fName').value, host: $('#fHost').value, port: Number($('#fPort').value), user: $('#fUser').value, authType: auth, password: $('#fPass').value, keyPath: $('#fKey').value }
      mainBusy(true)
      try {
        const { vps } = await api('/vps', { method: 'POST', body })
        haptic.ok(); toast('Server terhubung & disimpan'); cache.vps = null
        go(`#/vps/${vps.id}`, true)
      } catch (e) { haptic.fail(); oops.textContent = e.message; oops.hidden = false } finally { mainBusy(false) }
    })
  }

  const PRESETS = [
    { label: 'Node + pm2', script: 'git pull && npm ci && pm2 restart NAMA_PROSES' },
    { label: 'Build + pm2', script: 'git pull && npm ci && npm run build && pm2 restart NAMA_PROSES' },
    { label: 'Docker Compose', script: 'git pull && docker compose up -d --build' },
    { label: 'Static', script: 'git pull && npm ci && npm run build' }
  ]
  async function addProjectScreen(id) {
    const vps = (await loadVps()).find((v) => v.id === id)
    if (!vps) return go('#/')
    setHeader('Tambah project', vps.name)
    view.innerHTML = `<div class="screen"><div class="gap"></div>
      <div class="form">
        <label class="field"><span>Nama project</span><input id="pName" placeholder="rewardex" maxlength="40"></label>
        <label class="field"><span>Folder di server</span><input id="pPath" class="mono" placeholder="/root/rafael-dev/reward-promotion" autocapitalize="off" autocorrect="off"></label>
        <label class="field"><span>Script deploy</span><textarea id="pScript" placeholder="git pull && npm ci && pm2 restart app" autocapitalize="off" autocorrect="off" spellcheck="false"></textarea></label>
      </div>
      <div class="presets">${PRESETS.map((p, i) => `<button data-preset="${i}">${esc(p.label)}</button>`).join('')}</div>
      <p class="note">Script dijalankan di folder project lewat SSH, persis kayak kamu ngetik di terminal server.</p>
      <div class="oops" id="oops" hidden></div></div>`
    view.querySelectorAll('[data-preset]').forEach((b) => { b.onclick = () => { haptic.pick(); $('#pScript').value = PRESETS[Number(b.dataset.preset)].script } })
    mainButton('Simpan project', async () => {
      const oops = $('#oops'); oops.hidden = true
      mainBusy(true)
      try {
        await api(`/vps/${id}/projects`, { method: 'POST', body: { name: $('#pName').value, path: $('#pPath').value, deployScript: $('#pScript').value } })
        haptic.ok(); toast('Project disimpan'); cache.vps = null; currentTab = 'project'
        go(`#/vps/${id}`, true)
      } catch (e) { haptic.fail(); oops.textContent = e.message; oops.hidden = false } finally { mainBusy(false) }
    })
  }

  /* ---------- router ---------- */
  const routes = [
    [/^#\/?$/, () => homeScreen()],
    [/^#\/tambah-vps$/, () => addVpsScreen()],
    [/^#\/vps\/([^/]+)$/, (m) => vpsScreen(m[1])],
    [/^#\/vps\/([^/]+)\/tambah-project$/, (m) => addProjectScreen(m[1])],
    [/^#\/vps\/([^/]+)\/deploy\/([^/]+)$/, (m) => deployScreen(m[1], m[2])],
    [/^#\/vps\/([^/]+)\/log\/(.+)$/, (m) => logScreen(m[1], decodeURIComponent(m[2]))]
  ]
  function go(hash, replace) { if (replace) location.replace(hash); else location.hash = hash }
  async function render(force) {
    const hash = location.hash || '#/'
    if (tg) { hash === '#/' || hash === '#' ? tg.BackButton.hide() : tg.BackButton.show() }
    for (const [re, fn] of routes) {
      const m = hash.match(re)
      if (m) {
        try { await (force ? refreshCurrent(m, fn) : fn(m)) } catch (e) { haptic.fail(); view.innerHTML = `<div class="screen"><div class="gap"></div>${blankState('server', 'Gagal memuat', e.message)}</div>` }
        return
      }
    }
    go('#/', true)
  }
  async function refreshCurrent(m, fn) {
    cache.vps = null; cache.status = {}
    return fn(m)
  }

  function boot() {
    if (!INIT) {
      $('.bar').hidden = true
      view.innerHTML = `<div class="locked"><div><div class="blank" style="background:none"><div class="ico"><svg><use href="#ic-lock"/></svg></div><h2>Buka lewat Telegram</h2><p>Panel ini cuma bisa dibuka dari tombol "Buka Panel" di bot deploy kamu.</p></div></div></div>`
      return
    }
    tg.ready(); tg.expand()
    try { tg.setHeaderColor('secondary_bg_color'); tg.setBackgroundColor('secondary_bg_color') } catch {}
    document.documentElement.dataset.scheme = tg.colorScheme
    tg.onEvent('themeChanged', () => { document.documentElement.dataset.scheme = tg.colorScheme })
    tg.BackButton.onClick(() => { haptic.tap(); history.length > 1 ? history.back() : go('#/', true) })
    $('#refresh').onclick = async () => {
      const b = $('#refresh'); haptic.tap(); b.classList.add('busy')
      await render(true); b.classList.remove('busy')
    }
    window.addEventListener('hashchange', () => render())
    render()
  }
  boot()
})()

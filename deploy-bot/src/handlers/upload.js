import { InlineKeyboard } from 'grammy'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { listVPS, getVPS } from '../services/storage.js'
import { connectSSH, runCommand, disconnectSSH } from '../services/ssh.js'
import { extractCmd } from '../panel/server.js'
import { safe } from '../services/text.js'
import { backToMainKeyboard } from '../keyboards/index.js'

const TG_MAX = 20 * 1024 * 1024 // batas download file Bot API
const TTL = 30 * 60 * 1000
const DIR = join(tmpdir(), 'deploy-bot-uploads')
const pending = new Map() // uid -> { path, name, size, at, vpsId, projectId }

export const isZip = (buf) => buf.length >= 4 && buf.subarray(0, 4).toString('hex') === '504b0304'

const drop = (uid) => {
  const u = pending.get(uid)
  if (u) { pending.delete(uid); rmSync(u.path, { force: true }) }
}
setInterval(() => {
  for (const [uid, u] of pending) if (Date.now() - u.at > TTL) drop(uid)
}, 5 * 60 * 1000).unref()

export function registerUploadHandlers(bot) {
  mkdirSync(DIR, { recursive: true })

  bot.on('message:document', async (ctx) => {
    const doc = ctx.message.document
    if (!/\.zip$/i.test(doc.file_name || '')) {
      return ctx.reply('📦 Kirim file kode dalam format .zip untuk menimpa project di VPS.')
    }
    if (doc.file_size > TG_MAX) {
      return ctx.reply('❌ File terlalu besar (maks 20 MB lewat Telegram). Untuk file lebih besar pakai Panel (maks 100 MB).')
    }
    const vpsList = listVPS().filter(v => v.projects.length > 0)
    if (vpsList.length === 0) {
      return ctx.reply('📭 Belum ada VPS yang punya project. Tambah project dulu lewat Panel.')
    }

    const note = await ctx.reply('⬇️ Mengunduh ZIP...')
    const uid = randomBytes(4).toString('hex')
    const path = join(DIR, `${uid}.zip`)
    try {
      const file = await ctx.api.getFile(doc.file_id)
      const res = await fetch(`https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`)
      if (!res.ok) throw new Error(`download gagal (HTTP ${res.status})`)
      const buf = Buffer.from(await res.arrayBuffer())
      if (!isZip(buf)) throw new Error('bukan file ZIP yang valid')
      writeFileSync(path, buf)
      pending.set(uid, { path, name: doc.file_name, size: buf.length, at: Date.now() })
    } catch (err) {
      rmSync(path, { force: true })
      return ctx.api.editMessageText(ctx.chat.id, note.message_id, `❌ ${err.message}`)
    }

    const kb = new InlineKeyboard()
    for (const v of vpsList) kb.text(`🖥 ${v.name}`, `up_vps:${uid}:${v.id}`).row()
    kb.text('❌ Batal', `up_cancel:${uid}`)
    await ctx.api.editMessageText(ctx.chat.id, note.message_id,
      `📦 *${safe(doc.file_name)}* (${(pending.get(uid).size / 1048576).toFixed(1)} MB)\n\nTimpa code di VPS mana?`,
      { parse_mode: 'Markdown', reply_markup: kb })
  })

  const expired = (ctx) => ctx.editMessageText('⚠️ Upload kedaluwarsa. Kirim ulang ZIP-nya.', { reply_markup: backToMainKeyboard() })

  bot.callbackQuery(/^up_vps:/, async (ctx) => {
    await ctx.answerCallbackQuery()
    const [, uid, vpsId] = ctx.callbackQuery.data.split(':')
    const u = pending.get(uid), vps = getVPS(vpsId)
    if (!u || !vps) return expired(ctx)
    u.vpsId = vpsId
    const kb = new InlineKeyboard()
    vps.projects.forEach((p, i) => kb.text(`📦 ${p.name}`, `up_proj:${uid}:${i}`).row())
    kb.text('❌ Batal', `up_cancel:${uid}`)
    await ctx.editMessageText(`🖥 *${safe(vps.name)}*\n\nPilih project yang ditimpa:`, { parse_mode: 'Markdown', reply_markup: kb })
  })

  bot.callbackQuery(/^up_proj:/, async (ctx) => {
    await ctx.answerCallbackQuery()
    const [, uid, idx] = ctx.callbackQuery.data.split(':')
    const u = pending.get(uid)
    const vps = u && getVPS(u.vpsId)
    const project = vps?.projects[Number(idx)]
    if (!project) return expired(ctx)
    u.projectId = project.id
    const kb = new InlineKeyboard()
      .text('✅ Timpa & Deploy', `up_go:${uid}:1`).row()
      .text('📂 Timpa saja', `up_go:${uid}:0`).row()
      .text('❌ Batal', `up_cancel:${uid}`)
    await ctx.editMessageText(
      `⚠️ *Konfirmasi*\n\nFile: ${safe(u.name)}\nTujuan: *${safe(vps.name)}* → *${safe(project.name)}*\nFolder: \`${safe(project.path)}\`\n\nFile dengan nama sama akan ditimpa. \`.env\` dan \`data/\` yang sudah ada dipertahankan.`,
      { parse_mode: 'Markdown', reply_markup: kb })
  })

  bot.callbackQuery(/^up_cancel:/, async (ctx) => {
    await ctx.answerCallbackQuery()
    drop(ctx.callbackQuery.data.split(':')[1])
    await ctx.editMessageText('🚫 Dibatalkan.', { reply_markup: backToMainKeyboard() })
  })

  bot.callbackQuery(/^up_go:/, async (ctx) => {
    await ctx.answerCallbackQuery()
    const [, uid, run] = ctx.callbackQuery.data.split(':')
    const u = pending.get(uid)
    const vps = u && getVPS(u.vpsId)
    const project = vps?.projects.find(p => p.id === u.projectId)
    if (!project) return expired(ctx)
    pending.delete(uid) // cegah double-klik; file dibersihkan di finally

    const t0 = Date.now()
    const edit = (text, kb) => ctx.editMessageText(text, { parse_mode: 'Markdown', ...(kb ? { reply_markup: kb } : {}) })
    const secs = () => Math.round((Date.now() - t0) / 1000)
    let ssh
    try {
      await edit(`📡 Menghubungkan ke *${safe(vps.name)}*...`)
      ssh = await connectSSH(vps)
      await edit('📤 Mengirim ZIP ke server...')
      const remote = `/tmp/deploy-bot-${uid}.zip`
      await ssh.putFile(u.path, remote)
      await edit('📂 Mengekstrak & menimpa file...')
      const ex = await runCommand(ssh, extractCmd(remote, project.path), undefined)
      if (ex.code !== 0) {
        return edit(`❌ Gagal ekstrak (exit ${ex.code})\n\n\`\`\`\n${safe(ex.stderr || ex.stdout || '-').slice(-600)}\n\`\`\``, backToMainKeyboard())
      }
      const extractMsg = safe(ex.stdout.trim()).slice(-300)
      if (run !== '1') {
        return edit(`✅ *Kode ditimpa* — ${secs()}s\n\n${extractMsg}`, backToMainKeyboard())
      }
      await edit(`✅ ${extractMsg}\n\n⏳ Menjalankan script deploy...`)
      const r = await runCommand(ssh, project.deployScript, project.path)
      const out = safe(r.stdout || r.stderr || 'Done').slice(-700)
      if (r.code !== 0) {
        return edit(`❌ Kode ditimpa, tapi deploy *gagal* (exit ${r.code}) — ${secs()}s\n\n\`\`\`\n${safe(r.stderr || r.stdout || '-').slice(-700)}\n\`\`\``, backToMainKeyboard())
      }
      await edit(`✅ *Timpa & deploy selesai* — ${secs()}s\n\n\`\`\`\n${out}\n\`\`\``, backToMainKeyboard())
    } catch (err) {
      await edit(`❌ Error: ${safe(err.message)} (${secs()}s)`, backToMainKeyboard()).catch(() => {})
    } finally {
      if (ssh) disconnectSSH(ssh)
      rmSync(u.path, { force: true })
    }
  })
}

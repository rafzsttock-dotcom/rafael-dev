import { listVPS, getVPS } from '../services/storage.js'
import { connectSSH, runCommand, disconnectSSH } from '../services/ssh.js'
import { statusDetailKeyboard, backToMainKeyboard } from '../keyboards/index.js'

async function getPm2Status(vps) {
  let ssh
  try {
    ssh = await connectSSH(vps)
    const result = await runCommand(ssh, 'pm2 jlist', '/')
    if (result.code !== 0) {
      const msg = result.stderr || result.stdout || ''
      if (result.code === 127 || /not found/i.test(msg)) return '⚠️ pm2 tidak terinstall di VPS ini.'
      return `❌ pm2 error (exit ${result.code}): ${msg.slice(0, 200).replace(/[`*_]/g, '')}`
    }
    const start = result.stdout.indexOf('[')
    const processes = start >= 0 ? JSON.parse(result.stdout.slice(start)) : []
    if (processes.length === 0) return '📭 Tidak ada proses pm2.'
    return processes.map(p => {
      const icon = p.pm2_env?.status === 'online' ? '✅' : '❌'
      return `${icon} ${p.name} (${p.pm2_env?.status || 'unknown'})`
    }).join('\n')
  } catch (err) {
    if (err.message.includes('pm2: command not found') || err.message.includes('not found')) {
      return '⚠️ pm2 tidak terinstall di VPS ini.'
    }
    return `❌ Error: ${err.message}`
  } finally {
    if (ssh) disconnectSSH(ssh)
  }
}

export function registerStatusHandlers(bot) {
  bot.callbackQuery(/^status:/, async (ctx) => {
    await ctx.answerCallbackQuery()
    const vpsId = ctx.callbackQuery.data.split(':')[1]
    const vps = getVPS(vpsId)
    if (!vps) {
      await ctx.editMessageText('❌ VPS tidak ditemukan.', { reply_markup: backToMainKeyboard() })
      return
    }
    await ctx.editMessageText(`📊 *${vps.name}* — mengecek status...`, { parse_mode: 'Markdown' })
    const statusText = await getPm2Status(vps)
    await ctx.editMessageText(
      `📊 *${vps.name}*\n\n${statusText}`,
      { parse_mode: 'Markdown', reply_markup: statusDetailKeyboard(vpsId) }
    )
  })

  bot.callbackQuery('status_all', async (ctx) => {
    await ctx.answerCallbackQuery()
    const vpsList = listVPS()
    if (vpsList.length === 0) {
      await ctx.editMessageText('📭 Belum ada VPS terdaftar.', { reply_markup: backToMainKeyboard() })
      return
    }
    await ctx.editMessageText('📊 *Status All* — mengecek semua VPS...', { parse_mode: 'Markdown' })

    const sections = await Promise.all(vpsList.map(async (vps) => {
      const statusText = await getPm2Status(vps)
      return `🖥 *${vps.name}*\n${statusText}`
    }))

    await ctx.editMessageText(
      `📊 *Status Semua VPS*\n\n${sections.join('\n\n')}`,
      { parse_mode: 'Markdown', reply_markup: backToMainKeyboard() }
    )
  })
}

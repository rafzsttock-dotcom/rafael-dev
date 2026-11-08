import { getVPS } from '../services/storage.js'
import { connectSSH, runCommand, disconnectSSH } from '../services/ssh.js'
import { safe } from '../services/text.js'
import {
  deployProjectKeyboard,
  confirmDeployKeyboard,
  backToMainKeyboard,
  vpsDetailKeyboard
} from '../keyboards/index.js'

export function registerDeployHandlers(bot) {
  bot.callbackQuery(/^deploy_pick:/, async (ctx) => {
    await ctx.answerCallbackQuery()
    const vpsId = ctx.callbackQuery.data.split(':')[1]
    const vps = getVPS(vpsId)
    if (!vps) {
      await ctx.editMessageText('❌ VPS tidak ditemukan.', { reply_markup: backToMainKeyboard() })
      return
    }
    if (vps.projects.length === 0) {
      await ctx.editMessageText(
        `📭 *${vps.name}* belum punya project.\n\nTambah project dulu lewat tombol 🚀 Panel di menu utama.`,
        { parse_mode: 'Markdown', reply_markup: vpsDetailKeyboard(vpsId) }
      )
      return
    }
    await ctx.editMessageText(
      `🚀 Deploy ke *${vps.name}*\n\nPilih project:`,
      { parse_mode: 'Markdown', reply_markup: deployProjectKeyboard(vps.projects, vpsId) }
    )
  })

  bot.callbackQuery(/^deploy_confirm:/, async (ctx) => {
    await ctx.answerCallbackQuery()
    const [, vpsId, projectId] = ctx.callbackQuery.data.split(':')
    const vps = getVPS(vpsId)
    const project = vps?.projects.find(p => p.id === projectId)
    if (!vps || !project) {
      await ctx.editMessageText('❌ Project tidak ditemukan.', { reply_markup: backToMainKeyboard() })
      return
    }
    await ctx.editMessageText(
      `🚀 *Deploy Konfirmasi*\n\nProject: *${project.name}*\nVPS: *${vps.name}*\n\nLanjut?`,
      { parse_mode: 'Markdown', reply_markup: confirmDeployKeyboard(vpsId, projectId) }
    )
  })

  bot.callbackQuery(/^deploy_run:/, async (ctx) => {
    await ctx.answerCallbackQuery()
    const [, vpsId, projectId] = ctx.callbackQuery.data.split(':')
    const vps = getVPS(vpsId)
    const project = vps?.projects.find(p => p.id === projectId)
    if (!vps || !project) {
      await ctx.editMessageText('❌ Project tidak ditemukan.', { reply_markup: backToMainKeyboard() })
      return
    }
    const startTime = Date.now()

    const statusMsg = await ctx.editMessageText(
      `🚀 Deploying *${project.name}* on *${vps.name}*...\n\n📡 Connecting...`,
      { parse_mode: 'Markdown' }
    )
    const msgId = statusMsg.message_id

    let ssh
    try {
      ssh = await connectSSH(vps)
      await ctx.api.editMessageText(ctx.chat.id, msgId,
        `🚀 Deploying *${project.name}* on *${vps.name}*...\n\n✅ Connected\n⏳ Running script...`,
        { parse_mode: 'Markdown' })

      const result = await runCommand(ssh, project.deployScript, project.path)
      const elapsed = Math.round((Date.now() - startTime) / 1000)

      if (result.code !== 0) {
        const errOut = safe(result.stderr || result.stdout || 'No output').slice(-800)
        await ctx.api.editMessageText(ctx.chat.id, msgId,
          `❌ Deploy *gagal* (exit ${result.code}) — ${elapsed}s\n\n\`\`\`\n${errOut}\n\`\`\``,
          { parse_mode: 'Markdown', reply_markup: backToMainKeyboard() })
      } else {
        const out = safe(result.stdout || 'Done').slice(-800)
        await ctx.api.editMessageText(ctx.chat.id, msgId,
          `✅ Deploy *selesai!* — ${elapsed}s\n\n\`\`\`\n${out}\n\`\`\``,
          { parse_mode: 'Markdown', reply_markup: backToMainKeyboard() })
      }
    } catch (err) {
      const elapsed = Math.round((Date.now() - startTime) / 1000)
      await ctx.api.editMessageText(ctx.chat.id, msgId,
        `❌ Error: ${err.message} (${elapsed}s)`,
        { reply_markup: backToMainKeyboard() })
    } finally {
      if (ssh) disconnectSSH(ssh)
    }
  })
}

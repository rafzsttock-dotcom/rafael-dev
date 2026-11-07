import { createConversation } from '@grammyjs/conversations'
import { getVPS } from '../services/storage.js'
import { connectSSH, runCommand, disconnectSSH } from '../services/ssh.js'
import { backToMainKeyboard, vpsDetailKeyboard } from '../keyboards/index.js'

async function runCmdConversation(conversation, ctx) {
  const vpsId = ctx.session._cmdVpsId
  const vps = getVPS(vpsId)
  if (!vps) {
    await ctx.reply('❌ VPS tidak ditemukan.', { reply_markup: backToMainKeyboard() })
    return
  }

  await ctx.reply(`⚡ *${vps.name}* — Ketik command:`, { parse_mode: 'Markdown' })
  const cmdCtx = await conversation.waitFor('message:text')
  const cmd = cmdCtx.message.text

  const startTime = Date.now()
  const runMsg = await ctx.reply(`⚡ Menjalankan: \`${cmd}\`...`, { parse_mode: 'Markdown' })

  let ssh
  try {
    ssh = await connectSSH(vps)
    const result = await runCommand(ssh, cmd, '/')
    const elapsed = Math.round((Date.now() - startTime) / 1000)
    const output = (result.stdout || result.stderr || '(no output)').slice(0, 1000)
    await ctx.api.editMessageText(ctx.chat.id, runMsg.message_id,
      `⚡ \`${cmd}\` — ${elapsed}s\n\n\`\`\`\n${output}\n\`\`\``,
      { parse_mode: 'Markdown', reply_markup: vpsDetailKeyboard(vpsId) })
  } catch (err) {
    await ctx.api.editMessageText(ctx.chat.id, runMsg.message_id,
      `❌ Error: ${err.message}`,
      { reply_markup: vpsDetailKeyboard(vpsId) })
  } finally {
    if (ssh) disconnectSSH(ssh)
  }
}

export function registerCmdHandlers(bot) {
  bot.use(createConversation(runCmdConversation))

  bot.callbackQuery(/^run_cmd:/, async (ctx) => {
    await ctx.answerCallbackQuery()
    const vpsId = ctx.callbackQuery.data.split(':')[1]
    ctx.session._cmdVpsId = vpsId
    await ctx.conversation.enter('runCmdConversation')
  })
}

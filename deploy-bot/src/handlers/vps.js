import { createConversation } from '@grammyjs/conversations'
import { listVPS, addVPS, removeVPS, getVPS } from '../services/storage.js'
import { testConnection } from '../services/ssh.js'
import {
  vpsListKeyboard,
  vpsDetailKeyboard,
  deleteConfirmKeyboard,
  authTypeKeyboard,
  backToMainKeyboard,
  addVpsButtonKeyboard
} from '../keyboards/index.js'

async function addVpsConversation(conversation, ctx) {
  await ctx.reply('📝 Nama VPS? (contoh: VPS Production)')
  const name = (await conversation.waitFor('message:text')).message.text

  await ctx.reply('🌐 Host / IP?')
  const host = (await conversation.waitFor('message:text')).message.text

  await ctx.reply('🔌 Port SSH? (default: 22, kirim 22 untuk skip)')
  const portStr = (await conversation.waitFor('message:text')).message.text
  const port = parseInt(portStr) || 22

  await ctx.reply('👤 Username? (contoh: root)')
  const user = (await conversation.waitFor('message:text')).message.text

  await ctx.reply('🔐 Tipe auth?', { reply_markup: authTypeKeyboard() })
  const authCtx = await conversation.waitFor('callback_query')
  await authCtx.answerCallbackQuery()
  const authType = authCtx.callbackQuery.data === 'auth_key' ? 'key' : 'password'

  let password, keyPath
  if (authType === 'password') {
    await ctx.reply('🔑 Password:')
    password = (await conversation.waitFor('message:text')).message.text
  } else {
    await ctx.reply('📄 Path ke private key (contoh: /root/.ssh/id_rsa):')
    keyPath = (await conversation.waitFor('message:text')).message.text
  }

  const testMsg = await ctx.reply('📡 Testing koneksi...')
  const result = await testConnection({ host, port, user, authType, password, keyPath })

  if (!result.ok) {
    await ctx.api.editMessageText(ctx.chat.id, testMsg.message_id,
      `❌ Koneksi gagal: ${result.error}\n\nKetik /start untuk coba lagi.`)
    return
  }

  addVPS({ name, host, port, user, authType, password, keyPath })
  await ctx.api.editMessageText(ctx.chat.id, testMsg.message_id,
    `✅ VPS *${name}* berhasil ditambahkan!`,
    { parse_mode: 'Markdown', reply_markup: backToMainKeyboard() })
}

export function registerVpsHandlers(bot) {
  bot.use(createConversation(addVpsConversation))

  bot.callbackQuery('vps_list', async (ctx) => {
    await ctx.answerCallbackQuery()
    const vpsList = listVPS()
    if (vpsList.length === 0) {
      await ctx.editMessageText(
        '📭 Belum ada VPS terdaftar.',
        { reply_markup: addVpsButtonKeyboard() }
      )
      return
    }
    await ctx.editMessageText('🖥 *Daftar VPS*\n\nPilih VPS:', {
      parse_mode: 'Markdown',
      reply_markup: vpsListKeyboard(vpsList)
    })
  })

  bot.callbackQuery(/^vps_detail:/, async (ctx) => {
    await ctx.answerCallbackQuery()
    const vpsId = ctx.callbackQuery.data.split(':')[1]
    const vps = getVPS(vpsId)
    if (!vps) {
      await ctx.editMessageText('❌ VPS tidak ditemukan.', { reply_markup: backToMainKeyboard() })
      return
    }
    const authLabel = vps.authType === 'key' ? 'SSH Key' : 'Password'
    await ctx.editMessageText(
      `🖥 *${vps.name}*\n\nHost: \`${vps.host}\`\nUser: \`${vps.user}\` | Port: \`${vps.port}\`\nAuth: ${authLabel}\nProjects: ${vps.projects.length}`,
      { parse_mode: 'Markdown', reply_markup: vpsDetailKeyboard(vpsId) }
    )
  })

  bot.callbackQuery(/^vps_delete:/, async (ctx) => {
    await ctx.answerCallbackQuery()
    const vpsId = ctx.callbackQuery.data.split(':')[1]
    const vps = getVPS(vpsId)
    if (!vps) {
      await ctx.editMessageText('❌ VPS tidak ditemukan.', { reply_markup: backToMainKeyboard() })
      return
    }
    await ctx.editMessageText(
      `⚠️ Yakin hapus *${vps.name}*?\n\nSemua data project-nya juga akan ikut terhapus.`,
      { parse_mode: 'Markdown', reply_markup: deleteConfirmKeyboard(vpsId) }
    )
  })

  bot.callbackQuery(/^vps_delete_confirm:/, async (ctx) => {
    await ctx.answerCallbackQuery()
    const vpsId = ctx.callbackQuery.data.split(':')[1]
    removeVPS(vpsId)
    await ctx.editMessageText('✅ VPS berhasil dihapus.', { reply_markup: backToMainKeyboard() })
  })

  bot.callbackQuery('add_vps', async (ctx) => {
    await ctx.answerCallbackQuery()
    await ctx.conversation.enter('addVpsConversation')
  })
}

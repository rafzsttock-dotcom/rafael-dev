import 'dotenv/config'

if (!process.env.BOT_TOKEN) {
  console.error('❌ BOT_TOKEN kosong! Isi dulu di file .env')
  process.exit(1)
}
if (!process.env.OWNER_CHAT_ID) {
  console.error('❌ OWNER_CHAT_ID kosong! Isi dulu di file .env')
  process.exit(1)
}

const { bot } = await import('./bot.js')
const { registerMenuHandlers } = await import('./handlers/menu.js')
const { registerVpsHandlers } = await import('./handlers/vps.js')
const { registerDeployHandlers } = await import('./handlers/deploy.js')
const { registerStatusHandlers } = await import('./handlers/status.js')
const { registerCmdHandlers } = await import('./handlers/cmd.js')
const { registerUploadHandlers } = await import('./handlers/upload.js')

registerMenuHandlers(bot)
registerVpsHandlers(bot)
registerDeployHandlers(bot)
registerStatusHandlers(bot)
registerCmdHandlers(bot)
registerUploadHandlers(bot)

// Stale callback guard — must be last
bot.on('callback_query', async (ctx) => {
  await ctx.answerCallbackQuery('⚠️ Tombol ini sudah expired. Ketik /start')
})

const { startPanel } = await import('./panel/server.js')
startPanel({
  botToken: process.env.BOT_TOKEN,
  ownerId: process.env.OWNER_CHAT_ID,
  host: process.env.PANEL_HOST || '172.17.0.1',
  port: Number(process.env.PANEL_PORT || 8787)
})

bot.start({
  onStart: async () => {
    console.log('🤖 Deploy Bot running...')
    if (!process.env.PANEL_URL) return
    try {
      await bot.api.setChatMenuButton({
        chat_id: Number(process.env.OWNER_CHAT_ID),
        menu_button: { type: 'web_app', text: 'Panel', web_app: { url: process.env.PANEL_URL } }
      })
    } catch (err) {
      console.error('❌ Gagal pasang menu button panel:', err.message)
    }
  }
})

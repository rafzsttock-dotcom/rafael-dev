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

registerMenuHandlers(bot)
registerVpsHandlers(bot)
registerDeployHandlers(bot)
registerStatusHandlers(bot)
registerCmdHandlers(bot)

// Stale callback guard — must be last
bot.on('callback_query', async (ctx) => {
  await ctx.answerCallbackQuery('⚠️ Tombol ini sudah expired. Ketik /start')
})

bot.start({ onStart: () => console.log('🤖 Deploy Bot running...') })

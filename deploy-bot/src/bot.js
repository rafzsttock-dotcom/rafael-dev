import { Bot, session } from 'grammy'
import { conversations } from '@grammyjs/conversations'

export const bot = new Bot(process.env.BOT_TOKEN)

bot.use((ctx, next) => {
  if (String(ctx.from?.id) !== process.env.OWNER_CHAT_ID) return
  return next()
})

bot.use(session({ initial: () => ({}) }))
bot.use(conversations())

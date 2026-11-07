import { mainMenuKeyboard } from '../keyboards/index.js'

export function registerMenuHandlers(bot) {
  bot.command('start', async (ctx) => {
    await ctx.reply(
      '🤖 *Deploy Bot*\n\nPilih aksi:',
      { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard() }
    )
  })

  bot.callbackQuery('main_menu', async (ctx) => {
    await ctx.answerCallbackQuery()
    await ctx.editMessageText(
      '🤖 *Deploy Bot*\n\nPilih aksi:',
      { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard() }
    )
  })
}

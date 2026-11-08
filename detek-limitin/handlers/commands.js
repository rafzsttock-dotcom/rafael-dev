bot.start(async (ctx) => {
    if (!ctx) return
    lastBotActivity = Date.now()

    // Handle Referral Parameter jika ada (format: /start ref_XXXXXX)
    const textMsg = ctx.message?.text || ''
    const parts = textMsg.split(' ')
    const payload = parts.length > 1 ? parts[1].trim() : ''

    if (payload && payload.startsWith('ref_')) {
        const refCode = payload.replace(/^ref_/, '').trim()
        const existingUser = await User.findOne({ userId: ctx.from.id }).lean()

        if (!existingUser) {
            try {
                const referrer = await User.findOne({
                    $or: [
                        { refCode: refCode },
                        { userId: !isNaN(refCode) && Number(refCode) > 0 ? Number(refCode) : -1 }
                    ]
                }).lean()

                if (referrer && String(referrer.userId) !== String(ctx.from.id)) {
                    const curReff = referrer.referralCount || 0
                    const tier = getReferralTier(curReff)
                    const newProgress = (referrer.referralProgress || 0) + 1
                    const newCount = curReff + 1
                    let earnedLimit = 0
                    let nextProgress = newProgress

                    if (newProgress >= tier.costPerLimit) {
                        earnedLimit = 1
                        nextProgress = 0
                    }

                    await User.updateOne({ userId: referrer.userId }, {
                        $inc: {
                            referralCount: 1,
                            limit: earnedLimit,
                            referralBonusLimit: earnedLimit
                        },
                        $set: {
                            referralProgress: nextProgress
                        }
                    })

                    if (global.userCache) global.userCache.delete(referrer.userId)

                    // Daftarkan pengguna baru dengan invitedBy
                    const todayStr = getTodayDate()
                    const newUser = new User({
                        userId: ctx.from.id,
                        username: ctx.from.username || '',
                        firstName: ctx.from.first_name || '',
                        limit: 5,
                        lastReset: todayStr,
                        lastInteraction: Date.now(),
                        premium: false,
                        premiumUntil: null,
                        refCode: generateRefCode(),
                        invitedBy: referrer.userId,
                        referralCount: 0,
                        referralProgress: 0,
                        referralBonusLimit: 0,
                        totalChecked: 0,
                        totalCekBio: 0,
                        totalCekBioSessions: 0,
                        totalDetect: 0,
                        totalLimitin: 0
                    })
                    await newUser.save().catch(() => {})
                    if (global.userCache) global.userCache.set(ctx.from.id, newUser.toObject())

                    // Kirim notifikasi ke pengundang (referrer)
                    const newUserName = ctx.from.username ? `@${ctx.from.username}` : (ctx.from.first_name || 'Pengguna Baru')
                    let notifText = `<b>${EMOJIS.CHECK} REFERRAL BARU BERHASIL!</b>\n\n<blockquote>Pengguna baru <b>${escapeHTML(newUserName)}</b> bergabung menggunakan tautan referral Anda!</blockquote>\n\n`
                    if (earnedLimit > 0) {
                        notifText += `<blockquote>🎁 <b>Bonus Kuota:</b> +1 Limit Cek!\n📊 Total Referral: <b>${newCount} teman</b>\n🔑 Sisa Kuota Limit: <b>${(referrer.limit || 0) + earnedLimit} limit</b>\n📈 Peringkat: <b>${tier.name}</b></blockquote>`
                    } else {
                        notifText += `<blockquote>📊 Total Referral: <b>${newCount} teman</b>\n📈 Peringkat: <b>${tier.name}</b>\n🎯 Progres: <b>${nextProgress}/${tier.costPerLimit} teman</b> (Kurang ${tier.costPerLimit - nextProgress} teman lagi untuk +1 limit!)</blockquote>`
                    }

                    if (bot && bot.telegram) {
                        bot.telegram.sendMessage(referrer.userId, notifText, { parse_mode: 'HTML' }).catch(() => {})
                    }
                }
            } catch (err) {
                logger.add('ERROR', `Referral process error: ${err.message}`)
            }
        }
    }

    const joinStatus = await isJoined(ctx);
    if (!joinStatus.allJoined) {
        return await showMainMenu(ctx)
    }

    delete userState[ctx.from.id]
    await showMainMenu(ctx)
})

bot.command('menu', async (ctx) => {
    if (!ctx) return;
    lastBotActivity = Date.now();
    const joinStatus = await isJoined(ctx);
    if (!joinStatus.allJoined) {
        return await showMainMenu(ctx);
    }
    delete userState[ctx.from.id];
    await showMainMenu(ctx);
})

bot.command('ban', async (ctx) => {
    if (String(ctx.from.id) !== String(config.ownerId)) return;
    await ctx.deleteMessage().catch(() => {});
    const args = ctx.message.text.split(' ');
    let targetId;
    if (ctx.message.reply_to_message) {
        if (ctx.message.reply_to_message.forward_sender_name) {
            return ctx.reply(`<b>${EMOJIS.CROSS} Gunakan ID manual untuk akun privat.</b>`, { parse_mode: 'HTML' });
        }
        targetId = ctx.message.reply_to_message.forward_from ? ctx.message.reply_to_message.forward_from.id : ctx.message.reply_to_message.from.id;
    } else {
        if (args.length < 2) {
            return ctx.reply(`<b>${EMOJIS.CROSS} Format: <code>/ban ID_USER</code></b>`, { parse_mode: 'HTML' });
        }
        targetId = parseInt(args[1]);
    }

    const result = await User.findOneAndUpdate({ userId: targetId }, { isBanned: true });
    if (!result) return ctx.reply(`<b>${EMOJIS.CROSS} User <code>${targetId}</code> tidak ditemukan.</b>`, { parse_mode: 'HTML' });
    userCache.delete(targetId);
    ctx.reply(`<b>${EMOJIS.CHECK} User <code>${targetId}</code> berhasil diblokir.</b>`, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: 'KEMBALI KE OWNER PANEL', callback_data: 'action_ownermenu', icon_custom_emoji_id: EMOJI_IDS.BACK }]] }
    });
});

bot.command('unban', async (ctx) => {
    if (String(ctx.from.id) !== String(config.ownerId)) return;
    await ctx.deleteMessage().catch(() => {});
    const args = ctx.message.text.split(' ');
    let targetId;
    if (ctx.message.reply_to_message) {
        if (ctx.message.reply_to_message.forward_sender_name) {
            return ctx.reply(`<b>${EMOJIS.CROSS} Gunakan ID manual untuk akun privat.</b>`, { parse_mode: 'HTML' });
        }
        targetId = ctx.message.reply_to_message.forward_from ? ctx.message.reply_to_message.forward_from.id : ctx.message.reply_to_message.from.id;
    } else {
        if (args.length < 2) {
            return ctx.reply(`<b>${EMOJIS.CROSS} Format: <code>/unban ID_USER</code></b>`, { parse_mode: 'HTML' });
        }
        targetId = parseInt(args[1]);
    }

    const result = await User.findOneAndUpdate({ userId: targetId }, { isBanned: false });
    if (!result) return ctx.reply(`<b>${EMOJIS.CROSS} User <code>${targetId}</code> tidak ditemukan.</b>`, { parse_mode: 'HTML' });
    userCache.delete(targetId);
    ctx.reply(`<b>${EMOJIS.CHECK} User <code>${targetId}</code> berhasil di-unban.</b>`, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: 'KEMBALI KE OWNER PANEL', callback_data: 'action_ownermenu', icon_custom_emoji_id: EMOJI_IDS.BACK }]] }
    });
});

bot.command('modeperbaikan', async (ctx) => {
    if (!ctx) return;
    lastBotActivity = Date.now();
    if (String(ctx.from.id) !== String(config.ownerId)) return;

    await ctx.deleteMessage().catch(() => {});
    const res = await toggleMaintenanceMode();
    return ctx.reply(res.message, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: 'KEMBALI KE OWNER PANEL', callback_data: 'action_ownermenu', icon_custom_emoji_id: EMOJI_IDS.BACK }]] }
    });
});

bot.command('bc', async (ctx) => {
    if (!ctx) return
    lastBotActivity = Date.now()
    if (ctx.from.id !== config.ownerId) return

    const messageToCopy = ctx.message.reply_to_message
    const rawText = ctx.message.text || ctx.message.caption || ''

    let textToSend = rawText
    const entities = ctx.message.entities || ctx.message.caption_entities || []
    const customEmojis = entities.filter(e => e.type === 'custom_emoji').sort((a, b) => b.offset - a.offset)

    for (const ent of customEmojis) {
        const emojiText = textToSend.substring(ent.offset, ent.offset + ent.length)
        const replacement = `<tg-emoji emoji-id="${ent.custom_emoji_id}">${emojiText}</tg-emoji>`
        textToSend = textToSend.substring(0, ent.offset) + replacement + textToSend.substring(ent.offset + ent.length)
    }

    textToSend = textToSend.replace(/^\/bc\b\s*/i, '').trim()
    const hasMedia = ctx.message.photo || ctx.message.video || ctx.message.document || ctx.message.audio || ctx.message.animation

    if (!messageToCopy && !textToSend && !hasMedia) {
        return ctx.reply(
            `<b>${EMOJIS.CROSS} Format: <code>/bc pesan</code> atau reply pesan.</b>`,
            { parse_mode: 'HTML' }
        )
    }

    const totalUsers = await User.countDocuments()
    const users = await User.find({}).select('userId').lean()

    await ctx.reply(`<b>${EMOJIS.REFRESH} Mengirim broadcast ke ${totalUsers} user...</b>`, { parse_mode: 'HTML' })

    const jalankanBroadcast = async () => {
        let sukses = 0
        let gagal = 0
        const BATCH_SIZE = 25

        for (let i = 0; i < users.length; i += BATCH_SIZE) {
            const batch = users.slice(i, i + BATCH_SIZE)

            await Promise.all(batch.map(async (user) => {
                try {
                    if (messageToCopy) {
                        if (bot && bot.telegram) await bot.telegram.copyMessage(user.userId, ctx.chat.id, messageToCopy.message_id)
                    } else if (hasMedia) {
                        if (bot && bot.telegram) await bot.telegram.copyMessage(user.userId, ctx.chat.id, ctx.message.message_id, { caption: textToSend, parse_mode: 'HTML' })
                    } else {
                        if (bot && bot.telegram) await bot.telegram.sendMessage(user.userId, textToSend, { parse_mode: 'HTML', disable_web_page_preview: true })
                    }
                    sukses++
                } catch (e) {
                    gagal++
                }
            }))

            await new Promise(r => setTimeout(r, 1000))
        }

        logger.add('BROADCAST', `Broadcast S: ${sukses}, G: ${gagal}`)

        try {
            if (bot && bot.telegram) await bot.telegram.sendMessage(config.ownerId,
                `<b>${EMOJIS.CHECK} Broadcast Selesai</b>\n\n<blockquote>Target: ${totalUsers}\n${EMOJIS.CHECK} Sukses: ${sukses}\n${EMOJIS.CROSS} Gagal: ${gagal}</blockquote>`,
                { parse_mode: 'HTML' }
            )
        } catch (e) {}
    }
    jalankanBroadcast()
})

bot.command('bcfd', async (ctx) => {
    if (!ctx) return
    lastBotActivity = Date.now()
    if (ctx.from.id !== config.ownerId) return

    const messageToForward = ctx.message.reply_to_message
    if (!messageToForward) {
        return ctx.reply(
            `<b>${EMOJIS.CROSS} Reply pesan lalu ketik <code>/bcfd</code></b>`,
            { parse_mode: 'HTML' }
        )
    }

    const totalUsers = await User.countDocuments()
    const users = await User.find({}).select('userId').lean()

    await ctx.reply(`<b>${EMOJIS.REFRESH} Meneruskan pesan ke ${totalUsers} user...</b>`, { parse_mode: 'HTML' })

    const jalankanForward = async () => {
        let sukses = 0
        let gagal = 0
        const BATCH_SIZE = 25

        for (let i = 0; i < users.length; i += BATCH_SIZE) {
            const batch = users.slice(i, i + BATCH_SIZE)

            await Promise.all(batch.map(async (user) => {
                try {
                    if (bot && bot.telegram) await bot.telegram.forwardMessage(user.userId, ctx.chat.id, messageToForward.message_id)
                    sukses++
                } catch (e) {
                    gagal++
                }
            }))

            await new Promise(r => setTimeout(r, 1000))
        }

        logger.add('BROADCAST', `Forward BC S: ${sukses}, G: ${gagal}`)

        try {
            if (bot && bot.telegram) await bot.telegram.sendMessage(config.ownerId,
                `<b>${EMOJIS.CHECK} Forward Selesai</b>\n\n<blockquote>Target: ${totalUsers}\n${EMOJIS.CHECK} Sukses: ${sukses}\n${EMOJIS.CROSS} Gagal: ${gagal}</blockquote>`,
                { parse_mode: 'HTML' }
            )
        } catch (e) {}
    }
    jalankanForward()
})

bot.command('bcpin', async (ctx) => {
    if (!ctx) return
    lastBotActivity = Date.now()
    if (ctx.from.id !== config.ownerId) return

    const messageToCopy = ctx.message.reply_to_message
    const rawText = ctx.message.text || ctx.message.caption || ''

    let textToSend = rawText
    const entities = ctx.message.entities || ctx.message.caption_entities || []
    const customEmojis = entities.filter(e => e.type === 'custom_emoji').sort((a, b) => b.offset - a.offset)

    for (const ent of customEmojis) {
        const emojiText = textToSend.substring(ent.offset, ent.offset + ent.length)
        const replacement = `<tg-emoji emoji-id="${ent.custom_emoji_id}">${emojiText}</tg-emoji>`
        textToSend = textToSend.substring(0, ent.offset) + replacement + textToSend.substring(ent.offset + ent.length)
    }

    textToSend = textToSend.replace(/^\/bcpin\b\s*/i, '').trim()
    const hasMedia = ctx.message.photo || ctx.message.video || ctx.message.document || ctx.message.audio || ctx.message.animation

    if (!messageToCopy && !textToSend && !hasMedia) {
        return ctx.reply(
            `<b>${EMOJIS.CROSS} Format: <code>/bcpin pesan</code> atau reply pesan.</b>`,
            { parse_mode: 'HTML' }
        )
    }

    const totalUsers = await User.countDocuments()
    const users = await User.find({}).select('userId').lean()

    await ctx.reply(`<b>${EMOJIS.REFRESH} Broadcast & Pin ke ${totalUsers} user...</b>`, { parse_mode: 'HTML' })

    const jalankanBroadcast = async () => {
        let sukses = 0
        let gagal = 0
        const BATCH_SIZE = 12

        for (let i = 0; i < users.length; i += BATCH_SIZE) {
            const batch = users.slice(i, i + BATCH_SIZE)

            await Promise.all(batch.map(async (user) => {
                try {
                    let sentMsg;
                    if (messageToCopy) {
                        if (bot && bot.telegram) sentMsg = await bot.telegram.copyMessage(user.userId, ctx.chat.id, messageToCopy.message_id)
                    } else if (hasMedia) {
                        if (bot && bot.telegram) sentMsg = await bot.telegram.copyMessage(user.userId, ctx.chat.id, ctx.message.message_id, { caption: textToSend, parse_mode: 'HTML' })
                    } else {
                        if (bot && bot.telegram) sentMsg = await bot.telegram.sendMessage(user.userId, textToSend, { parse_mode: 'HTML', disable_web_page_preview: true })
                    }
                    if (sentMsg && sentMsg.message_id && bot && bot.telegram) {
                        await bot.telegram.pinChatMessage(user.userId, sentMsg.message_id).catch(() => {})
                    }
                    sukses++
                } catch (e) {
                    gagal++
                }
            }))

            await new Promise(r => setTimeout(r, 1000))
        }

        logger.add('BROADCAST', `Broadcast PIN S: ${sukses}, G: ${gagal}`)

        try {
            if (bot && bot.telegram) await bot.telegram.sendMessage(config.ownerId,
                `<b>${EMOJIS.CHECK} Broadcast & Pin Selesai</b>\n\n<blockquote>Target: ${totalUsers}\n${EMOJIS.CHECK} Sukses: ${sukses}\n${EMOJIS.CROSS} Gagal: ${gagal}</blockquote>`,
                { parse_mode: 'HTML' }
            )
        } catch (e) {}
    }
    jalankanBroadcast()
})

bot.command('bcfdpin', async (ctx) => {
    if (!ctx) return
    lastBotActivity = Date.now()
    if (ctx.from.id !== config.ownerId) return

    const messageToForward = ctx.message.reply_to_message
    if (!messageToForward) {
        return ctx.reply(
            `<b>${EMOJIS.CROSS} Reply pesan lalu ketik <code>/bcfdpin</code></b>`,
            { parse_mode: 'HTML' }
        )
    }

    const totalUsers = await User.countDocuments()
    const users = await User.find({}).select('userId').lean()

    await ctx.reply(`<b>${EMOJIS.REFRESH} Forward & Pin ke ${totalUsers} user...</b>`, { parse_mode: 'HTML' })

    const jalankanForward = async () => {
        let sukses = 0
        let gagal = 0
        const BATCH_SIZE = 12

        for (let i = 0; i < users.length; i += BATCH_SIZE) {
            const batch = users.slice(i, i + BATCH_SIZE)

            await Promise.all(batch.map(async (user) => {
                try {
                    let sentMsg;
                    if (bot && bot.telegram) sentMsg = await bot.telegram.forwardMessage(user.userId, ctx.chat.id, messageToForward.message_id)
                    if (sentMsg && sentMsg.message_id && bot && bot.telegram) {
                        await bot.telegram.pinChatMessage(user.userId, sentMsg.message_id).catch(() => {})
                    }
                    sukses++
                } catch (e) {
                    gagal++
                }
            }))

            await new Promise(r => setTimeout(r, 1000))
        }

        logger.add('BROADCAST', `Forward PIN S: ${sukses}, G: ${gagal}`)

        try {
            if (bot && bot.telegram) await bot.telegram.sendMessage(config.ownerId,
                `<b>${EMOJIS.CHECK} Forward & Pin Selesai</b>\n\n<blockquote>Target: ${totalUsers}\n${EMOJIS.CHECK} Sukses: ${sukses}\n${EMOJIS.CROSS} Gagal: ${gagal}</blockquote>`,
                { parse_mode: 'HTML' }
            )
        } catch (e) {}
    }
    jalankanForward()
})

bot.command('unpinmassal', async (ctx) => {
    if (!ctx) return
    lastBotActivity = Date.now()
    if (ctx.from.id !== config.ownerId) return

    const totalUsers = await User.countDocuments()
    const users = await User.find({}).select('userId').lean()

    await ctx.reply(`<b>${EMOJIS.REFRESH} Melepas pin dari ${totalUsers} user...</b>`, { parse_mode: 'HTML' })

    const jalankanUnpin = async () => {
        let sukses = 0
        let gagal = 0
        const BATCH_SIZE = 25

        for (let i = 0; i < users.length; i += BATCH_SIZE) {
            const batch = users.slice(i, i + BATCH_SIZE)

            await Promise.all(batch.map(async (user) => {
                try {
                    if (bot && bot.telegram) {
                        await bot.telegram.unpinChatMessage(user.userId).catch(() => {})
                        sukses++
                    }
                } catch (e) {
                    gagal++
                }
            }))

            await new Promise(r => setTimeout(r, 1000))
        }

        logger.add('BROADCAST', `Unpin Massal S: ${sukses}, G: ${gagal}`)

        try {
            if (bot && bot.telegram) await bot.telegram.sendMessage(config.ownerId,
                `<b>${EMOJIS.CHECK} Unpin Selesai</b>\n\n<blockquote>Target: ${totalUsers}\n${EMOJIS.CHECK} Sukses: ${sukses}\n${EMOJIS.CROSS} Gagal: ${gagal}</blockquote>`,
                { parse_mode: 'HTML' }
            )
        } catch (e) {}
    }
    jalankanUnpin()
})

bot.command('delsession', async (ctx) => {
    if (String(ctx.from.id) !== String(config.ownerId)) return

    const text = ctx.message.text.trim().split(/\s+/)
    if (text.length < 2) {
        return ctx.reply(
            `<b>${EMOJIS.CROSS} Format: <code>/delsession [user_id / me]</code></b>`,
            { parse_mode: 'HTML' }
        )
    }

    let targetId = text[1]
    if (targetId.toLowerCase() === 'me') {
        targetId = ctx.from.id
    }

    try {
        await ctx.reply(`<b>${EMOJIS.TIME} Menghapus sesi: <code>${targetId}</code>...</b>`, { parse_mode: 'HTML' })

        if (WaManager.logout.length >= 2) {
            const activeSids = typeof WaManager.getActiveSessions === 'function'
                ? WaManager.getActiveSessions(targetId).map(s => s.sessionId)
                : [1]
            for (const sId of activeSids) {
                await WaManager.logout(targetId, sId)
            }
        } else {
            await WaManager.logout(targetId)
        }

        ctx.reply(`<b>${EMOJIS.CHECK} Sesi <code>${targetId}</code> berhasil dihapus.</b>`, { parse_mode: 'HTML' })
    } catch (err) {
        ctx.reply(`<b>${EMOJIS.CROSS} Gagal: ${err.message}</b>`, { parse_mode: 'HTML' })
    }
})

bot.command(['cekjoin', 'join'], async (ctx) => {
    if (!ctx) return;
    lastBotActivity = Date.now();
    const joinStatus = await isJoined(ctx);
    if (!joinStatus.allJoined) return await showMainMenu(ctx);
    delete userState[ctx.from.id];

    const args = ctx.message.text.trim().split(/\s+/);
    if (args.length > 1) {
        const num = args[1].replace(/\D/g, '');
        if (num.length >= 7) {
            const waitMsg = await ctx.reply(`<b>${EMOJIS.TIME} Memeriksa status join & bio real-time...</b>`, { parse_mode: 'HTML' });
            try {
                const res = await WaManager.checkJoinedAndBio(num, ctx.from.id);
                await bot.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
                if (!res.isRegistered) {
                    return ctx.reply(`<b>${EMOJIS.CROSS} Nomor <code>+${num}</code> tidak terdaftar di WhatsApp.</b>`, { parse_mode: 'HTML' });
                }

                await User.updateOne({ userId: ctx.from.id }, {
                    $inc: { totalChecked: 1 },
                    $set: { lastInteraction: Date.now() }
                }).catch(() => {});
                await Setting.findOneAndUpdate(
                    { key: "total_checked_all" },
                    { $inc: { value: 1 } },
                    { upsert: true }
                ).catch(() => {});
                userCache.delete(ctx.from.id);

                const out = `<b>${EMOJIS.CHECK} DETAIL JOIN & BIO REAL-TIME</b>\n\n` +
                    `<blockquote>Nomor: <code>+${res.number}</code>\n` +
                    `Tipe Akun: <b>${res.isBusiness ? 'Bisnis' : 'Personal'}</b>\n` +
                    `Gabung WA (Since): <code>${res.joinSince}</code>\n` +
                    `Tanggal Set Bio: <code>${res.bioSetDate}</code>\n` +
                    `Bio: <i>${escapeHTML(res.bio)}</i></blockquote>`;

                return ctx.reply(out, {
                    parse_mode: 'HTML',
                    reply_markup: { inline_keyboard: [[{ text: 'KEMBALI', callback_data: 'back_home', icon_custom_emoji_id: EMOJI_IDS.BACK }]] }
                });
            } catch (err) {
                await bot.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
                return ctx.reply(`<b>${EMOJIS.CROSS} Gagal: ${err.message}</b>`, { parse_mode: 'HTML' });
            }
        }
    }

    const textMenu = `<b>${EMOJIS.SEARCH} CEK JOIN & BIO REAL-TIME</b>\n\n` +
        `<blockquote>Kirim nomor WhatsApp untuk mengecek tanggal pertama kali nomor gabung ke WA dan tanggal real-time bio diset.\n\n` +
        `Format: <code>628xxx</code> atau ketik <code>/cekjoin 628xxx</code></blockquote>`;

    const sent = await ctx.reply(textMenu, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: 'KEMBALI', callback_data: 'back_home', icon_custom_emoji_id: EMOJI_IDS.BACK }]] }
    });
    userState[ctx.from.id] = { status: 'WAITING_CEK_JOIN', menuId: sent.message_id };
});

bot.command(['cekmerah', 'flag', 'flagmerah', 'fixmerah'], async (ctx) => {
    if (!ctx) return;
    lastBotActivity = Date.now();
    const joinStatus = await isJoined(ctx);
    if (!joinStatus.allJoined) return await showMainMenu(ctx);
    delete userState[ctx.from.id];

    const args = ctx.message.text.trim().split(/\s+/);
    if (args.length > 1) {
        const num = args[1].replace(/\D/g, '');
        if (num.length >= 7) {
            const waitMsg = await ctx.reply(`<b>${EMOJIS.TIME} Memeriksa status flag merah nomor...</b>`, { parse_mode: 'HTML' });
            try {
                const res = await WaManager.checkFlagMerah(num, ctx.from.id);
                await bot.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});

                await User.updateOne({ userId: ctx.from.id }, {
                    $inc: { totalChecked: 1 },
                    $set: { lastInteraction: Date.now() }
                }).catch(() => {});
                await Setting.findOneAndUpdate(
                    { key: "total_checked_all" },
                    { $inc: { value: 1 } },
                    { upsert: true }
                ).catch(() => {});
                userCache.delete(ctx.from.id);

                const indText = res.indicators.map(i => `• ${i}`).join('\n');
                const out = `<b>${EMOJIS.SEARCH} HASIL CEK FLAG MERAH WHATSAPP</b>\n\n` +
                    `<blockquote>Nomor: <code>+${res.number}</code>\n` +
                    `Status: <b>${res.flagLabel}</b>\n\n` +
                    `Penjelasan:\n<i>${res.flagDescription}</i>\n\n` +
                    `Indikator Deteksi:\n${indText}</blockquote>`;

                return ctx.reply(out, {
                    parse_mode: 'HTML',
                    reply_markup: { inline_keyboard: [[{ text: 'KEMBALI', callback_data: 'back_home', icon_custom_emoji_id: EMOJI_IDS.BACK }]] }
                });
            } catch (err) {
                await bot.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
                return ctx.reply(`<b>${EMOJIS.CROSS} Gagal: ${err.message}</b>`, { parse_mode: 'HTML' });
            }
        }
    }

    const textMenu = `<b>${EMOJIS.SEARCH} CEK FLAG MERAH / NOMOR DITANDAI WA</b>\n\n` +
        `<blockquote>Kirim nomor WhatsApp untuk mendeteksi apakah nomor terkena tanda merah (Banned, CBS, Shadow-flag, Cooldown):\n\n` +
        `Format: <code>628xxx</code> atau ketik <code>/cekmerah 628xxx</code></blockquote>`;

    const sent = await ctx.reply(textMenu, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: 'KEMBALI', callback_data: 'back_home', icon_custom_emoji_id: EMOJI_IDS.BACK }]] }
    });
    userState[ctx.from.id] = { status: 'WAITING_CEK_MERAH', menuId: sent.message_id };
});

bot.command('backup', async (ctx) => {
    if (!ctx) return;
    lastBotActivity = Date.now();
    if (String(ctx.from.id) !== String(config.ownerId)) return;

    let statusMsg;
    try {
        statusMsg = await ctx.reply(`<b>${EMOJIS.TIME} Mengompres file project...</b>`, { parse_mode: 'HTML' });
    } catch (_) {}

    try {
        const backup = await createProjectBackup();

        const caption = `<b>${EMOJIS.BACKUP} BACKUP PROJECT</b>\n\n<blockquote>File: <code>${backup.fileName}</code>\nUkuran: <code>${backup.fileSize}</code> (${backup.fileCount} file)\nWaktu: ${formatWaktuGaul()}</blockquote>`;

        await ctx.replyWithDocument(
            { source: backup.buffer, filename: backup.fileName },
            { caption: caption, parse_mode: 'HTML' }
        );

        if (statusMsg && statusMsg.message_id) {
            await ctx.deleteMessage(statusMsg.message_id).catch(() => {});
        }
        logger.add('SYSTEM', `Backup sent (${backup.fileName} - ${backup.fileSize})`);
    } catch (err) {
        logger.add('ERROR', `Backup failed: ${err.message}`, err.stack);
        const errMsg = `<b>${EMOJIS.CROSS} Gagal membuat backup: ${escapeHTML(err.message)}</b>`;
        if (statusMsg && statusMsg.message_id) {
            await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, null, errMsg, { parse_mode: 'HTML' }).catch(() => {});
        } else {
            await ctx.reply(errMsg, { parse_mode: 'HTML' });
        }
    }
});

bot.command(['ownermenu', 'owner', 'panel'], async (ctx) => {
    if (!ctx) return;
    lastBotActivity = Date.now();
    if (String(ctx.from.id) !== String(config.ownerId)) return;

    await ctx.deleteMessage().catch(() => {});
    if (userState[ctx.from.id]) delete userState[ctx.from.id];
    const { text, keyboard } = await getMainOwnerMenuMessage();
    await ctx.reply(text, { parse_mode: 'HTML', disable_web_page_preview: true, ...keyboard });
});

bot.command(['fsub', 'wajibjoin'], async (ctx) => {
    if (!ctx) return;
    lastBotActivity = Date.now();
    if (String(ctx.from.id) !== String(config.ownerId)) return;

    await ctx.deleteMessage().catch(() => {});
    delete userState[ctx.from.id];
    const { text, keyboard } = await getForceSubMenuMessage();
    await ctx.reply(text, { parse_mode: 'HTML', disable_web_page_preview: true, ...keyboard });
});

bot.command('addfsub', async (ctx) => {
    if (!ctx) return;
    lastBotActivity = Date.now();
    if (String(ctx.from.id) !== String(config.ownerId)) return;

    await ctx.deleteMessage().catch(() => {});
    const args = ctx.message.text.trim().split(/\s+/);
    if (args.length < 2) {
        const promptMsg = await ctx.reply(
            `<b>${EMOJIS.PLUS} TAMBAH CHANNEL WAJIB JOIN</b>\n\n` +
            `<blockquote>Format: <code>/addfsub @channel</code> atau kirim username/ID channel target.</blockquote>`,
            {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [[{ text: "BATAL", callback_data: "owner_fsub_cancel", icon_custom_emoji_id: EMOJI_IDS.CROSS }]]
                }
            }
        );
        userState[ctx.from.id] = { status: "WAITING_FSUB_ADD", menuId: promptMsg.message_id };
        return;
    }

    let target = args[1].trim();
    if (target.startsWith("https://t.me/")) {
        const after = target.replace("https://t.me/", "");
        if (!after.startsWith("+") && !after.startsWith("joinchat/")) {
            target = "@" + after.split("/")[0].replace(/^@/, "");
        }
    } else if (!target.startsWith("-100") && !target.startsWith("@") && !isNaN(target)) {
        target = "-100" + target;
    } else if (!target.startsWith("-100") && !target.startsWith("@")) {
        target = "@" + target;
    }

    const waitMsg = await ctx.reply(`<b>${EMOJIS.TIME} Memvalidasi channel/grup...</b>`, { parse_mode: "HTML" });

    try {
        const chatInfo = await bot.telegram.getChat(target);
        const chatId = chatInfo.id;
        const title = chatInfo.title || chatInfo.username || "Channel";
        const username = chatInfo.username ? `@${chatInfo.username}` : "";

        let inviteLink = "";
        if (chatInfo.username) {
            inviteLink = `https://t.me/${chatInfo.username}`;
        } else if (chatInfo.invite_link) {
            inviteLink = chatInfo.invite_link;
        } else {
            try {
                inviteLink = await bot.telegram.exportChatInviteLink(chatId);
            } catch (_) {}
        }

        let isBotAdmin = false;
        try {
            const me = await bot.telegram.getMe();
            const botMember = await bot.telegram.getChatMember(chatId, me.id);
            isBotAdmin = ["creator", "administrator"].includes(botMember.status);
        } catch (e) {}

        if (!Array.isArray(global.forceSubChannels)) global.forceSubChannels = [];

        const alreadyExists = global.forceSubChannels.some(c =>
            String(c.id) === String(chatId) ||
            (c.username && username && c.username.toLowerCase() === username.toLowerCase())
        );

        if (alreadyExists) {
            await bot.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
            return ctx.reply(`<b>${EMOJIS.WARN} Channel <b>${escapeHTML(title)}</b> sudah terdaftar!</b>`, { parse_mode: 'HTML' });
        }

        const newChannelObj = {
            id: chatId,
            title: title,
            username: username,
            inviteLink: inviteLink || (username ? `https://t.me/${username.replace(/^@/, '')}` : ""),
            addedAt: Date.now()
        };

        global.forceSubChannels.push(newChannelObj);

        await Setting.findOneAndUpdate(
            { key: "force_sub_channels" },
            { value: global.forceSubChannels },
            { upsert: true }
        );

        if (typeof clearJoinCache === "function") clearJoinCache();

        await bot.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});

        let adminNote = isBotAdmin
            ? `\n${EMOJIS.CHECK} Status: <b>Bot adalah Admin</b>`
            : `\n${EMOJIS.WARN} Status: <b>Bot BELUM Admin</b> (Pastikan jadikan bot admin!)`;

        return ctx.reply(
            `<b>${EMOJIS.CHECK} CHANNEL BERHASIL DITAMBAHKAN!</b>\n\n` +
            `<blockquote>Nama: <b>${escapeHTML(title)}</b>\nID: <code>${chatId}</code>\nUsername: ${username || '<i>Privat</i>'}${adminNote}</blockquote>`,
            {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [[{ text: "MENU WAJIB JOIN", callback_data: "owner_fsub_menu", icon_custom_emoji_id: EMOJI_IDS.GLOBE }]]
                }
            }
        );
    } catch (err) {
        await bot.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
        return ctx.reply(`<b>${EMOJIS.CROSS} Gagal: ${escapeHTML(err.message)}</b>`, { parse_mode: 'HTML' });
    }
});

bot.command('delfsub', async (ctx) => {
    if (!ctx) return;
    lastBotActivity = Date.now();
    if (String(ctx.from.id) !== String(config.ownerId)) return;

    await ctx.deleteMessage().catch(() => {});
    const args = ctx.message.text.trim().split(/\s+/);
    if (args.length < 2) {
        return ctx.reply(
            `<b>${EMOJIS.CROSS} Format: <code>/delfsub ID_atau_username</code>\nAtau kelola via tombol di /fsub</b>`,
            { parse_mode: 'HTML' }
        );
    }

    const query = args[1].trim().toLowerCase().replace(/^@/, '');
    const initialLen = (global.forceSubChannels || []).length;
    global.forceSubChannels = (global.forceSubChannels || []).filter(c => {
        const cId = String(c.id || '').toLowerCase();
        const cUname = String(c.username || '').toLowerCase().replace(/^@/, '');
        return cId !== query && cUname !== query;
    });

    if (global.forceSubChannels.length === initialLen) {
        return ctx.reply(`<b>${EMOJIS.CROSS} Channel dengan identifier <code>${escapeHTML(args[1])}</code> tidak ditemukan.</b>`, { parse_mode: 'HTML' });
    }

    await Setting.findOneAndUpdate(
        { key: "force_sub_channels" },
        { value: global.forceSubChannels },
        { upsert: true }
    );
    if (typeof clearJoinCache === "function") clearJoinCache();

    return ctx.reply(`<b>${EMOJIS.CHECK} Channel berhasil dihapus dari daftar wajib join!</b>`, { parse_mode: 'HTML' });
});

bot.command('togglefsub', async (ctx) => {
    if (!ctx) return;
    lastBotActivity = Date.now();
    if (String(ctx.from.id) !== String(config.ownerId)) return;

    await ctx.deleteMessage().catch(() => {});
    global.IS_FORCE_SUB_ENABLED = !global.IS_FORCE_SUB_ENABLED;
    await Setting.findOneAndUpdate(
        { key: "force_sub_enabled" },
        { value: global.IS_FORCE_SUB_ENABLED },
        { upsert: true }
    );
    if (typeof clearJoinCache === "function") clearJoinCache();

    return ctx.reply(
        `<b>${EMOJIS.GLOBE} Fitur Wajib Join: ${global.IS_FORCE_SUB_ENABLED ? `${EMOJIS.CHECK} AKTIF` : `${EMOJIS.CROSS} NONAKTIF`}</b>`,
        { parse_mode: 'HTML' }
    );
});

bot.command(['logprem', 'logpremium'], async (ctx) => {
    if (!ctx) return;
    lastBotActivity = Date.now();
    if (String(ctx.from.id) !== String(config.ownerId)) return;

    await ctx.deleteMessage().catch(() => {});
    if (userState[ctx.from.id]) delete userState[ctx.from.id];
    const { text, keyboard } = await getOwnerPremiumLogsMessage();
    await ctx.reply(text, { parse_mode: 'HTML', disable_web_page_preview: true, ...keyboard });
});

bot.command(['leaderboard', 'top', 'lb'], async (ctx) => {
    if (!ctx) return;
    lastBotActivity = Date.now();
    const joinStatus = await isJoined(ctx);
    if (!joinStatus.allJoined) return await showMainMenu(ctx);
    delete userState[ctx.from.id];

    await checkUser(ctx.from.id, ctx.from);
    const { text, keyboard } = await getLeaderboardMessage(ctx.from.id);
    await ctx.reply(text, { parse_mode: 'HTML', ...keyboard });
});

bot.command(['statistik', 'stats', 'status'], async (ctx) => {
    if (!ctx) return;
    lastBotActivity = Date.now();
    const joinStatus = await isJoined(ctx);
    if (!joinStatus.allJoined) return await showMainMenu(ctx);
    delete userState[ctx.from.id];

    await checkUser(ctx.from.id, ctx.from);
    const { text, keyboard } = await getDetailedStatsMessage(ctx.from.id);
    await ctx.reply(text, { parse_mode: 'HTML', ...keyboard });
});

bot.command(['panduan', 'help', 'guide'], async (ctx) => {
    if (!ctx) return;
    lastBotActivity = Date.now();
    const joinStatus = await isJoined(ctx);
    if (!joinStatus.allJoined) return await showMainMenu(ctx);
    delete userState[ctx.from.id];

    const { text, keyboard } = getPanduanMessage('main');
    await ctx.reply(text, { parse_mode: 'HTML', ...keyboard });
});

bot.command(['buyprem', 'premium', 'beli'], async (ctx) => {
    if (!ctx) return;
    lastBotActivity = Date.now();
    const joinStatus = await isJoined(ctx);
    if (!joinStatus.allJoined) return await showMainMenu(ctx);
    delete userState[ctx.from.id];

    await checkUser(ctx.from.id, ctx.from);
    const { text, keyboard } = getBuyPremiumMenu(ctx.from.id);
    await ctx.reply(text, { parse_mode: 'HTML', ...keyboard });
});

bot.command(['referral', 'reff', 'ref', 'invite'], async (ctx) => {
    if (!ctx) return;
    lastBotActivity = Date.now();
    const joinStatus = await isJoined(ctx);
    if (!joinStatus.allJoined) return await showMainMenu(ctx);
    delete userState[ctx.from.id];

    const user = await checkUser(ctx.from.id, ctx.from);
    const { text, keyboard } = getReferralMenu(user);
    await ctx.reply(text, { parse_mode: 'HTML', ...keyboard });
});

bot.command('setprem', async (ctx) => {
    if (String(ctx.from.id) !== String(config.ownerId)) return;
    await ctx.deleteMessage().catch(() => {});
    const args = ctx.message.text.split(' ');
    if (args.length < 3) {
        return ctx.reply(`<b>${EMOJIS.CROSS} Format: <code>/setprem ID_USER JUMLAH_HARI</code>\nContoh: <code>/setprem 1234567 30</code> atau <code>/setprem 1234567 lifetime</code></b>`, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [[{ text: 'KEMBALI KE KELOLA PREMIUM', callback_data: 'owner_menu_premium', icon_custom_emoji_id: EMOJI_IDS.BACK }]] }
        });
    }

    const targetId = parseInt(args[1]);
    const durationArg = args[2].toLowerCase();
    const days = durationArg === 'lifetime' || durationArg === 'permanen' ? 3650 : parseInt(durationArg);

    if (isNaN(days) || days <= 0) {
        return ctx.reply(`<b>${EMOJIS.CROSS} Jumlah hari tidak valid.</b>`, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [[{ text: 'KEMBALI KE KELOLA PREMIUM', callback_data: 'owner_menu_premium', icon_custom_emoji_id: EMOJI_IDS.BACK }]] }
        });
    }

    const targetUser = await User.findOne({ userId: targetId });
    if (!targetUser) {
        return ctx.reply(`<b>${EMOJIS.CROSS} User <code>${targetId}</code> tidak ditemukan di database.</b>`, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [[{ text: 'KEMBALI KE KELOLA PREMIUM', callback_data: 'owner_menu_premium', icon_custom_emoji_id: EMOJI_IDS.BACK }]] }
        });
    }

    await PaymentManager.activatePremium(targetId, days, 'MANUAL-BY-OWNER', `Manual Owner (${days >= 3650 ? 'Lifetime' : days + ' Hari'})`);
    return ctx.reply(`<b>${EMOJIS.CHECK} Sukses memberikan akses PREMIUM kepada <code>${targetId}</code> selama <b>${days >= 3650 ? 'Permanen' : days + ' Hari'}</b>!</b>`, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: 'KEMBALI KE KELOLA PREMIUM', callback_data: 'owner_menu_premium', icon_custom_emoji_id: EMOJI_IDS.BACK }]] }
    });
});

bot.command('delprem', async (ctx) => {
    if (String(ctx.from.id) !== String(config.ownerId)) return;
    await ctx.deleteMessage().catch(() => {});
    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
        return ctx.reply(`<b>${EMOJIS.CROSS} Format: <code>/delprem ID_USER</code></b>`, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [[{ text: 'KEMBALI KE KELOLA PREMIUM', callback_data: 'owner_menu_premium', icon_custom_emoji_id: EMOJI_IDS.BACK }]] }
        });
    }

    const targetId = parseInt(args[1]);
    const result = await User.findOneAndUpdate(
        { userId: targetId },
        { $set: { premium: false, premiumUntil: null, limit: 5 } }
    );
    if (!result) return ctx.reply(`<b>${EMOJIS.CROSS} User <code>${targetId}</code> tidak ditemukan.</b>`, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: 'KEMBALI KE KELOLA PREMIUM', callback_data: 'owner_menu_premium', icon_custom_emoji_id: EMOJI_IDS.BACK }]] }
    });
    if (global.userCache) global.userCache.delete(targetId);

    return ctx.reply(`<b>${EMOJIS.CHECK} Akses Premium user <code>${targetId}</code> berhasil dicabut.</b>`, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: 'KEMBALI KE KELOLA PREMIUM', callback_data: 'owner_menu_premium', icon_custom_emoji_id: EMOJI_IDS.BACK }]] }
    });
});

bot.command('addlimit', async (ctx) => {
    if (String(ctx.from.id) !== String(config.ownerId)) return;
    await ctx.deleteMessage().catch(() => {});
    const args = ctx.message.text.split(' ');
    if (args.length < 3) {
        return ctx.reply(`<b>${EMOJIS.CROSS} Format: <code>/addlimit ID_USER JUMLAH</code></b>`, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [[{ text: 'KEMBALI KE KELOLA USER', callback_data: 'owner_menu_users', icon_custom_emoji_id: EMOJI_IDS.BACK }]] }
        });
    }

    const targetId = parseInt(args[1]);
    const amount = parseInt(args[2]);
    if (isNaN(amount)) return ctx.reply(`<b>${EMOJIS.CROSS} Jumlah limit harus berupa angka.</b>`, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: 'KEMBALI KE KELOLA USER', callback_data: 'owner_menu_users', icon_custom_emoji_id: EMOJI_IDS.BACK }]] }
    });

    const result = await User.findOneAndUpdate(
        { userId: targetId },
        { $inc: { limit: amount } },
        { new: true }
    );
    if (!result) return ctx.reply(`<b>${EMOJIS.CROSS} User <code>${targetId}</code> tidak ditemukan.</b>`, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: 'KEMBALI KE KELOLA USER', callback_data: 'owner_menu_users', icon_custom_emoji_id: EMOJI_IDS.BACK }]] }
    });
    if (global.userCache) global.userCache.delete(targetId);

    return ctx.reply(`<b>${EMOJIS.CHECK} Berhasil menambah <b>${amount}</b> limit ke <code>${targetId}</code>. Total sekarang: <b>${result.limit}</b>.</b>`, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: 'KEMBALI KE KELOLA USER', callback_data: 'owner_menu_users', icon_custom_emoji_id: EMOJI_IDS.BACK }]] }
    });
});

bot.command('setlimit', async (ctx) => {
    if (String(ctx.from.id) !== String(config.ownerId)) return;
    await ctx.deleteMessage().catch(() => {});
    const args = ctx.message.text.split(' ');
    if (args.length < 3) {
        return ctx.reply(`<b>${EMOJIS.CROSS} Format: <code>/setlimit ID_USER JUMLAH</code></b>`, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [[{ text: 'KEMBALI KE KELOLA USER', callback_data: 'owner_menu_users', icon_custom_emoji_id: EMOJI_IDS.BACK }]] }
        });
    }

    const targetId = parseInt(args[1]);
    const amount = parseInt(args[2]);
    if (isNaN(amount)) return ctx.reply(`<b>${EMOJIS.CROSS} Jumlah limit harus berupa angka.</b>`, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: 'KEMBALI KE KELOLA USER', callback_data: 'owner_menu_users', icon_custom_emoji_id: EMOJI_IDS.BACK }]] }
    });

    const result = await User.findOneAndUpdate(
        { userId: targetId },
        { $set: { limit: amount } },
        { new: true }
    );
    if (!result) return ctx.reply(`<b>${EMOJIS.CROSS} User <code>${targetId}</code> tidak ditemukan.</b>`, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: 'KEMBALI KE KELOLA USER', callback_data: 'owner_menu_users', icon_custom_emoji_id: EMOJI_IDS.BACK }]] }
    });
    if (global.userCache) global.userCache.delete(targetId);

    return ctx.reply(`<b>${EMOJIS.CHECK} Berhasil mengubah limit <code>${targetId}</code> menjadi <b>${result.limit}</b>.</b>`, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: 'KEMBALI KE KELOLA USER', callback_data: 'owner_menu_users', icon_custom_emoji_id: EMOJI_IDS.BACK }]] }
    });
});

bot.command('cekuser', async (ctx) => {
    if (String(ctx.from.id) !== String(config.ownerId)) return;
    await ctx.deleteMessage().catch(() => {});
    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
        return ctx.reply(`<b>${EMOJIS.CROSS} Format: <code>/cekuser ID_USER</code></b>`, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [[{ text: 'KEMBALI KE KELOLA USER', callback_data: 'owner_menu_users', icon_custom_emoji_id: EMOJI_IDS.BACK }]] }
        });
    }

    const targetId = parseInt(args[1]);
    const u = await User.findOne({ userId: targetId }).lean();
    if (!u) return ctx.reply(`<b>${EMOJIS.CROSS} User <code>${targetId}</code> tidak ditemukan.</b>`, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: 'KEMBALI KE KELOLA USER', callback_data: 'owner_menu_users', icon_custom_emoji_id: EMOJI_IDS.BACK }]] }
    });

    const formatWaktu = typeof formatWaktuGaul === 'function' ? formatWaktuGaul : (d) => new Date(d).toLocaleString('id-ID');
    const expStr = u.premium ? (u.premiumUntil ? formatWaktu(new Date(u.premiumUntil)) : 'LIFETIME') : 'BUKAN PREMIUM';

    const info = `<b>${EMOJIS.USER} DETAIL PENGGUNA</b>

<blockquote>ID: <code>${u.userId}</code>
Nama: <b>${escapeHTML(u.firstName || '-')}</b>
Username: <b>${u.username ? '@' + u.username : '-'}</b>
Status: <b>${u.premium ? `${EMOJIS.PREMIUM} PREMIUM` : `${EMOJIS.FREE} FREE`}</b>
Masa Aktif: <b>${expStr}</b>
Sisa Limit: <b>${u.limit ?? 5}</b>
Kode Reff: <code>${u.refCode || '-'}</code>
Total Diundang: <b>${u.referralCount || 0} orang</b>
Diundang Oleh: <code>${u.invitedBy || '-'}</code>
Total Cek: <b>${u.totalChecked || 0}</b> (Detect: ${u.totalDetect || 0}, Limitin: ${u.totalLimitin || 0})
Banned: <b>${u.isBanned ? 'YA' : 'TIDAK'}</b></blockquote>`;

    return ctx.reply(info, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: 'KEMBALI KE KELOLA USER', callback_data: 'owner_menu_users', icon_custom_emoji_id: EMOJI_IDS.BACK }]] }
    });
});

bot.command('redeem', async (ctx) => {
    if (!ctx) return;
    lastBotActivity = Date.now();
    const joinStatus = await isJoined(ctx);
    if (!joinStatus.allJoined) return await showMainMenu(ctx);
    delete userState[ctx.from.id];

    const args = ctx.message.text.trim().split(/\s+/);
    if (args.length < 2) {
        userState[ctx.from.id] = { status: "WAITING_REDEEM_CODE" };
        const { text, keyboard } = getRedeemMenuMessage();
        return ctx.reply(text, { parse_mode: "HTML", ...keyboard });
    }

    const cleanCode = args[1].trim().toUpperCase();
    const item = await RedeemCode.findOne({ code: cleanCode });

    if (!item) {
        return ctx.reply(
            `<b>${EMOJIS.CROSS} KODE TIDAK DITEMUKAN</b>\n\n<blockquote>Kode redeem <code>${escapeHTML(cleanCode)}</code> tidak valid atau sudah kadaluarsa.</blockquote>`,
            { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: 'KEMBALI', callback_data: 'back_home', icon_custom_emoji_id: EMOJI_IDS.BACK }]] } }
        );
    }

    if (item.maxUses > 0 && item.usedCount >= item.maxUses) {
        return ctx.reply(
            `<b>${EMOJIS.CROSS} KUOTA KODE HABIS</b>\n\n<blockquote>Kuota penukaran kode promo <code>${escapeHTML(cleanCode)}</code> telah habis (${item.maxUses} pengguna).</blockquote>`,
            { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: 'KEMBALI', callback_data: 'back_home', icon_custom_emoji_id: EMOJI_IDS.BACK }]] } }
        );
    }

    if (Array.isArray(item.usedBy) && item.usedBy.some(u => String(u.userId) === String(ctx.from.id))) {
        return ctx.reply(
            `<b>${EMOJIS.WARN} KODE SUDAH PERNAH DIKLAIM</b>\n\n<blockquote>Anda sudah pernah mengklaim kode redeem <code>${escapeHTML(cleanCode)}</code>. Setiap akun hanya berhak 1x klaim.</blockquote>`,
            { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: 'KEMBALI', callback_data: 'back_home', icon_custom_emoji_id: EMOJI_IDS.BACK }]] } }
        );
    }

    const uObj = await checkUser(ctx.from.id, ctx.from);
    if (!Array.isArray(item.usedBy)) item.usedBy = [];
    item.usedBy.push({
        userId: ctx.from.id,
        username: ctx.from.username || '',
        usedAt: Date.now()
    });
    item.usedCount = (item.usedCount || 0) + 1;
    await item.save();

    if (item.type === 'limit') {
        const addAmt = Number(item.amount) || 1;
        const newLim = (Number(uObj.limit) || 0) + addAmt;
        await User.updateOne({ userId: ctx.from.id }, { $set: { limit: newLim, lastInteraction: Date.now() } });
        if (global.userCache) global.userCache.delete(ctx.from.id);

        return ctx.reply(
            `<b>${EMOJIS.CHECK} KODE REDEEM BERHASIL DIKLAIM!</b>\n\n<blockquote>Kode: <code>${escapeHTML(cleanCode)}</code>\nHadiah: <b>+${addAmt} Limit Cek</b>\nTotal Kuota Limit: <b>${newLim}</b></blockquote>`,
            { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: 'MENU UTAMA', callback_data: 'back_home', icon_custom_emoji_id: EMOJI_IDS.BOT }]] } }
        );
    } else {
        const days = Number(item.amount) || 1;
        await PaymentManager.activatePremium(
            ctx.from.id,
            days,
            `REDEEM-${cleanCode}`,
            `Redeem Code (${days >= 3650 ? 'Lifetime' : days + ' Hari'})`
        );
        if (global.userCache) global.userCache.delete(ctx.from.id);

        return ctx.reply(
            `<b>${EMOJIS.CHECK} KODE REDEEM BERHASIL DIKLAIM!</b>\n\n<blockquote>Kode: <code>${escapeHTML(cleanCode)}</code>\nHadiah: <b>Akun PREMIUM (${days >= 3650 ? 'Permanen' : days + ' Hari'})</b>\nStatus: <b>AKTIF SEKARANG</b></blockquote>`,
            { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: 'MENU UTAMA', callback_data: 'back_home', icon_custom_emoji_id: EMOJI_IDS.BOT }]] } }
        );
    }
});

bot.command('createcode', async (ctx) => {
    if (!ctx) return;
    lastBotActivity = Date.now();
    if (String(ctx.from.id) !== String(config.ownerId)) return;

    await ctx.deleteMessage().catch(() => {});
    const args = ctx.message.text.trim().split(/\s+/);
    if (args.length < 3) {
        return ctx.reply(
            `<b>${EMOJIS.CROSS} Format: <code>/createcode [prem/limit] [jumlah] [max_uses] [kode_opsional]</code>\n\n` +
            `Contoh:\n` +
            `• <code>/createcode prem 7 10 BONUS7HARI</code> (7 hari, 10 orang)\n` +
            `• <code>/createcode limit 10 20 FREELIMIT</code> (+10 limit, 20 orang)\n` +
            `• <code>/createcode prem lifetime 1</code> (Permanen 1 orang)</b>`,
            {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [[{ text: "KEMBALI KE REDEEM PANEL", callback_data: "owner_menu_redeem", icon_custom_emoji_id: EMOJI_IDS.BACK }]]
                }
            }
        );
    }

    const typeArg = args[1].toLowerCase();
    const isPrem = typeArg === 'prem' || typeArg === 'premium';
    const isLimit = typeArg === 'limit';

    if (!isPrem && !isLimit) {
        return ctx.reply(`<b>${EMOJIS.CROSS} Tipe harus berupa <code>prem</code> atau <code>limit</code>.</b>`, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [[{ text: "KEMBALI KE REDEEM PANEL", callback_data: "owner_menu_redeem", icon_custom_emoji_id: EMOJI_IDS.BACK }]]
            }
        });
    }

    const type = isPrem ? 'premium' : 'limit';
    const amtArg = args[2].toLowerCase();
    const amount = (isPrem && (amtArg === 'lifetime' || amtArg === 'permanen')) ? 3650 : parseInt(amtArg);

    if (isNaN(amount) || amount <= 0) {
        return ctx.reply(`<b>${EMOJIS.CROSS} Jumlah tidak valid.</b>`, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [[{ text: "KEMBALI KE REDEEM PANEL", callback_data: "owner_menu_redeem", icon_custom_emoji_id: EMOJI_IDS.BACK }]]
            }
        });
    }

    const maxUses = args.length >= 4 ? parseInt(args[3]) : 1;
    if (isNaN(maxUses) || maxUses < 0) {
        return ctx.reply(`<b>${EMOJIS.CROSS} Maksimal penggunaan harus berupa angka (0 = unlimited).</b>`, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [[{ text: "KEMBALI KE REDEEM PANEL", callback_data: "owner_menu_redeem", icon_custom_emoji_id: EMOJI_IDS.BACK }]]
            }
        });
    }

    let code = args.length >= 5 ? args[4].trim().toUpperCase() : '';
    if (!code) {
        const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
        code = `${isPrem ? 'PREM' : 'LIM'}-${rand}`;
    }

    const existing = await RedeemCode.findOne({ code });
    if (existing) {
        return ctx.reply(`<b>${EMOJIS.CROSS} Kode <code>${escapeHTML(code)}</code> sudah ada di database. Silakan gunakan kode lain.</b>`, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [[{ text: "KEMBALI KE REDEEM PANEL", callback_data: "owner_menu_redeem", icon_custom_emoji_id: EMOJI_IDS.BACK }]]
            }
        });
    }

    const newCode = new RedeemCode({
        code,
        type,
        amount,
        maxUses,
        usedCount: 0,
        usedBy: [],
        createdAt: Date.now(),
        createdBy: ctx.from.id
    });
    await newCode.save();

    const maxStr = maxUses === 0 ? 'Unlimited' : `${maxUses} pengguna`;
    const hadiahStr = isPrem ? `${amount >= 3650 ? 'Lifetime' : amount + ' Hari'} Premium` : `+${amount} Kuota Limit`;

    return ctx.reply(
        `<b>${EMOJIS.CHECK} KODE REDEEM BERHASIL DIBUAT!</b>\n\n` +
        `<blockquote>Kode: <code>${escapeHTML(code)}</code>\n` +
        `Tipe: <b>${isPrem ? 'Akun Premium' : 'Limit Pengecekan'}</b>\n` +
        `Hadiah: <b>${hadiahStr}</b>\n` +
        `Kuota Penggunaan: <b>${maxStr}</b></blockquote>`,
        {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: "KEMBALI KE REDEEM PANEL", callback_data: "owner_menu_redeem", icon_custom_emoji_id: EMOJI_IDS.BACK }]
                ]
            }
        }
    );
});

bot.command('listcode', async (ctx) => {
    if (!ctx) return;
    lastBotActivity = Date.now();
    if (String(ctx.from.id) !== String(config.ownerId)) return;

    await ctx.deleteMessage().catch(() => {});
    const codes = await RedeemCode.find({}).sort({ createdAt: -1 }).lean();
    if (codes.length === 0) {
        return ctx.reply(`<b>${EMOJIS.NOTE} Belum ada kode redeem yang dibuat.</b>`, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: "KEMBALI KE REDEEM PANEL", callback_data: "owner_menu_redeem", icon_custom_emoji_id: EMOJI_IDS.BACK }]
                ]
            }
        });
    }

    const listText = codes.map((c, idx) => {
        const typeLabel = c.type === 'premium' ? 'PREMIUM' : 'LIMIT';
        const valLabel = c.type === 'premium' ? (c.amount >= 3650 ? 'Lifetime' : `${c.amount} Hari`) : `+${c.amount} Limit`;
        const quotaLabel = c.maxUses === 0 ? `${c.usedCount}/∞` : `${c.usedCount}/${c.maxUses}`;
        return `<b>#${idx + 1} • <code>${escapeHTML(c.code)}</code></b>\n└ Tipe: <b>${typeLabel}</b> | Hadiah: <b>${valLabel}</b> | Terpakai: <b>${quotaLabel}</b>`;
    }).join('\n\n');

    return ctx.reply(
        `<b>${EMOJIS.GIFT} DAFTAR KODE REDEEM AKTIF</b>\n\n<blockquote expandable>${listText}</blockquote>`,
        {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: "KEMBALI KE REDEEM PANEL", callback_data: "owner_menu_redeem", icon_custom_emoji_id: EMOJI_IDS.BACK }]
                ]
            }
        }
    );
});

bot.command('delcode', async (ctx) => {
    if (!ctx) return;
    lastBotActivity = Date.now();
    if (String(ctx.from.id) !== String(config.ownerId)) return;

    await ctx.deleteMessage().catch(() => {});
    const args = ctx.message.text.trim().split(/\s+/);
    if (args.length < 2) {
        return ctx.reply(`<b>${EMOJIS.CROSS} Format: <code>/delcode KODE</code></b>`, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: "KEMBALI KE REDEEM PANEL", callback_data: "owner_menu_redeem", icon_custom_emoji_id: EMOJI_IDS.BACK }]
                ]
            }
        });
    }

    const codeTarget = args[1].trim().toUpperCase();
    const result = await RedeemCode.deleteOne({ code: codeTarget });

    if (result.deletedCount === 0) {
        return ctx.reply(`<b>${EMOJIS.CROSS} Kode <code>${escapeHTML(codeTarget)}</code> tidak ditemukan.</b>`, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: "KEMBALI KE REDEEM PANEL", callback_data: "owner_menu_redeem", icon_custom_emoji_id: EMOJI_IDS.BACK }]
                ]
            }
        });
    }

    return ctx.reply(`<b>${EMOJIS.CHECK} Kode redeem <code>${escapeHTML(codeTarget)}</code> berhasil dihapus.</b>`, {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [{ text: "KEMBALI KE REDEEM PANEL", callback_data: "owner_menu_redeem", icon_custom_emoji_id: EMOJI_IDS.BACK }]
            ]
        }
    });
});


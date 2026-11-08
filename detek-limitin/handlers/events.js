async function executeCheckBioSession({ ctx, bot, userId, numbers, speedMode = "brutal", reportMode = "detail", promptMsgId = null }) {
    if (promptMsgId) {
        await ctx.telegram.deleteMessage(ctx.chat.id, promptMsgId).catch(() => {});
    }

    const totalNum = numbers.length;
    const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    let frameIdx = 0;
    const modeLabel = reportMode === "simpel" ? "SIMPEL" : "DETAIL";

    const msgProses = await ctx.reply(
        `<b>${frames[frameIdx]} CEK BIO (${modeLabel}): ${totalNum} NOMOR</b>\n\n<blockquote>Progress: 0 / ${totalNum}\nEstimasi: Menghitung...</blockquote>`,
        {
            parse_mode: "HTML",
            reply_markup: { inline_keyboard: [[{ text: "BATALKAN", callback_data: "cancel_cekbio", icon_custom_emoji_id: EMOJI_IDS.CROSS }]] }
        }
    );
    delete userState[userId];

    sendChannelReport({
        type: "CEKBIO",
        user: ctx?.from || { id: userId },
        count: totalNum,
        meta: { mode: reportMode }
    }).catch(() => {});

    let isChecking = true;
    let currentProcessed = 0;
    const startCheckTime = Date.now();
    let lastAnimationText = "";
    let nextAnimationDelay = 2500;

    const runAnimation = async () => {
        if (!isChecking) return;
        frameIdx = (frameIdx + 1) % frames.length;
        let elapsed = Date.now() - startCheckTime;
        let etaStr = "Menghitung...";
        if (currentProcessed > 0) {
            let msPerItem = elapsed / currentProcessed;
            let remainingMs = msPerItem * (totalNum - currentProcessed);
            let etaMin = Math.floor(remainingMs / 60000);
            let etaSec = Math.floor((remainingMs % 60000) / 1000);
            etaStr = etaMin > 0 ? `${etaMin}m ${etaSec}s` : `${etaSec}s`;
        }
        const percent = totalNum > 0 ? Math.min(100, Math.floor((currentProcessed / totalNum) * 100)) : 0;
        const text = `<b>${frames[frameIdx]} CEK BIO (${modeLabel}): ${totalNum.toLocaleString('id-ID')} NOMOR</b>\n\n<blockquote>Progress: ${currentProcessed.toLocaleString('id-ID')} / ${totalNum.toLocaleString('id-ID')} (${percent}%)\nEstimasi: ${etaStr}</blockquote>`;

        if (text !== lastAnimationText) {
            try {
                if (bot && bot.telegram) {
                    await bot.telegram.editMessageText(ctx.chat.id, msgProses.message_id, null, text, {
                        parse_mode: "HTML",
                        reply_markup: { inline_keyboard: [[{ text: "BATALKAN", callback_data: "cancel_cekbio", icon_custom_emoji_id: EMOJI_IDS.CROSS }]] }
                    });
                    lastAnimationText = text;
                    nextAnimationDelay = 2500;
                }
            } catch (e) {
                const retryAfter = Number(e?.parameters?.retry_after || 0);
                if (retryAfter > 0) {
                    nextAnimationDelay = (retryAfter + 1) * 1000;
                }
            }
        }

        if (isChecking) {
            setTimeout(runAnimation, nextAnimationDelay);
        }
    };

    setTimeout(runAnimation, 2500);

    try {
        const results = await WaManager.checkBio(userId, numbers, speedMode, (current, total) => {
            currentProcessed = current;
            if (current === total) {
                ctx.telegram.sendChatAction(ctx.chat.id, "upload_document").catch(() => {});
            }
        });

        isChecking = false;
        const remainingList = results.remainingNumbers || [];
        const remainingCount = remainingList.length;
        const validChecked = numbers.length - remainingCount;

        if (validChecked > 0) {
            await User.updateOne({ userId: userId }, {
                $inc: { totalChecked: validChecked, totalCekBio: validChecked, totalCekBioSessions: 1 },
                $set: { lastInteraction: Date.now() }
            }).catch(e => logger.add('ERROR', `Failed to update user stats: ${e.message}`));
            await Setting.findOneAndUpdate(
                { key: "total_checked_all" },
                { $inc: { value: validChecked } },
                { upsert: true }
            ).catch(e => logger.add('ERROR', `Failed to update total_checked_all: ${e.message}`));
            userCache.delete(userId);
        }

        const isInterrupted = results.senderLoggedOut || results.isCancelled || remainingCount > 0;

        if (isInterrupted && remainingCount > 0) {
            const { filePath: repPath, fileName: repName } = reportMode === "simpel"
                ? await WaManager.generateSimpleReport(results)
                : await WaManager.generateReport(results);
            const partialCaption = WaManager.formatCekBioCaption(results, numbers.length);

            if (bot && bot.telegram) {
                await bot.telegram.sendDocument(ctx.chat.id, { source: fs.createReadStream(repPath), filename: repName }, {
                    caption: partialCaption,
                    parse_mode: "HTML"
                });
            }
            fs.unlink(repPath, () => {});

            const { filePath: remPath, fileName: remName } = await WaManager.generateRemainingFile(remainingList);
            const sisaCaption = `<b>${EMOJIS.FOLDER} SISA NOMOR (${remainingCount} NOMOR)</b>\n\n<blockquote>File sisa nomor yang belum sempat dicek.</blockquote>`.trim();

            if (bot && bot.telegram) {
                await bot.telegram.sendDocument(ctx.chat.id, { source: fs.createReadStream(remPath), filename: remName }, {
                    caption: sisaCaption,
                    parse_mode: "HTML",
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "TAMBAH SENDER", callback_data: "wa_connect_menu", icon_custom_emoji_id: EMOJI_IDS.PLUS }, { text: "CEK BIO", callback_data: "menu_cekbio", icon_custom_emoji_id: EMOJI_IDS.DOC }],
                            [{ text: "KEMBALI", callback_data: "back_home", icon_custom_emoji_id: EMOJI_IDS.BACK }]
                        ]
                    }
                });
            }
            fs.unlink(remPath, () => {});

        } else {
            const { filePath, fileName } = reportMode === "simpel"
                ? await WaManager.generateSimpleReport(results)
                : await WaManager.generateReport(results);
            const combinedCaption = WaManager.formatCekBioCaption(results, numbers.length);

            if (bot && bot.telegram) {
                await bot.telegram.sendDocument(ctx.chat.id, { source: fs.createReadStream(filePath), filename: fileName }, {
                    caption: combinedCaption,
                    parse_mode: "HTML",
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "CEK LAGI", callback_data: "menu_cekbio", icon_custom_emoji_id: EMOJI_IDS.DOC }],
                            [{ text: "MENU UTAMA", callback_data: "back_home", icon_custom_emoji_id: EMOJI_IDS.BACK }]
                        ]
                    }
                });
            }
            fs.unlink(filePath, () => {});
        }

    } catch (err) {
        isChecking = false;
        if (bot && bot.telegram) await bot.telegram.deleteMessage(ctx.chat.id, msgProses.message_id).catch(() => {});
        ctx.reply(`<b>${EMOJIS.CROSS} Gagal: ${err.message}</b>`, {
            parse_mode: "HTML",
            reply_markup: { inline_keyboard: [[{ text: "KEMBALI", callback_data: "menu_cekbio", icon_custom_emoji_id: EMOJI_IDS.BACK }]] }
        });
    }
}
global.executeCheckBioSession = executeCheckBioSession;

bot.on("document", async (ctx) => {
    if (!ctx) return
    const userId = ctx.from.id
    const lockKey = "user_" + userId
    if (userLocks.get(lockKey)) {
        return ctx.reply(`<b>${EMOJIS.TIME} Pengecekan sedang berjalan, mohon tunggu...</b>`, { parse_mode: "HTML" })
    }
    userLocks.set(lockKey, true)
    try {
        lastBotActivity = Date.now()
        const state = userState[userId]

        if (state && state.status === "WAITING_CHECK_BIO") {
            const status = WaManager.getSessionStatus(userId)
            if (status !== "CONNECTED") {
                if (state.menuId) ctx.telegram.deleteMessage(ctx.chat.id, state.menuId).catch(() => {})
                delete userState[userId]
                return ctx.reply(
                    `<b>${EMOJIS.CROSS} Sesi sender terputus.\nHubungkan ulang di menu Cek Bio.</b>`,
                    { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "KEMBALI", callback_data: "menu_cekbio", icon_custom_emoji_id: EMOJI_IDS.BACK }]] } }
                )
            }

            try {
                const link = await ctx.telegram.getFileLink(ctx.message.document.file_id)
                const axios = require("axios")
                const res = await axios.get(link.href, { responseType: "arraybuffer" })
                
                const numbers = WaManager.processFile(res.data, ctx.message.document.file_name)
                
                if (numbers.length === 0) {
                    if (state.menuId) ctx.telegram.deleteMessage(ctx.chat.id, state.menuId).catch(() => {})
                    delete userState[userId]
                    return ctx.reply(
                        `<b>${EMOJIS.CROSS} File tidak berisi nomor valid (.xlsx / .csv / .txt).</b>`,
                        { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "KEMBALI", callback_data: "menu_cekbio", icon_custom_emoji_id: EMOJI_IDS.BACK }]] } }
                    )
                }

                if (state.menuId) ctx.telegram.deleteMessage(ctx.chat.id, state.menuId).catch(() => {})

                userState[userId] = {
                    status: "WAITING_CEKBIO_MODE",
                    numbers: numbers,
                    speedMode: state.speedMode || "brutal",
                    fileName: ctx.message.document.file_name
                }

                const buttons = [
                    [
                        { text: "MODE SIMPEL", callback_data: "cekbio_mode_simpel", icon_custom_emoji_id: EMOJI_IDS.DOC },
                        { text: "MODE DETAIL", callback_data: "cekbio_mode_detail", icon_custom_emoji_id: EMOJI_IDS.SEARCH }
                    ],
                    [
                        { text: "BATAL", callback_data: "menu_cekbio", icon_custom_emoji_id: EMOJI_IDS.CROSS }
                    ]
                ]

                const sent = await ctx.reply(
                    `<b>${EMOJIS.DOC} PILIH FORMAT HASIL CEK BIO</b>\n\n` +
                    `<blockquote>File: <code>${ctx.message.document.file_name}</code>\n` +
                    `Total: <b>${numbers.length} nomor</b>\n\n` +
                    `• <b>Mode Simpel</b>: Output ringkas (+62xxx (tgl set) (tier) + Zona Waktu)\n` +
                    `• <b>Mode Detail</b>: Laporan lengkap file .txt + statistik detail</blockquote>`,
                    { parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } }
                )
                userState[userId].menuId = sent.message_id
                return

            } catch (e) {
                if (state.menuId) ctx.telegram.deleteMessage(ctx.chat.id, state.menuId).catch(() => {})
                delete userState[userId]
                return ctx.reply(`<b>${EMOJIS.CROSS} Gagal: ${e.message}</b>`, {
                    parse_mode: "HTML",
                    reply_markup: { inline_keyboard: [[{ text: "KEMBALI", callback_data: "menu_cekbio", icon_custom_emoji_id: EMOJI_IDS.BACK }]] }
                })
            }
        }

        if (state && (state.status === "WAITING_DETECT" || state.status === "WAITING_DETECT_REALTIME" || state.status === "WAITING_DETECT_SMS" || state.status === "WAITING_DETECT_FULL")) {
            if (state.menuId) ctx.telegram.deleteMessage(ctx.chat.id, state.menuId).catch(() => {})
            delete userState[userId]
            return ctx.reply(`<b>${EMOJIS.CROSS} Fitur Detect hanya mendukung input teks (maks 10 nomor per baris).</b>`, {
                parse_mode: "HTML",
                reply_markup: { inline_keyboard: [[{ text: "KEMBALI", callback_data: "menu_detect", icon_custom_emoji_id: EMOJI_IDS.BACK }]] }
            })
        }

        if (state && state.status === "WAITING_LIMITIN") {
            if (state.menuId) ctx.telegram.deleteMessage(ctx.chat.id, state.menuId).catch(() => {})
            delete userState[userId]
            return ctx.reply(`<b>${EMOJIS.CROSS} Fitur Limitin hanya mendukung input teks (maks 5 nomor per baris).</b>`, {
                parse_mode: "HTML",
                reply_markup: { inline_keyboard: [[{ text: "KEMBALI", callback_data: "menu_limitin", icon_custom_emoji_id: EMOJI_IDS.BACK }]] }
            })
        }
    } finally {
        userLocks.delete(lockKey)
    }
})

bot.on("text", async (ctx) => {
    if (!ctx) return
    const userId = ctx.from.id
    
    const state = userState[userId]
    const isCommand = ctx.message.text && ctx.message.text.startsWith("/")
    
    if (!state && !isCommand) {
        return;
    }

    const lockKey = "user_" + userId
    if (userLocks.get(lockKey)) {
        return ctx.reply(`<b>${EMOJIS.TIME} Permintaan sebelumnya sedang diproses...</b>`, { parse_mode: "HTML" })
    }
    userLocks.set(lockKey, true)
    try {
        lastBotActivity = Date.now()
        
        if (isCommand) {
            delete userState[userId]
            if (ctx.chat.type === "private") {
                return ctx.reply(`<b>${EMOJIS.CROSS} Perintah tidak dikenal.</b>`, { parse_mode: "HTML" })
            }
            return;
        }

        const joinStatus = await isJoined(ctx);
        if (!joinStatus.allJoined) return ctx.reply(`<b>${EMOJIS.PROHIBITED} Wajib join semua channel/grup terlebih dahulu. Ketik /start</b>`, { parse_mode: "HTML" });

        if (state && state.status === "WAITING_REDEEM_CODE") {
            delete userState[userId];
            const cleanCode = ctx.message.text.trim().toUpperCase();
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

            if (Array.isArray(item.usedBy) && item.usedBy.some(u => String(u.userId) === String(userId))) {
                return ctx.reply(
                    `<b>${EMOJIS.WARN} KODE SUDAH PERNAH DIKLAIM</b>\n\n<blockquote>Anda sudah pernah mengklaim kode redeem <code>${escapeHTML(cleanCode)}</code>. Setiap akun hanya berhak 1x klaim.</blockquote>`,
                    { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: 'KEMBALI', callback_data: 'back_home', icon_custom_emoji_id: EMOJI_IDS.BACK }]] } }
                );
            }

            const uObj = await checkUser(userId, ctx.from);
            if (!Array.isArray(item.usedBy)) item.usedBy = [];
            item.usedBy.push({
                userId: userId,
                username: ctx.from.username || '',
                usedAt: Date.now()
            });
            item.usedCount = (item.usedCount || 0) + 1;
            await item.save();

            if (item.type === 'limit') {
                const addAmt = Number(item.amount) || 1;
                const newLim = (Number(uObj.limit) || 0) + addAmt;
                await User.updateOne({ userId: userId }, { $set: { limit: newLim, lastInteraction: Date.now() } });
                if (global.userCache) global.userCache.delete(userId);

                if (typeof sendChannelReport === 'function') {
                    sendChannelReport({
                        type: 'REDEEM',
                        user: ctx.from,
                        count: addAmt,
                        meta: { code: cleanCode }
                    }).catch(() => {});
                }

                return ctx.reply(
                    `<b>${EMOJIS.CHECK} KODE REDEEM BERHASIL DIKLAIM!</b>\n\n<blockquote>Kode: <code>${escapeHTML(cleanCode)}</code>\nHadiah: <b>+${addAmt} Limit Cek</b>\nTotal Kuota Limit: <b>${newLim}</b></blockquote>`,
                    { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: 'MENU UTAMA', callback_data: 'back_home', icon_custom_emoji_id: EMOJI_IDS.BOT }]] } }
                );
            } else {
                const days = Number(item.amount) || 1;
                await PaymentManager.activatePremium(
                    userId,
                    days,
                    `REDEEM-${cleanCode}`,
                    `Redeem Code (${days >= 3650 ? 'Lifetime' : days + ' Hari'})`
                );
                if (global.userCache) global.userCache.delete(userId);

                return ctx.reply(
                    `<b>${EMOJIS.CHECK} KODE REDEEM BERHASIL DIKLAIM!</b>\n\n<blockquote>Kode: <code>${escapeHTML(cleanCode)}</code>\nHadiah: <b>Akun PREMIUM (${days >= 3650 ? 'Permanen' : days + ' Hari'})</b>\nStatus: <b>AKTIF SEKARANG</b></blockquote>`,
                    { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: 'MENU UTAMA', callback_data: 'back_home', icon_custom_emoji_id: EMOJI_IDS.BOT }]] } }
                );
            }
        }

        if (state && state.status === "WAITING_CREATE_CODE_LIMIT") {
            const promptId = state.menuId || state.menuMsgId;
            delete userState[userId];
            if (String(userId) !== String(config.ownerId)) return;

            await ctx.deleteMessage().catch(() => {});
            if (promptId) await ctx.telegram.deleteMessage(ctx.chat.id, promptId).catch(() => {});

            const parts = ctx.message.text.trim().split(/\s+/);
            const amount = parseInt(parts[0]);
            if (isNaN(amount) || amount <= 0) {
                return ctx.reply(`<b>${EMOJIS.CROSS} Jumlah limit tidak valid. Harus angka lebih dari 0.</b>`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: 'KEMBALI KE REDEEM PANEL', callback_data: 'owner_menu_redeem', icon_custom_emoji_id: EMOJI_IDS.BACK }]] } });
            }
            const maxUses = parts.length >= 2 ? parseInt(parts[1]) : 1;
            let code = parts.length >= 3 ? parts[2].trim().toUpperCase() : '';
            if (!code) {
                code = `LIM-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
            }

            const existing = await RedeemCode.findOne({ code });
            if (existing) return ctx.reply(`<b>${EMOJIS.CROSS} Kode <code>${escapeHTML(code)}</code> sudah ada.</b>`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: 'KEMBALI KE REDEEM PANEL', callback_data: 'owner_menu_redeem', icon_custom_emoji_id: EMOJI_IDS.BACK }]] } });

            const newCode = new RedeemCode({
                code,
                type: 'limit',
                amount,
                maxUses: isNaN(maxUses) ? 1 : maxUses,
                usedCount: 0,
                usedBy: [],
                createdAt: Date.now(),
                createdBy: userId
            });
            await newCode.save();

            return ctx.reply(
                `<b>${EMOJIS.CHECK} KODE REDEEM LIMIT DIBUAT!</b>\n\n<blockquote>Kode: <code>${escapeHTML(code)}</code>\nHadiah: <b>+${amount} Limit</b>\nKuota: <b>${maxUses === 0 ? 'Unlimited' : maxUses + ' orang'}</b></blockquote>`,
                { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: 'KEMBALI KE REDEEM PANEL', callback_data: 'owner_menu_redeem', icon_custom_emoji_id: EMOJI_IDS.BACK }]] } }
            );
        }

        if (state && state.status === "WAITING_CREATE_CODE_PREM") {
            const promptId = state.menuId || state.menuMsgId;
            delete userState[userId];
            if (String(userId) !== String(config.ownerId)) return;

            await ctx.deleteMessage().catch(() => {});
            if (promptId) await ctx.telegram.deleteMessage(ctx.chat.id, promptId).catch(() => {});

            const parts = ctx.message.text.trim().split(/\s+/);
            const amtStr = parts[0].toLowerCase();
            const amount = (amtStr === 'lifetime' || amtStr === 'permanen') ? 3650 : parseInt(amtStr);
            if (isNaN(amount) || amount <= 0) {
                return ctx.reply(`<b>${EMOJIS.CROSS} Durasi hari tidak valid.</b>`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: 'KEMBALI KE REDEEM PANEL', callback_data: 'owner_menu_redeem', icon_custom_emoji_id: EMOJI_IDS.BACK }]] } });
            }
            const maxUses = parts.length >= 2 ? parseInt(parts[1]) : 1;
            let code = parts.length >= 3 ? parts[2].trim().toUpperCase() : '';
            if (!code) {
                code = `PREM-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
            }

            const existing = await RedeemCode.findOne({ code });
            if (existing) return ctx.reply(`<b>${EMOJIS.CROSS} Kode <code>${escapeHTML(code)}</code> sudah ada.</b>`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: 'KEMBALI KE REDEEM PANEL', callback_data: 'owner_menu_redeem', icon_custom_emoji_id: EMOJI_IDS.BACK }]] } });

            const newCode = new RedeemCode({
                code,
                type: 'premium',
                amount,
                maxUses: isNaN(maxUses) ? 1 : maxUses,
                usedCount: 0,
                usedBy: [],
                createdAt: Date.now(),
                createdBy: userId
            });
            await newCode.save();

            const hadiahStr = amount >= 3650 ? 'Lifetime Premium' : `${amount} Hari Premium`;
            return ctx.reply(
                `<b>${EMOJIS.CHECK} KODE REDEEM PREMIUM DIBUAT!</b>\n\n<blockquote>Kode: <code>${escapeHTML(code)}</code>\nHadiah: <b>${hadiahStr}</b>\nKuota: <b>${maxUses === 0 ? 'Unlimited' : maxUses + ' orang'}</b></blockquote>`,
                { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: 'KEMBALI KE REDEEM PANEL', callback_data: 'owner_menu_redeem', icon_custom_emoji_id: EMOJI_IDS.BACK }]] } }
            );
        }

        if (state && state.status === "WAITING_OWNER_BC") {
            const promptId = state.menuId || state.menuMsgId;
            delete userState[userId];
            if (String(userId) !== String(config.ownerId)) return;

            await ctx.deleteMessage().catch(() => {});
            if (promptId) await ctx.telegram.deleteMessage(ctx.chat.id, promptId).catch(() => {});

            const allUsers = await User.find({ isBanned: { $ne: true } }).select('userId').lean();
            const total = allUsers.length;

            const sentStatusMsg = await ctx.reply(`<b>${EMOJIS.TIME} Memulai broadcast ke ${total} pengguna...</b>`, { parse_mode: 'HTML' });

            let sukses = 0;
            let gagal = 0;
            const startTime = Date.now();

            for (let i = 0; i < total; i++) {
                const u = allUsers[i];
                try {
                    await bot.telegram.copyMessage(u.userId, ctx.chat.id, ctx.message.message_id);
                    sukses++;
                } catch (err) {
                    gagal++;
                }
                if (i % 25 === 0) await new Promise(r => setTimeout(r, 1000));
            }

            const elapsedSec = Math.round((Date.now() - startTime) / 1000);
            await bot.telegram.deleteMessage(ctx.chat.id, sentStatusMsg.message_id).catch(() => {});

            return ctx.reply(
                `<b>${EMOJIS.CHECK} BROADCAST SELESAI!</b>\n\n<blockquote>Total Target: <b>${total}</b>\nSukses: <b>${sukses}</b>\nGagal: <b>${gagal}</b>\nDurasi: <b>${elapsedSec}s</b></blockquote>`,
                { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: 'KEMBALI', callback_data: 'owner_menu_broadcast', icon_custom_emoji_id: EMOJI_IDS.BACK }]] } }
            );
        }

        if (state && state.status === "WAITING_OWNER_SETPREM") {
            const promptId = state.menuId || state.menuMsgId;
            delete userState[userId];
            if (String(userId) !== String(config.ownerId)) return;

            await ctx.deleteMessage().catch(() => {});
            if (promptId) await ctx.telegram.deleteMessage(ctx.chat.id, promptId).catch(() => {});

            const parts = ctx.message.text.trim().split(/\s+/);
            const targetId = parseInt(parts[0]);
            if (isNaN(targetId)) return ctx.reply(`<b>${EMOJIS.CROSS} Format salah. Contoh: <code>12345678 30</code></b>`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: 'KEMBALI', callback_data: 'owner_menu_premium', icon_custom_emoji_id: EMOJI_IDS.BACK }]] } });

            const daysArg = (parts[1] || '30').toLowerCase();
            const days = (daysArg === 'lifetime' || daysArg === 'permanen') ? 3650 : parseInt(daysArg);

            await PaymentManager.activatePremium(targetId, days, `MANUAL-${Date.now()}`, 'Manual by Owner');
            if (global.userCache) global.userCache.delete(targetId);

            return ctx.reply(
                `<b>${EMOJIS.CHECK} Berhasil mengaktifkan Premium untuk user <code>${targetId}</code> (${days >= 3650 ? 'Lifetime' : days + ' Hari'}).</b>`,
                { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: 'KEMBALI', callback_data: 'owner_menu_premium', icon_custom_emoji_id: EMOJI_IDS.BACK }]] } }
            );
        }

        if (state && state.status === "WAITING_OWNER_DELPREM") {
            const promptId = state.menuId || state.menuMsgId;
            delete userState[userId];
            if (String(userId) !== String(config.ownerId)) return;

            await ctx.deleteMessage().catch(() => {});
            if (promptId) await ctx.telegram.deleteMessage(ctx.chat.id, promptId).catch(() => {});

            const targetId = parseInt(ctx.message.text.trim());
            if (isNaN(targetId)) return ctx.reply(`<b>${EMOJIS.CROSS} ID User tidak valid.</b>`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: 'KEMBALI', callback_data: 'owner_menu_premium', icon_custom_emoji_id: EMOJI_IDS.BACK }]] } });

            await User.updateOne({ userId: targetId }, { $set: { premium: false, premiumUntil: null, limit: 5 } });
            if (global.userCache) global.userCache.delete(targetId);

            return ctx.reply(
                `<b>${EMOJIS.CHECK} Status Premium user <code>${targetId}</code> berhasil dicabut.</b>`,
                { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: 'KEMBALI', callback_data: 'owner_menu_premium', icon_custom_emoji_id: EMOJI_IDS.BACK }]] } }
            );
        }

        if (state && state.status === "WAITING_OWNER_CEKUSER") {
            const promptId = state.menuId || state.menuMsgId;
            delete userState[userId];
            if (String(userId) !== String(config.ownerId)) return;

            await ctx.deleteMessage().catch(() => {});
            if (promptId) await ctx.telegram.deleteMessage(ctx.chat.id, promptId).catch(() => {});

            const targetId = parseInt(ctx.message.text.trim());
            if (isNaN(targetId)) return ctx.reply(`<b>${EMOJIS.CROSS} ID User tidak valid.</b>`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: 'KEMBALI', callback_data: 'owner_menu_users', icon_custom_emoji_id: EMOJI_IDS.BACK }]] } });

            const u = await User.findOne({ userId: targetId }).lean();
            if (!u) return ctx.reply(`<b>${EMOJIS.CROSS} User <code>${targetId}</code> tidak ditemukan di database.</b>`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: 'KEMBALI', callback_data: 'owner_menu_users', icon_custom_emoji_id: EMOJI_IDS.BACK }]] } });

            const expStr = u.premium ? (u.premiumUntil ? global.formatWaktu(new Date(u.premiumUntil)) : 'LIFETIME') : 'BUKAN PREMIUM';
            const info = `<b>${EMOJIS.USER} DETAIL PENGGUNA</b>\n\n<blockquote>ID: <code>${u.userId}</code>\nNama: <b>${escapeHTML(u.firstName || '-')}</b>\nUsername: <b>${u.username ? '@' + u.username : '-'}</b>\nStatus: <b>${u.premium ? `${EMOJIS.PREMIUM} PREMIUM` : `${EMOJIS.FREE} FREE`}</b>\nMasa Aktif: <b>${expStr}</b>\nSisa Limit: <b>${u.limit ?? 5}</b>\nKode Reff: <code>${u.refCode || '-'}</code>\nTotal Diundang: <b>${u.referralCount || 0} orang</b>\nTotal Cek: <b>${u.totalChecked || 0}</b>\nBanned: <b>${u.isBanned ? 'YA' : 'TIDAK'}</b></blockquote>`;

            return ctx.reply(info, {
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: [[{ text: 'KEMBALI', callback_data: 'owner_menu_users', icon_custom_emoji_id: EMOJI_IDS.BACK }]] }
            });
        }

        if (state && state.status === "WAITING_OWNER_ADDLIMIT") {
            const promptId = state.menuId || state.menuMsgId;
            delete userState[userId];
            if (String(userId) !== String(config.ownerId)) return;

            await ctx.deleteMessage().catch(() => {});
            if (promptId) await ctx.telegram.deleteMessage(ctx.chat.id, promptId).catch(() => {});

            const parts = ctx.message.text.trim().split(/\s+/);
            const targetId = parseInt(parts[0]);
            const addLimit = parseInt(parts[1]);
            if (isNaN(targetId) || isNaN(addLimit)) return ctx.reply(`<b>${EMOJIS.CROSS} Format salah. Contoh: <code>12345678 20</code></b>`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: 'KEMBALI', callback_data: 'owner_menu_users', icon_custom_emoji_id: EMOJI_IDS.BACK }]] } });

            const res = await User.findOneAndUpdate({ userId: targetId }, { $inc: { limit: addLimit } }, { new: true });
            if (!res) return ctx.reply(`<b>${EMOJIS.CROSS} User <code>${targetId}</code> tidak ditemukan.</b>`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: 'KEMBALI', callback_data: 'owner_menu_users', icon_custom_emoji_id: EMOJI_IDS.BACK }]] } });
            if (global.userCache) global.userCache.delete(targetId);

            return ctx.reply(
                `<b>${EMOJIS.CHECK} Berhasil menambahkan <b>+${addLimit} limit</b> untuk user <code>${targetId}</code>. Total Limit: <b>${res.limit}</b></b>`,
                { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: 'KEMBALI', callback_data: 'owner_menu_users', icon_custom_emoji_id: EMOJI_IDS.BACK }]] } }
            );
        }

        if (state && state.status === "WAITING_FSUB_ADD") {
            if (String(ctx.from.id) !== String(config.ownerId)) {
                delete userState[userId];
                return;
            }

            const promptId = state.menuId || state.menuMsgId;
            const rawInput = ctx.message.text.trim();
            delete userState[userId];

            await ctx.deleteMessage().catch(() => {});
            if (promptId) {
                ctx.telegram.deleteMessage(ctx.chat.id, promptId).catch(() => {});
            }

            let target = rawInput;
            if (target.startsWith("https://t.me/")) {
                const after = target.replace("https://t.me/", "");
                if (after.startsWith("+") || after.startsWith("joinchat/")) {
                    return ctx.reply(
                        `<b>${EMOJIS.CROSS} Link join privat tidak dapat divalidasi langsung oleh Telegram Bot API.</b>\n\n` +
                        `<blockquote>Silakan masukkan bot ke channel/grup tersebut sebagai <b>Admin</b> terlebih dahulu, lalu kirimkan <b>ID Channel</b> (contoh: <code>-100xxxxxxxxxx</code>).</blockquote>`,
                        {
                            parse_mode: "HTML",
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: "COBA LAGI", callback_data: "owner_fsub_add", icon_custom_emoji_id: EMOJI_IDS.REFRESH }],
                                    [{ text: "KEMBALI", callback_data: "owner_fsub_menu", icon_custom_emoji_id: EMOJI_IDS.BACK }]
                                ]
                            }
                        }
                    );
                } else {
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
                    const botMember = await bot.telegram.getChatMember(chatId, ctx.botInfo.id);
                    isBotAdmin = ["creator", "administrator"].includes(botMember.status);
                } catch (e) {}

                if (!Array.isArray(global.forceSubChannels)) global.forceSubChannels = [];

                const alreadyExists = global.forceSubChannels.some(c =>
                    String(c.id) === String(chatId) ||
                    (c.username && username && c.username.toLowerCase() === username.toLowerCase())
                );

                if (alreadyExists) {
                    await bot.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
                    return ctx.reply(
                        `<b>${EMOJIS.WARN} Channel <b>${escapeHTML(title)}</b> sudah terdaftar dalam list wajib join!</b>`,
                        {
                            parse_mode: "HTML",
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: "MENU WAJIB JOIN", callback_data: "owner_fsub_menu", icon_custom_emoji_id: EMOJI_IDS.GLOBE }],
                                    [{ text: "OWNER PANEL", callback_data: "action_ownermenu", icon_custom_emoji_id: EMOJI_IDS.BACK }]
                                ]
                            }
                        }
                    );
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

                let adminNote = "";
                if (isBotAdmin) {
                    adminNote = `\n${EMOJIS.CHECK} Status: <b>Bot adalah Admin</b> (Siap digunakan)`;
                } else {
                    adminNote = `\n${EMOJIS.WARN} Status: <b>Bot BELUM Admin</b>!\n<i>⚠️ Pastikan segera jadikan bot sebagai Admin di channel/grup tersebut dengan izin invite users agar tidak terjadi error saat pengecekan member.</i>`;
                }

                const successText = `<b>${EMOJIS.CHECK} CHANNEL BERHASIL DITAMBAHKAN!</b>\n\n` +
                    `<blockquote>Nama: <b>${escapeHTML(title)}</b>\n` +
                    `ID: <code>${chatId}</code>\n` +
                    `Username: ${username || "<i>Privat</i>"}${adminNote}</blockquote>`;

                return ctx.reply(successText, {
                    parse_mode: "HTML",
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "TAMBAH LAGI", callback_data: "owner_fsub_add", icon_custom_emoji_id: EMOJI_IDS.PLUS }, { text: "MENU WAJIB JOIN", callback_data: "owner_fsub_menu", icon_custom_emoji_id: EMOJI_IDS.GLOBE }],
                            [{ text: "OWNER PANEL", callback_data: "action_ownermenu", icon_custom_emoji_id: EMOJI_IDS.BACK }]
                        ]
                    }
                });

            } catch (err) {
                await bot.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
                logger.add("WARN", `Gagal menambahkan channel fsub ${target}: ${err.message}`);
                return ctx.reply(
                    `<b>${EMOJIS.CROSS} Gagal Menemukan Channel / Grup!</b>\n\n` +
                    `<blockquote>Error: <code>${escapeHTML(err.message)}</code>\n\n` +
                    `Kemungkinan penyebab:\n` +
                    `1. Username channel salah atau tidak ditemukan.\n` +
                    `2. Channel privat dan bot belum dimasukkan sebagai Admin.\n` +
                    `3. Bot diblokir atau dikeluarkan dari channel.</blockquote>`,
                    {
                        parse_mode: "HTML",
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: "COBA LAGI", callback_data: "owner_fsub_add", icon_custom_emoji_id: EMOJI_IDS.REFRESH }],
                                [{ text: "MENU WAJIB JOIN", callback_data: "owner_fsub_menu", icon_custom_emoji_id: EMOJI_IDS.BACK }]
                            ]
                        }
                    }
                );
            }
        }

        if (state && state.status === "WAITING_WA_PHONE") {
            if (state.msgId) ctx.telegram.deleteMessage(ctx.chat.id, state.msgId).catch(() => {})

            const num = ctx.message.text.replace(/\D/g, "")
            if (num.length < 8) {
                delete userState[userId]
                return ctx.reply(
                    `<b>${EMOJIS.CROSS} Nomor tidak valid (terlalu pendek).</b>`,
                    { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "KEMBALI", callback_data: "menu_cekbio", icon_custom_emoji_id: EMOJI_IDS.BACK }]] } }
                )
            }

            const user = await checkUser(userId)
            const isOwner = userId === config.ownerId
            const isPremium = user?.premium
            const maxLimit = isOwner ? 999 : (isPremium ? 5 : 2)
            
            let activeSids = []
            if (typeof WaManager.getActiveSessions === "function") {
                const activeSessions = WaManager.getActiveSessions(userId)
                if (Array.isArray(activeSessions)) {
                    activeSids = activeSessions.map(s => Number(s.sessionId))
                }
            } else {
                if (WaManager.getSessionStatus(userId) === "CONNECTED") {
                    activeSids = [1]
                }
            }

            const activeCount = activeSids.length

            if (activeCount >= maxLimit) {
                delete userState[userId]
                return ctx.reply(
                    `<b>${EMOJIS.CROSS} Batas maksimal ${maxLimit} sesi tercapai.</b>`,
                    { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "KEMBALI", callback_data: "menu_cekbio", icon_custom_emoji_id: EMOJI_IDS.BACK }]] } }
                )
            }

            let currentSessionId = state.sessionId || 1
            while (activeSids.includes(currentSessionId)) {
                currentSessionId++
            }
            const sessionId = currentSessionId
            
            delete userState[userId]
            const msg = await ctx.reply(`<b>${EMOJIS.TIME} Meminta kode pairing Sesi ${sessionId}...</b>`, { parse_mode: "HTML" })

            try {
                let isConnectedMessageSent = false
                const cb = (event, uid, sid) => {
                    if (event === "open" && !isConnectedMessageSent) {
                        isConnectedMessageSent = true
                        if (bot && bot.telegram) bot.telegram.deleteMessage(ctx.chat.id, msg.message_id).catch(() => {})
                        const phone = WaManager.sessions?.get(String(uid))?.get(Number(sid))?.user?.id?.split(":")[0]?.split("@")[0] || num
                        if (bot && bot.telegram) bot.telegram.sendMessage(uid, `<b>${EMOJIS.CHECK} WA TERHUBUNG (SESI ${sid || 1})</b>\n\n<blockquote>Nomor: <code>+${phone}</code>\nStatus: Siap Digunakan</blockquote>`, { 
                            parse_mode: "HTML",
                            reply_markup: { inline_keyboard: [
                                [{ text: "MULAI CEK", callback_data: "wa_check", icon_custom_emoji_id: EMOJI_IDS.ROCKET }],
                                [{ text: "MENU UTAMA", callback_data: "back_home", icon_custom_emoji_id: EMOJI_IDS.BACK }]
                            ] }
                        }).catch(() => {})
                    }
                }

                let code
                const fnStr = String(WaManager.requestPairing)
                if (fnStr.includes("customCode")) {
                    code = await WaManager.requestPairing(userId, num, sessionId, null, cb)
                } else {
                    code = await WaManager.requestPairing(userId, num, sessionId, cb)
                }

                function formatPairingCode(str) {
                    if (!str) return "ERROR"
                    return str.match(/.{1,4}/g).join("-")
                }

                const displayCode = code ? formatPairingCode(code) : "ERROR"

                if (bot && bot.telegram) await bot.telegram.editMessageText(
                    ctx.chat.id,
                    msg.message_id,
                    null,
                    `<b>${EMOJIS.KEY} KODE PAIRING (SESI ${sessionId})</b>\n\n` +
                    `<blockquote>Nomor: <code>+${num}</code>\n` +
                    `Kode: <code>${displayCode}</code>\n\n` +
                    `Masukkan di: WhatsApp > Perangkat Tertaut > Tautkan dengan nomor.</blockquote>`,
                    { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "KEMBALI", callback_data: "menu_cekbio", icon_custom_emoji_id: EMOJI_IDS.BACK }]] } }
                )
            } catch (e) {
                await ctx.reply(`<b>${EMOJIS.CROSS} Gagal pairing: ${e.message}</b>`, {
                    parse_mode: "HTML",
                    reply_markup: { inline_keyboard: [[{ text: "KEMBALI", callback_data: "menu_cekbio", icon_custom_emoji_id: EMOJI_IDS.BACK }]] }
                })
            }
            return
        }

        if (state && state.status === "WAITING_CHECK_BIO") {
            const numbers = WaManager.extractFromText(ctx.message.text)
            
            if (numbers.length === 0) {
                if (state.menuId) ctx.telegram.deleteMessage(ctx.chat.id, state.menuId).catch(() => {})
                delete userState[userId]
                return ctx.reply(`<b>${EMOJIS.CROSS} Tidak ada nomor valid dalam pesan.</b>`, {
                    parse_mode: "HTML",
                    reply_markup: { inline_keyboard: [[{ text: "KEMBALI", callback_data: "menu_cekbio", icon_custom_emoji_id: EMOJI_IDS.BACK }]] }
                })
            }

            const status = WaManager.getSessionStatus(userId)
            if (status !== "CONNECTED") {
                if (state.menuId) ctx.telegram.deleteMessage(ctx.chat.id, state.menuId).catch(() => {})
                delete userState[userId]
                return ctx.reply(`<b>${EMOJIS.CROSS} Sesi WA terputus.\nHubungkan kembali di menu Cek Bio.</b>`, {
                    parse_mode: "HTML",
                    reply_markup: { inline_keyboard: [[{ text: "KEMBALI", callback_data: "menu_cekbio", icon_custom_emoji_id: EMOJI_IDS.BACK }]] }
                })
            }

            if (state.menuId) ctx.telegram.deleteMessage(ctx.chat.id, state.menuId).catch(() => {})

            userState[userId] = {
                status: "WAITING_CEKBIO_MODE",
                numbers: numbers,
                speedMode: state.speedMode || "brutal"
            }

            const buttons = [
                [
                    { text: "MODE SIMPEL", callback_data: "cekbio_mode_simpel", icon_custom_emoji_id: EMOJI_IDS.DOC },
                    { text: "MODE DETAIL", callback_data: "cekbio_mode_detail", icon_custom_emoji_id: EMOJI_IDS.SEARCH }
                ],
                [
                    { text: "BATAL", callback_data: "menu_cekbio", icon_custom_emoji_id: EMOJI_IDS.CROSS }
                ]
            ]

            const sent = await ctx.reply(
                `<b>${EMOJIS.DOC} PILIH FORMAT HASIL CEK BIO</b>\n\n` +
                `<blockquote>Total Input: <b>${numbers.length} nomor</b>\n\n` +
                `• <b>Mode Simpel</b>: Output ringkas (+62xxx (tgl set) (tier) + Zona Waktu)\n` +
                `• <b>Mode Detail</b>: Laporan lengkap file .txt + statistik detail</blockquote>`,
                { parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } }
            )
            userState[userId].menuId = sent.message_id
            return
        }

        if (state && (state.status === "WAITING_DETECT" || state.status === "WAITING_DETECT_REALTIME" || state.status === "WAITING_DETECT_SMS" || state.status === "WAITING_DETECT_FULL")) {
            if (state.menuId) ctx.telegram.deleteMessage(ctx.chat.id, state.menuId).catch(() => {})
            const numbers = WaManager.extractFromText(ctx.message.text)
            if (numbers.length === 0) {
                delete userState[userId]
                return ctx.reply(`<b>${EMOJIS.CROSS} Tidak ada nomor valid.\nKetik nomor diawali kode negara (contoh: <code>628xxx</code>).</b>`, {
                    parse_mode: "HTML",
                    reply_markup: { inline_keyboard: [[{ text: "KEMBALI", callback_data: "menu_detect", icon_custom_emoji_id: EMOJI_IDS.BACK }]] }
                })
            }

            const user = await checkUser(userId, ctx.from);
            const isOwner = userId === config.ownerId;
            const isPremium = Boolean(user && user.premium);

            // User Free: Hanya bisa 1 nomor per request
            if (!isOwner && !isPremium && numbers.length > 1) {
                delete userState[userId];
                return ctx.reply(
                    `<b>${EMOJIS.CROSS} USER FREE MAKSIMAL 1 NOMOR</b>\n\n` +
                    `<blockquote>Pengguna Free hanya diperbolehkan mengecek <b>1 nomor per permintaan</b> (Input Anda: <b>${numbers.length} nomor</b>).\n\n` +
                    `💡 <i>Ingin mengecek hingga 10 nomor sekaligus? Silakan upgrade ke akun <b>Premium</b>!</i></blockquote>`,
                    {
                        parse_mode: "HTML",
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: "BELI PREMIUM", callback_data: "menu_buyprem", icon_custom_emoji_id: EMOJI_IDS.PREMIUM }],
                                [{ text: "COBA LAGI", callback_data: "menu_detect", icon_custom_emoji_id: EMOJI_IDS.SEARCH }],
                                [{ text: "KEMBALI", callback_data: "back_home", icon_custom_emoji_id: EMOJI_IDS.BACK }]
                            ]
                        }
                    }
                );
            }

            // User Free: Maksimal limit 5x per hari (reset jam 12 malam WIB)
            if (!isOwner && !isPremium && (user?.limit ?? 0) <= 0) {
                delete userState[userId];
                return ctx.reply(
                    `<b>${EMOJIS.WARN} KUOTA LIMIT HARIAN HABIS (0/5)</b>\n\n` +
                    `<blockquote>Batas <b>5 kali pengecekan gratis</b> Anda hari ini telah habis.\n` +
                    `Limit akan di-reset otomatis setiap <b>Jam 12 Malam WIB (00:00 WIB)</b>.\n\n` +
                    `<b>Solusi Melanjutkan:</b>\n` +
                    `• <b>Beli Paket Premium</b>: Akses tanpa batas (Unlimited) & bisa cek banyak nomor sekaligus.\n` +
                    `• <b>Undang Teman (Referral)</b>: Bagikan link referral Anda untuk mendapatkan kuota limit gratis!</blockquote>`,
                    {
                        parse_mode: "HTML",
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: "BELI PREMIUM", callback_data: "menu_buyprem", icon_custom_emoji_id: EMOJI_IDS.PREMIUM }],
                                [{ text: "UNDANG TEMAN (+LIMIT)", callback_data: "menu_referral", icon_custom_emoji_id: EMOJI_IDS.USER }],
                                [{ text: "KEMBALI", callback_data: "back_home", icon_custom_emoji_id: EMOJI_IDS.BACK }]
                            ]
                        }
                    }
                );
            }

            if (numbers.length > 10) {
                return ctx.reply(`<b>${EMOJIS.CROSS} Maksimal 10 nomor per permintaan.</b>`, {
                    parse_mode: "HTML",
                    reply_markup: { inline_keyboard: [[{ text: "KEMBALI", callback_data: "menu_detect", icon_custom_emoji_id: EMOJI_IDS.BACK }]] }
                })
            }

            delete userState[userId]

            const userInc = {
                totalDetect: numbers.length,
                totalChecked: numbers.length
            };
            if (!isOwner && !isPremium) {
                userInc.limit = -1;
            }

            await User.updateOne({ userId: userId }, {
                $inc: userInc,
                $set: { lastInteraction: Date.now() }
            }).catch(e => logger.add('ERROR', `Failed to update detect stats: ${e.message}`));

            await Setting.findOneAndUpdate(
                { key: "total_detect_all" },
                { $inc: { value: numbers.length } },
                { upsert: true }
            ).catch(e => logger.add('ERROR', `Failed to update total_detect_all: ${e.message}`));

            await Setting.findOneAndUpdate(
                { key: "total_checked_all" },
                { $inc: { value: numbers.length } },
                { upsert: true }
            ).catch(e => logger.add('ERROR', `Failed to update total_checked_all: ${e.message}`));

            userCache.delete(userId);

            sendChannelReport({
                type: 'DETECT',
                user: ctx.from,
                count: numbers.length
            }).catch(() => {});

            if (numbers.length === 1) {
                const waitMsg = await ctx.reply(`<b>${EMOJIS.TIME} Mengecek status...</b>`, { parse_mode: "HTML" })
                try {
                    const r = await WaManager.detectRealtimeStatus(numbers[0])
                    await bot.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {})
                    await ctx.reply(
                        `<b>${EMOJIS.CHECK} HASIL DETECT</b>\n\n<blockquote><code>${r.formatted}</code></blockquote>`,
                        {
                            parse_mode: "HTML",
                            reply_markup: { inline_keyboard: [
                                [{ text: "CEK LAGI", callback_data: "menu_detect", icon_custom_emoji_id: EMOJI_IDS.SEARCH }],
                                [{ text: "KEMBALI", callback_data: "back_home", icon_custom_emoji_id: EMOJI_IDS.BACK }]
                            ] }
                        }
                    )
                } catch (e) {
                    await bot.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {})
                    ctx.reply(`<b>${EMOJIS.CROSS} Gagal: ${e.message}</b>`, { parse_mode: "HTML" })
                }
                return
            }

            // Multiple numbers (up to 10)
            const waitMsg = await ctx.reply(`<b>${EMOJIS.TIME} Mendeteksi ${numbers.length} nomor...</b>`, { parse_mode: "HTML" })
            try {
                const results = await WaManager.detectBulkRealtime(numbers)
                await bot.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {})
                const lines = results.map((r, i) => `${i + 1}. <code>${r.formatted}</code>`).join("\n")
                await ctx.reply(
                    `<b>${EMOJIS.CHECK} HASIL DETECT (${results.length} NOMOR)</b>\n\n<blockquote>${lines}</blockquote>`,
                    {
                        parse_mode: "HTML",
                        reply_markup: { inline_keyboard: [
                            [{ text: "CEK LAGI", callback_data: "menu_detect", icon_custom_emoji_id: EMOJI_IDS.SEARCH }],
                            [{ text: "KEMBALI", callback_data: "back_home", icon_custom_emoji_id: EMOJI_IDS.BACK }]
                        ] }
                    }
                )
            } catch (e) {
                await bot.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {})
                ctx.reply(`<b>${EMOJIS.CROSS} Gagal: ${e.message}</b>`, { parse_mode: "HTML" })
            }
            return
        }

        if (state && state.status === "WAITING_LIMITIN") {
            if (state.menuId) ctx.telegram.deleteMessage(ctx.chat.id, state.menuId).catch(() => {})
            const numbers = WaManager.extractFromText(ctx.message.text)
            if (numbers.length === 0) {
                delete userState[userId]
                return ctx.reply(`<b>${EMOJIS.CROSS} Tidak ada nomor valid.\nKetik nomor diawali kode negara (contoh: <code>628xxx</code>).</b>`, {
                    parse_mode: "HTML",
                    reply_markup: { inline_keyboard: [[{ text: "KEMBALI", callback_data: "menu_limitin", icon_custom_emoji_id: EMOJI_IDS.BACK }]] }
                })
            }

            const user = await checkUser(userId, ctx.from);
            const isOwner = userId === config.ownerId;
            const isPremium = Boolean(user && user.premium);

            // User Free: Hanya bisa 1 nomor per request
            if (!isOwner && !isPremium && numbers.length > 1) {
                delete userState[userId];
                return ctx.reply(
                    `<b>${EMOJIS.CROSS} USER FREE MAKSIMAL 1 NOMOR</b>\n\n` +
                    `<blockquote>Pengguna Free hanya diperbolehkan melimitkan <b>1 nomor per permintaan</b> (Input Anda: <b>${numbers.length} nomor</b>).\n\n` +
                    `💡 <i>Ingin melimitkan hingga 5 nomor sekaligus? Silakan upgrade ke akun <b>Premium</b>!</i></blockquote>`,
                    {
                        parse_mode: "HTML",
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: "BELI PREMIUM", callback_data: "menu_buyprem", icon_custom_emoji_id: EMOJI_IDS.PREMIUM }],
                                [{ text: "COBA LAGI", callback_data: "menu_limitin", icon_custom_emoji_id: EMOJI_IDS.ROCKET }],
                                [{ text: "KEMBALI", callback_data: "back_home", icon_custom_emoji_id: EMOJI_IDS.BACK }]
                            ]
                        }
                    }
                );
            }

            // User Free: Maksimal limit 5x per hari (reset jam 12 malam WIB)
            if (!isOwner && !isPremium && (user?.limit ?? 0) <= 0) {
                delete userState[userId];
                return ctx.reply(
                    `<b>${EMOJIS.WARN} KUOTA LIMIT HARIAN HABIS (0/5)</b>\n\n` +
                    `<blockquote>Batas <b>5 kali percobaan gratis</b> Anda hari ini telah habis.\n` +
                    `Limit akan di-reset otomatis setiap <b>Jam 12 Malam WIB (00:00 WIB)</b>.\n\n` +
                    `<b>Solusi Melanjutkan:</b>\n` +
                    `• <b>Beli Paket Premium</b>: Akses tanpa batas (Unlimited) & bisa massal banyak nomor sekaligus.\n` +
                    `• <b>Undang Teman (Referral)</b>: Bagikan link referral Anda untuk mendapatkan kuota limit gratis!</blockquote>`,
                    {
                        parse_mode: "HTML",
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: "💎 BELI PREMIUM", callback_data: "menu_buyprem", icon_custom_emoji_id: EMOJI_IDS.PREMIUM }],
                                [{ text: "👥 UNDANG TEMAN (+LIMIT)", callback_data: "menu_referral", icon_custom_emoji_id: EMOJI_IDS.USER }],
                                [{ text: "⬅️ KEMBALI", callback_data: "back_home", icon_custom_emoji_id: EMOJI_IDS.BACK }]
                            ]
                        }
                    }
                );
            }

            if (numbers.length > 5) {
                return ctx.reply(`<b>${EMOJIS.CROSS} Maksimal 5 nomor per baris.</b>`, {
                    parse_mode: "HTML",
                    reply_markup: { inline_keyboard: [[{ text: "KEMBALI", callback_data: "menu_limitin", icon_custom_emoji_id: EMOJI_IDS.BACK }]] }
                })
            }

            const selectedMethod = state.method || "sms"
            const methodName = state.methodName || "SMS"
            delete userState[userId]

            const userIncLimitin = {
                totalLimitin: numbers.length,
                totalChecked: numbers.length
            };
            if (!isOwner && !isPremium) {
                userIncLimitin.limit = -1;
            }

            await User.updateOne({ userId: userId }, {
                $inc: userIncLimitin,
                $set: { lastInteraction: Date.now() }
            }).catch(e => logger.add('ERROR', `Failed to update limitin stats: ${e.message}`));

            await Setting.findOneAndUpdate(
                { key: "total_limitin_all" },
                { $inc: { value: numbers.length } },
                { upsert: true }
            ).catch(e => logger.add('ERROR', `Failed to update total_limitin_all: ${e.message}`));

            await Setting.findOneAndUpdate(
                { key: "total_checked_all" },
                { $inc: { value: numbers.length } },
                { upsert: true }
            ).catch(e => logger.add('ERROR', `Failed to update total_checked_all: ${e.message}`));

            userCache.delete(userId);

            sendChannelReport({
                type: 'LIMITIN',
                user: ctx.from,
                count: numbers.length,
                meta: { method: methodName }
            }).catch(() => {});

            (async () => {
                for (let i = 0; i < numbers.length; i++) {
                    WaManager.startLimitinBackgroundSession({
                        bot,
                        chatId: ctx.chat.id,
                        userId,
                        number: numbers[i],
                        method: selectedMethod,
                        methodName: methodName,
                        maxAttempts: 5
                    });
                    if (i < numbers.length - 1) {
                        await new Promise(r => setTimeout(r, 400));
                    }
                }
            })().catch(e => logger.add('ERROR', `Error starting limitin sessions: ${e.message}`));
            return
        }

        if (state && state.status === "WAITING_CEK_JOIN") {
            if (state.menuId) ctx.telegram.deleteMessage(ctx.chat.id, state.menuId).catch(() => {})
            const numbers = WaManager.extractFromText(ctx.message.text)
            if (numbers.length === 0) {
                delete userState[userId]
                return ctx.reply(`<b>${EMOJIS.CROSS} Tidak ada nomor valid.\nKetik nomor diawali kode negara (contoh: <code>628xxx</code>).</b>`, {
                    parse_mode: "HTML",
                    reply_markup: { inline_keyboard: [[{ text: "KEMBALI", callback_data: "back_home", icon_custom_emoji_id: EMOJI_IDS.BACK }]] }
                })
            }

            delete userState[userId]
            const targetNum = numbers[0]
            const waitMsg = await ctx.reply(`<b>${EMOJIS.TIME} Memeriksa status join & bio real-time...</b>`, { parse_mode: "HTML" })

            try {
                const res = await WaManager.checkJoinedAndBio(targetNum, userId)
                await bot.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {})
                if (!res.isRegistered) {
                    return ctx.reply(`<b>${EMOJIS.CROSS} Nomor <code>+${targetNum}</code> tidak terdaftar di WhatsApp.</b>`, {
                        parse_mode: "HTML",
                        reply_markup: { inline_keyboard: [[{ text: "KEMBALI", callback_data: "back_home", icon_custom_emoji_id: EMOJI_IDS.BACK }]] }
                    })
                }

                await User.updateOne({ userId: userId }, {
                    $inc: { totalChecked: 1 },
                    $set: { lastInteraction: Date.now() }
                }).catch(() => {});
                await Setting.findOneAndUpdate(
                    { key: "total_checked_all" },
                    { $inc: { value: 1 } },
                    { upsert: true }
                ).catch(() => {});
                userCache.delete(userId);

                const out = `<b>${EMOJIS.CHECK} DETAIL JOIN & BIO REAL-TIME</b>\n\n` +
                    `<blockquote>Nomor: <code>+${res.number}</code>\n` +
                    `Tipe Akun: <b>${res.isBusiness ? 'Bisnis' : 'Personal'}</b>\n` +
                    `Gabung WA (Since): <code>${res.joinSince}</code>\n` +
                    `Tanggal Set Bio: <code>${res.bioSetDate}</code>\n` +
                    `Bio: <i>${escapeHTML(res.bio)}</i></blockquote>`

                return ctx.reply(out, {
                    parse_mode: "HTML",
                    reply_markup: { inline_keyboard: [[{ text: "KEMBALI", callback_data: "back_home", icon_custom_emoji_id: EMOJI_IDS.BACK }]] }
                })
            } catch (err) {
                await bot.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {})
                return ctx.reply(`<b>${EMOJIS.CROSS} Gagal: ${err.message}</b>`, {
                    parse_mode: "HTML",
                    reply_markup: { inline_keyboard: [[{ text: "KEMBALI", callback_data: "back_home", icon_custom_emoji_id: EMOJI_IDS.BACK }]] }
                })
            }
        }

        if (state && state.status === "WAITING_CEK_MERAH") {
            if (state.menuId) ctx.telegram.deleteMessage(ctx.chat.id, state.menuId).catch(() => {})
            const numbers = WaManager.extractFromText(ctx.message.text)
            if (numbers.length === 0) {
                delete userState[userId]
                return ctx.reply(`<b>${EMOJIS.CROSS} Tidak ada nomor valid.\nKetik nomor diawali kode negara (contoh: <code>628xxx</code>).</b>`, {
                    parse_mode: "HTML",
                    reply_markup: { inline_keyboard: [[{ text: "KEMBALI", callback_data: "back_home", icon_custom_emoji_id: EMOJI_IDS.BACK }]] }
                })
            }

            delete userState[userId]
            const targetNum = numbers[0]
            const waitMsg = await ctx.reply(`<b>${EMOJIS.TIME} Memeriksa status flag merah nomor...</b>`, { parse_mode: "HTML" })

            try {
                const res = await WaManager.checkFlagMerah(targetNum, userId)
                await bot.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {})

                await User.updateOne({ userId: userId }, {
                    $inc: { totalChecked: 1 },
                    $set: { lastInteraction: Date.now() }
                }).catch(() => {});
                await Setting.findOneAndUpdate(
                    { key: "total_checked_all" },
                    { $inc: { value: 1 } },
                    { upsert: true }
                ).catch(() => {});
                userCache.delete(userId);

                const indText = res.indicators.map(i => `• ${i}`).join('\n')
                const out = `<b>${EMOJIS.SEARCH} HASIL CEK FLAG MERAH WHATSAPP</b>\n\n` +
                    `<blockquote>Nomor: <code>+${res.number}</code>\n` +
                    `Status: <b>${res.flagLabel}</b>\n\n` +
                    `Penjelasan:\n<i>${res.flagDescription}</i>\n\n` +
                    `Indikator Deteksi:\n${indText}</blockquote>`

                return ctx.reply(out, {
                    parse_mode: "HTML",
                    reply_markup: { inline_keyboard: [[{ text: "KEMBALI", callback_data: "back_home", icon_custom_emoji_id: EMOJI_IDS.BACK }]] }
                })
            } catch (err) {
                await bot.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {})
                return ctx.reply(`<b>${EMOJIS.CROSS} Gagal: ${err.message}</b>`, {
                    parse_mode: "HTML",
                    reply_markup: { inline_keyboard: [[{ text: "KEMBALI", callback_data: "back_home", icon_custom_emoji_id: EMOJI_IDS.BACK }]] }
                })
            }
        }
    } catch (e) {
        logger.add("ERROR", `Text Handler Error: ${e.message}`, e.stack)
    } finally {
        userLocks.delete(lockKey)
    }
})

bot.on('new_chat_members', async (ctx) => {
    try {
        const newMembers = ctx.message?.new_chat_members || [];
        const botUser = config.botUsername || 'kicenxcekbiobot';
        const isBotAdded = newMembers.some(m => m.is_bot && (m.username === botUser || (ctx.botInfo && m.id === ctx.botInfo.id)));
        if (isBotAdded) {
            const groupTitle = escapeHTML(ctx.chat.title || 'Grup');
            const welcomeText = `<b>${EMOJIS.BOT} HALO SEMUANYA DI ${groupTitle}!</b>\n\n` +
                `<blockquote>Saya adalah bot <b>Cek Bio WhatsApp, Detect OTP & Limitin Code</b>.\n` +
                `Gunakan perintah <code>/menu</code> atau <code>/start</code> untuk mengakses layanan.\n\n` +
                `Untuk privasi dan fitur penuh, Anda juga dapat membuka bot di chat pribadi.</blockquote>`;
            
            const keyboard = {
                inline_keyboard: [
                    [
                        { text: '🚀 BUKA BOT (CHAT PRIBADI)', url: `https://t.me/${botUser}?start=group` }
                    ],
                    [
                        { text: '📊 STATISTIK', callback_data: 'menu_stats', icon_custom_emoji_id: EMOJI_IDS.CHART },
                        { text: '📖 PANDUAN', callback_data: 'menu_panduan', icon_custom_emoji_id: EMOJI_IDS.BOOK }
                    ]
                ]
            };

            await ctx.reply(welcomeText, {
                parse_mode: 'HTML',
                reply_markup: keyboard
            }).catch(() => {});
        }
    } catch (e) {
        logger.add('WARN', `Error on new_chat_members: ${e.message}`);
    }
});

bot.launch({ dropPendingUpdates: false }).then(() => {
    logger.add("SYSTEM", "Bot System Online")
    restartCount = 0
    watchdogFails = 0
    lastBotActivity = Date.now()
}).catch(err => {
    logger.add("CRITICAL", `Bot Launch Failed: ${err.message}`, err.stack)
    restartBot()
})

bot.action("back_home", async (ctx) => {
    if (!ctx) return
    lastBotActivity = Date.now()
    delete userState[ctx.from.id]
    await showMainMenu(ctx)
})

bot.action("cek_join_lagi", async (ctx) => {
    if (!ctx) return
    lastBotActivity = Date.now()
    if (typeof clearJoinCache === "function") {
        clearJoinCache(ctx.from.id)
    }
    const joinStatus = await isJoined(ctx, true);
    if (joinStatus.allJoined) {
        await ctx.answerCbQuery("Akses diterima!", { show_alert: false })
        delete userState[ctx.from.id]
        await showMainMenu(ctx)
    } else {
        await ctx.answerCbQuery("Belum join " + joinStatus.unjoined.length + " channel/grup!", { show_alert: true })
    }
})

bot.action("menu_cekbio", async (ctx) => {
    if (!ctx) return
    const userId = ctx.from.id
    const lockKey = "user_" + userId
    if (userLocks.get(lockKey)) {
        return ctx.answerCbQuery("Mohon tunggu...", { show_alert: true })
    }
    userLocks.set(lockKey, true)
    try {
        lastBotActivity = Date.now()
        const joinStatus = await isJoined(ctx);
        if (!joinStatus.allJoined) return ctx.answerCbQuery("Wajib join semua channel/grup terlebih dahulu!", { show_alert: true })
        await ctx.deleteMessage().catch(() => { })
        if (userState[userId]) delete userState[userId]

        const status = WaManager.getSessionStatus(userId)
        const statLabel = status === "CONNECTED" ? `${EMOJIS.DOT_GREEN} TERHUBUNG` : `${EMOJIS.DOT_RED} TERPUTUS`

        let activeSessions = []
        if (typeof WaManager.getActiveSessions === "function") {
            activeSessions = WaManager.getActiveSessions(userId)
        } else {
            if (status === "CONNECTED") {
                activeSessions.push({ sessionId: 1, phoneNumber: "Terhubung" })
            }
        }

        let sessionsText = ""
        if (activeSessions && activeSessions.length > 0) {
            sessionsText = "\n" + activeSessions.map(s => `${EMOJIS.PHONE} Sesi ${s.sessionId}: <code>${s.phoneNumber}</code>`).join("\n")
        } else {
            sessionsText = `\n${EMOJIS.NOTE} Belum ada sender terhubung`
        }

        const textCek = `<b>${EMOJIS.DOC} CEK BIO WHATSAPP</b>

<blockquote>Status Sender: ${statLabel}${sessionsText}</blockquote>

<blockquote expandable><b>Panduan Cepat:</b>
▸ Hubungkan sender WA terlebih dahulu
▸ Klik <b>MULAI CEK</b> dan kirim list nomor
▸ Format nomor: <code>628xxx</code> (1 per baris)
▸ Mendukung file <code>.xlsx</code> / <code>.csv</code> / <code>.txt</code></blockquote>`

        const buttons = [
            [
                { text: "TAMBAH SENDER", callback_data: "wa_connect_menu", icon_custom_emoji_id: EMOJI_IDS.PLUS },
                { text: "MULAI CEK", callback_data: "wa_check", icon_custom_emoji_id: EMOJI_IDS.ROCKET }
            ],
            [
                { text: "LOGOUT SESI", callback_data: "wa_logout_menu", icon_custom_emoji_id: EMOJI_IDS.DOOR },
                { text: "KEMBALI", callback_data: "back_home", icon_custom_emoji_id: EMOJI_IDS.BACK }
            ]
        ]

        await ctx.reply(textCek, { parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } })
    } finally {
        userLocks.delete(lockKey)
    }
})

bot.action(["wa_connect", "wa_connect_menu"], async (ctx) => {
    if (!ctx) return
    const userId = ctx.from.id
    const lockKey = "user_" + userId
    if (userLocks.get(lockKey)) {
        return ctx.answerCbQuery("Mohon tunggu...", { show_alert: true })
    }
    userLocks.set(lockKey, true)
    try {
        await ctx.deleteMessage().catch(() => { })
        lastBotActivity = Date.now()
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
            const msg = `<b>${EMOJIS.CROSS} LIMIT TERCAPAI</b>\n\n<blockquote>Maksimal: <b>${maxLimit} sesi WA aktif</b>.</blockquote>`
            return ctx.reply(msg, {
                parse_mode: "HTML",
                reply_markup: { inline_keyboard: [[{ text: "KEMBALI", callback_data: "menu_cekbio", icon_custom_emoji_id: EMOJI_IDS.BACK }]] }
            })
        }

        let newSessionId = 1
        while (activeSids.includes(newSessionId)) {
            newSessionId++
        }

        const menuText = `<b>${EMOJIS.PHONE} TAMBAH SENDER WHATSAPP</b>

<blockquote>Slot: <b>Sesi ${newSessionId}</b>  ·  Aktif: <b>${activeCount}/${maxLimit}</b>
Pilih metode koneksi di bawah:</blockquote>

<blockquote expandable><b>Panduan Metode:</b>
${EMOJIS.QR} <b>Scan QR</b> — Buka WA &gt; Perangkat Tertaut &gt; Scan
${EMOJIS.KEY} <b>Pairing Code</b> — Masukkan kode 8 digit di WA kamu</blockquote>`

        const buttons = [
            [{ text: "SCAN QR CODE", callback_data: `wa_connect_qr_${newSessionId}`, icon_custom_emoji_id: EMOJI_IDS.QR }],
            [{ text: "PAIRING CODE", callback_data: `wa_connect_pairing_${newSessionId}`, icon_custom_emoji_id: EMOJI_IDS.KEY }],
            [{ text: "KEMBALI", callback_data: "menu_cekbio", icon_custom_emoji_id: EMOJI_IDS.BACK }]
        ]

        await ctx.reply(menuText, { parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } })
    } finally {
        userLocks.delete(lockKey)
    }
})

bot.action(/^wa_connect_pairing(?:_(\d+))?$/, async (ctx) => {
    if (!ctx) return
    const userId = ctx.from.id
    const lockKey = "user_" + userId
    if (userLocks.get(lockKey)) {
        return ctx.answerCbQuery("Mohon tunggu...", { show_alert: true })
    }
    userLocks.set(lockKey, true)
    try {
        await ctx.deleteMessage().catch(() => { })
        lastBotActivity = Date.now()
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

        if (activeSids.length >= maxLimit) {
            const msg = `<b>${EMOJIS.CROSS} LIMIT TERCAPAI</b>\n\n<blockquote>Maksimal: <b>${maxLimit} sesi WA aktif</b>.</blockquote>`
            return ctx.reply(msg, {
                parse_mode: "HTML",
                reply_markup: { inline_keyboard: [[{ text: "KEMBALI", callback_data: "menu_cekbio", icon_custom_emoji_id: EMOJI_IDS.BACK }]] }
            })
        }

        let newSessionId = ctx.match[1] ? parseInt(ctx.match[1]) : 1
        if (!newSessionId || activeSids.includes(newSessionId)) {
            newSessionId = 1
            while (activeSids.includes(newSessionId)) {
                newSessionId++
            }
        }

        userState[userId] = { status: "WAITING_WA_PHONE", sessionId: newSessionId }
        await ctx.reply(
            `<b>${EMOJIS.KEY} PAIRING CODE — SESI ${newSessionId}</b>

<blockquote>Kirim nomor WhatsApp kamu untuk mendapat pairing code.
Format: <code>628xxx</code> (tanpa tanda +)</blockquote>

<blockquote expandable><b>Cara Pakai Pairing Code:</b>
1. Dapatkan kode dari bot ini
2. Buka WhatsApp &gt; Pengaturan
3. Perangkat Tertaut &gt; Tautkan Perangkat
4. Pilih <b>Tautkan dengan nomor telepon</b>
5. Masukkan kode 8 digit</blockquote>`,
            { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "BATAL", callback_data: "wa_connect_menu", icon_custom_emoji_id: EMOJI_IDS.CROSS }]] } }
        )
    } finally {
        userLocks.delete(lockKey)
    }
})

const QR_EXPIRY_MS = 5 * 60 * 1000;

bot.action([/^wa_connect_qr(?:_(\d+))?$/, /^wa_qr_refresh_(\d+)$/], async (ctx) => {
    if (!ctx) return
    const userId = ctx.from.id
    const lockKey = "user_" + userId
    if (userLocks.get(lockKey)) {
        return ctx.answerCbQuery("Mohon tunggu...", { show_alert: true })
    }
    userLocks.set(lockKey, true)
    try {
        await ctx.deleteMessage().catch(() => { })
        lastBotActivity = Date.now()
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

        if (activeSids.length >= maxLimit) {
            const msg = `<b>${EMOJIS.CROSS} LIMIT TERCAPAI</b>\n\n<blockquote>Maksimal: <b>${maxLimit} sesi WA aktif</b>.</blockquote>`
            return ctx.reply(msg, {
                parse_mode: "HTML",
                reply_markup: { inline_keyboard: [[{ text: "KEMBALI", callback_data: "menu_cekbio", icon_custom_emoji_id: EMOJI_IDS.BACK }]] }
            })
        }

        let newSessionId = ctx.match[1] ? parseInt(ctx.match[1]) : 1
        if (!newSessionId || activeSids.includes(newSessionId)) {
            newSessionId = 1
            while (activeSids.includes(newSessionId)) {
                newSessionId++
            }
        }

        const sid = newSessionId
        clearUserState(userId);

        const sentLoading = await ctx.reply(
            `<b>${EMOJIS.TIME} Menyiapkan QR Code Sesi ${sid}...</b>`,
            { parse_mode: "HTML" }
        )

        const startTime = Date.now();
        const expiresAt = startTime + QR_EXPIRY_MS;

        userState[userId] = {
            status: "WAITING_QR",
            sessionId: sid,
            msgId: sentLoading.message_id,
            chatId: ctx.chat.id,
            startTime,
            expiresAt,
            qrTimeoutTimer: null,
            qrRefreshTimer: null
        }

        let isConnectedMessageSent = false
        let lastQrMsgId = sentLoading.message_id
        let isFirstQr = true
        let isExpired = false

        userState[userId].qrTimeoutTimer = setTimeout(async () => {
            if (userState[userId]?.status !== "WAITING_QR" || userState[userId]?.sessionId !== sid) return;
            isExpired = true;
            clearUserState(userId);

            if (WaManager.sessions.has(String(userId)) && WaManager.sessions.get(String(userId)).has(sid)) {
                try {
                    const sock = WaManager.sessions.get(String(userId)).get(sid);
                    if (sock) {
                        sock.ev.removeAllListeners();
                        sock.end(undefined);
                    }
                } catch (_) {}
                WaManager.sessions.get(String(userId)).delete(sid);
            }
            const authPath = path.join(__dirname, "../wa_sessions", `session_${userId}_${sid}`);
            if (fs.existsSync(authPath)) {
                try { fs.rmSync(authPath, { recursive: true, force: true }); } catch (_) {}
            }

            const expiredCaption = `<b>${EMOJIS.CROSS} QR CODE EXPIRED</b>\n\n<blockquote>Waktu scan 5 menit telah berakhir.</blockquote>`;

            const expiredKeyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "BUAT QR BARU", callback_data: `wa_connect_qr_${sid}`, icon_custom_emoji_id: EMOJI_IDS.REFRESH }],
                        [{ text: "KEMBALI", callback_data: "menu_cekbio", icon_custom_emoji_id: EMOJI_IDS.BACK }]
                    ]
                }
            };

            try {
                if (lastQrMsgId) {
                    await bot.telegram.editMessageCaption(ctx.chat.id, lastQrMsgId, null, expiredCaption, {
                        parse_mode: "HTML",
                        ...expiredKeyboard
                    }).catch(async () => {
                        await bot.telegram.deleteMessage(ctx.chat.id, lastQrMsgId).catch(() => {});
                        await bot.telegram.sendMessage(ctx.chat.id, expiredCaption, {
                            parse_mode: "HTML",
                            ...expiredKeyboard
                        }).catch(() => {});
                    });
                }
            } catch (_) {}
        }, QR_EXPIRY_MS);

        const cb = async (event, uid, targetSid, data) => {
            if (String(uid) !== String(userId) || Number(targetSid) !== Number(sid)) return
            if (isExpired) return

            if (event === "qr") {
                if (userState[userId]?.status !== "WAITING_QR" || userState[userId]?.sessionId !== sid) return
                const remMs = expiresAt - Date.now();
                if (remMs <= 0) return;

                const remTotalSec = Math.max(1, Math.ceil(remMs / 1000));
                const remMin = Math.floor(remTotalSec / 60);
                const remSec = remTotalSec % 60;
                const remStr = remMin > 0 ? `${remMin}m ${remSec}s` : `${remSec}s`;

                try {
                    const qrBuffer = await WaManager.generateQrBuffer(data)
                    const captionText = `<b>${EMOJIS.QR} SCAN QR CODE (SESI ${sid})</b>

<blockquote>Sesi: <b>Sesi ${sid}</b>
Expired: ~${remStr}
Buka WhatsApp > Perangkat Tertaut > Scan QR.</blockquote>`

                    const qrKeyboard = {
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: "REFRESH QR", callback_data: `wa_qr_refresh_${sid}`, icon_custom_emoji_id: EMOJI_IDS.REFRESH }],
                                [{ text: "BATAL", callback_data: `wa_qr_cancel_${sid}`, icon_custom_emoji_id: EMOJI_IDS.CROSS }]
                            ]
                        }
                    }

                    if (isFirstQr) {
                        isFirstQr = false
                        if (lastQrMsgId) {
                            await bot.telegram.deleteMessage(ctx.chat.id, lastQrMsgId).catch(() => { })
                        }
                        const sentPhoto = await ctx.replyWithPhoto({ source: qrBuffer }, { caption: captionText, parse_mode: "HTML", ...qrKeyboard })
                        lastQrMsgId = sentPhoto.message_id
                        if (userState[userId]) userState[userId].msgId = lastQrMsgId
                    } else {
                        try {
                            await bot.telegram.editMessageMedia(ctx.chat.id, lastQrMsgId, null, {
                                type: "photo",
                                media: { source: qrBuffer },
                                caption: captionText,
                                parse_mode: "HTML"
                            }, qrKeyboard)
                        } catch (_) {
                            if (lastQrMsgId) await bot.telegram.deleteMessage(ctx.chat.id, lastQrMsgId).catch(() => { })
                            const sentPhoto = await ctx.replyWithPhoto({ source: qrBuffer }, { caption: captionText, parse_mode: "HTML", ...qrKeyboard })
                            lastQrMsgId = sentPhoto.message_id
                            if (userState[userId]) userState[userId].msgId = lastQrMsgId
                        }
                    }
                } catch (err) {
                    logger.add("ERROR", `Render QR Error: ${err.message}`)
                }
            } else if (event === "open" && !isConnectedMessageSent) {
                isConnectedMessageSent = true
                clearUserState(userId);
                if (lastQrMsgId) {
                    await bot.telegram.deleteMessage(ctx.chat.id, lastQrMsgId).catch(() => { })
                }
                const phone = WaManager.sessions?.get(String(uid))?.get(Number(sid))?.user?.id?.split(":")[0]?.split("@")[0] || "Terhubung"
                await bot.telegram.sendMessage(uid, `<b>${EMOJIS.CHECK} WA TERHUBUNG — SESI ${sid}</b>\n\n<blockquote>${EMOJIS.DOT_GREEN} Status: <b>Siap Digunakan</b>\n${EMOJIS.PHONE} Nomor: <code>+${phone}</code></blockquote>`, {
                    parse_mode: "HTML",
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "MULAI CEK", callback_data: "wa_check", icon_custom_emoji_id: EMOJI_IDS.ROCKET }],
                            [{ text: "MENU UTAMA", callback_data: "back_home", icon_custom_emoji_id: EMOJI_IDS.BACK }]
                        ]
                    }
                }).catch(() => { })
            } else if (event === "close") {
                const isRestart = data?.isRestartRequired || data?.statusCode === 515;
                if (isRestart) return;
                const isReg = data?.isRegistered;
                if (!isReg && !isConnectedMessageSent && !isExpired && !data?.isHardLogout) {
                    if (userState[userId]?.status === "WAITING_QR" && userState[userId]?.sessionId === sid && Date.now() < expiresAt) {
                        logger.add("WA", `[Auto-Refresh QR] Sesi ${uid}_${sid} reconnecting...`);
                        if (userState[userId].qrRefreshTimer) clearTimeout(userState[userId].qrRefreshTimer);
                        userState[userId].qrRefreshTimer = setTimeout(async () => {
                            if (userState[userId]?.status === "WAITING_QR" && userState[userId]?.sessionId === sid && Date.now() < expiresAt) {
                                try {
                                    await WaManager.startSession(userId, sid, cb);
                                } catch (e) {
                                    logger.add("ERROR", `Auto-refresh QR failed: ${e.message}`);
                                }
                            }
                        }, 1000);
                    }
                }
            }
        }

        await WaManager.requestQr(userId, sid, cb)
    } finally {
        userLocks.delete(lockKey)
    }
})

bot.action(/^wa_qr_cancel_(\d+)$/, async (ctx) => {
    if (!ctx) return
    const userId = ctx.from.id
    const sessionId = parseInt(ctx.match[1])
    const lockKey = "user_" + userId
    if (userLocks.get(lockKey)) {
        return ctx.answerCbQuery("Mohon tunggu...", { show_alert: true })
    }
    userLocks.set(lockKey, true)
    try {
        await ctx.deleteMessage().catch(() => { })
        lastBotActivity = Date.now()
        clearUserState(userId);

        if (WaManager.sessions.has(String(userId)) && WaManager.sessions.get(String(userId)).has(sessionId)) {
            try {
                const sock = WaManager.sessions.get(String(userId)).get(sessionId);
                if (sock) {
                    sock.ev.removeAllListeners();
                    sock.end(undefined);
                }
            } catch (_) { }
            WaManager.sessions.get(String(userId)).delete(sessionId);
        }
        const authPath = path.join(__dirname, "../wa_sessions", `session_${userId}_${sessionId}`);
        if (fs.existsSync(authPath)) {
            try { fs.rmSync(authPath, { recursive: true, force: true }) } catch (_) { }
        }

        await ctx.answerCbQuery("QR dibatalkan", { show_alert: false });
        await showMainMenu(ctx);
    } finally {
        userLocks.delete(lockKey);
    }
})

bot.action("wa_check", async (ctx) => {
    if (!ctx) return
    const userId = ctx.from.id
    const lockKey = "user_" + userId
    if (userLocks.get(lockKey)) {
        return ctx.answerCbQuery("Mohon tunggu...", { show_alert: true })
    }
    userLocks.set(lockKey, true)
    try {
        lastBotActivity = Date.now()
        await ctx.deleteMessage().catch(() => { })

        const status = WaManager.getSessionStatus(userId)
        if (status !== "CONNECTED") {
            return ctx.reply(`<b>${EMOJIS.CROSS} Belum ada sesi WhatsApp terhubung.\nSilakan hubungkan sender terlebih dahulu.</b>`, {
                parse_mode: "HTML",
                reply_markup: { inline_keyboard: [[{ text: "KEMBALI", callback_data: "menu_cekbio", icon_custom_emoji_id: EMOJI_IDS.BACK }]] }
            })
        }

        if (userState[userId]) delete userState[userId]

        const sent = await ctx.reply(
            `<b>${EMOJIS.FOLDER} KIRIM DATA NOMOR</b>\n\n<blockquote>Kirim file (<code>.xlsx</code> / <code>.csv</code> / <code>.txt</code>) atau list nomor (1 per baris, maks <b>50 nomor</b>).\nFormat: <code>628xxx</code></blockquote>`,
            { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "BATAL", callback_data: "menu_cekbio", icon_custom_emoji_id: EMOJI_IDS.CROSS }]] } }
        )

        userState[userId] = { status: "WAITING_CHECK_BIO", speedMode: "brutal", menuId: sent.message_id }
    } finally {
        userLocks.delete(lockKey)
    }
})

bot.action("wa_logout_menu", async (ctx) => {
    if (!ctx) return
    const userId = ctx.from.id
    const lockKey = "user_" + userId
    if (userLocks.get(lockKey)) {
        return ctx.answerCbQuery("Mohon tunggu...", { show_alert: true })
    }
    userLocks.set(lockKey, true)
    try {
        await ctx.deleteMessage().catch(() => { })
        lastBotActivity = Date.now()
        if (userState[userId]) delete userState[userId]
        let activeSessions = []
        if (typeof WaManager.getActiveSessions === "function") {
            activeSessions = WaManager.getActiveSessions(userId)
        } else {
            if (WaManager.getSessionStatus(userId) === "CONNECTED") {
                activeSessions.push({ sessionId: 1, phoneNumber: "Terhubung" })
            }
        }

        if (!activeSessions || activeSessions.length === 0) {
            return ctx.reply(`<b>${EMOJIS.CROSS} Tidak ada sesi aktif saat ini.</b>`, {
                parse_mode: "HTML",
                reply_markup: { inline_keyboard: [[{ text: "KEMBALI", callback_data: "menu_cekbio", icon_custom_emoji_id: EMOJI_IDS.BACK }]] }
            })
        }

        let text = `<b>${EMOJIS.DOOR} LOGOUT SESI</b>\n\n<blockquote>Pilih sesi yang ingin diputus:</blockquote>`
        const buttons = []
        activeSessions.forEach(s => {
            buttons.push([{ text: `LOGOUT SESI ${s.sessionId} (${s.phoneNumber})`, callback_data: `wa_logout_${s.sessionId}`, icon_custom_emoji_id: EMOJI_IDS.CROSS }])
        })
        buttons.push([{ text: "LOGOUT SEMUA", callback_data: "wa_logout_all", icon_custom_emoji_id: EMOJI_IDS.CROSS }])
        buttons.push([{ text: "BATAL", callback_data: "menu_cekbio", icon_custom_emoji_id: EMOJI_IDS.CROSS }])

        await ctx.reply(text, { parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } })
    } finally {
        userLocks.delete(lockKey)
    }
})

bot.action(/^wa_logout_(\d+)$/, async (ctx) => {
    if (!ctx) return
    const userId = ctx.from.id
    const sessionId = parseInt(ctx.match[1])
    const lockKey = "user_" + userId
    if (userLocks.get(lockKey)) {
        return ctx.answerCbQuery("Mohon tunggu...", { show_alert: true })
    }
    userLocks.set(lockKey, true)
    try {
        await ctx.deleteMessage().catch(() => { })
        lastBotActivity = Date.now()
        await WaManager.logout(userId, sessionId)
        await ctx.reply(`<b>${EMOJIS.CHECK} Sesi ${sessionId} berhasil diputus.</b>`, {
            parse_mode: "HTML",
            reply_markup: { inline_keyboard: [[{ text: "KEMBALI", callback_data: "menu_cekbio", icon_custom_emoji_id: EMOJI_IDS.BACK }]] }
        })
    } catch (err) {
        ctx.reply(`<b>${EMOJIS.CROSS} Gagal: ${err.message}</b>`, {
            parse_mode: "HTML",
            reply_markup: { inline_keyboard: [[{ text: "KEMBALI", callback_data: "menu_cekbio", icon_custom_emoji_id: EMOJI_IDS.BACK }]] }
        })
    } finally {
        userLocks.delete(lockKey)
    }
})

bot.action("wa_logout_all", async (ctx) => {
    if (!ctx) return
    const userId = ctx.from.id
    const lockKey = "user_" + userId
    if (userLocks.get(lockKey)) {
        return ctx.answerCbQuery("Mohon tunggu...", { show_alert: true })
    }
    userLocks.set(lockKey, true)
    try {
        await ctx.deleteMessage().catch(() => { })
        lastBotActivity = Date.now()
        await WaManager.logout(userId)
        await ctx.reply(`<b>${EMOJIS.CHECK} Semua sesi WhatsApp berhasil diputus.</b>`, {
            parse_mode: "HTML",
            reply_markup: { inline_keyboard: [[{ text: "KEMBALI", callback_data: "menu_cekbio", icon_custom_emoji_id: EMOJI_IDS.BACK }]] }
        })
    } catch (err) {
        ctx.reply(`<b>${EMOJIS.CROSS} Gagal: ${err.message}</b>`, {
            parse_mode: "HTML",
            reply_markup: { inline_keyboard: [[{ text: "KEMBALI", callback_data: "menu_cekbio", icon_custom_emoji_id: EMOJI_IDS.BACK }]] }
        })
    } finally {
        userLocks.delete(lockKey)
    }
})

bot.action("cancel_cekbio", async (ctx) => {
    if (!ctx) return
    const userId = ctx.from.id
    WaManager.cancelCheckBio(userId)
    WaManager.clearPendingJob(userId)
    await ctx.answerCbQuery("Pengecekan dibatalkan", { show_alert: true })
})

bot.action(/^cekbio_mode_(simpel|detail)$/, async (ctx) => {
    if (!ctx) return
    const userId = ctx.from.id
    const lockKey = "user_" + userId
    if (userLocks.get(lockKey)) {
        return ctx.answerCbQuery("Mohon tunggu...", { show_alert: true })
    }
    userLocks.set(lockKey, true)
    try {
        lastBotActivity = Date.now()
        const mode = ctx.match[1]
        const state = userState[userId]
        if (!state || !state.numbers || state.numbers.length === 0) {
            return ctx.answerCbQuery("Sesi habis atau tidak ada data nomor.", { show_alert: true })
        }

        const numbers = state.numbers
        const speedMode = state.speedMode || "brutal"
        const promptMsgId = state.menuId

        await ctx.answerCbQuery(`Mode ${mode.toUpperCase()} dipilih`, { show_alert: false })
        if (typeof global.executeCheckBioSession === "function") {
            await global.executeCheckBioSession({
                ctx,
                bot,
                userId,
                numbers,
                speedMode,
                reportMode: mode,
                promptMsgId
            })
        }
    } finally {
        userLocks.delete(lockKey)
    }
})

bot.action(["menu_detect", "detect_realtime", "detect_start", "detect_sms_only", "detect_full"], async (ctx) => {
    if (!ctx) return
    const userId = ctx.from.id
    const lockKey = "user_" + userId
    if (userLocks.get(lockKey)) {
        return ctx.answerCbQuery("Mohon tunggu...", { show_alert: true })
    }
    userLocks.set(lockKey, true)
    try {
        lastBotActivity = Date.now()
        const joinStatus = await isJoined(ctx);
        if (!joinStatus.allJoined) return ctx.answerCbQuery("Wajib join semua channel/grup terlebih dahulu!", { show_alert: true })
        await ctx.deleteMessage().catch(() => { })
        if (userState[userId]) delete userState[userId]

        const textMenu = `<b>${EMOJIS.SEARCH} DETECT STATUS OTP</b>

<blockquote>Cek apakah nomor WA sedang <b>cooldown</b> atau <b>siap</b> terima OTP.
Kirim nomor (maks <b>10 nomor</b>, 1 per baris).
Format: <code>628xxx</code></blockquote>

<blockquote expandable><b>Status yang dicek:</b>
${EMOJIS.SMS} <b>SMS</b> — OTP via pesan teks
${EMOJIS.DEVICE} <b>WA Old</b> — via akun WhatsApp lama
${EMOJIS.PHONE_VOICE} <b>Voice</b> — OTP via telepon otomatis</blockquote>`

        const buttons = [
            [{ text: "KEMBALI", callback_data: "back_home", icon_custom_emoji_id: EMOJI_IDS.BACK }]
        ]

        const sent = await ctx.reply(textMenu, { parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } })
        userState[userId] = { status: "WAITING_DETECT", menuId: sent.message_id }
    } finally {
        userLocks.delete(lockKey)
    }
})

bot.action("cancel_detect", async (ctx) => {
    if (!ctx) return
    const userId = ctx.from.id
    if (userState[userId]) delete userState[userId]
    await ctx.answerCbQuery("Detect dibatalkan", { show_alert: false })
})

bot.action("menu_limitin", async (ctx) => {
    if (!ctx) return
    const userId = ctx.from.id
    const lockKey = "user_" + userId
    if (userLocks.get(lockKey)) return ctx.answerCbQuery("Mohon tunggu...", { show_alert: true })
    userLocks.set(lockKey, true)
    try {
        lastBotActivity = Date.now()
        const joinStatus = await isJoined(ctx);
        if (!joinStatus.allJoined) return ctx.answerCbQuery("Wajib join semua channel/grup terlebih dahulu!", { show_alert: true })
        await ctx.deleteMessage().catch(() => { })
        if (userState[userId]) delete userState[userId]

        const textMenu = `<b>${EMOJIS.ROCKET} LIMITIN — REQUEST CODE</b>

<blockquote>Kirim OTP berulang ke nomor WhatsApp target.
Pilih metode request di bawah:</blockquote>

<blockquote expandable><b>Info Metode:</b>
${EMOJIS.DEVICE} <b>WA OLD</b> — Request via akun WA perangkat lama
${EMOJIS.SMS} <b>SMS</b> — Request via kode pesan teks
${EMOJIS.PHONE_VOICE} <b>PANGGILAN</b> — Request via telepon otomatis</blockquote>`

        const buttons = [
            [{ text: "WA OLD / PERANGKAT", callback_data: "limitin_method_wa_old", icon_custom_emoji_id: EMOJI_IDS.DEVICE }],
            [{ text: "SMS", callback_data: "limitin_method_sms", icon_custom_emoji_id: EMOJI_IDS.SMS }],
            [{ text: "PANGGILAN", callback_data: "limitin_method_voice", icon_custom_emoji_id: EMOJI_IDS.PHONE_VOICE }],
            [{ text: "KEMBALI", callback_data: "back_home", icon_custom_emoji_id: EMOJI_IDS.BACK }]
        ]

        await ctx.reply(textMenu, { parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } })
    } finally {
        userLocks.delete(lockKey)
    }
})

bot.action(/^limitin_method_(wa_old|sms|voice)$/, async (ctx) => {
    if (!ctx) return
    const userId = ctx.from.id
    const method = ctx.match[1]
    const methodNames = {
        "wa_old": "WA OLD / PERANGKAT",
        "sms": "SMS",
        "voice": "PANGGILAN"
    }
    const methodName = methodNames[method] || method.toUpperCase()

    const lockKey = "user_" + userId
    if (userLocks.get(lockKey)) return ctx.answerCbQuery("Mohon tunggu...", { show_alert: true })
    userLocks.set(lockKey, true)
    try {
        lastBotActivity = Date.now()
        await ctx.deleteMessage().catch(() => {})
        if (userState[userId]) delete userState[userId]

        const sent = await ctx.reply(
            `<b>${EMOJIS.ROCKET} LIMITIN — ${methodName}</b>

<blockquote>Kirim daftar nomor target (maks <b>5 nomor</b>, 1 per baris).
Format: <code>628xxx</code></blockquote>

<blockquote expandable><b>Detail Proses:</b>
▸ Sistem request OTP hingga <b>5x percobaan</b>
▸ Proses berjalan di <b>background</b> otomatis
▸ Laporan dikirim setelah tiap nomor selesai</blockquote>`,
            { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "BATAL", callback_data: "menu_limitin", icon_custom_emoji_id: EMOJI_IDS.CROSS }]] } }
        )
        userState[userId] = { status: "WAITING_LIMITIN", method: method, methodName: methodName, menuId: sent.message_id }
    } finally {
        userLocks.delete(lockKey)
    }
})

bot.action("cancel_limitin", async (ctx) => {
    if (!ctx) return
    const userId = ctx.from.id
    if (userState[userId]) delete userState[userId]
    if (typeof WaManager.cancelLimitinByUser === "function") {
        WaManager.cancelLimitinByUser(userId)
    }
    await ctx.answerCbQuery("Limitin dibatalkan", { show_alert: false })
})

bot.action(/^cancel_lim_(.+)$/, async (ctx) => {
    if (!ctx) return
    const taskId = ctx.match[1]
    const task = WaManager.cancelLimitinTask ? WaManager.cancelLimitinTask(taskId) : null
    if (task) {
        await ctx.answerCbQuery(`Limitin +${task.number} dibatalkan`, { show_alert: true })
        try {
            await ctx.editMessageText(
                `<b>${EMOJIS.CROSS} LIMITIN DIBATALKAN</b>\n\n<blockquote>Nomor: <code>+${task.number}</code>\nMetode: <b>${task.methodName || "SMS"}</b>\nStatus: Dibatalkan pada percobaan ${task.attempt}/${task.maxAttempts || 5}</blockquote>`,
                {
                    parse_mode: "HTML",
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "LIMITIN LAGI", callback_data: "menu_limitin", icon_custom_emoji_id: EMOJI_IDS.ROCKET }],
                            [{ text: "MENU UTAMA", callback_data: "back_home", icon_custom_emoji_id: EMOJI_IDS.BACK }]
                        ]
                    }
                }
            )
        } catch (_) {}
    } else {
        await ctx.answerCbQuery("Proses Limitin sudah selesai/dibatalkan.", { show_alert: true })
    }
})

bot.action("restart_bot", async (ctx) => {
    if (!ctx) return;
    if (String(ctx.from.id) !== String(config.ownerId)) {
        return ctx.answerCbQuery("Akses ditolak", { show_alert: true });
    }
    lastBotActivity = Date.now();

    await ctx.deleteMessage().catch(() => {});
    await ctx.reply(
        `<b>${EMOJIS.WARN} KONFIRMASI RESTART</b>\n\n<blockquote>Restart seluruh sistem bot?</blockquote>`,
        {
            parse_mode: "HTML",
            reply_markup: {
                inline_keyboard: [
                    [{ text: "YA, RESTART", callback_data: "confirm_restart", icon_custom_emoji_id: EMOJI_IDS.CHECK }],
                    [{ text: "BATAL", callback_data: "action_ownermenu", icon_custom_emoji_id: EMOJI_IDS.CROSS }]
                ]
            }
        }
    );
});

bot.action("confirm_restart", async (ctx) => {
    if (!ctx) return;
    if (String(ctx.from.id) !== String(config.ownerId)) {
        return ctx.answerCbQuery("Akses ditolak", { show_alert: true });
    }
    await ctx.answerCbQuery("Restart dimulai...");
    logger.add("SYSTEM", "Bot restart initiated by owner");

    await ctx.deleteMessage().catch(() => {});
    try {
        await ctx.reply(`<b>${EMOJIS.REFRESH} Sedang restart...</b>`, { parse_mode: "HTML" });
    } catch (e) { }

    setTimeout(() => {
        process.exit(1);
    }, 2000);
});

bot.action("menu_redeem", async (ctx) => {
    if (!ctx) return;
    lastBotActivity = Date.now();
    const joinStatus = await isJoined(ctx);
    if (!joinStatus.allJoined) return ctx.answerCbQuery("Silakan join channel terlebih dahulu.", { show_alert: true });

    userState[ctx.from.id] = { status: "WAITING_REDEEM_CODE" };
    const { text, keyboard } = getRedeemMenuMessage();

    await ctx.editMessageCaption(text, { parse_mode: "HTML", ...keyboard }).catch(async () => {
        await ctx.editMessageText(text, { parse_mode: "HTML", ...keyboard }).catch(async () => {
            await ctx.deleteMessage().catch(() => {});
            await ctx.reply(text, { parse_mode: "HTML", ...keyboard });
        });
    });
});

bot.action("action_ownermenu", async (ctx) => {
    if (!ctx) return;
    lastBotActivity = Date.now();
    if (String(ctx.from.id) !== String(config.ownerId)) {
        return ctx.answerCbQuery("Akses Ditolak!", { show_alert: true });
    }

    await ctx.deleteMessage().catch(() => {});
    if (userState[ctx.from.id]) delete userState[ctx.from.id];
    const { text, keyboard } = await getMainOwnerMenuMessage();
    await ctx.reply(text, { parse_mode: 'HTML', disable_web_page_preview: true, ...keyboard });
});

bot.action("owner_menu_broadcast", async (ctx) => {
    if (!ctx) return;
    lastBotActivity = Date.now();
    if (String(ctx.from.id) !== String(config.ownerId)) return ctx.answerCbQuery("Akses Ditolak!", { show_alert: true });

    await ctx.deleteMessage().catch(() => {});
    if (userState[ctx.from.id]) delete userState[ctx.from.id];
    const { text, keyboard } = getOwnerBroadcastMenuMessage();
    await ctx.reply(text, { parse_mode: 'HTML', disable_web_page_preview: true, ...keyboard });
});

bot.action("owner_menu_redeem", async (ctx) => {
    if (!ctx) return;
    lastBotActivity = Date.now();
    if (String(ctx.from.id) !== String(config.ownerId)) return ctx.answerCbQuery("Akses Ditolak!", { show_alert: true });

    await ctx.deleteMessage().catch(() => {});
    if (userState[ctx.from.id]) delete userState[ctx.from.id];
    const { text, keyboard } = await getOwnerRedeemMenuMessage();
    await ctx.reply(text, { parse_mode: 'HTML', disable_web_page_preview: true, ...keyboard });
});

bot.action("owner_menu_premium", async (ctx) => {
    if (!ctx) return;
    lastBotActivity = Date.now();
    if (String(ctx.from.id) !== String(config.ownerId)) return ctx.answerCbQuery("Akses Ditolak!", { show_alert: true });

    await ctx.deleteMessage().catch(() => {});
    if (userState[ctx.from.id]) delete userState[ctx.from.id];
    const { text, keyboard } = getOwnerPremiumMenuMessage();
    await ctx.reply(text, { parse_mode: 'HTML', disable_web_page_preview: true, ...keyboard });
});

bot.action("owner_log_premium", async (ctx) => {
    if (!ctx) return;
    lastBotActivity = Date.now();
    if (String(ctx.from.id) !== String(config.ownerId)) return ctx.answerCbQuery("Akses Ditolak!", { show_alert: true });

    await ctx.deleteMessage().catch(() => {});
    if (userState[ctx.from.id]) delete userState[ctx.from.id];
    const { text, keyboard } = await getOwnerPremiumLogsMessage();
    await ctx.reply(text, { parse_mode: 'HTML', disable_web_page_preview: true, ...keyboard });
});

bot.action("owner_menu_users", async (ctx) => {
    if (!ctx) return;
    lastBotActivity = Date.now();
    if (String(ctx.from.id) !== String(config.ownerId)) return ctx.answerCbQuery("Akses Ditolak!", { show_alert: true });

    await ctx.deleteMessage().catch(() => {});
    if (userState[ctx.from.id]) delete userState[ctx.from.id];
    const { text, keyboard } = getOwnerUsersMenuMessage();
    await ctx.reply(text, { parse_mode: 'HTML', disable_web_page_preview: true, ...keyboard });
});

bot.action("owner_menu_maintenance", async (ctx) => {
    if (!ctx) return;
    lastBotActivity = Date.now();
    if (String(ctx.from.id) !== String(config.ownerId)) return ctx.answerCbQuery("Akses Ditolak!", { show_alert: true });

    await ctx.deleteMessage().catch(() => {});
    if (userState[ctx.from.id]) delete userState[ctx.from.id];
    const { text, keyboard } = await getOwnerMaintenanceMenuMessage();
    await ctx.reply(text, { parse_mode: 'HTML', disable_web_page_preview: true, ...keyboard });
});

bot.action("owner_toggle_maintenance", async (ctx) => {
    if (!ctx) return;
    lastBotActivity = Date.now();
    if (String(ctx.from.id) !== String(config.ownerId)) return ctx.answerCbQuery("Akses Ditolak!", { show_alert: true });

    await toggleMaintenanceMode();
    await ctx.answerCbQuery(global.IS_MAINTENANCE_MODE ? "Maintenance AKTIF (Premium Dibekukan)" : "Maintenance NONAKTIF (Premium Diperpanjang)", { show_alert: false });
    await ctx.deleteMessage().catch(() => {});
    const { text, keyboard } = await getOwnerMaintenanceMenuMessage();
    await ctx.reply(text, { parse_mode: 'HTML', disable_web_page_preview: true, ...keyboard });
});

bot.action("owner_prompt_bc", async (ctx) => {
    if (!ctx) return;
    lastBotActivity = Date.now();
    if (String(ctx.from.id) !== String(config.ownerId)) return ctx.answerCbQuery("Akses Ditolak!", { show_alert: true });

    await ctx.deleteMessage().catch(() => {});
    userState[ctx.from.id] = { status: "WAITING_OWNER_BC" };
    const promptText = `<b>${EMOJIS.BROADCAST} KIRIM BROADCAST TEKS</b>\n\n<blockquote>Silakan kirimkan pesan teks atau media yang ingin Anda broadcast ke seluruh pengguna bot:</blockquote>`;
    const keyboard = {
        reply_markup: {
            inline_keyboard: [
                [{ text: "BATAL", callback_data: "owner_menu_broadcast", icon_custom_emoji_id: EMOJI_IDS.CROSS }]
            ]
        }
    };
    const sent = await ctx.reply(promptText, { parse_mode: "HTML", ...keyboard });
    userState[ctx.from.id].menuId = sent.message_id;
});

bot.action("owner_unpin_all", async (ctx) => {
    if (!ctx) return;
    lastBotActivity = Date.now();
    if (String(ctx.from.id) !== String(config.ownerId)) return ctx.answerCbQuery("Akses Ditolak!", { show_alert: true });

    await ctx.answerCbQuery("Melepas semua pesan pin...", { show_alert: false });
    await ctx.deleteMessage().catch(() => {});
    const waitMsg = await ctx.reply(`<b>${EMOJIS.TIME} Melepas semua pesan pin...</b>`, { parse_mode: "HTML" });
    const users = await User.find({}).select("userId").lean();
    let count = 0;
    for (const u of users) {
        try {
            if (bot && bot.telegram) await bot.telegram.unpinChatMessage(u.userId).catch(() => {});
            count++;
        } catch (e) {}
    }
    await bot.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
    await ctx.reply(`<b>${EMOJIS.CHECK} Berhasil melepas pin pada ${count} obrolan pengguna.</b>`, {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [[{ text: "KEMBALI", callback_data: "owner_menu_broadcast", icon_custom_emoji_id: EMOJI_IDS.BACK }]] }
    });
});

bot.action("owner_create_code_limit", async (ctx) => {
    if (!ctx) return;
    lastBotActivity = Date.now();
    if (String(ctx.from.id) !== String(config.ownerId)) return ctx.answerCbQuery("Akses Ditolak!", { show_alert: true });

    await ctx.deleteMessage().catch(() => {});
    userState[ctx.from.id] = { status: "WAITING_CREATE_CODE_LIMIT" };
    const promptText = `<b>${EMOJIS.PLUS} BUAT KODE REDEEM LIMIT</b>\n\n<blockquote>Kirim format: <code>JUMLAH_LIMIT [KUOTA_PENGGUNA] [KODE_OPSIONAL]</code>\n\nContoh: <code>10 25 BONUS10</code> (+10 limit, untuk 25 pengguna)</blockquote>`;
    const sent = await ctx.reply(promptText, {
        parse_mode: "HTML",
        reply_markup: {
            inline_keyboard: [[{ text: "BATAL", callback_data: "owner_menu_redeem", icon_custom_emoji_id: EMOJI_IDS.CROSS }]]
        }
    });
    userState[ctx.from.id].menuId = sent.message_id;
});

bot.action("owner_create_code_prem", async (ctx) => {
    if (!ctx) return;
    lastBotActivity = Date.now();
    if (String(ctx.from.id) !== String(config.ownerId)) return ctx.answerCbQuery("Akses Ditolak!", { show_alert: true });

    await ctx.deleteMessage().catch(() => {});
    userState[ctx.from.id] = { status: "WAITING_CREATE_CODE_PREM" };
    const promptText = `<b>${EMOJIS.PREMIUM} BUAT KODE REDEEM PREMIUM</b>\n\n<blockquote>Kirim format: <code>JUMLAH_HARI [KUOTA_PENGGUNA] [KODE_OPSIONAL]</code>\n\nContoh:\n• <code>7 10 PROMO7</code> (7 hari, 10 pengguna)\n• <code>lifetime 1 VIPSELAMANYA</code> (Permanen 1 pengguna)</blockquote>`;
    const sent = await ctx.reply(promptText, {
        parse_mode: "HTML",
        reply_markup: {
            inline_keyboard: [[{ text: "BATAL", callback_data: "owner_menu_redeem", icon_custom_emoji_id: EMOJI_IDS.CROSS }]]
        }
    });
    userState[ctx.from.id].menuId = sent.message_id;
});

bot.action("owner_list_codes", async (ctx) => {
    if (!ctx) return;
    lastBotActivity = Date.now();
    if (String(ctx.from.id) !== String(config.ownerId)) return ctx.answerCbQuery("Akses Ditolak!", { show_alert: true });

    await ctx.deleteMessage().catch(() => {});
    const codes = await RedeemCode.find({}).sort({ createdAt: -1 }).lean();
    if (codes.length === 0) {
        return ctx.reply(`<b>${EMOJIS.NOTE} Belum ada kode redeem yang dibuat.</b>`, {
            parse_mode: "HTML",
            reply_markup: { inline_keyboard: [[{ text: "KEMBALI", callback_data: "owner_menu_redeem", icon_custom_emoji_id: EMOJI_IDS.BACK }]] }
        });
    }

    const listText = codes.map((c, idx) => {
        const typeLabel = c.type === 'premium' ? 'PREMIUM' : 'LIMIT';
        const valLabel = c.type === 'premium' ? (c.amount >= 3650 ? 'Lifetime' : `${c.amount} Hari`) : `+${c.amount} Limit`;
        const quotaLabel = c.maxUses === 0 ? `${c.usedCount}/∞` : `${c.usedCount}/${c.maxUses}`;
        return `<b>#${idx + 1} • <code>${escapeHTML(c.code)}</code></b>\n└ Tipe: <b>${typeLabel}</b> | Hadiah: <b>${valLabel}</b> | Terpakai: <b>${quotaLabel}</b>`;
    }).join('\n\n');

    await ctx.reply(`<b>${EMOJIS.GIFT} DAFTAR KODE REDEEM AKTIF</b>\n\n<blockquote expandable>${listText}</blockquote>`, {
        parse_mode: "HTML",
        reply_markup: {
            inline_keyboard: [[{ text: "KEMBALI", callback_data: "owner_menu_redeem", icon_custom_emoji_id: EMOJI_IDS.BACK }]]
        }
    });
});

bot.action("owner_prompt_setprem", async (ctx) => {
    if (!ctx) return;
    lastBotActivity = Date.now();
    if (String(ctx.from.id) !== String(config.ownerId)) return ctx.answerCbQuery("Akses Ditolak!", { show_alert: true });

    await ctx.deleteMessage().catch(() => {});
    userState[ctx.from.id] = { status: "WAITING_OWNER_SETPREM" };
    const promptText = `<b>${EMOJIS.PREMIUM} TAMBAH PREMIUM USER</b>\n\n<blockquote>Kirim format: <code>ID_USER JUMLAH_HARI</code>\nContoh: <code>12345678 30</code> atau <code>12345678 lifetime</code></blockquote>`;
    const sent = await ctx.reply(promptText, {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [[{ text: "BATAL", callback_data: "owner_menu_premium", icon_custom_emoji_id: EMOJI_IDS.CROSS }]] }
    });
    userState[ctx.from.id].menuId = sent.message_id;
});

bot.action("owner_prompt_delprem", async (ctx) => {
    if (!ctx) return;
    lastBotActivity = Date.now();
    if (String(ctx.from.id) !== String(config.ownerId)) return ctx.answerCbQuery("Akses Ditolak!", { show_alert: true });

    await ctx.deleteMessage().catch(() => {});
    userState[ctx.from.id] = { status: "WAITING_OWNER_DELPREM" };
    const promptText = `<b>${EMOJIS.CROSS} CABUT PREMIUM USER</b>\n\n<blockquote>Kirim <code>ID_USER</code> yang ingin dicabut status Premiumnya:</blockquote>`;
    const sent = await ctx.reply(promptText, {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [[{ text: "BATAL", callback_data: "owner_menu_premium", icon_custom_emoji_id: EMOJI_IDS.CROSS }]] }
    });
    userState[ctx.from.id].menuId = sent.message_id;
});

bot.action("owner_prompt_cekuser", async (ctx) => {
    if (!ctx) return;
    lastBotActivity = Date.now();
    if (String(ctx.from.id) !== String(config.ownerId)) return ctx.answerCbQuery("Akses Ditolak!", { show_alert: true });

    await ctx.deleteMessage().catch(() => {});
    userState[ctx.from.id] = { status: "WAITING_OWNER_CEKUSER" };
    const promptText = `<b>${EMOJIS.SEARCH} CEK DETAIL USER</b>\n\n<blockquote>Kirim <code>ID_USER</code> yang ingin diperiksa:</blockquote>`;
    const sent = await ctx.reply(promptText, {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [[{ text: "BATAL", callback_data: "owner_menu_users", icon_custom_emoji_id: EMOJI_IDS.CROSS }]] }
    });
    userState[ctx.from.id].menuId = sent.message_id;
});

bot.action("owner_prompt_addlimit", async (ctx) => {
    if (!ctx) return;
    lastBotActivity = Date.now();
    if (String(ctx.from.id) !== String(config.ownerId)) return ctx.answerCbQuery("Akses Ditolak!", { show_alert: true });

    await ctx.deleteMessage().catch(() => {});
    userState[ctx.from.id] = { status: "WAITING_OWNER_ADDLIMIT" };
    const promptText = `<b>${EMOJIS.PLUS} TAMBAH LIMIT USER</b>\n\n<blockquote>Kirim format: <code>ID_USER JUMLAH_LIMIT</code>\nContoh: <code>12345678 20</code></blockquote>`;
    const sent = await ctx.reply(promptText, {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [[{ text: "BATAL", callback_data: "owner_menu_users", icon_custom_emoji_id: EMOJI_IDS.CROSS }]] }
    });
    userState[ctx.from.id].menuId = sent.message_id;
});

bot.action("owner_fsub_menu", async (ctx) => {
    if (!ctx) return;
    lastBotActivity = Date.now();
    if (String(ctx.from.id) !== String(config.ownerId)) {
        return ctx.answerCbQuery("Akses Ditolak!", { show_alert: true });
    }

    await ctx.deleteMessage().catch(() => {});
    if (userState[ctx.from.id]) delete userState[ctx.from.id];
    const { text, keyboard } = await getForceSubMenuMessage();
    await ctx.reply(text, { parse_mode: 'HTML', disable_web_page_preview: true, ...keyboard });
});

bot.action("owner_fsub_toggle", async (ctx) => {
    if (!ctx) return;
    lastBotActivity = Date.now();
    if (String(ctx.from.id) !== String(config.ownerId)) {
        return ctx.answerCbQuery("Akses Ditolak!", { show_alert: true });
    }

    global.IS_FORCE_SUB_ENABLED = !global.IS_FORCE_SUB_ENABLED;
    await Setting.findOneAndUpdate(
        { key: "force_sub_enabled" },
        { value: global.IS_FORCE_SUB_ENABLED },
        { upsert: true }
    );
    if (typeof clearJoinCache === "function") clearJoinCache();

    await ctx.answerCbQuery(`Fitur Wajib Join sekarang ${global.IS_FORCE_SUB_ENABLED ? "AKTIF" : "NONAKTIF"}!`, { show_alert: false });

    await ctx.deleteMessage().catch(() => {});
    const { text, keyboard } = await getForceSubMenuMessage();
    await ctx.reply(text, { parse_mode: "HTML", disable_web_page_preview: true, ...keyboard });
});

bot.action("owner_fsub_add", async (ctx) => {
    if (!ctx) return;
    lastBotActivity = Date.now();
    if (String(ctx.from.id) !== String(config.ownerId)) {
        return ctx.answerCbQuery("Akses Ditolak!", { show_alert: true });
    }

    await ctx.deleteMessage().catch(() => {});
    const textPrompt = `<b>${EMOJIS.PLUS} TAMBAH CHANNEL WAJIB JOIN</b>

<blockquote>Silakan kirimkan target channel atau grup:
• <b>Username Publik</b>: <code>@namachannel</code>
• <b>ID Private</b>: <code>-100xxxxxxxxxx</code>
• <b>Link Channel</b>: <code>https://t.me/namachannel</code>

<i>⚠️ Pastikan bot sudah diangkat sebagai <b>ADMIN</b> di channel/grup tersebut dengan izin Invite Users terlebih dahulu!</i></blockquote>`;

    const sent = await ctx.reply(textPrompt, {
        parse_mode: "HTML",
        reply_markup: {
            inline_keyboard: [
                [{ text: "BATAL", callback_data: "owner_fsub_cancel", icon_custom_emoji_id: EMOJI_IDS.CROSS }]
            ]
        }
    });

    userState[ctx.from.id] = {
        status: "WAITING_FSUB_ADD",
        menuId: sent.message_id
    };
});

bot.action("owner_fsub_cancel", async (ctx) => {
    if (!ctx) return;
    lastBotActivity = Date.now();
    if (String(ctx.from.id) !== String(config.ownerId)) {
        return ctx.answerCbQuery("Akses Ditolak!", { show_alert: true });
    }

    delete userState[ctx.from.id];
    await ctx.answerCbQuery("Dibatalkan", { show_alert: false });

    await ctx.deleteMessage().catch(() => {});
    const { text, keyboard } = await getForceSubMenuMessage();
    await ctx.reply(text, { parse_mode: "HTML", disable_web_page_preview: true, ...keyboard });
});

bot.action("owner_fsub_del_menu", async (ctx) => {
    if (!ctx) return;
    lastBotActivity = Date.now();
    if (String(ctx.from.id) !== String(config.ownerId)) {
        return ctx.answerCbQuery("Akses Ditolak!", { show_alert: true });
    }

    const channels = Array.isArray(global.forceSubChannels) ? global.forceSubChannels : [];
    if (channels.length === 0) {
        return ctx.answerCbQuery("Belum ada channel yang terdaftar!", { show_alert: true });
    }

    await ctx.deleteMessage().catch(() => {});
    const buttons = channels.map((c, idx) => {
        const title = c.title || c.username || c.id || `Channel ${idx + 1}`;
        return [{
            text: `HAPUS: ${title}`,
            callback_data: `owner_fsub_del_${idx}`,
            icon_custom_emoji_id: EMOJI_IDS.CROSS
        }];
    });

    buttons.push([
        { text: "HAPUS SEMUA CHANNEL", callback_data: "owner_fsub_del_all", icon_custom_emoji_id: EMOJI_IDS.CROSS }
    ]);
    buttons.push([
        { text: "KEMBALI", callback_data: "owner_fsub_menu", icon_custom_emoji_id: EMOJI_IDS.BACK }
    ]);

    const text = `<b>${EMOJIS.CROSS} HAPUS CHANNEL WAJIB JOIN</b>

<blockquote>Pilih channel yang ingin dihapus dari daftar wajib join:</blockquote>`;

    await ctx.reply(text, {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: buttons }
    });
});

bot.action(/^owner_fsub_del_(\d+)$/, async (ctx) => {
    if (!ctx) return;
    lastBotActivity = Date.now();
    if (String(ctx.from.id) !== String(config.ownerId)) {
        return ctx.answerCbQuery("Akses Ditolak!", { show_alert: true });
    }

    const idx = parseInt(ctx.match[1]);
    if (!Array.isArray(global.forceSubChannels) || !global.forceSubChannels[idx]) {
        return ctx.answerCbQuery("Channel tidak ditemukan!", { show_alert: true });
    }

    const removed = global.forceSubChannels.splice(idx, 1)[0];
    await Setting.findOneAndUpdate(
        { key: "force_sub_channels" },
        { value: global.forceSubChannels },
        { upsert: true }
    );
    if (typeof clearJoinCache === "function") clearJoinCache();

    await ctx.answerCbQuery(`Channel "${removed.title || removed.id}" dihapus!`, { show_alert: true });

    await ctx.deleteMessage().catch(() => {});
    if (global.forceSubChannels.length === 0) {
        const { text, keyboard } = await getForceSubMenuMessage();
        await ctx.reply(text, { parse_mode: "HTML", disable_web_page_preview: true, ...keyboard });
    } else {
        const buttons = global.forceSubChannels.map((c, i) => {
            const title = c.title || c.username || c.id || `Channel ${i + 1}`;
            return [{
                text: `HAPUS: ${title}`,
                callback_data: `owner_fsub_del_${i}`,
                icon_custom_emoji_id: EMOJI_IDS.CROSS
            }];
        });
        buttons.push([
            { text: "HAPUS SEMUA CHANNEL", callback_data: "owner_fsub_del_all", icon_custom_emoji_id: EMOJI_IDS.CROSS }
        ]);
        buttons.push([
            { text: "KEMBALI", callback_data: "owner_fsub_menu", icon_custom_emoji_id: EMOJI_IDS.BACK }
        ]);

        const text = `<b>${EMOJIS.CROSS} HAPUS CHANNEL WAJIB JOIN</b>

<blockquote>Pilih channel yang ingin dihapus dari daftar wajib join:</blockquote>`;

        await ctx.reply(text, { parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } });
    }
});

bot.action("owner_fsub_del_all", async (ctx) => {
    if (!ctx) return;
    lastBotActivity = Date.now();
    if (String(ctx.from.id) !== String(config.ownerId)) {
        return ctx.answerCbQuery("Akses Ditolak!", { show_alert: true });
    }

    global.forceSubChannels = [];
    await Setting.findOneAndUpdate(
        { key: "force_sub_channels" },
        { value: [] },
        { upsert: true }
    );
    if (typeof clearJoinCache === "function") clearJoinCache();

    await ctx.answerCbQuery("Semua channel berhasil dihapus!", { show_alert: true });

    await ctx.deleteMessage().catch(() => {});
    const { text, keyboard } = await getForceSubMenuMessage();
    await ctx.reply(text, { parse_mode: "HTML", disable_web_page_preview: true, ...keyboard });
});

bot.action("owner_fsub_check_admin", async (ctx) => {
    if (!ctx) return;
    lastBotActivity = Date.now();
    if (String(ctx.from.id) !== String(config.ownerId)) {
        return ctx.answerCbQuery("Akses Ditolak!", { show_alert: true });
    }

    const channels = Array.isArray(global.forceSubChannels) ? global.forceSubChannels : [];
    if (channels.length === 0) {
        return ctx.answerCbQuery("Belum ada channel yang dikonfigurasi.", { show_alert: true });
    }

    await ctx.answerCbQuery("Memeriksa status bot di setiap channel...");
    await ctx.deleteMessage().catch(() => {});

    let reportLines = [];
    for (let i = 0; i < channels.length; i++) {
        const c = channels[i];
        const targetId = c.id || c.username;
        const cTitle = escapeHTML(c.title || 'Channel');

        try {
            const me = await bot.telegram.getMe();
            const member = await bot.telegram.getChatMember(targetId, me.id);
            if (['creator', 'administrator'].includes(member.status)) {
                const canInvite = member.can_invite_users ? " (Izin Invite: ✅)" : " (Izin Invite: ❌)";
                reportLines.push(`${EMOJIS.CHECK} <b>${cTitle}</b>\n└ Status: <b>ADMIN</b>${canInvite}`);
            } else {
                reportLines.push(`${EMOJIS.WARN} <b>${cTitle}</b>\n└ Status: <b>BUKAN ADMIN</b> (${member.status})`);
            }
        } catch (e) {
            reportLines.push(`${EMOJIS.CROSS} <b>${cTitle}</b>\n└ Error: <code>${escapeHTML(e.message)}</code>`);
        }
    }

    const reportText = `<b>${EMOJIS.SEARCH} HASIL CEK STATUS ADMIN BOT</b>

<blockquote>Berikut status bot pada channel wajib join:</blockquote>

<blockquote>${reportLines.join('\n\n')}</blockquote>`;

    await ctx.reply(reportText, {
        parse_mode: "HTML",
        reply_markup: {
            inline_keyboard: [
                [{ text: "KEMBALI KE PENGATURAN", callback_data: "owner_fsub_menu", icon_custom_emoji_id: EMOJI_IDS.BACK }]
            ]
        }
    });
});

bot.action("owner_backup", async (ctx) => {
    if (!ctx) return;
    lastBotActivity = Date.now();
    if (String(ctx.from.id) !== String(config.ownerId)) {
        return ctx.answerCbQuery("Akses Ditolak!", { show_alert: true });
    }

    await ctx.answerCbQuery("Membuat backup project...");
    await ctx.deleteMessage().catch(() => {});
    let statusMsg;
    try {
        statusMsg = await ctx.reply(`<b>${EMOJIS.TIME} Mengompres file project...</b>`, { parse_mode: "HTML" });
    } catch (_) {}

    try {
        const backup = await createProjectBackup();

        const caption = `<b>${EMOJIS.BACKUP} BACKUP PROJECT</b>

<blockquote>File: <code>${backup.fileName}</code>
Ukuran: <code>${backup.fileSize}</code> (${backup.fileCount} file)
Waktu: ${formatWaktuGaul()}</blockquote>`;

        await ctx.replyWithDocument(
            { source: backup.buffer, filename: backup.fileName },
            { 
                caption: caption, 
                parse_mode: "HTML",
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "KEMBALI KE OWNER PANEL", callback_data: "action_ownermenu", icon_custom_emoji_id: EMOJI_IDS.BACK }]
                    ]
                }
            }
        );

        if (statusMsg && statusMsg.message_id) {
            await ctx.deleteMessage(statusMsg.message_id).catch(() => {});
        }
        logger.add("SYSTEM", `Backup menu sent (${backup.fileName} - ${backup.fileSize})`);
    } catch (err) {
        logger.add("ERROR", `Backup failed: ${err.message}`, err.stack);
        const errMsg = `<b>${EMOJIS.CROSS} Gagal membuat backup: ${escapeHTML(err.message)}</b>`;
        if (statusMsg && statusMsg.message_id) {
            await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, null, errMsg, { parse_mode: "HTML" }).catch(() => {});
        } else {
            await ctx.reply(errMsg, { parse_mode: "HTML" });
        }
    }
});

bot.action(["menu_leaderboard", "refresh_leaderboard"], async (ctx) => {
    if (!ctx) return;
    lastBotActivity = Date.now();
    const userId = ctx.from.id;
    const lockKey = "user_" + userId;
    if (userLocks.get(lockKey)) return ctx.answerCbQuery("Mohon tunggu...", { show_alert: true });
    userLocks.set(lockKey, true);
    try {
        const isRefresh = ctx.callbackQuery?.data === "refresh_leaderboard";
        if (isRefresh) {
            await ctx.answerCbQuery("Memperbarui Leaderboard...");
        } else {
            const joinStatus = await isJoined(ctx);
            if (!joinStatus.allJoined) return ctx.answerCbQuery("Wajib join semua channel/grup terlebih dahulu!", { show_alert: true });
            await ctx.deleteMessage().catch(() => {});
        }
        delete userState[userId];

        await checkUser(userId, ctx.from);
        const { text, keyboard } = await getLeaderboardMessage(userId);

        if (isRefresh) {
            await ctx.editMessageText(text, { parse_mode: "HTML", ...keyboard }).catch(async () => {
                await ctx.reply(text, { parse_mode: "HTML", ...keyboard });
            });
        } else {
            await ctx.reply(text, { parse_mode: "HTML", ...keyboard });
        }
    } finally {
        userLocks.delete(lockKey);
    }
});

bot.action(["menu_stats", "refresh_stats"], async (ctx) => {
    if (!ctx) return;
    lastBotActivity = Date.now();
    const userId = ctx.from.id;
    const lockKey = "user_" + userId;
    if (userLocks.get(lockKey)) return ctx.answerCbQuery("Mohon tunggu...", { show_alert: true });
    userLocks.set(lockKey, true);
    try {
        const isRefresh = ctx.callbackQuery?.data === "refresh_stats";
        if (isRefresh) {
            await ctx.answerCbQuery("Memperbarui Statistik...");
        } else {
            const joinStatus = await isJoined(ctx);
            if (!joinStatus.allJoined) return ctx.answerCbQuery("Wajib join semua channel/grup terlebih dahulu!", { show_alert: true });
            await ctx.deleteMessage().catch(() => {});
        }
        delete userState[userId];

        await checkUser(userId, ctx.from);
        const { text, keyboard } = await getDetailedStatsMessage(userId);

        if (isRefresh) {
            await ctx.editMessageText(text, { parse_mode: "HTML", ...keyboard }).catch(async () => {
                await ctx.reply(text, { parse_mode: "HTML", ...keyboard });
            });
        } else {
            await ctx.reply(text, { parse_mode: "HTML", ...keyboard });
        }
    } finally {
        userLocks.delete(lockKey);
    }
});

bot.action("menu_panduan", async (ctx) => {
    if (!ctx) return;
    lastBotActivity = Date.now();
    const userId = ctx.from.id;
    const lockKey = "user_" + userId;
    if (userLocks.get(lockKey)) return ctx.answerCbQuery("Mohon tunggu...", { show_alert: true });
    userLocks.set(lockKey, true);
    try {
        const joinStatus = await isJoined(ctx);
        if (!joinStatus.allJoined) return ctx.answerCbQuery("Wajib join semua channel/grup terlebih dahulu!", { show_alert: true });
        delete userState[userId];

        const { text, keyboard } = getPanduanMessage("main");
        await ctx.editMessageText(text, { parse_mode: "HTML", ...keyboard }).catch(async () => {
            await ctx.deleteMessage().catch(() => {});
            await ctx.reply(text, { parse_mode: "HTML", ...keyboard });
        });
    } finally {
        userLocks.delete(lockKey);
    }
});

bot.action("menu_apidocs", async (ctx) => {
    if (!ctx) return;
    lastBotActivity = Date.now();
    const userId = ctx.from.id;
    const lockKey = "user_" + userId;
    if (userLocks.get(lockKey)) return ctx.answerCbQuery("Mohon tunggu...", { show_alert: true });
    userLocks.set(lockKey, true);
    try {
        const text = `<b>${EMOJIS.DOC} DOKUMENTASI API</b>

<blockquote>${EMOJIS.GLOBE} Base URL: <code>https://api.wspro.id</code>
${EMOJIS.BOOK} Docs: <code>https://docs.wspro.dev</code></blockquote>

<blockquote expandable><b>Endpoint Tersedia:</b>
▸ <code>POST /api/cek-bio</code> — cek bio massal
▸ <code>POST /api/detect</code> — cek cooldown OTP
▸ <code>POST /api/limitin</code> — limitin OTP otomatis
▸ <code>GET /api/sessions</code> — info sesi WA aktif
▸ <code>GET /api/me</code> — info akun &amp; sisa limit
▸ <code>POST /api/generate-key</code> — buat API Key
▸ <code>DELETE /api/revoke-key</code> — hapus API Key

Auth: <code>X-API-Key: dl_xxx</code>  ·  Rate limit: <b>30 req/menit</b></blockquote>

<blockquote expandable><b>Cara Dapat API Key:</b>
1. Beli <b>Akses API</b> (klik tombol di bawah)
2. Buka menu <b>AMBIL APIKEY</b>
3. Klik <b>Generate API Key</b>
4. Simpan key — hanya tampil <b>sekali!</b>

Telegram ID kamu: <code>${userId}</code></blockquote>`;

        const keyboard = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "Beli Akses Apikey", callback_data: "menu_buyprem", icon_custom_emoji_id: EMOJI_IDS.PREMIUM }],
                    [{ text: "KEMBALI", callback_data: "back_home", icon_custom_emoji_id: EMOJI_IDS.BACK }]
                ]
            }
        };

        await ctx.editMessageText(text, { parse_mode: "HTML", ...keyboard }).catch(async () => {
            await ctx.deleteMessage().catch(() => {});
            await ctx.reply(text, { parse_mode: "HTML", ...keyboard });
        });
    } finally {
        userLocks.delete(lockKey);
    }
});

bot.action("menu_ambilapikey", async (ctx) => {
    if (!ctx) return;
    lastBotActivity = Date.now();
    const userId = ctx.from.id;
    const lockKey = "user_" + userId;
    if (userLocks.get(lockKey)) return ctx.answerCbQuery("Mohon tunggu...", { show_alert: true });
    userLocks.set(lockKey, true);
    try {
        const user = await checkUser(userId, ctx.from);
        const hasApiAccess = user && user.premium; // or add separate apiAccess field later

        if (hasApiAccess) {
            const text = `<b>${EMOJIS.KEY} AMBIL API KEY</b>

<blockquote>${EMOJIS.CHECK} Akses API kamu <b>aktif</b>!
Klik tombol di bawah untuk generate atau regenerate API Key.
${EMOJIS.WARN} Key lama akan <b>langsung tidak berlaku</b> setelah generate baru.</blockquote>`;
            const keyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "Generate API Key", callback_data: "generate_apikey", icon_custom_emoji_id: EMOJI_IDS.KEY }],
                        [{ text: "Lihat Dokumentasi", callback_data: "menu_apidocs", icon_custom_emoji_id: EMOJI_IDS.DOC }],
                        [{ text: "KEMBALI", callback_data: "back_home", icon_custom_emoji_id: EMOJI_IDS.BACK }]
                    ]
                }
            };
            await ctx.editMessageText(text, { parse_mode: "HTML", ...keyboard }).catch(async () => {
                await ctx.deleteMessage().catch(() => {});
                await ctx.reply(text, { parse_mode: "HTML", ...keyboard });
            });
        } else {
            const text = `<b>${EMOJIS.KEY} AMBIL API KEY</b>

<blockquote>${EMOJIS.CROSS} Belum punya akses API.
Beli <b>Akses API</b> terlebih dahulu untuk bisa generate API Key.</blockquote>

<blockquote expandable><b>Benefit Akses API:</b>
▸ Cek bio massal via REST API
▸ Detect status OTP otomatis
▸ Limitin via API (OTP bomber)
▸ Kelola sesi WA via endpoint
▸ Rate limit <b>30 req/menit</b> per key</blockquote>`;
            const keyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "Beli Akses Apikey", callback_data: "menu_beli_api", icon_custom_emoji_id: EMOJI_IDS.PREMIUM }],
                        [{ text: "KEMBALI", callback_data: "back_home", icon_custom_emoji_id: EMOJI_IDS.BACK }]
                    ]
                }
            };
            await ctx.editMessageText(text, { parse_mode: "HTML", ...keyboard }).catch(async () => {
                await ctx.deleteMessage().catch(() => {});
                await ctx.reply(text, { parse_mode: "HTML", ...keyboard });
            });
        }
    } finally {
        userLocks.delete(lockKey);
    }
});

bot.action("generate_apikey", async (ctx) => {
    if (!ctx) return;
    lastBotActivity = Date.now();
    const userId = ctx.from.id;
    const lockKey = "user_" + userId;
    if (userLocks.get(lockKey)) return ctx.answerCbQuery("Mohon tunggu...", { show_alert: true });
    userLocks.set(lockKey, true);
    try {
        await ctx.answerCbQuery("Generating API Key...", { show_alert: false });

        const user = await User.findOne({ userId: Number(userId) });
        if (!user) {
            return ctx.reply(`<b>${EMOJIS.CROSS} User tidak ditemukan. Start bot dulu.</b>`, { parse_mode: "HTML" });
        }
        if (!user.premium && Number(userId) !== Number(config.ownerId)) {
            return ctx.reply(`<b>${EMOJIS.CROSS} Belum punya akses API. Beli dulu.</b>`, { parse_mode: "HTML" });
        }

        const crypto = require('crypto');
        const newKey = 'dl_' + crypto.randomBytes(24).toString('hex');
        user.apiKey = newKey;
        await user.save();

        logger.add('API', `API Key generated via Telegram for user ${userId}`);

        const text = `<b>${EMOJIS.CHECK} API KEY BERHASIL DIBUAT</b>

<blockquote>${EMOJIS.WARN} Simpan sekarang! Key ini <b>hanya tampil sekali</b>.
Generate ulang akan menginvalidasi key lama.</blockquote>

<code>${newKey}</code>

<blockquote>Cara pakai:
Header: <code>X-API-Key: ${newKey}</code>
Docs: <code>https://docs.wspro.dev</code></blockquote>`;

        const keyboard = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "Lihat Dokumentasi", callback_data: "menu_apidocs", icon_custom_emoji_id: EMOJI_IDS.DOC }],
                    [{ text: "KEMBALI", callback_data: "menu_ambilapikey", icon_custom_emoji_id: EMOJI_IDS.BACK }]
                ]
            }
        };

        await ctx.editMessageText(text, { parse_mode: "HTML", ...keyboard }).catch(async () => {
            await ctx.deleteMessage().catch(() => {});
            await ctx.reply(text, { parse_mode: "HTML", ...keyboard });
        });
    } catch (err) {
        logger.add('ERROR', `Generate apikey telegram: ${err.message}`);
        await ctx.reply(`<b>${EMOJIS.CROSS} Gagal generate: ${err.message}</b>`, { parse_mode: "HTML" });
    } finally {
        userLocks.delete(lockKey);
    }
});

bot.action("menu_beli_api", async (ctx) => {
    if (!ctx) return;
    lastBotActivity = Date.now();
    const userId = ctx.from.id;
    const lockKey = "user_" + userId;
    if (userLocks.get(lockKey)) return ctx.answerCbQuery("Mohon tunggu...", { show_alert: true });
    userLocks.set(lockKey, true);
    try {
        const plans = config.apiPlans || [];
        const text = `<b>${EMOJIS.PREMIUM} BELI AKSES API</b>

<blockquote>Pilih paket akses API:</blockquote>

<blockquote expandable>
• 1 Hari — Rp 8.000
• 3 Hari — Rp 20.000
• 1 Minggu — Rp 50.000
• 1 Bulan — Rp 130.000
• 3 Bulan — Rp 300.000
</blockquote>`;

        const buttons = plans.map(p => ([{
            text: `${p.name} — Rp${p.price.toLocaleString('id-ID')}`,
            callback_data: `buy_api_${p.id}`,
            icon_custom_emoji_id: EMOJI_IDS.PREMIUM
        }]));

        buttons.push([
            { text: "KEMBALI", callback_data: "menu_ambilapikey", icon_custom_emoji_id: EMOJI_IDS.BACK }
        ]);

        const keyboard = { reply_markup: { inline_keyboard: buttons } };

        await ctx.editMessageText(text, { parse_mode: "HTML", ...keyboard }).catch(async () => {
            await ctx.deleteMessage().catch(() => {});
            await ctx.reply(text, { parse_mode: "HTML", ...keyboard });
        });
    } finally {
        userLocks.delete(lockKey);
    }
});

bot.action(/^buy_api_(.+)$/, async (ctx) => {
    if (!ctx) return;
    lastBotActivity = Date.now();
    const userId = ctx.from.id;
    const planId = ctx.match[1];
    const lockKey = "user_" + userId;
    if (userLocks.get(lockKey)) return ctx.answerCbQuery("Mohon tunggu...", { show_alert: true });
    userLocks.set(lockKey, true);
    try {
        await ctx.answerCbQuery("Membuat tagihan QRIS...", { show_alert: false });
        await ctx.deleteMessage().catch(() => {});

        const loadingMsg = await ctx.reply(`<b>${EMOJIS.REFRESH} Menyiapkan tagihan QRIS...</b>`, { parse_mode: "HTML" });

        try {
            // Reuse existing payment system — it will treat api_* plans if added to premiumPlans or handle separately
            // For now, map to existing createInvoice if possible, or show placeholder
            const plan = (config.apiPlans || []).find(p => p.id === planId);
            if (!plan) throw new Error("Paket tidak ditemukan");

            // Temporary: use existing premium invoice flow if PaymentManager supports custom plans
            // Otherwise inform user
            await bot.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id).catch(() => {});

            const text = `<b>${EMOJIS.PREMIUM} TAGIHAN AKSES API</b>

<blockquote>Paket: <b>${plan.name}</b>
Harga: <code>Rp ${plan.price.toLocaleString('id-ID')}</code>
Durasi: <b>${plan.days} Hari</b></blockquote>

<blockquote>Pembayaran via QRIS akan dibuat. Hubungi owner jika pembayaran manual.</blockquote>

<blockquote>Setelah bayar, akses API aktif dan kamu bisa generate API Key.</blockquote>`;

            const keyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "KEMBALI", callback_data: "menu_beli_api", icon_custom_emoji_id: EMOJI_IDS.BACK }]
                    ]
                }
            };

            await ctx.reply(text, { parse_mode: "HTML", ...keyboard });
        } catch (err) {
            await bot.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id).catch(() => {});
            await ctx.reply(`<b>${EMOJIS.CROSS} Gagal membuat tagihan: ${err.message}</b>`, { parse_mode: "HTML" });
        }
    } finally {
        userLocks.delete(lockKey);
    }
});

bot.action(/^panduan_(cekbio|sender|detect_limitin|limit_rules|referral|premium)$/, async (ctx) => {
    if (!ctx) return;
    lastBotActivity = Date.now();
    const userId = ctx.from.id;
    const category = ctx.match[1];
    const lockKey = "user_" + userId;
    if (userLocks.get(lockKey)) return ctx.answerCbQuery("Mohon tunggu...", { show_alert: true });
    userLocks.set(lockKey, true);
    try {
        delete userState[userId];
        const { text, keyboard } = getPanduanMessage(category);
        await ctx.editMessageText(text, { parse_mode: "HTML", ...keyboard }).catch(async () => {
            await ctx.deleteMessage().catch(() => {});
            await ctx.reply(text, { parse_mode: "HTML", ...keyboard });
        });
    } finally {
        userLocks.delete(lockKey);
    }
});

bot.action("menu_buyprem", async (ctx) => {
    if (!ctx) return;
    lastBotActivity = Date.now();
    const userId = ctx.from.id;
    const lockKey = "user_" + userId;
    if (userLocks.get(lockKey)) return ctx.answerCbQuery("Mohon tunggu...", { show_alert: true });
    userLocks.set(lockKey, true);
    try {
        const joinStatus = await isJoined(ctx);
        if (!joinStatus.allJoined) return ctx.answerCbQuery("Wajib join semua channel/grup terlebih dahulu!", { show_alert: true });
        delete userState[userId];

        await checkUser(userId, ctx.from);
        const { text, keyboard } = getBuyPremiumMenu(userId);
        await ctx.editMessageText(text, { parse_mode: "HTML", ...keyboard }).catch(async () => {
            await ctx.deleteMessage().catch(() => {});
            await ctx.reply(text, { parse_mode: "HTML", ...keyboard });
        });
    } finally {
        userLocks.delete(lockKey);
    }
});

bot.action(/^buy_plan_(.+)$/, async (ctx) => {
    if (!ctx) return;
    lastBotActivity = Date.now();
    const userId = ctx.from.id;
    const planId = ctx.match[1];
    const lockKey = "user_" + userId;
    if (userLocks.get(lockKey)) return ctx.answerCbQuery("Mohon tunggu...", { show_alert: true });
    userLocks.set(lockKey, true);
    try {
        await ctx.answerCbQuery("Membuat tagihan QRIS...", { show_alert: false });
        await ctx.deleteMessage().catch(() => {});

        const loadingMsg = await ctx.reply(`<b>${EMOJIS.REFRESH} Menyiapkan tagihan QRIS...</b>`, { parse_mode: "HTML" });

        try {
            const { invoice, apiData, qrBuffer } = await PaymentManager.createInvoice(userId, planId, ctx);
            await bot.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id).catch(() => {});

            const caption = `<b>${EMOJIS.PREMIUM} TAGIHAN QRIS RESMI (PAYQRIS)</b>

<blockquote>${EMOJIS.TAG} Paket: <b>${invoice.planName}</b>
${EMOJIS.CALENDAR} Durasi: <b>${invoice.days >= 3650 ? 'Permanen (Lifetime)' : invoice.days + ' Hari'}</b>
${EMOJIS.STAR} Total Bayar: <code>Rp ${invoice.payAmount.toLocaleString('id-ID')}</code>
${EMOJIS.KEY} Kode Unik: <b>${invoice.uniqueCode}</b>
${EMOJIS.ID} Invoice ID: <code>${invoice.invoiceId}</code>
${EMOJIS.TIME} Batas Waktu: <b>15 Menit</b></blockquote>

<blockquote expandable><b>${EMOJIS.WARN} PENTING & INSTRUKSI:</b>
1. Buka aplikasi M-Banking atau E-Wallet apa saja (BCA, Mandiri, BRI, BNI, Dana, OVO, GoPay, ShopeePay).
2. Scan QRIS di atas.
3. <b>PASTIKAN TRANSFER TEPAT Rp ${invoice.payAmount.toLocaleString('id-ID')}</b> (termasuk kode unik agar otomatis terverifikasi).
4. Klik tombol <b>CEK STATUS PEMBAYARAN</b> setelah transfer, atau tunggu beberapa saat hingga terdeteksi otomatis.</blockquote>`.trim();

            const buttons = [
                [{ text: "CEK STATUS PEMBAYARAN", callback_data: `check_pay_${invoice.invoiceId}`, icon_custom_emoji_id: EMOJI_IDS.CHECK }],
                [{ text: "BATALKAN PEMBAYARAN", callback_data: `cancel_pay_${invoice.invoiceId}`, icon_custom_emoji_id: EMOJI_IDS.CROSS }]
            ];

            if (invoice.checkoutUrl) {
                buttons.splice(1, 0, [{ text: "LINK PEMBAYARAN (WEB)", url: invoice.checkoutUrl, icon_custom_emoji_id: EMOJI_IDS.GLOBE }]);
            }

            if (qrBuffer) {
                await ctx.replyWithPhoto({ source: qrBuffer }, {
                    caption,
                    parse_mode: "HTML",
                    reply_markup: { inline_keyboard: buttons }
                });
            } else if (invoice.qrisUrl) {
                await ctx.replyWithPhoto(invoice.qrisUrl, {
                    caption,
                    parse_mode: "HTML",
                    reply_markup: { inline_keyboard: buttons }
                });
            } else {
                await ctx.reply(caption, {
                    parse_mode: "HTML",
                    reply_markup: { inline_keyboard: buttons }
                });
            }
        } catch (err) {
            await bot.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id).catch(() => {});
            await ctx.reply(`<b>${EMOJIS.CROSS} Gagal membuat tagihan: ${escapeHTML(err.message)}</b>`, {
                parse_mode: "HTML",
                reply_markup: { inline_keyboard: [[{ text: "COBA LAGI", callback_data: "menu_buyprem", icon_custom_emoji_id: EMOJI_IDS.REFRESH }]] }
            });
        }
    } finally {
        userLocks.delete(lockKey);
    }
});

bot.action(/^check_pay_(.+)$/, async (ctx) => {
    if (!ctx) return;
    lastBotActivity = Date.now();
    const userId = ctx.from.id;
    const invoiceId = ctx.match[1];
    const lockKey = "user_" + userId;
    if (userLocks.get(lockKey)) return ctx.answerCbQuery("Mohon tunggu...", { show_alert: true });
    userLocks.set(lockKey, true);
    try {
        await ctx.answerCbQuery("Memeriksa status pembayaran...", { show_alert: false });
        const check = await PaymentManager.checkInvoiceStatus(invoiceId);

        if (check.isPaid) {
            await ctx.answerCbQuery("Pembayaran berhasil diverifikasi!", { show_alert: true });
            await ctx.deleteMessage().catch(() => {});
            return await showMainMenu(ctx);
        } else if (check.isCancelled) {
            await ctx.answerCbQuery("Tagihan ini telah dibatalkan.", { show_alert: true });
            await ctx.deleteMessage().catch(() => {});
            return await showMainMenu(ctx);
        } else if (check.isExpired) {
            await ctx.answerCbQuery("Tagihan telah kedaluwarsa. Silakan buat invoice baru.", { show_alert: true });
            await ctx.deleteMessage().catch(() => {});
            return await showMainMenu(ctx);
        } else {
            await ctx.answerCbQuery("Pembayaran belum masuk. Pastikan sudah transfer sesuai nominal persis beserta kode unik!", { show_alert: true });
        }
    } catch (err) {
        await ctx.answerCbQuery(`Error: ${err.message}`, { show_alert: true });
    } finally {
        userLocks.delete(lockKey);
    }
});

bot.action(/^cancel_pay_(.+)$/, async (ctx) => {
    if (!ctx) return;
    lastBotActivity = Date.now();
    const userId = ctx.from.id;
    const invoiceId = ctx.match[1];
    const lockKey = "user_" + userId;
    if (userLocks.get(lockKey)) return ctx.answerCbQuery("Mohon tunggu...", { show_alert: true });
    userLocks.set(lockKey, true);
    try {
        await PaymentManager.cancelInvoice(invoiceId);
        await ctx.answerCbQuery("Tagihan berhasil dibatalkan.", { show_alert: true });
        await ctx.deleteMessage().catch(() => {});
        return await showMainMenu(ctx);
    } catch (err) {
        await ctx.answerCbQuery("Gagal membatalkan tagihan.", { show_alert: true });
    } finally {
        userLocks.delete(lockKey);
    }
});

bot.action("menu_referral", async (ctx) => {
    if (!ctx) return;
    lastBotActivity = Date.now();
    const userId = ctx.from.id;
    const lockKey = "user_" + userId;
    if (userLocks.get(lockKey)) return ctx.answerCbQuery("Mohon tunggu...", { show_alert: true });
    userLocks.set(lockKey, true);
    try {
        const joinStatus = await isJoined(ctx);
        if (!joinStatus.allJoined) return ctx.answerCbQuery("Wajib join semua channel/grup terlebih dahulu!", { show_alert: true });
        delete userState[userId];

        const user = await checkUser(userId, ctx.from);
        const { text, keyboard } = getReferralMenu(user);
        await ctx.editMessageText(text, { parse_mode: "HTML", ...keyboard }).catch(async () => {
            await ctx.deleteMessage().catch(() => {});
            await ctx.reply(text, { parse_mode: "HTML", ...keyboard });
        });
    } finally {
        userLocks.delete(lockKey);
    }
});

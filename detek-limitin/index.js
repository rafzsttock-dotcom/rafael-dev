require("./core/context");

// Token registry URL is intentionally never printed to stdout/stderr.
const axios = require("axios");
const { createHash, timingSafeEqual } = require("crypto");
const TOKEN_DATABASE_URL = "https://raw.githubusercontent.com/nur900963-maker/tokens.json/main/tokens.json";

// Set TOKEN_GUARD_DEBUG=1 untuk diagnosa (owner only). Tidak pernah print URL / token mentah.
const GUARD_DEBUG = process.env.TOKEN_GUARD_DEBUG === "1";

function guardDebug(...args) {
    if (GUARD_DEBUG) console.error("[TOKEN-GUARD]", ...args);
}

async function isTokenRegistered(token) {
    if (typeof token !== "string" || token.trim().length === 0) {
        return { valid: false, status: "invalid_config" };
    }

    const currentHashHex = createHash("sha256").update(token.trim(), "utf8").digest("hex");
    guardDebug("sha256 token ini:", currentHashHex);

    let raw;
    try {
        // raw.githubusercontent.com di-cache CDN (~5 menit, max-age=300) dan header
        // request "Cache-Control: no-cache" TIDAK menembus cache itu. Query unik per-request
        // membuat cache key berbeda sehingga selalu dapat isi terbaru.
        const response = await axios.get(TOKEN_DATABASE_URL, {
            params: { _: Date.now() },
            timeout: 10000,
            responseType: "text",
            transformResponse: [(data) => data],
            maxContentLength: 128 * 1024,
            maxBodyLength: 128 * 1024,
            headers: {
                Accept: "application/json",
                "Cache-Control": "no-cache, no-store, max-age=0",
                Pragma: "no-cache"
            }
        });
        raw = response.data;
        guardDebug("HTTP", response.status, "bytes:", typeof raw === "string" ? raw.length : "n/a",
            "cache-age:", response.headers && response.headers.age, "etag:", response.headers && response.headers.etag);
    } catch (err) {
        // URL sengaja tidak ikut di-log: axios error.message/config bisa membocorkan URL.
        const httpStatus = err && err.response ? err.response.status : null;
        const code = err && err.code ? err.code : "UNKNOWN";
        guardDebug("fetch gagal. http:", httpStatus, "code:", code);
        return { valid: false, status: "unavailable", reason: httpStatus ? `HTTP_${httpStatus}` : code };
    }

    if (typeof raw !== "string") {
        return { valid: false, status: "invalid_database", reason: "NOT_TEXT" };
    }

    let registry;
    try {
        // Editor Windows kadang menyimpan BOM (\uFEFF) -> JSON.parse gagal.
        registry = JSON.parse(raw.replace(/^\uFEFF/, ""));
    } catch (err) {
        guardDebug("JSON.parse gagal:", err.message);
        return { valid: false, status: "invalid_database", reason: "BAD_JSON" };
    }

    if (!registry || !Array.isArray(registry.tokenHashes)) {
        guardDebug("field tokenHashes tidak ada / bukan array. Keys:", registry ? Object.keys(registry) : null);
        return { valid: false, status: "invalid_database", reason: "NO_TOKENHASHES" };
    }

    // Registry boleh berisi:
    //  (a) SHA-256 hex 64 karakter (DISARANKAN, aman di repo public), atau
    //  (b) token bot mentah "123456:AAxxxx" -> di-hash di sini sebelum dibandingkan.
    // Entri lain (placeholder dll) diabaikan, tidak menggagalkan seluruh registry.
    const HEX64 = /^[a-f0-9]{64}$/i;
    const RAW_TOKEN = /^\d{5,}:[A-Za-z0-9_-]{30,}$/;
    let hashCount = 0, rawCount = 0, ignored = 0;
    const validHashes = [];
    for (const item of registry.tokenHashes) {
        if (typeof item !== "string") { ignored++; continue; }
        const v = item.trim();
        if (HEX64.test(v)) {
            hashCount++;
            validHashes.push(v.toLowerCase());
        } else if (RAW_TOKEN.test(v)) {
            rawCount++;
            validHashes.push(createHash("sha256").update(v, "utf8").digest("hex"));
        } else {
            ignored++;
        }
    }
    guardDebug("entri:", registry.tokenHashes.length, "hash:", hashCount, "token-mentah:", rawCount, "diabaikan:", ignored);
    if (rawCount > 0) {
        guardDebug("PERINGATAN: ada token mentah di registry public. Ganti ke hash & revoke token itu.");
    }

    if (validHashes.length === 0) {
        return { valid: false, status: "invalid_database", reason: "NO_VALID_HASH" };
    }

    const currentHash = Buffer.from(currentHashHex, "hex");
    const registered = validHashes.some((hashText) => {
        const expectedHash = Buffer.from(hashText, "hex");
        return expectedHash.length === currentHash.length && timingSafeEqual(expectedHash, currentHash);
    });

    return { valid: registered, status: registered ? "registered" : "not_registered" };
}

function printPiracyBanner(title, detail) {
    const line = "═".repeat(58);
    const lines = [
        "",
        "\x1b[1;31m╔" + line + "╗\x1b[0m",
        "\x1b[1;31m║\x1b[0m\x1b[1;33m   ████████████████████████████████████████████████████   \x1b[0m\x1b[1;31m║\x1b[0m",
        "\x1b[1;31m║\x1b[0m\x1b[1;37m             ⛔  AKSES DITOLAK  ⛔                         \x1b[0m\x1b[1;31m║\x1b[0m",
        "\x1b[1;31m║\x1b[0m\x1b[1;33m   ████████████████████████████████████████████████████   \x1b[0m\x1b[1;31m║\x1b[0m",
        "\x1b[1;31m╚" + line + "╝\x1b[0m",
        "",
        "  \x1b[1;31m" + title + "\x1b[0m",
        detail ? "  \x1b[90m" + detail + "\x1b[0m" : "",
        "",
        "  \x1b[1;36m🤣 Token bot lu GA TERDAFTAR di database, bos.\x1b[0m",
        "  \x1b[1;36m   Mau nyolong SC orang? Maling aja kok pake bangga 😂\x1b[0m",
        "",
        "  \x1b[1;32m💸 BUY SC RESMI ke  : @lakujr  ya tolol 😂\x1b[0m",
        "  \x1b[1;32m📢 Channel info    : @infoastian\x1b[0m",
        "  \x1b[1;32m👑 Credit / Owner  : @lakujr\x1b[0m",
        "",
        "  \x1b[90mBot dihentikan. Jangan lupa mandi, maling.\x1b[0m",
        ""
    ];
    console.error(lines.join("\n"));
}

const app = express()
app.use(express.json())

async function initDatabaseAndSystem() {
    try {
        logger.add("SYSTEM", "Local JSON Database Connected Successfully");

        let setLog = await Setting.findOne({ key: "channel_log" });
        if (!setLog) {
            setLog = new Setting({ key: "channel_log", value: true });
            await setLog.save();
        }
        IS_CHANNEL_LOG_ACTIVE = setLog.value;

        let setFree = await Setting.findOne({ key: "free_access" });
        if (!setFree) {
            setFree = new Setting({ key: "free_access", value: true });
            await setFree.save();
        }
        IS_FREE_ACCESS_ACTIVE = setFree.value;

        let setSlot = await Setting.findOne({ key: "max_prem_slots" });
        if (!setSlot) {
            setSlot = new Setting({ key: "max_prem_slots", value: 35 });
            await setSlot.save();
        }
        MAX_PREM_SLOTS = parseInt(setSlot.value) || 35;

        let setMt = await Setting.findOne({ key: "maintenance_mode" });
        if (!setMt) {
            setMt = new Setting({ key: "maintenance_mode", value: false });
            await setMt.save();
        }
        IS_MAINTENANCE_MODE = Boolean(setMt.value);

        let setFsubEnabled = await Setting.findOne({ key: "force_sub_enabled" });
        if (!setFsubEnabled) {
            setFsubEnabled = new Setting({ key: "force_sub_enabled", value: true });
            await setFsubEnabled.save();
        }
        IS_FORCE_SUB_ENABLED = Boolean(setFsubEnabled.value);

        let setFsubChannels = await Setting.findOne({ key: "force_sub_channels" });
        if (!setFsubChannels) {
            let initial = [];
            if (Array.isArray(config.forceSub) && config.forceSub.length > 0) {
                initial = config.forceSub.map(c => {
                    if (typeof c === 'object' && c !== null) return c;
                    const s = String(c).trim();
                    return {
                        id: s,
                        title: s.startsWith('@') ? s.slice(1) : s,
                        username: s.startsWith('@') ? s : '',
                        inviteLink: ''
                    };
                });
            }
            setFsubChannels = new Setting({ key: "force_sub_channels", value: initial });
            await setFsubChannels.save();
        }
        global.forceSubChannels = Array.isArray(setFsubChannels.value) ? setFsubChannels.value : [];

        logger.add("SYSTEM", `Log Channel: ${IS_CHANNEL_LOG_ACTIVE ? "ON" : "OFF"} | Maintenance: ${IS_MAINTENANCE_MODE ? "ON" : "OFF"} | ForceSub: ${IS_FORCE_SUB_ENABLED ? "ON" : "OFF"} (${(global.forceSubChannels || []).length} ch)`);

        logger.add("SYSTEM", "Loading WhatsApp Sessions...");
        await WaManager.loadSessions((event, uid) => {
            if (event === "open") logger.add("WA", `Session ${uid} Reconnected`);
            if (event === "log") logger.add("WA", uid);
        });

        setTimeout(async () => {
            if (!bot || !bot.telegram) return;
            const pending = WaManager.getPendingJobs();
            if (pending.length > 0) logger.add("SYSTEM", `Resuming ${pending.length} pending CekBio jobs...`);
            
            for (const job of pending) {
                const userId = job.userId;
                const originalTotal = job.originalTotal;
                const remaining = job.pendingNumbers.length;
                
                if (remaining === 0) {
                    WaManager.checkBio(userId, [], job.speedMode, null, true).catch(()=>{});
                    continue;
                }

                try {
                    let msgProses = await bot.telegram.sendMessage(
                        userId, 
                        `<b>${EMOJIS.REFRESH} MELANJUTKAN PENGECEKAN</b>\n\n<blockquote>Sisa: <b>${remaining}</b> dari <b>${originalTotal}</b> nomor.</blockquote>`,
                        { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "BATALKAN", callback_data: "cancel_cekbio", icon_custom_emoji_id: EMOJI_IDS.CROSS }]] } }
                    );

                    let waReady = false;
                    let cancelled = false;
                    for (let i = 0; i < 45; i++) {
                        if (typeof WaManager.isCancelled === "function" && WaManager.isCancelled(userId)) {
                            cancelled = true;
                            break;
                        }
                        if (typeof WaManager.isSessionReady === "function" && WaManager.isSessionReady(userId)) {
                            waReady = true;
                            break;
                        }
                        await new Promise(r => setTimeout(r, 2000));
                    }

                    if (cancelled && !waReady) {
                        if (typeof WaManager.clearPendingJob === "function") WaManager.clearPendingJob(userId);
                        await bot.telegram.editMessageText(userId, msgProses.message_id, null, `<b>${EMOJIS.CHECK} Pengecekan dibatalkan.</b>`, { parse_mode: "HTML" }).catch(()=>{});
                        continue;
                    }

                    if (!waReady) {
                        await bot.telegram.editMessageText(userId, msgProses.message_id, null, `<b>${EMOJIS.CROSS} Gagal melanjutkan: Sesi WA tidak merespon.</b>`, { parse_mode: "HTML" }).catch(()=>{});
                        continue;
                    }

                    let isChecking = true;
                    let currentProcessed = originalTotal - remaining;

                    const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
                    let frameIdx = 0;
                    const startCheckTime = Date.now();

                    const runAnimation = async () => {
                        if (!isChecking || !bot) return;
                        frameIdx = (frameIdx + 1) % frames.length;
                        
                        let elapsed = Date.now() - startCheckTime;
                        let processDalamSesiIni = currentProcessed - (originalTotal - remaining);
                        let etaStr = "Menghitung...";
                        
                        if (processDalamSesiIni > 0) {
                            let msPerItem = elapsed / processDalamSesiIni;
                            let remainingMs = msPerItem * (originalTotal - currentProcessed);
                            let etaMin = Math.floor(remainingMs / 60000);
                            let etaSec = Math.floor((remainingMs % 60000) / 1000);
                            etaStr = etaMin > 0 ? `${etaMin}m ${etaSec}s` : `${etaSec}s`;
                        }
                        
                        const text = `<b>${frames[frameIdx]} CEK BIO: ${originalTotal} NOMOR</b>\n\n<blockquote>Progress: ${currentProcessed} / ${originalTotal}\nEstimasi: ${etaStr}</blockquote>`;
                        
                        try {
                            await bot.telegram.editMessageText(userId, msgProses.message_id, null, text, {
                                parse_mode: "HTML",
                                reply_markup: { inline_keyboard: [[{ text: "BATALKAN", callback_data: "cancel_cekbio", icon_custom_emoji_id: EMOJI_IDS.CROSS }]] }
                            });
                        } catch (e) {}
                        
                        if (isChecking) setTimeout(runAnimation, 2500);
                    };
                    
                    setTimeout(runAnimation, 2500);

                    WaManager.checkBio(userId, [], job.speedMode, (current, total) => {
                        currentProcessed = current;
                    }, true).then(async (results) => {
                        isChecking = false;
                        if (bot && bot.telegram) await bot.telegram.deleteMessage(userId, msgProses.message_id).catch(()=>{});
                        
                        const totalRegistered = results.business.length + results.private.length + results.repe.length;
                        const totalUnregistered = results.invalid.length;
                        const totalChecked = totalRegistered + totalUnregistered;

                        if (totalChecked > 0) {
                            await User.updateOne({ userId: userId }, {
                                $inc: { totalChecked: totalChecked, totalCekBio: totalChecked, totalCekBioSessions: 1 },
                                $set: { lastInteraction: Date.now() }
                            }).catch(e => logger.add('ERROR', `Failed to update user stats: ${e.message}`));
                            await Setting.findOneAndUpdate(
                                { key: "total_checked_all" },
                                { $inc: { value: totalChecked } },
                                { upsert: true }
                            ).catch(e => logger.add('ERROR', `Failed to update total_checked_all: ${e.message}`));
                            userCache.delete(userId);
                        }
                        const allValid = [...results.repe, ...results.business, ...results.private];
                        const withBio = allValid.filter(x => x.hasBio).length;
                        const noBio = allValid.length - withBio;
                        
                        const metaVerifiedCount = results.business.filter(x => x.isVerified).length;
                        const normalBusinessCount = results.business.length - metaVerifiedCount;

                        const durationMs = Date.now() - startCheckTime;
                        const durMenit = Math.floor(durationMs / 60000);
                        const durDetik = Math.floor((durationMs % 60000) / 1000);
                        const durasiStr = durMenit > 0 ? `${durMenit}m ${durDetik}s` : `${durDetik}s`;

                        const remainingList = results.remainingNumbers || [];
                        const remainingCount = remainingList.length;
                        const isInterrupted = results.senderLoggedOut || results.isCancelled || remainingCount > 0;

                        if (isInterrupted && remainingCount > 0) {
                            if (totalChecked > 0) {
                                const { filePath: repPath, fileName: repName } = await WaManager.generateReport(results);
                                const partialCaption = `<b>${EMOJIS.WARN} PROSES TERHENTI (${results.senderLoggedOut ? "SENDER LOGOUT" : "DIBATALKAN"})</b>\n\n<blockquote>Tercek: ${totalChecked} / ${originalTotal}\nSisa: ${remainingCount} nomor\nDurasi: ${durasiStr}</blockquote>`.trim();

                                if (bot && bot.telegram) {
                                    await bot.telegram.sendDocument(userId, { source: fs.createReadStream(repPath), filename: repName }, {
                                        caption: partialCaption,
                                        parse_mode: "HTML"
                                    });
                                }
                                fs.unlink(repPath, () => {});
                            }

                            const { filePath: remPath, fileName: remName } = await WaManager.generateRemainingFile(remainingList);
                            const sisaCaption = `<b>${EMOJIS.FOLDER} SISA NOMOR (${remainingCount} NOMOR)</b>\n\n<blockquote>File sisa nomor yang belum sempat dicek.</blockquote>`.trim();

                            if (bot && bot.telegram) {
                                await bot.telegram.sendDocument(userId, { source: fs.createReadStream(remPath), filename: remName }, {
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
                            const { filePath, fileName } = await WaManager.generateReport(results);
                            const combinedCaption = WaManager.formatCekBioCaption(results, originalTotal);
                            
                            if (bot && bot.telegram) await bot.telegram.sendDocument(userId, { source: fs.createReadStream(filePath), filename: fileName }, { 
                                caption: combinedCaption, 
                                parse_mode: "HTML",
                                reply_markup: { inline_keyboard: [
                                    [{ text: "CEK BIO LAGI", callback_data: "menu_cekbio", icon_custom_emoji_id: EMOJI_IDS.DOC }],
                                    [{ text: "KEMBALI", callback_data: "back_home", icon_custom_emoji_id: EMOJI_IDS.BACK }]
                                ] }
                            });
                            fs.unlink(filePath, () => {});
                        }
                    }).catch(err => {
                        isChecking = false;
                        if (bot && bot.telegram) bot.telegram.sendMessage(userId, `<b>${EMOJIS.CROSS} Gagal: ${err.message}</b>`, { parse_mode: "HTML" }).catch(()=>{});
                    });

                } catch (e) {
                    logger.add("ERROR", `Failed to resume job for ${userId}: ${e.message}`);
                    if (typeof WaManager.clearPendingJob === "function") WaManager.clearPendingJob(userId);
                }
                await new Promise(r => setTimeout(r, 1000));
            }
        }, 5000);

        const userCount = await User.countDocuments();
        await updateStatsCache();
        logger.showStatus(config.botUsername, userCount, 0, 0);
    } catch (e) {
        logger.add("ERROR", `Initial Sync Error: ${e.message}`, e.stack);
    }
}

function initializeBot() {
    if (restartTimer) {
        clearTimeout(restartTimer)
        restartTimer = null
    }

    bot = new Telegraf(config.botToken, {
        telegram: {
            agent: new https.Agent({ keepAlive: true, family: 4 })
        }
    })

    const originalCallApi = bot.telegram.callApi.bind(bot.telegram)

    bot.telegram.callApi = async (method, payload, options) => {
        let retries = 3;
        while (retries > 0) {
            try {
                return await originalCallApi(method, payload, options)
            } catch (error) {
                if (error.code === 403) {
                    const targetId = payload && (payload.chat_id || payload.user_id);
                    if (targetId && !isNaN(targetId) && Number(targetId) > 0 && String(targetId) !== String(config.ownerId)) {
                        const uid = Number(targetId);
                        User.deleteOne({ userId: uid }).catch(() => {});
                        if (typeof WaManager.clearPendingJob === "function") WaManager.clearPendingJob(uid);
                        userCache.delete(uid);
                        logger.add("SYSTEM", `Auto-Wipe: User ${uid} blocked the bot (403 Forbidden).`);
                    }
                    throw error;
                }
                if (error.code === 429) {
                    const retryAfter = (error.parameters && error.parameters.retry_after) || 1
                    await new Promise(r => setTimeout(r, (retryAfter * 1000) + 100))
                    continue;
                }
                if (error.message && (error.message.includes("ECONNRESET") || error.message.includes("ETIMEDOUT") || error.message.includes("socket hang up") || error.message.includes("timeout"))) {
                    retries--;
                    if (retries === 0) throw error;
                    await new Promise(r => setTimeout(r, 2000));
                    continue;
                }
                throw error
            }
        }
    }

    bot.use(async (ctx, next) => {
        if (ctx.message && ctx.message.text && ctx.message.text.startsWith("/")) {
            if (ctx.from && userState[ctx.from.id]) {
                delete userState[ctx.from.id]
            }
        }

        if (!ctx.from) return next();
        let isIntentional = false;
        if (ctx.callbackQuery) isIntentional = true;
        else if (ctx.message && ctx.message.text && ctx.message.text.startsWith("/")) isIntentional = true;
        else if (ctx.from && userState[ctx.from.id]) isIntentional = true;

        if (isIntentional) {
            const user = await checkUser(ctx.from.id, ctx.from);
            if (user && user.isBanned) {
                if (ctx.updateType === "message") {
                    return ctx.reply(`<b>${EMOJIS.CROSS} Akses diblokir permanen.</b>`, { parse_mode: "HTML" });
                }
                return;
            }

            if (IS_MAINTENANCE_MODE && ctx.from && String(ctx.from.id) !== String(config.ownerId)) {
                const isPrem = Boolean(user && user.premium);
                const premNotice = isPrem
                    ? `\n\n<blockquote>${EMOJIS.SHIELD} <b>Info Pengguna Premium:</b>\nMasa aktif akun Premium Anda saat ini <b>dibekukan (tidak berkurang)</b> dan akan otomatis diperpanjang setelah pemeliharaan selesai.</blockquote>`
                    : '';
                if (ctx.callbackQuery) {
                    ctx.answerCbQuery("Bot sedang dalam perbaikan sistem. Masa aktif Premium dibekukan!", { show_alert: true }).catch(() => {});
                    return;
                }
                if (ctx.message) {
                    ctx.reply(`<b>${EMOJIS.GEAR} SISTEM SEDANG DALAM PEMELIHARAAN</b>\n\n<blockquote>Mohon maaf, bot sedang dalam perbaikan rutin. Silakan coba beberapa saat lagi.</blockquote>${premNotice}`, { parse_mode: "HTML" }).catch(() => {});
                    return;
                }
                return;
            }
        }

        return next()
    })

    bot.catch((err, ctx) => {
        logger.add("ERROR", `Bot Runtime Error: ${err.message}`, err.stack)
        lastBotActivity = Date.now()
    })
    require("./handlers/commands")
    require("./handlers/actions")
    require("./handlers/events")
}

function restartBot() {
    if (restartCount >= MAX_RESTARTS) {
        logger.add("CRITICAL", "Maximum restart attempts reached. Bot stopping...")
        try {
            if (bot && bot.telegram) bot.telegram.sendMessage(config.ownerId, `<b>${EMOJIS.CROSS} Bot mencapai batas restart maksimal.</b>`, { parse_mode: "HTML" }).catch(() => {})
        } catch (e) {}
        process.exit(1)
    }

    restartCount++
    logger.add("SYSTEM", `Restarting bot in ${RESTART_DELAY/1000}s... Attempt ${restartCount}/${MAX_RESTARTS}`)

    if (bot) {
        try { Promise.resolve(bot.stop("restart")).catch(() => {}) } catch (e) {}
        bot = null
    }

    setTimeout(() => {
        process.exit(1)
    }, RESTART_DELAY)
}
global.restartBot = restartBot;

function startWatchdog() {
    setInterval(async () => {
        try {
            if (!bot) {
                logger.add("WATCHDOG", "Bot instance null, restarting...")
                watchdogFails++
                if (watchdogFails >= MAX_WATCHDOG_FAILS) restartBot()
                return
            }

            const inactive = Date.now() - lastBotActivity > 5 * 60 * 1000
            if (inactive) {
                logger.add("WATCHDOG", "Bot inactive for 5 minutes, restarting...")
                watchdogFails++
                if (watchdogFails >= MAX_WATCHDOG_FAILS) restartBot()
                else lastBotActivity = Date.now()
            } else {
                watchdogFails = 0
            }

        } catch (err) {
            logger.add("WATCHDOG", `Health check error: ${err.message}`, err.stack)
            watchdogFails++
            if (watchdogFails >= MAX_WATCHDOG_FAILS) restartBot()
        }
    }, WATCHDOG_INTERVAL)
}

async function startAll() {
    await initDatabaseAndSystem();

    const PORT = process.env.SERVER_PORT || process.env.PORT || 5055

    app.get("/", (req, res) => res.send("Bot is Alive!"))
    app.get("/health", (req, res) => {
        const status = bot ? "running" : "restarting"
        res.json({ status, uptime: process.uptime(), restartCount, watchdogFails, dbState: "connected_local_json" })
    })

    app.post('/api/webhook/austinpay', async (req, res) => {
        try {
            const payload = req.body;
            logger.add('PAYMENT', `Webhook diterima dari AustinPay: ${JSON.stringify(payload)}`);
    if (payload && (payload.event === 'payment.paid' || payload.event === 'deposit.paid' || String(payload.status).toLowerCase() === 'paid')) {
        const invoiceId = payload.transaction_id || payload.invoice_id || payload.reference_id;
                if (invoiceId) {
                    const check = await PaymentManager.checkInvoiceStatus(invoiceId);
                    logger.add('PAYMENT', `Webhook memproses invoice ${invoiceId}: ${check.status}`);
                }
            }
            res.json({ success: true });
        } catch (err) {
            logger.add('ERROR', `Webhook error: ${err.message}`);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // Register API routes
    try {
        const { registerApiRoutes } = require('./core/api');
        registerApiRoutes(app);
    } catch (e) {
        logger.add('WARN', `API routes failed to load: ${e.message}`);
    }

    try {
        const server = app.listen(PORT, () => {
            logger.add("SYSTEM", `Server running on port ${PORT}`)
        })
        server.on("error", (err) => {
            logger.add("WARN", `Express server error on port ${PORT}: ${err.message}`)
        })
    } catch (err) {
        logger.add("WARN", `Could not bind Express to port ${PORT}: ${err.message}`)
    }

    initializeBot()
    startWatchdog()
    PaymentManager.startPoller()

    // Scheduler Reset Jam 12 Malam WIB (00:00 WIB)
    let lastMidnightResetDate = getTodayDate();
    setInterval(async () => {
        const today = getTodayDate();
        if (today !== lastMidnightResetDate) {
            lastMidnightResetDate = today;
            logger.add('SYSTEM', `[RESET WIB] Jam 12 Malam WIB (00:00). Melakukan reset limit harian 5x untuk user Free...`);
            try {
                await User.updateMany(
                    { premium: { $ne: true } },
                    { $set: { limit: 5, lastReset: today } }
                );
                if (global.userCache) {
                    global.userCache.clear();
                }
                logger.add('SYSTEM', `[RESET WIB] Sukses reset kuota limit user Free.`);
            } catch (e) {
                logger.add('ERROR', `[RESET WIB] Gagal reset limit: ${e.message}`);
            }
        }
    }, 30000);

    setInterval(() => {
        const now = Date.now()
        for (const [userId, timestamps] of userRateLimiter.entries()) {
            const filtered = timestamps.filter(ts => now - ts < 5 * 60 * 1000)
            if (filtered.length === 0) {
                userRateLimiter.delete(userId)
            } else {
                userRateLimiter.set(userId, filtered)
            }
        }
    }, 60 * 60 * 1000)

    setInterval(updateStatsCache, 60000);

    // Notifikasi API plan mau expired (5 jam sebelum)
    setInterval(async () => {
        if (!bot || !bot.telegram) return;
        try {
            const now = Date.now();
            const fiveHours = 5 * 60 * 60 * 1000;
            // Cari user yang plan-nya expired dalam 5 jam dan belum dinotif
            const expiringUsers = await User.find({
                apiPlanExpiry: { $gt: now, $lte: now + fiveHours },
                apiPlanId: { $ne: '' }
            }).lean();

            for (const u of expiringUsers) {
                // Skip kalau sudah dinotif dalam 5 jam terakhir
                if (u.apiExpiryNotifiedAt && now - u.apiExpiryNotifiedAt < fiveHours) continue;

                const msLeft = u.apiPlanExpiry - now;
                const hLeft = Math.floor(msLeft / 3600000);
                const mLeft = Math.floor((msLeft % 3600000) / 60000);
                const timeStr = hLeft > 0 ? `${hLeft} jam ${mLeft} menit` : `${mLeft} menit`;

                const notifText = `<b>⚠️ API PLAN HAMPIR EXPIRED!</b>

<blockquote>Paket API kamu akan expired dalam <b>${timeStr}</b>!</blockquote>

<blockquote>Perpanjang sekarang agar akses API tidak terputus.
Jika tidak diperpanjang, API Key otomatis nonaktif saat expired.</blockquote>`;

                try {
                    await bot.telegram.sendMessage(u.userId, notifText, {
                        parse_mode: 'HTML',
                        reply_markup: {
                            inline_keyboard: [[
                                { text: "🔄 PERPANJANG SEKARANG", callback_data: "menu_beli_api" }
                            ]]
                        }
                    });
                    await User.updateOne({ userId: u.userId }, { $set: { apiExpiryNotifiedAt: now } });
                } catch (_) { /* user mungkin blokir bot */ }
            }
        } catch (e) {
            logger.add('ERROR', `API expiry notif error: ${e.message}`);
        }
    }, 30 * 60 * 1000); // cek setiap 30 menit

    setInterval(() => {
        userCache.clear();
        logger.add("SYSTEM", "User Cache Cleared");
    }, 10 * 60 * 1000);

    require('events').EventEmitter.defaultMaxListeners = 100;
    process.removeAllListeners("uncaughtException");
    process.removeAllListeners("unhandledRejection");

    const NON_FATAL_PATTERNS = [
        "ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "ENOTFOUND", "EHOSTUNREACH",
        "socket hang up", "rate-overlimit", "Connection Closed", "Bad MAC", "Stream Errored",
        "QR refs", "conflict", "EBUSY", "EEXIST", "429", "retry after",
        "bot was blocked by the user", "message is not modified", "query is too old",
        "user is deactivated", "chat not found", "cannot parse entities", "gateway timeout",
        "ERR_HTTP2_GOAWAY", "EPIPE"
    ];

    process.on("uncaughtException", (err) => {
        const errText = `${err?.message || ''} ${err?.stack || ''}`;
        const isNonFatal = NON_FATAL_PATTERNS.some(k => errText.includes(k));
        if (isNonFatal) {
            logger.add("WARN", `Handled non-fatal exception: ${err?.message || err}`);
            return;
        }
        logger.add("CRITICAL", `Uncaught Exception: ${err?.message}`, err?.stack);
        try {
            if (bot && bot.telegram) bot.telegram.sendMessage(config.ownerId, `<b>${EMOJIS.CROSS} UNCAUGHT EXCEPTION</b>\n\n<blockquote>Error: ${escapeHTML(err?.message || String(err))}</blockquote>`, { parse_mode: "HTML" }).catch(() => {});
        } catch (e) {}
        restartBot();
    });

    process.on("unhandledRejection", (reason, promise) => {
        const reasonStr = reason instanceof Error ? reason.message : String(reason);
        const stack = reason instanceof Error ? reason.stack : "";
        if (reasonStr.includes("ENOENT") && reasonStr.includes("creds.json")) return;
        if (reasonStr.includes("Bot is not running")) return;
        
        const isNonFatal = NON_FATAL_PATTERNS.some(k => reasonStr.includes(k) || stack.includes(k));
        if (isNonFatal) {
            logger.add("WARN", `Handled non-fatal rejection: ${reasonStr}`);
            return;
        }
        logger.add("CRITICAL", `Unhandled Rejection: ${reasonStr}`, stack);
        try {
            if (bot && bot.telegram) bot.telegram.sendMessage(config.ownerId, `<b>${EMOJIS.CROSS} UNHANDLED REJECTION</b>\n\n<blockquote>Alasan: ${escapeHTML(reasonStr)}</blockquote>`, { parse_mode: "HTML" }).catch(() => {});
        } catch (e) {}
    });

    process.once("SIGINT", async () => {
        logger.add("SYSTEM", "Received SIGINT, shutting down...")
        try { if (bot) await Promise.resolve(bot.stop("SIGINT")).catch(() => {}) } catch (_) {}
        process.exit(0)
    })

    process.once("SIGTERM", async () => {
        logger.add("SYSTEM", "Received SIGTERM, shutting down...")
        try { if (bot) await Promise.resolve(bot.stop("SIGTERM")).catch(() => {}) } catch (_) {}
        process.exit(0)
    })


    setInterval(async () => {
        if (bot) {
            try {
                await bot.telegram.getMe()
                lastBotActivity = Date.now()
            } catch (err) {
                logger.add("CRITICAL", `Bot health check failed: ${err.message}.`, err.stack)
            }
        }
    }, 60 * 1000)

    setInterval(() => {
        const now = Date.now()
        let cleaned = 0
        for (const [userId, state] of Object.entries(userState)) {
            if (!state.timestamp) {
                state.timestamp = now;
            }
            if (now - state.timestamp > 10 * 60 * 1000) {
                delete userState[userId]
                cleaned++
            }
        }
        if (cleaned > 0) logger.add("SYSTEM", `Cleaned ${cleaned} stale user states`)
    }, 30 * 60 * 1000)

    logger.add("SYSTEM", "Index.js initialized")
}

// CLI helper (tanpa file tambahan):
//   node index.js --hash            -> hash SHA-256 dari botToken di config.js
//   node index.js --hash TOKEN ...  -> hash dari token yang diketik (boleh banyak)
// Output berupa JSON siap tempel ke tokens.json. Token mentah tidak pernah dicetak.
function handleHashCli() {
    const idx = process.argv.indexOf("--hash");
    if (idx === -1) return false;

    let tokens = process.argv.slice(idx + 1).filter((a) => !a.startsWith("--"));
    if (tokens.length === 0) tokens = [config.botToken];

    const hashes = [];
    for (const t of tokens) {
        if (typeof t !== "string" || t.trim().length === 0) {
            console.error("❌ Token kosong / belum diisi di config.js.");
            process.exit(1);
        }
        hashes.push(createHash("sha256").update(t.trim(), "utf8").digest("hex"));
    }
    console.log(JSON.stringify({ tokenHashes: hashes }, null, 2));
    process.exit(0);
}

async function main() {
    handleHashCli();
    logger.showBanner();
    console.log("✅ Token Guard dinonaktifkan. Bot langsung jalan.");
    await startAll();
}

main().catch((err) => {
    console.clear();
    console.error("❌ ERROR FATAL: Startup dihentikan.", err && err.message ? err.message : err);
    process.exit(1);
});

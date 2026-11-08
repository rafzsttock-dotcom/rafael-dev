const { Telegraf } = require('telegraf')
const express = require('express')
const fs = require('fs')
const path = require('path')
const https = require('https')
const os = require('os')

const config = require('../config')
const { User, Setting, Invoice, RedeemCode } = require('../database')
const logger = require('./logger')
const WaManager = require('./wa')
const PaymentManager = require('./payment')
const { getTodayDate, getWaktuLengkap, getCountryName, formatNomor, isJoined, clearJoinCache, formatWaktuGaul, createProjectBackup } = require('./utils')
const { EMOJI_IDS, EMOJIS, tgEmoji } = require('./emojis')

global.Telegraf = Telegraf;
global.express = express;
global.fs = fs;
global.path = path;
global.https = https;
global.os = os;
global.config = config;
global.User = User;
global.Setting = Setting;
global.Invoice = Invoice;
global.RedeemCode = RedeemCode;
global.PaymentManager = PaymentManager;
global.logger = logger;
global.WaManager = WaManager;
global.getTodayDate = getTodayDate;
global.getWaktuLengkap = getWaktuLengkap;
global.getCountryName = getCountryName;
global.formatNomor = formatNomor;
global.isJoined = isJoined;
global.clearJoinCache = clearJoinCache;
global.formatWaktuGaul = formatWaktuGaul;
global.formatWaktu = (d) => typeof global.formatWaktuGaul === 'function' ? global.formatWaktuGaul(d) : new Date(d).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
global.createProjectBackup = createProjectBackup;
global.EMOJI_IDS = EMOJI_IDS;
global.EMOJIS = EMOJIS;
global.tgEmoji = tgEmoji;

global.IS_CHANNEL_LOG_ACTIVE = true
global.IS_FREE_ACCESS_ACTIVE = true
global.IS_MAINTENANCE_MODE = false
global.IS_FORCE_SUB_ENABLED = true
global.forceSubChannels = []
global.bot = null
global.restartCount = 0
global.restartTimer = null
global.MAX_RESTARTS = 50
global.RESTART_DELAY = 10000
global.WATCHDOG_INTERVAL = 30000
global.watchdogFails = 0
global.MAX_WATCHDOG_FAILS = 3
global.lastBotActivity = Date.now()
global.fileIdCache = {
    menuImage: null
};

global.uploadLocks = {
    menuImage: false
};

global.statsCache = {
    totalUsers: 0
};

global.userCache = new Map();

async function updateStatsCache() {
    try {
        const u = await User.countDocuments({}).lean();
        statsCache = {
            totalUsers: u
        };
    } catch (err) {
        logger.add('ERROR', 'Failed to update stats cache');
    }
}
global.updateStatsCache = updateStatsCache;

global.userRateLimiter = new Map()
global.userLocks = {
    locks: new Map(),
    get(key) {
        const lockTime = this.locks.get(key);
        return lockTime && (Date.now() - lockTime < 120000);
    },
    set(key, val) {
        this.locks.set(key, Date.now());
    },
    delete(key) {
        this.locks.delete(key);
    }
}
global.userState = {}

function clearUserState(userId) {
    if (!userId) return;
    const state = userState[userId];
    if (state) {
        if (state.qrTimeoutTimer) {
            clearTimeout(state.qrTimeoutTimer);
            state.qrTimeoutTimer = null;
        }
        if (state.qrRefreshTimer) {
            clearTimeout(state.qrRefreshTimer);
            state.qrRefreshTimer = null;
        }
        delete userState[userId];
    }
}
global.clearUserState = clearUserState;

function escapeHTML(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[m]);
}
global.escapeHTML = escapeHTML;

async function safeEditOrReply(ctx, text, extra = {}) {
    if (!ctx) return;
    if (ctx.callbackQuery) {
        await ctx.answerCbQuery().catch(() => {});
    }
    const hasPhoto = Boolean(ctx.callbackQuery?.message?.photo);
    const options = { parse_mode: 'HTML', disable_web_page_preview: true, ...extra };

    if (hasPhoto) {
        if (text && text.length <= 1024) {
            try {
                return await ctx.editMessageCaption(text, options);
            } catch (e) {
                if (e?.message?.includes('message is not modified')) return;
            }
        }
        await ctx.deleteMessage().catch(() => {});
        return await ctx.reply(text, options);
    } else {
        try {
            return await ctx.editMessageText(text, options);
        } catch (e) {
            if (e?.message?.includes('message is not modified')) return;
            await ctx.deleteMessage().catch(() => {});
            return await ctx.reply(text, options);
        }
    }
}
global.safeEditOrReply = safeEditOrReply;

async function sendChannelReport({ type, user, count = 1, meta = {} }) {
    try {
        if (global.IS_CHANNEL_LOG_ACTIVE === false) return;
        const targetBot = global.bot;
        if (!targetBot || !targetBot.telegram) return;

        const channelId = String(config.chLogs || '-1003877662893').trim();
        if (!channelId) return;

        let userId = user?.id || user?.userId;
        if (!userId) return;

        let firstName = user?.first_name || user?.firstName || '';
        let lastName = user?.last_name || user?.lastName || '';
        let rawUsername = user?.username || '';

        if (!firstName || !rawUsername) {
            const cached = userCache.get(userId);
            if (cached) {
                if (!firstName && cached.firstName) firstName = cached.firstName;
                if (!rawUsername && cached.username) rawUsername = cached.username;
            }
        }
        if (!firstName || !rawUsername) {
            const dbUser = await User.findOne({ userId }).lean().catch(() => null);
            if (dbUser) {
                if (!firstName && dbUser.firstName) firstName = dbUser.firstName;
                if (!rawUsername && dbUser.username) rawUsername = dbUser.username;
            }
        }
        if (!firstName && targetBot.telegram) {
            try {
                const tgChat = await targetBot.telegram.getChat(userId);
                if (tgChat) {
                    if (!firstName && tgChat.first_name) firstName = tgChat.first_name;
                    if (!lastName && tgChat.last_name) lastName = tgChat.last_name;
                    if (!rawUsername && tgChat.username) rawUsername = tgChat.username;
                }
            } catch (e) {}
        }

        const fullName = escapeHTML(`${firstName} ${lastName}`.trim() || 'Pengguna');
        const usernameText = rawUsername ? `@${escapeHTML(rawUsername)}` : '<i>Tanpa Username</i>';
        const waktuStr = typeof formatWaktuGaul === 'function' ? formatWaktuGaul() : new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
        const botUser = config.botUsername || 'kicenxcekbiobot';
        const jumlahNum = Number(count) || 0;

        let title = '';
        let detailsBlock = '';

        if (type === 'CEKBIO') {
            const modeLabel = meta.mode === 'simpel' ? 'Mode Simpel' : 'Mode Detail';
            title = `${EMOJIS.DOC} LAPORAN AKTIVITAS CEK BIO`;
            detailsBlock = `<blockquote>${EMOJIS.DOC} Layanan: <b>Cek Bio WhatsApp</b>\n` +
                           `${EMOJIS.SEARCH} Total Dicek: <b>${jumlahNum} nomor</b>\n` +
                           `${EMOJIS.NOTE} Format: <b>${modeLabel}</b>\n` +
                           `${EMOJIS.TIME} Waktu: <code>${waktuStr}</code></blockquote>`;
        } else if (type === 'DETECT') {
            title = `${EMOJIS.SEARCH} LAPORAN AKTIVITAS DETECT`;
            detailsBlock = `<blockquote>${EMOJIS.SEARCH} Layanan: <b>Detect Status & Cooldown</b>\n` +
                           `${EMOJIS.DOC} Total Dicek: <b>${jumlahNum} nomor</b>\n` +
                           `${EMOJIS.TIME} Waktu: <code>${waktuStr}</code></blockquote>`;
        } else if (type === 'LIMITIN') {
            const methodLabel = meta.method || 'SMS';
            title = `${EMOJIS.ROCKET} LAPORAN AKTIVITAS LIMITIN`;
            detailsBlock = `<blockquote>${EMOJIS.ROCKET} Layanan: <b>Limitin Code WhatsApp</b>\n` +
                           `${EMOJIS.TIME} Sedang Diproses: <b>${jumlahNum} nomor</b>\n` +
                           `${EMOJIS.PHONE} Metode: <b>${methodLabel}</b>\n` +
                           `${EMOJIS.CALENDAR} Waktu: <code>${waktuStr}</code></blockquote>`;
        } else if (type === 'PREMIUM' || type === 'PAYMENT') {
            const planLabel = meta.planName || `${jumlahNum} Hari`;
            const priceBlock = meta.price ? `\n${EMOJIS.KEY} Nominal: <b>Rp ${Number(meta.price).toLocaleString('id-ID')}</b>` : '';
            const statusBlock = `\n${EMOJIS.CHECK} Status: <b>LUNAS / BERHASIL (PAID)</b>`;
            const methodBlock = meta.method ? `\n${EMOJIS.FIRE} Metode: <b>${meta.method}</b>` : '';
            const expBlock = meta.expiredStr ? `\n${EMOJIS.CALENDAR} Masa Aktif: <b>${meta.expiredStr}</b>` : '';
            const invBlock = meta.invoiceId ? `\n${EMOJIS.ID} Invoice: <code>${meta.invoiceId}</code>` : '';

            title = `${EMOJIS.PREMIUM} LAPORAN PEMBAYARAN PREMIUM`;
            detailsBlock = `<blockquote>${EMOJIS.PREMIUM} Layanan: <b>Langganan Akun Premium</b>\n` +
                           `${EMOJIS.STAR} Paket: <b>${planLabel}</b>` +
                           priceBlock +
                           statusBlock +
                           methodBlock +
                           expBlock +
                           invBlock + `\n` +
                           `${EMOJIS.TIME} Waktu: <code>${waktuStr}</code></blockquote>`;
        } else if (type === 'API_PLAN') {
            const planLabel = meta.planName || `${jumlahNum} Hari`;
            const methodBlock = meta.method ? `\n${EMOJIS.FIRE} Metode: <b>${meta.method}</b>` : '';
            const expBlock = meta.expiredStr ? `\n${EMOJIS.CALENDAR} Aktif s/d: <b>${meta.expiredStr}</b>` : '';
            const invBlock = meta.invoiceId ? `\n${EMOJIS.ID} Invoice: <code>${meta.invoiceId}</code>` : '';

            title = `${EMOJIS.KEY} LAPORAN PEMBAYARAN PAKET API`;
            detailsBlock = `<blockquote>${EMOJIS.KEY} Layanan: <b>Akses API</b>\n` +
                           `${EMOJIS.STAR} Paket: <b>${planLabel}</b>\n` +
                           `${EMOJIS.CHECK} Status: <b>LUNAS / BERHASIL (PAID)</b>` +
                           methodBlock +
                           expBlock +
                           invBlock + `\n` +
                           `${EMOJIS.TIME} Waktu: <code>${waktuStr}</code></blockquote>`;
        } else if (type === 'REDEEM') {
            const codeLabel = meta.code || '-';
            title = `${EMOJIS.GIFT} LAPORAN KLAIM REDEEM`;
            detailsBlock = `<blockquote>${EMOJIS.GIFT} Layanan: <b>Klaim Kode Promo</b>\n` +
                           `${EMOJIS.KEY} Hadiah: <b>+${jumlahNum} Limit</b>\n` +
                           `${EMOJIS.TAG} Kode: <code>${codeLabel}</code>\n` +
                           `${EMOJIS.TIME} Waktu: <code>${waktuStr}</code></blockquote>`;
        } else {
            return;
        }

        const messageText = `<b>${title}</b>

<blockquote>${EMOJIS.USER} Nama: <b>${fullName}</b>
${EMOJIS.TAG} Username: ${usernameText}
${EMOJIS.ID} User ID: <code>${userId}</code></blockquote>

${detailsBlock}`.trim();

        const keyboard = {
            inline_keyboard: [
                [
                    {
                        text: 'MENU BOT',
                        url: `https://t.me/${botUser}`,
                        icon_custom_emoji_id: EMOJI_IDS.BOT
                    }
                ]
            ]
        };

        const sendOptions = {
            parse_mode: 'HTML',
            disable_web_page_preview: true
        };
        if (meta.message_thread_id || config.chLogsTopicId) {
            sendOptions.message_thread_id = meta.message_thread_id || config.chLogsTopicId;
        }

        try {
            await targetBot.telegram.sendMessage(channelId, messageText, {
                ...sendOptions,
                reply_markup: keyboard
            });
        } catch (sendErr) {
            // Fallback 1: Jika custom emoji ditolak grup/channel
            try {
                await targetBot.telegram.sendMessage(channelId, messageText, {
                    ...sendOptions,
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🤖 MENU BOT', url: `https://t.me/${botUser}` }]
                        ]
                    }
                });
            } catch (fallbackErr) {
                // Fallback 2: Kirim tanpa markup jika grup membatasi inline link/button
                await targetBot.telegram.sendMessage(channelId, messageText, sendOptions);
            }
        }

        logger.add('SYSTEM', `[REPORT LOG] Sukses kirim laporan ${type} ke ${channelId} (User: ${userId}, Jumlah: ${jumlahNum})`);
    } catch (err) {
        logger.add('ERROR', `[REPORT LOG] Gagal kirim laporan ${type} ke ${config.chLogs || '-1003877662893'}: ${err.message}`);
    }
}
global.sendChannelReport = sendChannelReport;


function isRateLimited(userId, limit = 3, windowMs = 5 * 60 * 1000) {
    const now = Date.now()
    let timestamps = userRateLimiter.get(userId) || []
    timestamps = timestamps.filter(ts => now - ts < windowMs)
    if (timestamps.length >= limit) return true
    timestamps.push(now)
    userRateLimiter.set(userId, timestamps)
    return false
}
global.isRateLimited = isRateLimited;

function generateRefCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}
global.generateRefCode = generateRefCode;

function getReferralTier(referralCount = 0) {
    const count = Number(referralCount) || 0;
    if (count < 5) {
        return { tier: 1, costPerLimit: 1, name: 'Tingkat 1 (Pemula)', desc: '1 teman = +1 Limit' };
    } else if (count < 15) {
        return { tier: 2, costPerLimit: 2, name: 'Tingkat 2 (Menengah)', desc: '2 teman = +1 Limit' };
    } else {
        return { tier: 3, costPerLimit: 3, name: 'Tingkat 3 (Master)', desc: '3 teman = +1 Limit' };
    }
}
global.getReferralTier = getReferralTier;

const checkUser = async (userId, ctxFrom = null) => {
    const todayStr = getTodayDate();
    const now = Date.now();
    
    if (userCache.has(userId)) {
        let cachedUser = userCache.get(userId);
        if (ctxFrom) {
            if (ctxFrom.username && cachedUser.username !== ctxFrom.username) cachedUser.username = ctxFrom.username;
            if (ctxFrom.first_name && cachedUser.firstName !== ctxFrom.first_name) cachedUser.firstName = ctxFrom.first_name;
        }

        const isPremExpired = cachedUser.premium && cachedUser.premiumUntil && cachedUser.premiumUntil < now && !global.IS_MAINTENANCE_MODE;
        if (cachedUser.lastReset === todayStr && !isPremExpired && cachedUser.refCode) {
            return cachedUser;
        }
    }

    let user = await User.findOne({ userId: userId }).lean();

    if (!user) {
        logger.add('INFO', `New User Register: ${userId}`);
        const refCode = generateRefCode();
        const newUser = new User({
            userId: userId,
            username: ctxFrom?.username || '',
            firstName: ctxFrom?.first_name || '',
            limit: 5,
            lastReset: todayStr,
            lastInteraction: now,
            premium: false,
            premiumUntil: null,
            refCode: refCode,
            invitedBy: null,
            referralCount: 0,
            referralProgress: 0,
            referralBonusLimit: 0,
            totalChecked: 0,
            totalCekBio: 0,
            totalCekBioSessions: 0,
            totalDetect: 0,
            totalLimitin: 0
        });
        try {
            user = await newUser.save();
            user = user.toObject();
        } catch (e) {
            if (e.code === 11000) {
                user = await User.findOne({ userId: userId }).lean();
            } else {
                throw e;
            }
        }
    } else {
        let updateData = {};
        let needsUpdate = false;

        // Cek kadaluarsa akun premium (DIBEKUKAN SELAMA MAINTENANCE AKTIF)
        if (user.premium && user.premiumUntil && user.premiumUntil < now) {
            if (!global.IS_MAINTENANCE_MODE) {
                logger.add('PREMIUM', `Masa aktif Premium User ${userId} telah berakhir.`);
                updateData.premium = false;
                updateData.premiumUntil = null;
                updateData.limit = 5;
                user.premium = false;
                user.premiumUntil = null;
                user.limit = 5;
                needsUpdate = true;

                if (global.bot && global.bot.telegram) {
                    global.bot.telegram.sendMessage(userId, 
                        `<b>${EMOJIS.WARN} MASA AKTIF PREMIUM HABIS</b>\n\n<blockquote>Masa aktif akun Premium Anda telah selesai. Akun Anda kembali ke status Free User (limit 5x/hari). Silakan perpanjang kembali di menu <b>Beli Premium</b>.</blockquote>`,
                        { parse_mode: 'HTML' }
                    ).catch(() => {});
                }
            }
        }

        // Reset limit 5x setiap jam 12 malam WIB (00:00 WIB)
        if (user.lastReset !== todayStr) {
            if (!user.premium) {
                updateData.limit = 5;
                user.limit = 5;
            }
            updateData.lastReset = todayStr;
            user.lastReset = todayStr;
            needsUpdate = true;
        }

        // Pastikan setiap user memiliki refCode unik
        if (!user.refCode) {
            updateData.refCode = generateRefCode();
            user.refCode = updateData.refCode;
            needsUpdate = true;
        }

        if (ctxFrom) {
            if (ctxFrom.username && user.username !== ctxFrom.username) {
                updateData.username = ctxFrom.username;
                user.username = ctxFrom.username;
                needsUpdate = true;
            }
            if (ctxFrom.first_name && user.firstName !== ctxFrom.first_name) {
                updateData.firstName = ctxFrom.first_name;
                user.firstName = ctxFrom.first_name;
                needsUpdate = true;
            }
        }

        if (needsUpdate) {
            User.updateOne({ userId: userId }, { $set: updateData }).catch(e => logger.add('ERROR', `Background update failed for ${userId}: ${e.message}`));
        }
    }

    userCache.set(userId, user);
    return user;
};
global.checkUser = checkUser;

async function getUserRank(userId) {
    try {
        const target = await User.findOne({ userId }).lean();
        if (!target) return { rank: '-', totalChecked: 0 };
        const myChecked = Math.max(
            target.totalChecked || 0,
            ((target.totalCekBio || 0) + (target.totalDetect || 0) + (target.totalLimitin || 0))
        );
        const higherCount = await User.countDocuments({
            isBanned: false,
            $or: [
                { totalChecked: { $gt: myChecked } },
                { totalChecked: myChecked, points: { $gt: target.points || 0 } },
                { totalChecked: myChecked, points: target.points || 0, lastInteraction: { $gt: target.lastInteraction || 0 } }
            ]
        });
        return {
            rank: higherCount + 1,
            totalChecked: myChecked
        };
    } catch (e) {
        return { rank: '-', totalChecked: 0 };
    }
}
global.getUserRank = getUserRank;

async function getLeaderboardMessage(userId) {
    const topUsers = await User.find({ isBanned: false })
        .sort({ totalChecked: -1, points: -1, lastInteraction: -1 })
        .limit(10)
        .lean();

    const userRank = await getUserRank(userId);

    const medalEmojis = [
        EMOJIS.MEDAL_GOLD,
        EMOJIS.MEDAL_SILVER,
        EMOJIS.MEDAL_BRONZE
    ];
    const numberEmojis = [
        EMOJIS.NUM_4,
        EMOJIS.NUM_5,
        EMOJIS.NUM_6,
        EMOJIS.NUM_7,
        EMOJIS.NUM_8,
        EMOJIS.NUM_9,
        `${EMOJIS.NUM_1}${EMOJIS.NUM_0}`
    ];

    let rankListText = "";
    if (topUsers.length === 0) {
        rankListText = `${EMOJIS.NOTE} Belum ada data pengecekan nomor.`;
    } else {
        rankListText = topUsers.map((u, idx) => {
            const icon = idx < 3 ? medalEmojis[idx] : (numberEmojis[idx - 3] || EMOJIS.STAR);
            let nameStr = "";
            if (u.username) {
                nameStr = `@${escapeHTML(u.username)}`;
            } else if (u.firstName) {
                nameStr = escapeHTML(u.firstName);
            } else {
                const sId = String(u.userId);
                nameStr = `User ${sId.slice(0, 3)}***${sId.slice(-3)}`;
            }
            const checkedCount = Math.max(
                u.totalChecked || 0,
                ((u.totalCekBio || 0) + (u.totalDetect || 0) + (u.totalLimitin || 0))
            );
            return `${icon} <b>#${idx + 1} • ${nameStr}</b>\n└ Total Cek: <b>${checkedCount}</b> nomor`;
        }).join("\n\n");
    }

    const text = `<b>${EMOJIS.TROPHY} TOP LEADERBOARD PENGGUNA</b>

<blockquote>10 pengguna teratas dengan total nomor dicek terbanyak:</blockquote>

<blockquote expandable>${rankListText}</blockquote>

<blockquote>${EMOJIS.USER} <b>Peringkat Anda:</b>
Rank: <b>#${userRank.rank}</b> | Total Cek: <b>${userRank.totalChecked}</b> nomor</blockquote>`.trim();

    const keyboard = {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: "REFRESH", callback_data: "refresh_leaderboard", icon_custom_emoji_id: EMOJI_IDS.REFRESH },
                    { text: "STATISTIK", callback_data: "menu_stats", icon_custom_emoji_id: EMOJI_IDS.CHART }
                ],
                [
                    { text: "KEMBALI", callback_data: "back_home", icon_custom_emoji_id: EMOJI_IDS.BACK }
                ]
            ]
        }
    };

    return { text, keyboard };
}
global.getLeaderboardMessage = getLeaderboardMessage;

async function getDetailedStatsMessage(userId) {
    const totalUsers = statsCache.totalUsers || await User.countDocuments({}).lean();
    const uptimeSeconds = process.uptime();
    const days = Math.floor(uptimeSeconds / 86400);
    const hours = Math.floor((uptimeSeconds % 86400) / 3600);
    const minutes = Math.floor((uptimeSeconds % 3600) / 60);
    const seconds = Math.floor(uptimeSeconds % 60);
    const uptimeString = days > 0
        ? `${days}d ${hours}h ${minutes}m`
        : `${hours}h ${minutes}m ${seconds}s`;

    const memoryUsage = process.memoryUsage();
    const memMB = Math.round(memoryUsage.rss / 1024 / 1024);
    const totalMemMB = Math.round(os.totalmem() / 1024 / 1024);

    let activeSessions = 0;
    try {
        if (WaManager && WaManager.sessions) {
            for (const userSessions of WaManager.sessions.values()) {
                activeSessions += userSessions.size;
            }
        }
    } catch (e) {
        activeSessions = 0;
    }

    let setChecked = await Setting.findOne({ key: "total_checked_all" }).lean();
    let setDetect = await Setting.findOne({ key: "total_detect_all" }).lean();
    let setLimitin = await Setting.findOne({ key: "total_limitin_all" }).lean();

    const globalTotalDetect = Number(setDetect?.value) || 0;
    const globalTotalLimitin = Number(setLimitin?.value) || 0;
    const globalTotalChecked = Number(setChecked?.value) || (globalTotalDetect + globalTotalLimitin);

    const mtStatus = IS_MAINTENANCE_MODE ? "AKTIF" : "NONAKTIF";
    const dbStatus = "LOKAL (JSON)";

    // Ambil user langsung dari DB agar statistik real-time tidak tertahan cache
    const user = await User.findOne({ userId }).lean() || await checkUser(userId);
    userCache.set(userId, user);

    const userRank = await getUserRank(userId);
    const isOwner = Number(userId) === Number(config.ownerId);
    const isPremium = Boolean(user?.premium);
    const statusLabel = isOwner ? "OWNER" : (isPremium ? "PREMIUM" : "FREE USER");

    const userTotalChecked = Math.max(
        user?.totalChecked || 0,
        ((user?.totalCekBio || 0) + (user?.totalDetect || 0) + (user?.totalLimitin || 0))
    );
    const userCekBio = user?.totalCekBio ?? (user?.totalCekBioSessions ? (user?.totalChecked || 0) : 0);

    const text = `<b>${EMOJIS.CHART} STATISTIK & KINERJA SISTEM</b>

<blockquote expandable><b>Ringkasan Layanan:</b>
${EMOJIS.USER} Total Pengguna: <b>${totalUsers}</b> user
${EMOJIS.PHONE} Sesi WA Aktif: <b>${activeSessions}</b> sender
${EMOJIS.DOC} Total Nomor Dicek: <b>${globalTotalChecked}</b> nomor
${EMOJIS.SEARCH} Total Detect OTP: <b>${globalTotalDetect}</b> kali
${EMOJIS.ROCKET} Total Limitin: <b>${globalTotalLimitin}</b> kali</blockquote>

<blockquote expandable><b>Performa Server:</b>
${EMOJIS.TIME} Uptime: <b>${uptimeString}</b>
${EMOJIS.TAG} RAM: <b>${memMB} MB / ${totalMemMB} MB</b>
${EMOJIS.GLOBE} Database: <b>${dbStatus}</b>
${EMOJIS.SHIELD} Maintenance: <b>${mtStatus}</b></blockquote>

<blockquote><b>Statistik Akun Anda:</b>
${EMOJIS.ID} ID: <code>${userId}</code>
${EMOJIS.STAR} Status: <b>${statusLabel}</b>
${EMOJIS.TROPHY} Peringkat: <b>#${userRank.rank}</b>
${EMOJIS.DOC} Total Dicek: <b>${userTotalChecked}</b> nomor
${EMOJIS.DOC} Cek Bio: <b>${userCekBio}</b> nomor (${user?.totalCekBioSessions || 0} batch)
${EMOJIS.SEARCH} Detect OTP: <b>${user?.totalDetect || 0}</b> kali
${EMOJIS.ROCKET} Limitin Code: <b>${user?.totalLimitin || 0}</b> kali
${EMOJIS.KEY} Sisa Kuota: <b>${user?.limit ?? 5}</b> cek</blockquote>`.trim();

    const keyboard = {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: "REFRESH", callback_data: "refresh_stats", icon_custom_emoji_id: EMOJI_IDS.REFRESH },
                    { text: "LEADERBOARD", callback_data: "menu_leaderboard", icon_custom_emoji_id: EMOJI_IDS.TROPHY }
                ],
                [
                    { text: "KEMBALI", callback_data: "back_home", icon_custom_emoji_id: EMOJI_IDS.BACK }
                ]
            ]
        }
    };

    return { text, keyboard };
}
global.getDetailedStatsMessage = getDetailedStatsMessage;

function getBuyPremiumMenu(userId) {
    const plans = config.premiumPlans || [];
    const text = `<b>${EMOJIS.PREMIUM} UPGRADE KE AKUN PREMIUM</b>

<blockquote>Dapatkan akses penuh tanpa batas ke semua fitur bot dengan aktivasi otomatis instan via QRIS (Semua Bank & E-Wallet)!</blockquote>

<blockquote expandable><b>Keuntungan Akun Premium:</b>
• ${EMOJIS.CHECK} <b>Unlimited Kuota Limit</b> (Tanpa batasan 5x sehari untuk Detect & Limitin)
• ${EMOJIS.CHECK} <b>Bisa Cek Massal</b> (hingga 10 nomor di Detect, 5 nomor di Limitin sekaligus)
• ${EMOJIS.CHECK} <b>Slot Sender WA</b> aktif hingga 5 nomor (Free hanya 2)
• ${EMOJIS.CHECK} <b>Server Prioritas</b> koneksi lebih cepat & minim delay
• ${EMOJIS.CHECK} <b>Aktivasi Otomatis</b> langsung aktif setelah transfer QRIS</blockquote>

<blockquote><b>Pilihan Paket Tersedia:</b>
Owner: @${config.ownerContact?.telegram || 'owner'}</blockquote>`.trim();

    const buttons = plans.map(p => ([{
        text: `${p.name} — Rp${p.price.toLocaleString('id-ID')}`,
        callback_data: `buy_plan_${p.id}`,
        icon_custom_emoji_id: EMOJI_IDS.PREMIUM
    }]));

    buttons.push([
        { text: 'KEMBALI', callback_data: 'back_home', icon_custom_emoji_id: EMOJI_IDS.BACK }
    ]);

    return {
        text,
        keyboard: { reply_markup: { inline_keyboard: buttons } }
    };
}
global.getBuyPremiumMenu = getBuyPremiumMenu;

function getReferralMenu(user) {
    const botUser = config.botUsername || 'kicenxcekbiobot';
    const refCode = user.refCode || 'REF';
    const refLink = `https://t.me/${botUser}?start=ref_${refCode}`;
    const totalReff = user.referralCount || 0;
    const bonusLimit = user.referralBonusLimit || 0;
    const tier = getReferralTier(totalReff);
    const progress = user.referralProgress || 0;

    const shareText = encodeURIComponent(`🔥 Bot Cek Bio WhatsApp, Detect OTP & Limitin Code otomatis!\nYuk cobain bot ini sekarang: ${refLink}`);
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(refLink)}&text=${shareText}`;

    const text = `<b>${EMOJIS.USER} PROGRAM REFERRAL BOT</b>

<blockquote>Undang teman Anda menggunakan link referral untuk mendapatkan tambahan kuota limit pengecekan gratis!</blockquote>

<blockquote><b>Tautan Referral Anda:</b>
<code>${refLink}</code> (Klik untuk salin)</blockquote>

<blockquote expandable><b>Statistik Referral Anda:</b>
• ${EMOJIS.TROPHY} Total Teman Diundang: <b>${totalReff} orang</b>
• ${EMOJIS.KEY} Total Bonus Limit Didapat: <b>+${bonusLimit} limit</b>
• ${EMOJIS.STAR} Peringkat: <b>${tier.name}</b>
• 🎯 Progres: <b>${progress}/${tier.costPerLimit} teman</b> (Kurang ${tier.costPerLimit - progress} untuk +1 limit)</blockquote>

<blockquote expandable><b>💡 Aturan & Ketentuan Referral:</b>
• <b>Tingkat 1 (1-5 teman):</b> 1 teman = +1 Limit
• <b>Tingkat 2 (6-15 teman):</b> 2 teman = +1 Limit
• <b>Tingkat 3 (16+ teman):</b> 3 teman = +1 Limit
• Teman yang diundang harus pengguna baru yang belum pernah menggunakan bot.
• Kuota limit langsung ditambahkan ke akun Anda begitu teman klik Start.</blockquote>`.trim();

    const keyboard = {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: 'BAGIKAN KE TEMAN / GRUP', url: shareUrl, icon_custom_emoji_id: EMOJI_IDS.BROADCAST }
                ],
                [
                    { text: 'REFRESH', callback_data: 'menu_referral', icon_custom_emoji_id: EMOJI_IDS.REFRESH },
                    { text: 'KEMBALI', callback_data: 'back_home', icon_custom_emoji_id: EMOJI_IDS.BACK }
                ]
            ]
        }
    };

    return { text, keyboard };
}
global.getReferralMenu = getReferralMenu;

function getPanduanMessage(category = "main") {
    if (category === "cekbio") {
        const text = `<b>${EMOJIS.DOC} PANDUAN CEK BIO WHATSAPP</b>

<blockquote expandable><b>Langkah-Langkah:</b>
${EMOJIS.NUM_1} Pastikan minimal 1 sender WhatsApp terhubung di menu Cek Bio.
${EMOJIS.NUM_2} Klik tombol <b>MULAI CEK</b>.
${EMOJIS.NUM_3} Kirim data nomor yang ingin diperiksa:
 • File dokumen: <code>.txt</code>, <code>.xlsx</code>, atau <code>.csv</code>
 • Atau kirim teks langsung (1 nomor per baris, contoh: <code>628xxx</code>).
${EMOJIS.NUM_4} Pilih mode laporan:
 • <b>SIMPEL</b>: Output ringkas nomor dan status bio.
 • <b>DETAIL</b>: Laporan lengkap nama bisnis, verified badge, deskripsi, tanggal join, dan tanggal set bio.
${EMOJIS.NUM_5} Tunggu hingga proses selesai. Bot akan mengirimkan file laporan Excel dan ringkasan hasil pengecekan.</blockquote>

<blockquote expandable><b>${EMOJIS.WARN} Catatan Penting:</b>
• Jika sender terputus di tengah proses, bot otomatis menyimpan sisa nomor dalam file khusus dan melanjutkan saat sender siap.
• Gunakan nomor sender yang stabil untuk menghindari disconnect.</blockquote>`.trim();

        const keyboard = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "MULAI CEK BIO", callback_data: "menu_cekbio", icon_custom_emoji_id: EMOJI_IDS.DOC }],
                    [{ text: "KEMBALI", callback_data: "menu_panduan", icon_custom_emoji_id: EMOJI_IDS.BACK }]
                ]
            }
        };
        return { text, keyboard };
    }

    if (category === "sender") {
        const text = `<b>${EMOJIS.PHONE} PANDUAN HUBUNGKAN SENDER WA</b>

<blockquote expandable><b>Metode Scan QR:</b>
${EMOJIS.NUM_1} Buka menu <b>CEK BIO</b> > <b>TAMBAH SENDER</b> > <b>SCAN QR CODE</b>.
${EMOJIS.NUM_2} Buka aplikasi WhatsApp di HP Anda.
${EMOJIS.NUM_3} Masuk ke menu <b>Perangkat Tertaut</b> > <b>Tautkan Perangkat</b>.
${EMOJIS.NUM_4} Scan QR code yang dikirimkan oleh bot dalam batas waktu 5 menit.

<b>Metode Pairing Code:</b>
${EMOJIS.NUM_1} Buka menu <b>CEK BIO</b> > <b>TAMBAH SENDER</b> > <b>PAIRING CODE</b>.
${EMOJIS.NUM_2} Masukkan nomor WhatsApp Anda (format: <code>628xxx</code>).
${EMOJIS.NUM_3} Masukkan kode 8 digit yang diberikan bot ke notifikasi WhatsApp di HP Anda.</blockquote>

<blockquote expandable><b>${EMOJIS.SHIELD} Batas Slot Sender:</b>
• User Free: Maksimal <b>2 sender aktif</b>
• User Premium: Maksimal <b>5 sender aktif</b>
• Owner: Bebas slot tanpa batas</blockquote>`.trim();

        const keyboard = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "TAMBAH SENDER", callback_data: "wa_connect_menu", icon_custom_emoji_id: EMOJI_IDS.PLUS }],
                    [{ text: "KEMBALI", callback_data: "menu_panduan", icon_custom_emoji_id: EMOJI_IDS.BACK }]
                ]
            }
        };
        return { text, keyboard };
    }

    if (category === "detect_limitin") {
        const text = `<b>${EMOJIS.ROCKET} PANDUAN DETECT OTP & LIMITIN</b>

<blockquote expandable><b>${EMOJIS.SEARCH} Detect OTP:</b>
• Digunakan untuk mengecek apakah nomor WhatsApp siap menerima kode verifikasi OTP atau masih dalam masa cooldown.
• Buka menu <b>DETECT OTP</b> melalui tombol di menu utama bot.
• User Free: <b>1 nomor per request</b> (Maks 5x limit/hari).
• User Premium: <b>Hingga 10 nomor</b> per batch sekaligus (Unlimited).
• Bot akan menguji endpoint registrasi dan menampilkan status cooldown serta metode OTP yang aktif.</blockquote>

<blockquote expandable><b>${EMOJIS.ROCKET} Limitin Code (Request OTP):</b>
• Digunakan untuk melakukan request kode OTP berulang kali secara otomatis ke nomor target.
• Buka menu <b>LIMITIN CODE</b> melalui tombol di menu utama bot.
• Pilih metode: <b>WA OLD / PERANGKAT</b>, <b>SMS</b>, atau <b>PANGGILAN</b>.
• User Free: <b>1 nomor per request</b> (Maks 5x limit/hari).
• User Premium: <b>Hingga 5 nomor</b> sekaligus (Unlimited).
• Sistem akan menjalankan hingga 5 percobaan request kode di background.</blockquote>`.trim();

        const keyboard = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: "DETECT OTP", callback_data: "menu_detect", icon_custom_emoji_id: EMOJI_IDS.SEARCH },
                        { text: "LIMITIN CODE", callback_data: "menu_limitin", icon_custom_emoji_id: EMOJI_IDS.ROCKET }
                    ],
                    [{ text: "KEMBALI", callback_data: "menu_panduan", icon_custom_emoji_id: EMOJI_IDS.BACK }]
                ]
            }
        };
        return { text, keyboard };
    }

    if (category === "limit_rules") {
        const text = `<b>${EMOJIS.WARN} KETENTUAN LIMIT & JAM RESET</b>

<blockquote expandable><b>Aturan Pengguna Free:</b>
• Kuota Limit: <b>5x percobaan per hari</b> gabungan untuk fitur Detect OTP dan Limitin Code.
• Pengecekan hanya dapat dilakukan <b>1 nomor per request</b> (tidak dapat borongan).
• Jam Reset: Kuota limit di-reset otomatis setiap <b>Jam 12 Malam WIB (00:00 WIB)</b>.</blockquote>

<blockquote expandable><b>Jika Kuota Habis:</b>
• <b>Beli Paket Premium</b>: Akses tanpa batas (Unlimited), bisa cek massal nomor sekaligus, dan dapat 5 slot sender WA.
• <b>Undang Teman (Referral)</b>: Dapatkan bonus +1 kuota limit untuk setiap teman yang bergabung via tautan referral Anda!</blockquote>`.trim();

        const keyboard = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: "BELI PREMIUM", callback_data: "menu_buyprem", icon_custom_emoji_id: EMOJI_IDS.PREMIUM },
                        { text: "REFERRAL", callback_data: "menu_referral", icon_custom_emoji_id: EMOJI_IDS.USER }
                    ],
                    [{ text: "KEMBALI", callback_data: "menu_panduan", icon_custom_emoji_id: EMOJI_IDS.BACK }]
                ]
            }
        };
        return { text, keyboard };
    }

    if (category === "referral") {
        const text = `<b>${EMOJIS.USER} PANDUAN PROGRAM REFERRAL</b>

<blockquote expandable><b>Cara Mendapatkan Limit Gratis:</b>
1. Buka menu <b>REFERRAL</b> di menu utama bot.
2. Salin tautan referral unik Anda (contoh: <code>https://t.me/kicenxcekbiobot?start=ref_XXXXXX</code>).
3. Bagikan ke teman, channel, atau grup WhatsApp & Telegram.
4. Setiap pengguna baru yang memulai bot melalui tautan Anda, Anda akan otomatis menerima kuota limit gratis!</blockquote>

<blockquote expandable><b>Sistem Tingkat Kesulitan:</b>
• <b>Tingkat 1 (1 - 5 teman):</b> Setiap 1 teman = <b>+1 Limit</b>
• <b>Tingkat 2 (6 - 15 teman):</b> Setiap 2 teman = <b>+1 Limit</b>
• <b>Tingkat 3 (16+ teman):</b> Setiap 3 teman = <b>+1 Limit</b>

<i>Semakin banyak teman yang Anda undang, semakin menantang untuk mendapatkan kuota berikutnya!</i></blockquote>`.trim();

        const keyboard = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "MENU REFERRAL SAYA", callback_data: "menu_referral", icon_custom_emoji_id: EMOJI_IDS.USER }],
                    [{ text: "KEMBALI", callback_data: "menu_panduan", icon_custom_emoji_id: EMOJI_IDS.BACK }]
                ]
            }
        };
        return { text, keyboard };
    }

    if (category === "premium") {
        const text = `<b>${EMOJIS.PREMIUM} PANDUAN PEMBELIAN PREMIUM VIA QRIS</b>

<blockquote expandable><b>Fitur & Keuntungan Premium:</b>
• ${EMOJIS.CHECK} <b>Unlimited Kuota Limit Harian</b>: Bebas gunakan Detect OTP dan Limitin Code tanpa batasan kuota 5x sehari.
• ${EMOJIS.CHECK} <b>Cek Massal Nomor</b>: Cek hingga 10 nomor di Detect dan 5 nomor di Limitin sekaligus (Free hanya 1 nomor).
• ${EMOJIS.CHECK} <b>Slot Sender WA Tambahan</b>: Hubungkan hingga 5 sender aktif (Free hanya 2).
• ${EMOJIS.CHECK} <b>Server Prioritas</b>: Minim delay, performa tinggi, dan bebas antrian.</blockquote>

<blockquote expandable><b>Cara Pembelian Otomatis:</b>
1. Pilih menu <b>BELI PREMIUM</b>.
2. Pilih paket yang Anda inginkan (3 Hari, 7 Hari, 30 Hari, atau Permanen).
3. Bot akan menampilkan gambar QRIS resmi (PayQRIS).
4. Scan menggunakan aplikasi M-Banking atau E-Wallet apa saja (BCA, BRI, BNI, Mandiri, Dana, GoPay, OVO, ShopeePay).
5. <b>PENTING:</b> Bayar tepat sebesar nominal yang tertera (sudah termasuk kode unik).
6. Pembayaran otomatis diverifikasi dan akun Anda langsung menjadi Premium dalam hitungan detik!</blockquote>`.trim();

        const keyboard = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "BELI SEKARANG", callback_data: "menu_buyprem", icon_custom_emoji_id: EMOJI_IDS.PREMIUM }],
                    [{ text: "KEMBALI", callback_data: "menu_panduan", icon_custom_emoji_id: EMOJI_IDS.BACK }]
                ]
            }
        };
        return { text, keyboard };
    }

    // Default: Main Panduan
    const text = `<b>${EMOJIS.BOOK} PANDUAN PENGGUNAAN BOT</b>

<blockquote>Pusat informasi dan panduan resmi fitur bot:</blockquote>

<blockquote expandable><b>${EMOJIS.WARN} 1. Ketentuan Limit & Jam Reset</b>
User Free mendapatkan kuota 5x cek/hari untuk Detect OTP & Limitin Code (1 nomor per request). Kuota di-reset setiap jam 12 malam WIB (00:00 WIB). Jika limit habis, wajib beli Premium atau undang teman.</blockquote>

<blockquote expandable><b>${EMOJIS.PREMIUM} 2. Upgrade Akun Premium (QRIS)</b>
Akses tanpa batas (Unlimited limit), cek massal hingga 10 nomor sekaligus, 5 slot sender aktif, dan server prioritas. Pembayaran otomatis via QRIS real-time.</blockquote>

<blockquote expandable><b>${EMOJIS.USER} 3. Program Referral (Limit Gratis)</b>
Bagikan tautan bot Anda untuk mengundang pengguna baru. Setiap referral berhasil memberikan tambahan kuota limit gratis!</blockquote>

<blockquote expandable><b>${EMOJIS.DOC} 4. Cek Bio WhatsApp</b>
Pengecekan nomor massal untuk mendeteksi status registrasi, bio teks profil, tipe akun, tanggal join, dan tanggal set bio dalam format Excel (.xlsx).</blockquote>

<blockquote expandable><b>${EMOJIS.SEARCH} 5. Detect OTP & Cooldown</b>
Mendeteksi kesiapan nomor WhatsApp dalam menerima kode OTP dan mengecek status cooldown server.</blockquote>

<blockquote expandable><b>${EMOJIS.ROCKET} 6. Limitin Code</b>
Otomasi request kode OTP berulang kali via WA Old, SMS, atau Voice Call untuk memicu limitasi pada nomor target.</blockquote>`.trim();

    const keyboard = {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: "ATURAN LIMIT", callback_data: "panduan_limit_rules", icon_custom_emoji_id: EMOJI_IDS.WARN },
                    { text: "BELI PREMIUM", callback_data: "panduan_premium", icon_custom_emoji_id: EMOJI_IDS.PREMIUM }
                ],
                [
                    { text: "PROGRAM REFERRAL", callback_data: "panduan_referral", icon_custom_emoji_id: EMOJI_IDS.USER },
                    { text: "DETECT & LIMITIN", callback_data: "panduan_detect_limitin", icon_custom_emoji_id: EMOJI_IDS.ROCKET }
                ],
                [
                    { text: "PANDUAN CEK BIO", callback_data: "panduan_cekbio", icon_custom_emoji_id: EMOJI_IDS.DOC },
                    { text: "PANDUAN SENDER", callback_data: "panduan_sender", icon_custom_emoji_id: EMOJI_IDS.PHONE }
                ],
                [
                    { text: "KEMBALI", callback_data: "back_home", icon_custom_emoji_id: EMOJI_IDS.BACK }
                ]
            ]
        }
    };
    return { text, keyboard };
}
global.getPanduanMessage = getPanduanMessage;

async function getStatsMessage() {
    const totalUsers = statsCache.totalUsers
    const uptimeSeconds = process.uptime()
    const days = Math.floor(uptimeSeconds / 86400)
    const hours = Math.floor((uptimeSeconds % 86400) / 3600)
    const minutes = Math.floor((uptimeSeconds % 3600) / 60)
    const uptimeString = days > 0 
          ? `${days}d ${hours}h ${minutes}m` 
          : `${hours}h ${minutes}m`
    const memoryUsage = process.memoryUsage()
    const memMB = Math.round(memoryUsage.rss / 1024 / 1024)

    const mtStatus = IS_MAINTENANCE_MODE ? 'AKTIF' : 'NONAKTIF'
    let activeSessions = 0
    try {
        if (WaManager && WaManager.sessions) {
            for (const userSessions of WaManager.sessions.values()) {
                activeSessions += userSessions.size
            }
        }
    } catch (e) {
        activeSessions = 0
    }

    return `<b>${EMOJIS.BOT} STATUS SISTEM</b>

<blockquote>${EMOJIS.USER} Total User: <b>${totalUsers}</b>
${EMOJIS.PHONE} WA Aktif: <b>${activeSessions}</b>
${EMOJIS.TIME} Uptime: <b>${uptimeString}</b>
${EMOJIS.GEAR} Maintenance: <b>${mtStatus}</b>
${EMOJIS.TAG} RAM: <b>${memMB} MB</b></blockquote>`.trim()
}
global.getStatsMessage = getStatsMessage;

async function getForceSubMenuMessage() {
    const isEnabled = global.IS_FORCE_SUB_ENABLED !== false;
    const channels = Array.isArray(global.forceSubChannels) ? global.forceSubChannels : [];

    const statusBadge = isEnabled ? `${EMOJIS.DOT_GREEN} <b>AKTIF</b>` : `${EMOJIS.DOT_RED} <b>NONAKTIF</b>`;

    let chListStr = "";
    if (channels.length === 0) {
        chListStr = `${EMOJIS.NOTE} <i>Belum ada channel/grup wajib join yang diatur.\nSemua pengguna dapat menggunakan bot tanpa pembatasan join.</i>`;
    } else {
        chListStr = channels.map((c, idx) => {
            const numEmoji = [EMOJIS.NUM_1, EMOJIS.NUM_2, EMOJIS.NUM_3, EMOJIS.NUM_4, EMOJIS.NUM_5, EMOJIS.NUM_6, EMOJIS.NUM_7, EMOJIS.NUM_8, EMOJIS.NUM_9, `${EMOJIS.NUM_1}${EMOJIS.NUM_0}`][idx] || `${idx + 1}.`;
            const name = escapeHTML(c.title || 'Channel');
            const uname = c.username ? ` (@${escapeHTML(c.username.replace(/^@/, ''))})` : '';
            const idVal = c.id || '-';
            const linkHref = c.inviteLink || (c.username ? `https://t.me/${c.username.replace(/^@/, '')}` : null);
            const linkHtml = linkHref ? ` • <a href="${linkHref}">Buka Link</a>` : '';
            return `${numEmoji} <b>${name}</b>${uname}\n└ ID: <code>${idVal}</code>${linkHtml}`;
        }).join("\n\n");
    }

    const text = `<b>${EMOJIS.GLOBE} PENGATURAN CHANNEL WAJIB JOIN (FORCE SUB)</b>

<blockquote>Status Fitur: ${statusBadge}
Total Channel: <b>${channels.length} channel</b></blockquote>

<blockquote><b>Daftar Channel Wajib Join:</b>\n\n${chListStr}</blockquote>

<blockquote expandable><b>💡 Panduan Cepat:</b>
• <b>Status Fitur:</b> Jika NONAKTIF, user bebas akses bot tanpa dicek.
• <b>Tambah Channel:</b> Kirim @username publik atau ID private (-100xxx).
• <b>Admin Bot:</b> Bot WAJIB menjadi <b>Admin</b> di channel target dengan izin invite users.</blockquote>`.trim();

    const toggleText = isEnabled ? "MATIKAN FITUR" : "AKTIFKAN FITUR";
    const toggleIcon = isEnabled ? EMOJI_IDS.CROSS : EMOJI_IDS.CHECK;

    const keyboard = {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: toggleText, callback_data: "owner_fsub_toggle", icon_custom_emoji_id: toggleIcon }
                ],
                [
                    { text: "TAMBAH CHANNEL", callback_data: "owner_fsub_add", icon_custom_emoji_id: EMOJI_IDS.PLUS },
                    { text: "HAPUS CHANNEL", callback_data: "owner_fsub_del_menu", icon_custom_emoji_id: EMOJI_IDS.CROSS }
                ],
                [
                    { text: "CEK STATUS BOT", callback_data: "owner_fsub_check_admin", icon_custom_emoji_id: EMOJI_IDS.SEARCH },
                    { text: "REFRESH", callback_data: "owner_fsub_menu", icon_custom_emoji_id: EMOJI_IDS.REFRESH }
                ],
                [
                    { text: "KEMBALI KE OWNER PANEL", callback_data: "action_ownermenu", icon_custom_emoji_id: EMOJI_IDS.BACK }
                ]
            ]
        }
    };

    return { text, keyboard };
}
global.getForceSubMenuMessage = getForceSubMenuMessage;

async function showMainMenu(ctx) {
    if (!ctx) return
    lastBotActivity = Date.now()
    if (ctx.callbackQuery) {
        ctx.deleteMessage().catch(() => {})
    }

    const joinStatus = await isJoined(ctx);
    if (!joinStatus.allJoined) {
        const textJoin = `<b>${EMOJIS.PROHIBITED} AKSES DIBATASI</b>

<blockquote>Silakan bergabung ke channel/grup berikut untuk membuka menu:</blockquote>`;

        const buttons = [];
        for (const chat of joinStatus.unjoined) {
            let url = (typeof chat === 'object' && (chat.inviteLink || chat.url || chat.link)) ? (chat.inviteLink || chat.url || chat.link) : '';
            const chatId = typeof chat === 'object' ? (chat.id || chat.username || '') : String(chat);

            if (!url) {
                if (String(chatId).startsWith('-100')) {
                    try {
                        const inviteLink = await ctx.telegram.exportChatInviteLink(chatId);
                        url = inviteLink;
                        if (typeof chat === 'object') chat.inviteLink = url;
                    } catch (e) {
                        logger.add('ERROR', `Gagal membuat link invite untuk chat private ${chatId}: ${e.message}`);
                    }
                } else {
                    const cleanUser = String(chatId).replace(/^@/, '').replace(/^https?:\/\/t\.me\//, '');
                    url = `https://t.me/${cleanUser}`;
                }
            }

            let rawTitle = (typeof chat === 'object' && (chat.title || chat.name)) ? (chat.title || chat.name) : '';
            if (!rawTitle) {
                if (typeof chat === 'object' && chat.username) {
                    rawTitle = chat.username.replace(/^@/, '');
                } else if (!String(chatId).startsWith('-100')) {
                    rawTitle = String(chatId).replace(/^@/, '').replace(/^https?:\/\/t\.me\//, '');
                } else {
                    rawTitle = 'CHANNEL';
                }
            }
            const safeTitle = String(rawTitle || 'CHANNEL').trim().toUpperCase();

            buttons.push([{
                text: `JOIN ${safeTitle}`,
                url: url || (config.botUsername ? `https://t.me/${config.botUsername}` : 'https://t.me/'),
                icon_custom_emoji_id: EMOJI_IDS.GLOBE
            }]);
        }
        buttons.push([{ text: 'SAYA SUDAH JOIN', callback_data: 'cek_join_lagi', icon_custom_emoji_id: EMOJI_IDS.CHECK }]);
        const keyboardJoin = { reply_markup: { inline_keyboard: buttons } };

        if (!fileIdCache.menuImage && uploadLocks.menuImage) {
            for (let i = 0; i < 50 && !fileIdCache.menuImage; i++) await new Promise(r => setTimeout(r, 100));
        }
        let isUploading = false;
        if (!fileIdCache.menuImage) { uploadLocks.menuImage = true; isUploading = true; }

        const photoObj = fileIdCache.menuImage || { source: config.menuImage };
        let sentMsg;
        try {
            sentMsg = await ctx.replyWithPhoto(photoObj, { caption: textJoin, parse_mode: 'HTML', ...keyboardJoin })
        } finally {
            if (isUploading) {
                if (sentMsg && sentMsg.photo) {
                    fileIdCache.menuImage = sentMsg.photo[sentMsg.photo.length - 1].file_id;
                }
                uploadLocks.menuImage = false;
            }
        }
        return sentMsg;
    }

    const fullName = escapeHTML(`${ctx.from.first_name} ${ctx.from.last_name || ''}`.trim())
    const username = ctx.from.username ? `@${ctx.from.username}` : fullName

    const uptimeSeconds = process.uptime()
    const days = Math.floor(uptimeSeconds / 86400)
    const hours = Math.floor((uptimeSeconds % 86400) / 3600)
    const minutes = Math.floor((uptimeSeconds % 3600) / 60)
    const uptimeString = days > 0 
        ? `${days}d ${hours}h ${minutes}m` 
        : `${hours}h ${minutes}m`

    const user = await checkUser(ctx.from.id, ctx.from);
    const isOwner = ctx.from.id === config.ownerId;
    const isPremium = Boolean(user && user.premium);

    let statusLabel = '';
    if (isOwner) {
        statusLabel = `${EMOJIS.OWNER} <b>OWNER</b>`;
    } else if (isPremium) {
        const expStr = user.premiumUntil ? formatWaktuGaul(new Date(user.premiumUntil)) : 'LIFETIME';
        statusLabel = `${EMOJIS.PREMIUM} <b>PREMIUM</b> — s/d <i>${expStr}</i>`;
    } else {
        statusLabel = `${EMOJIS.FREE} <b>FREE</b> — Limit: <b>${user?.limit ?? 5}/5</b>`;
    }

    const totalUsersCount = statsCache.totalUsers || await User.countDocuments({}).lean();

    const textWelcome = `<b>${EMOJIS.BOT} Whatsapp Tools Wspro Untility.</b>

Selamat datang, <b>${fullName}</b>.

${EMOJIS.ID} ID: <code>${ctx.from.id}</code>
${EMOJIS.USER} Username: ${username}
${EMOJIS.STAR} Status: ${statusLabel}

${EMOJIS.PHONE} User Aktif: <b>${totalUsersCount}</b>
${EMOJIS.TIME} Uptime: <b>${uptimeString}</b>

Silakan pilih menu di bawah ini.`

    const keyboard = { reply_markup: { inline_keyboard: [
        [
            { text: 'CEK BIO', callback_data: 'menu_cekbio', icon_custom_emoji_id: EMOJI_IDS.DOC, style: 'primary' },
            { text: 'DETECT OTP', callback_data: 'menu_detect', icon_custom_emoji_id: EMOJI_IDS.SEARCH, style: 'primary' }
        ],
        [
            { text: 'LIMITIN CODE', callback_data: 'menu_limitin', icon_custom_emoji_id: EMOJI_IDS.ROCKET, style: 'primary' }
        ],
        [
            { text: 'BELI PREMIUM', callback_data: 'menu_buyprem', icon_custom_emoji_id: EMOJI_IDS.PREMIUM, style: 'success' },
            { text: 'REDEEM CODE', callback_data: 'menu_redeem', icon_custom_emoji_id: EMOJI_IDS.GIFT, style: 'success' }
        ],
        [
            { text: 'REFERRAL', callback_data: 'menu_referral', icon_custom_emoji_id: EMOJI_IDS.USER },
            { text: 'LEADERBOARD', callback_data: 'menu_leaderboard', icon_custom_emoji_id: EMOJI_IDS.TROPHY }
        ],
        [
            { text: 'STATISTIK', callback_data: 'menu_stats', icon_custom_emoji_id: EMOJI_IDS.CHART },
            { text: 'PANDUAN BOT', callback_data: 'menu_panduan', icon_custom_emoji_id: EMOJI_IDS.BOOK }
        ],
        [
            { text: 'API DOCS', callback_data: 'menu_apidocs', icon_custom_emoji_id: EMOJI_IDS.DOC }
        ],
        [
            { text: 'AMBIL APIKEY', callback_data: 'menu_ambilapikey', icon_custom_emoji_id: EMOJI_IDS.KEY }
        ]
    ] } }

    if (ctx.from.id === config.ownerId) {
        keyboard.reply_markup.inline_keyboard.push([
            { text: 'OWNER PANEL', callback_data: 'action_ownermenu', icon_custom_emoji_id: EMOJI_IDS.OWNER, style: 'danger' }
        ]);
    }

    if (!fileIdCache.menuImage && uploadLocks.menuImage) {
        for (let i = 0; i < 50 && !fileIdCache.menuImage; i++) await new Promise(r => setTimeout(r, 100));
    }
    let isUploading2 = false;
    if (!fileIdCache.menuImage) { uploadLocks.menuImage = true; isUploading2 = true; }

    const photoObj = fileIdCache.menuImage || { source: config.menuImage };
    let sentMsg;
    try {
        sentMsg = await ctx.replyWithPhoto(photoObj, { caption: textWelcome, parse_mode: 'HTML', ...keyboard })
    } finally {
        if (isUploading2) {
            if (sentMsg && sentMsg.photo) {
                fileIdCache.menuImage = sentMsg.photo[sentMsg.photo.length - 1].file_id;
            }
            uploadLocks.menuImage = false;
        }
    }
}

global.showMainMenu = showMainMenu;

function getRedeemMenuMessage() {
    const text = `<b>${EMOJIS.GIFT} KLAIM KODE REDEEM</b>

<blockquote>Punya kode promo atau voucher dari Owner?
Klaim sekarang untuk mendapatkan kuota limit tambahan atau upgrade akun Premium!</blockquote>

<blockquote expandable><b>Cara Klaim:</b>
• Kirim kode promo langsung di pesan obrolan ini
• Atau ketik perintah: <code>/redeem KODE</code></blockquote>`.trim();

    const keyboard = {
        reply_markup: {
            inline_keyboard: [
                [{ text: "KEMBALI", callback_data: "back_home", icon_custom_emoji_id: EMOJI_IDS.BACK }]
            ]
        }
    };

    return { text, keyboard };
}
global.getRedeemMenuMessage = getRedeemMenuMessage;

async function getMainOwnerMenuMessage() {
    const totalUsers = (typeof statsCache !== 'undefined' && statsCache.totalUsers) ? statsCache.totalUsers : await User.countDocuments({}).lean();
    const fsubCount = (global.forceSubChannels || []).length;
    const fsubStatus = (global.IS_FORCE_SUB_ENABLED !== false) ? `${EMOJIS.DOT_GREEN} AKTIF` : `${EMOJIS.DOT_RED} NONAKTIF`;
    const mtStatus = global.IS_MAINTENANCE_MODE ? `${EMOJIS.DOT_RED} AKTIF (BEKU)` : `${EMOJIS.DOT_GREEN} NORMAL`;

    const uptimeSeconds = process.uptime();
    const days = Math.floor(uptimeSeconds / 86400);
    const hours = Math.floor((uptimeSeconds % 86400) / 3600);
    const minutes = Math.floor((uptimeSeconds % 3600) / 60);
    const uptimeString = days > 0 ? `${days}d ${hours}h ${minutes}m` : `${hours}h ${minutes}m`;

    const text = `<b>${EMOJIS.OWNER} OWNER CONTROL PANEL</b>

<blockquote>Pusat kendali dan administrasi bot:</blockquote>

<blockquote expandable><b>Ringkasan Sistem:</b>
• ${EMOJIS.GLOBE} Database: <b>LOKAL (JSON)</b>
• ${EMOJIS.GEAR} Maintenance: <b>${mtStatus}</b>
• ${EMOJIS.GLOBE} Wajib Join: <b>${fsubStatus} (${fsubCount} ch)</b>
• ${EMOJIS.USER} Total User: <b>${totalUsers} pengguna</b>
• ${EMOJIS.TIME} Uptime: <b>${uptimeString}</b></blockquote>

<blockquote>Pilih menu kelola di bawah:</blockquote>`.trim();

    const keyboard = {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: "BROADCAST", callback_data: "owner_menu_broadcast", icon_custom_emoji_id: EMOJI_IDS.BROADCAST },
                    { text: "KELOLA REDEEM", callback_data: "owner_menu_redeem", icon_custom_emoji_id: EMOJI_IDS.GIFT }
                ],
                [
                    { text: "KELOLA PREMIUM", callback_data: "owner_menu_premium", icon_custom_emoji_id: EMOJI_IDS.PREMIUM },
                    { text: "KELOLA USER", callback_data: "owner_menu_users", icon_custom_emoji_id: EMOJI_IDS.USER }
                ],
                [
                    { text: "WAJIB JOIN (FSUB)", callback_data: "owner_fsub_menu", icon_custom_emoji_id: EMOJI_IDS.GLOBE },
                    { text: "MAINTENANCE", callback_data: "owner_menu_maintenance", icon_custom_emoji_id: EMOJI_IDS.GEAR }
                ],
                [
                    { text: "KELOLA API PLANS", callback_data: "owner_menu_api_plans", icon_custom_emoji_id: EMOJI_IDS.GEAR }
                ],
                [
                    { text: "BACKUP PROJECT", callback_data: "owner_backup", icon_custom_emoji_id: EMOJI_IDS.BACKUP },
                    { text: "RESTART BOT", callback_data: "restart_bot", icon_custom_emoji_id: EMOJI_IDS.REFRESH }
                ],
                [
                    { text: "KEMBALI KE MENU UTAMA", callback_data: "back_home", icon_custom_emoji_id: EMOJI_IDS.BACK }
                ]
            ]
        }
    };

    return { text, keyboard };
}
global.getMainOwnerMenuMessage = getMainOwnerMenuMessage;

async function getOwnerApiPlansMenuMessage() {
    let plans = [];
    try {
        const { getApiPlans } = require('./api');
        plans = await getApiPlans();
    } catch (_) {
        const config = require('../config');
        plans = config.apiPlans || [];
    }

    const planLines = plans.map((p, i) => {
        const quota = [
            p.maxCekBio === -1 ? 'Cek Bio: ∞' : `Cek Bio: ${p.maxCekBio}`,
            p.maxDetect === -1 ? 'Detect: ∞' : `Detect: ${p.maxDetect}`,
            p.maxLimitin === -1 ? 'Limitin: ∞' : `Limitin: ${p.maxLimitin}`,
        ].join(' | ');
        return `${i + 1}. <b>${p.name}</b> — Rp ${p.price.toLocaleString('id-ID')}\n   <code>${quota}</code> (${p.quotaPeriod}, ${p.days}d)`;
    }).join('\n\n');

    const text = `<b>${EMOJIS.GEAR} KELOLA API PLANS</b>

<blockquote>Daftar paket API aktif:</blockquote>

<blockquote expandable>${planLines || 'Belum ada paket.'}</blockquote>

<blockquote>Pilih aksi di bawah:</blockquote>`.trim();

    const buttons = plans.map((p, i) => ([{
        text: `✏️ Edit: ${p.name}`,
        callback_data: `owner_api_edit_${p.id}`,
        icon_custom_emoji_id: EMOJI_IDS.GEAR
    }]));

    buttons.push([
        { text: "TAMBAH PAKET BARU", callback_data: "owner_api_add", icon_custom_emoji_id: EMOJI_IDS.GIFT }
    ]);
    buttons.push([
        { text: "BERI PAKET KE USER", callback_data: "owner_api_grant", icon_custom_emoji_id: EMOJI_IDS.USER }
    ]);
    buttons.push([
        { text: "KEMBALI KE OWNER PANEL", callback_data: "action_ownermenu", icon_custom_emoji_id: EMOJI_IDS.BACK }
    ]);

    const keyboard = { reply_markup: { inline_keyboard: buttons } };
    return { text, keyboard };
}
global.getOwnerApiPlansMenuMessage = getOwnerApiPlansMenuMessage;

function getOwnerBroadcastMenuMessage() {
    const text = `<b>${EMOJIS.BROADCAST} MENU BROADCAST PENGGUNA</b>

<blockquote>Kirim pengumuman atau teruskan pesan ke seluruh pengguna bot:</blockquote>

<blockquote expandable><b>Perintah Broadcast:</b>
• <code>/bc [teks/media]</code> — Broadcast teks/media ke semua user
• <code>/bcpin [teks/media]</code> — Broadcast teks/media & otomatis pin
• <code>/bcfd</code> (reply pesan) — Teruskan pesan ke semua user
• <code>/bcfdpin</code> (reply pesan) — Teruskan pesan & otomatis pin
• <code>/unpinmassal</code> — Lepas semua pin dari obrolan user</blockquote>`.trim();

    const keyboard = {
        reply_markup: {
            inline_keyboard: [
                [{ text: "KIRIM BROADCAST TEKS", callback_data: "owner_prompt_bc", icon_custom_emoji_id: EMOJI_IDS.BROADCAST }],
                [{ text: "LEPAS SEMUA PIN", callback_data: "owner_unpin_all", icon_custom_emoji_id: EMOJI_IDS.CROSS }],
                [{ text: "KEMBALI KE OWNER PANEL", callback_data: "action_ownermenu", icon_custom_emoji_id: EMOJI_IDS.BACK }]
            ]
        }
    };

    return { text, keyboard };
}
global.getOwnerBroadcastMenuMessage = getOwnerBroadcastMenuMessage;

async function getOwnerRedeemMenuMessage() {
    const totalCodes = await RedeemCode.countDocuments({}).lean();
    const text = `<b>${EMOJIS.GIFT} KELOLA KODE REDEEM</b>

<blockquote>Buat kupon atau kode voucher untuk limit & premium:</blockquote>

<blockquote expandable><b>Daftar Perintah Redeem:</b>
• <code>/createcode prem [hari] [kuota] [kode]</code>
  Contoh: <code>/createcode prem 7 10 PROMO7HARI</code>
• <code>/createcode limit [jumlah] [kuota] [kode]</code>
  Contoh: <code>/createcode limit 10 20 LIMITGRATIS</code>
• <code>/listcode</code> — Tampilkan semua kode aktif
• <code>/delcode [kode]</code> — Hapus kode redeem

<i>Total kode saat ini: <b>${totalCodes} kode</b></i></blockquote>`.trim();

    const keyboard = {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: "BUAT KODE LIMIT", callback_data: "owner_create_code_limit", icon_custom_emoji_id: EMOJI_IDS.PLUS },
                    { text: "BUAT KODE PREM", callback_data: "owner_create_code_prem", icon_custom_emoji_id: EMOJI_IDS.PREMIUM }
                ],
                [
                    { text: "DAFTAR KODE AKTIF", callback_data: "owner_list_codes", icon_custom_emoji_id: EMOJI_IDS.DOC }
                ],
                [
                    { text: "KEMBALI KE OWNER PANEL", callback_data: "action_ownermenu", icon_custom_emoji_id: EMOJI_IDS.BACK }
                ]
            ]
        }
    };

    return { text, keyboard };
}
global.getOwnerRedeemMenuMessage = getOwnerRedeemMenuMessage;

function getOwnerPremiumMenuMessage() {
    const text = `<b>${EMOJIS.PREMIUM} KELOLA AKUN PREMIUM</b>

<blockquote>Manajemen status langganan premium pengguna secara manual:</blockquote>

<blockquote expandable><b>Perintah Premium:</b>
• <code>/setprem [id] [hari/lifetime]</code>
  Contoh: <code>/setprem 1234567 30</code> atau <code>/setprem 1234567 lifetime</code>
• <code>/delprem [id]</code>
  Contoh: <code>/delprem 1234567</code> (kembali ke Free)</blockquote>`.trim();

    const keyboard = {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: "TAMBAH PREMIUM", callback_data: "owner_prompt_setprem", icon_custom_emoji_id: EMOJI_IDS.PLUS },
                    { text: "CABUT PREMIUM", callback_data: "owner_prompt_delprem", icon_custom_emoji_id: EMOJI_IDS.CROSS }
                ],
                [
                    { text: "KEMBALI KE OWNER PANEL", callback_data: "action_ownermenu", icon_custom_emoji_id: EMOJI_IDS.BACK }
                ]
            ]
        }
    };

    return { text, keyboard };
}
global.getOwnerPremiumMenuMessage = getOwnerPremiumMenuMessage;

async function getOwnerPremiumLogsMessage() {
    const paidInvoices = await Invoice.find({ status: 'PAID' }).sort({ paidAt: -1, createdAt: -1 }).lean();
    const totalTransactions = paidInvoices.length;
    let totalIncome = 0;
    for (const inv of paidInvoices) {
        totalIncome += Number(inv.payAmount || inv.amount || 0);
    }

    const totalActivePrem = await User.countDocuments({ premium: true });

    const formatWaktu = typeof formatWaktuGaul === 'function' 
        ? formatWaktuGaul 
        : (d) => new Date(d).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });

    let listText = '';
    if (paidInvoices.length === 0) {
        listText = '<i>Belum ada transaksi pembelian premium (QRIS) yang tercatat.</i>';
    } else {
        const recent = paidInvoices.slice(0, 10);
        const lines = [];
        for (let i = 0; i < recent.length; i++) {
            const inv = recent[i];
            const dateStr = inv.paidAt 
                ? formatWaktu(new Date(inv.paidAt)) 
                : (inv.createdAt ? formatWaktu(new Date(inv.createdAt)) : '-');
            const priceStr = Number(inv.payAmount || inv.amount || 0).toLocaleString('id-ID');
            let uName = '';
            if (global.userCache && global.userCache.has(inv.userId)) {
                const u = global.userCache.get(inv.userId);
                uName = u.username ? `@${u.username}` : (u.firstName || '');
            }
            if (!uName) {
                const u = await User.findOne({ userId: inv.userId }).lean().catch(() => null);
                if (u) uName = u.username ? `@${u.username}` : (u.firstName || '');
            }

            lines.push(
                `<b>#${i + 1} • <code>${inv.merchantReferenceId || inv.invoiceId}</code></b>\n` +
                `├ ${EMOJIS.USER} User: <code>${inv.userId}</code> ${uName ? `(${escapeHTML(uName)})` : ''}\n` +
                `├ ${EMOJIS.STAR} Paket: <b>${escapeHTML(inv.planName || (inv.days >= 3650 ? 'Lifetime' : inv.days + ' Hari'))}</b>\n` +
                `├ ${EMOJIS.KEY} Nominal: <b>Rp ${priceStr}</b>\n` +
                `├ ${EMOJIS.TIME} Waktu: <code>${dateStr}</code>\n` +
                `└ ${EMOJIS.CHECK} Status: <b>LUNAS (PAID)</b>`
            );
        }
        listText = lines.join('\n\n');
    }

    const text = `<b>${EMOJIS.PREMIUM} LOG TRANSAKSI PEMBELI PREMIUM</b>\n\n` +
                 `<blockquote><b>Statistik Pendapatan Premium:</b>\n` +
                 `• Total Transaksi Sukses: <b>${totalTransactions} transaksi</b>\n` +
                 `• Total Omset QRIS: <b>Rp ${totalIncome.toLocaleString('id-ID')}</b>\n` +
                 `• User Premium Aktif: <b>${totalActivePrem} pengguna</b></blockquote>\n\n` +
                 `<b>10 Transaksi Terakhir:</b>\n\n` +
                 `<blockquote expandable>${listText}</blockquote>`.trim();

    const keyboard = {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: "REFRESH LOG", callback_data: "owner_log_premium", icon_custom_emoji_id: EMOJI_IDS.REFRESH }
                ],
                [
                    { text: "KEMBALI KE KELOLA PREMIUM", callback_data: "owner_menu_premium", icon_custom_emoji_id: EMOJI_IDS.BACK }
                ]
            ]
        }
    };

    return { text, keyboard };
}
global.getOwnerPremiumLogsMessage = getOwnerPremiumLogsMessage;

function getOwnerUsersMenuMessage() {
    const text = `<b>${EMOJIS.USER} KELOLA PENGGUNA BOT</b>

<blockquote>Kendali dan pengaturan akun pengguna, limit, dan sesi:</blockquote>

<blockquote expandable><b>Perintah Manajemen User:</b>
• <code>/cekuser [id]</code> — Cek detail akun & statistik
• <code>/addlimit [id] [jumlah]</code> — Tambah kuota limit
• <code>/setlimit [id] [jumlah]</code> — Ubah total limit
• <code>/ban [id]</code> — Blokir akses pengguna
• <code>/unban [id]</code> — Buka blokir pengguna
• <code>/delsession [id/me]</code> — Putus sesi WhatsApp</blockquote>`.trim();

    const keyboard = {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: "CEK INFO USER", callback_data: "owner_prompt_cekuser", icon_custom_emoji_id: EMOJI_IDS.SEARCH },
                    { text: "TAMBAH LIMIT", callback_data: "owner_prompt_addlimit", icon_custom_emoji_id: EMOJI_IDS.PLUS }
                ],
                [
                    { text: "KEMBALI KE OWNER PANEL", callback_data: "action_ownermenu", icon_custom_emoji_id: EMOJI_IDS.BACK }
                ]
            ]
        }
    };

    return { text, keyboard };
}
global.getOwnerUsersMenuMessage = getOwnerUsersMenuMessage;

async function getOwnerMaintenanceMenuMessage() {
    const isMt = global.IS_MAINTENANCE_MODE === true;
    const statusLabel = isMt ? `${EMOJIS.DOT_RED} <b>AKTIF (DIBEKUKAN)</b>` : `${EMOJIS.DOT_GREEN} <b>NONAKTIF (NORMAL)</b>`;
    const toggleText = isMt ? "MATIKAN MAINTENANCE" : "AKTIFKAN MAINTENANCE";
    const toggleIcon = isMt ? EMOJI_IDS.CHECK : EMOJI_IDS.CROSS;

    let durationText = "";
    if (isMt) {
        const setStart = await Setting.findOne({ key: "maintenance_started_at" });
        const start = Number(setStart?.value) || 0;
        if (start > 0) {
            const elapsed = Date.now() - start;
            const m = Math.floor(elapsed / 60000);
            durationText = `\n• Berjalan selama: <b>${m} menit</b>`;
        }
    }

    const text = `<b>${EMOJIS.GEAR} KONTROL MODE MAINTENANCE</b>

<blockquote>Status Saat Ini: ${statusLabel}${durationText}</blockquote>

<blockquote expandable><b>Sistem Pembekuan Premium Otomatis (Auto-Freeze):</b>
• Saat mode perbaikan <b>AKTIF</b>, seluruh masa aktif akun Premium otomatis <b>DIBEKUKAN</b> (waktu tidak berkurang).
• Saat mode perbaikan <b>DIMATIKAN</b>, sistem otomatis memperpanjang masa aktif seluruh akun premium sesuai lama durasi pemeliharaan!
• Pengguna biasa tidak dapat mengakses bot dan diberi tahu secara profesional.</blockquote>

<blockquote><b>Perintah Cepat:</b> <code>/modeperbaikan</code></blockquote>`.trim();

    const keyboard = {
        reply_markup: {
            inline_keyboard: [
                [{ text: toggleText, callback_data: "owner_toggle_maintenance", icon_custom_emoji_id: toggleIcon }],
                [{ text: "KEMBALI KE OWNER PANEL", callback_data: "action_ownermenu", icon_custom_emoji_id: EMOJI_IDS.BACK }]
            ]
        }
    };

    return { text, keyboard };
}
global.getOwnerMaintenanceMenuMessage = getOwnerMaintenanceMenuMessage;

async function toggleMaintenanceMode() {
    const isCurrentlyMt = global.IS_MAINTENANCE_MODE === true;
    const newMt = !isCurrentlyMt;
    global.IS_MAINTENANCE_MODE = newMt;
    const now = Date.now();

    if (newMt) {
        await Setting.findOneAndUpdate({ key: "maintenance_mode" }, { value: true }, { upsert: true });
        await Setting.findOneAndUpdate({ key: "maintenance_started_at" }, { value: now }, { upsert: true });
        logger.add("SYSTEM", "Maintenance Mode AKTIF. Masa aktif premium dibekukan.");
        return {
            status: true,
            message: `<b>${EMOJIS.GEAR} MODE PERBAIKAN (MAINTENANCE) DIAKTIFKAN</b>\n\n<blockquote>Status: <b>AKTIF</b>\n${EMOJIS.SHIELD} Masa aktif seluruh user Premium otomatis <b>DIBEKUKAN</b> (tidak akan berkurang).</blockquote>`
        };
    } else {
        const setStart = await Setting.findOne({ key: "maintenance_started_at" });
        const startTime = Number(setStart?.value) || 0;
        let extendedInfo = "";

        if (startTime > 0) {
            const durationMs = Math.max(0, now - startTime);
            const durMenit = Math.floor(durationMs / 60000);
            const durJam = Math.floor(durMenit / 60);
            const sisaMenit = durMenit % 60;
            const durStr = durJam > 0 ? `${durJam} jam ${sisaMenit} menit` : `${durMenit} menit`;

            const premUsers = await User.find({ premium: true });
            let countExtended = 0;
            for (const u of premUsers) {
                if (u.premiumUntil && typeof u.premiumUntil === "number") {
                    const newExp = u.premiumUntil + durationMs;
                    await User.updateOne({ userId: u.userId }, { $set: { premiumUntil: newExp } });
                    countExtended++;
                }
            }
            if (global.userCache) global.userCache.clear();

            extendedInfo = `\n\n<blockquote>${EMOJIS.CHECK} Durasi Maintenance: <b>${durStr}</b>\n${EMOJIS.PREMIUM} <b>${countExtended} user premium</b> masa aktifnya otomatis diperpanjang sesuai durasi maintenance!</blockquote>`;
        }

        await Setting.findOneAndUpdate({ key: "maintenance_mode" }, { value: false }, { upsert: true });
        await Setting.findOneAndUpdate({ key: "maintenance_started_at" }, { value: null }, { upsert: true });
        logger.add("SYSTEM", "Maintenance Mode NONAKTIF. Masa aktif user premium diperpanjang.");

        return {
            status: false,
            message: `<b>${EMOJIS.CHECK} MODE PERBAIKAN (MAINTENANCE) DIMATIKAN</b>\n\n<blockquote>Status: <b>NONAKTIF</b> (Bot normal kembali)</blockquote>${extendedInfo}`
        };
    }
}
global.toggleMaintenanceMode = toggleMaintenanceMode;

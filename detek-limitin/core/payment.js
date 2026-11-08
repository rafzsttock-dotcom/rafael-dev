const axios = require('axios');
const crypto = require('crypto');
const QRCode = require('qrcode');
const config = require('../config');
const { User, Invoice } = require('../database');
const logger = require('./logger');
const { EMOJIS, EMOJI_IDS } = require('./emojis');

function signRequest(method, path, body, secret) {
    const timestamp = Date.now().toString();
    const payload = `${method}\n${path}\n${body}\n${timestamp}`;
    const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    return { timestamp, signature };
}

class PaymentManager {
    constructor() {
        this.apiKey = config.austinpay?.apiKey || '';
        this.apiSecret = config.austinpay?.apiSecret || '';
        this.baseUrl = config.austinpay?.baseUrl || 'https://austinstore.id';
        this.plans = config.premiumPlans || [];
        this.pollTimer = null;
        this.isPolling = false;
    }

    getPlan(planId) {
        return this.plans.find(p => p.id === planId) || null;
    }

    /**
     * Buat deposit QRIS
     * POST /api/deposit/create
     * Response: { success, deposit: { transaction_id, amount, qr_string, qr_image, expired_at, status } }
     */
    async createInvoice(userId, planId, ctx = null, planType = 'premium') {
        let plan;
        if (planType === 'api') {
            const { getApiPlans } = require('./api');
            const apiPlansList = await getApiPlans();
            plan = apiPlansList.find(p => p.id === planId) || null;
        } else {
            plan = this.getPlan(planId);
        }
        if (!plan) throw new Error('Paket tidak ditemukan.');

        logger.add('PAYMENT', `Membuat deposit AustinPay untuk User ${userId} (${plan.name}, Rp${plan.price})...`);

        const path = '/api/deposit/create';
        const bodyObj = { amount: plan.price };
        const body = JSON.stringify(bodyObj);
        const { timestamp, signature } = signRequest('POST', path, body, this.apiSecret);

        let result = null;
        try {
            const response = await axios.post(`${this.baseUrl}${path}`, bodyObj, {
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-Key': this.apiKey,
                    'X-Timestamp': timestamp,
                    'X-Signature': signature
                },
                timeout: 30000
            });
            result = response.data;
        } catch (err) {
            const errMsg = err?.response?.data?.message || err.message;
            logger.add('ERROR', `AustinPay create gagal: ${errMsg}`);
            throw new Error(`Gagal membuat tagihan: ${errMsg}`);
        }

        if (!result || !result.success || !result.deposit) {
            throw new Error(result?.message || 'Gagal membuat deposit QRIS.');
        }

        const dep = result.deposit;
        const transactionId = dep.transaction_id;
        const amount = dep.amount || plan.price;
        const qrImage = dep.qr_image || '';
        const qrString = dep.qr_string || '';

        const expiredDate = dep.expired_at ? new Date(dep.expired_at) : new Date(Date.now() + 15 * 60 * 1000);

        const newInvoice = new Invoice({
            invoiceId: transactionId,
            referenceId: transactionId,
            merchantReferenceId: `ORD-${userId}-${Date.now().toString().slice(-6)}`,
            userId: userId,
            planId: plan.id,
            planName: plan.name,
            planType: planType,
            days: plan.days,
            amount: plan.price,
            payAmount: amount,
            uniqueCode: dep.unique_code || 0,
            qrisUrl: qrImage,
            qrisString: qrString,
            checkoutUrl: '',
            status: 'PENDING',
            chatId: ctx?.chat?.id || userId,
            createdAt: new Date(),
            expiredAt: expiredDate
        });

        await newInvoice.save();
        logger.add('PAYMENT', `Invoice ${transactionId} dibuat. Nominal: Rp${amount}`);

        // Render QR
        let qrBuffer = null;
        try {
            if (qrString) {
                qrBuffer = await QRCode.toBuffer(qrString, {
                    width: 600,
                    margin: 2,
                    color: { dark: '#000000', light: '#ffffff' }
                });
            } else if (qrImage && qrImage.includes(',')) {
                qrBuffer = Buffer.from(qrImage.split(',')[1], 'base64');
            } else if (qrImage && qrImage.startsWith('http')) {
                const imgRes = await axios.get(qrImage, { responseType: 'arraybuffer', timeout: 10000 });
                qrBuffer = Buffer.from(imgRes.data);
            }
        } catch (qrErr) {
            logger.add('ERROR', `Gagal render QR buffer: ${qrErr.message}`);
        }

        return {
            invoice: newInvoice.toObject(),
            apiData: dep,
            qrBuffer
        };
    }

    /**
     * Cek status deposit
     * GET /api/deposit/check/:id
     * Response: { success: true, status: "paid"|"pending"|"expired", message: "..." }
     * ⚠️ PENTING: AustinPay TIDAK balikin object "deposit", cuma "status" + "message"
     */
    async checkInvoiceStatus(invoiceId) {
        logger.add('PAYMENT', `Mengecek status deposit ${invoiceId}...`);

        const path = `/api/deposit/check/${invoiceId}`;
        const { timestamp, signature } = signRequest('GET', path, '', this.apiSecret);

        let result = null;
        try {
            const response = await axios.get(`${this.baseUrl}${path}`, {
                headers: {
                    'X-API-Key': this.apiKey,
                    'X-Timestamp': timestamp,
                    'X-Signature': signature
                },
                timeout: 15000
            });
            result = response.data;
        } catch (err) {
            const errMsg = err?.response?.data?.message || err.message;
            logger.add('ERROR', `AustinPay check gagal: ${errMsg}`);
            throw new Error(errMsg);
        }

        if (!result || !result.success) {
            throw new Error(result?.message || 'Gagal mengecek deposit.');
        }

        const rawStatus = String(result.status || '').toUpperCase();

        // Normalisasi status AustinPay → internal
        let status = 'PENDING';
        if (['PAID', 'SUCCESS', 'SETTLED', 'BERHASIL', 'COMPLETED'].includes(rawStatus)) status = 'PAID';
        else if (['CANCELLED', 'CANCELED', 'BATAL', 'EXPIRED'].includes(rawStatus)) status = 'CANCELLED';
        else if (['PENDING', 'WAITING', 'UNPAID'].includes(rawStatus)) status = 'PENDING';

        const inv = await Invoice.findOne({ invoiceId });
        if (inv) {
            inv.status = status;
            if (status === 'PAID' && !inv.paidAt) inv.paidAt = new Date();
            await inv.save();
        }

        if (status === 'PAID' && inv) {
            if (inv.planType === 'api') {
                await this.activateApiPlan(inv.userId, inv.planId, inv.invoiceId, inv.planName, inv.days);
            } else {
                await this.activatePremium(inv.userId, inv.days, inv.invoiceId, inv.planName);
            }
        }

        return {
            status,
            isPaid: status === 'PAID',
            isCancelled: status === 'CANCELLED',
            isExpired: rawStatus === 'EXPIRED',
            data: result, // bukan result.deposit
            invoice: inv ? inv.toObject() : null
        };
    }

    /**
     * Cancel deposit
     * POST /api/deposit/cancel/:id
     * Response: { success: true, status: "cancel", message: "..." }
     */
    async cancelInvoice(invoiceId) {
        const path = `/api/deposit/cancel/${invoiceId}`;
        const { timestamp, signature } = signRequest('POST', path, '', this.apiSecret);

        try {
            await axios.post(`${this.baseUrl}${path}`, {}, {
                headers: {
                    'X-API-Key': this.apiKey,
                    'X-Timestamp': timestamp,
                    'X-Signature': signature
                },
                timeout: 15000
            });
        } catch (e) {
            const errMsg = e?.response?.data?.message || e.message;
            logger.add('WARN', `Cancel invoice ${invoiceId} warning: ${errMsg}`);
        }

        await Invoice.updateOne({ invoiceId }, { $set: { status: 'CANCELLED', cancelledAt: new Date() } });
        return true;
    }

    async activatePremium(userId, days, invoiceId = '', planName = '') {
        let user = await User.findOne({ userId });
        if (!user && typeof global.checkUser === 'function') {
            user = await global.checkUser(userId);
        }
        if (!user) return false;

        const now = Date.now();
        let newUntil = null;

        if (Number(days) >= 3650) {
            newUntil = null; // Lifetime
        } else {
            const currentUntil = (user.premium && user.premiumUntil && user.premiumUntil > now)
                ? user.premiumUntil
                : now;
            newUntil = currentUntil + (days * 86400 * 1000);
        }

        await User.updateOne({ userId }, {
            $set: {
                premium: true,
                premiumUntil: newUntil,
                limit: 999999,
                lastInteraction: now
            }
        });

        if (global.userCache) global.userCache.delete(userId);

        let invDoc = null;
        if (invoiceId) {
            await Invoice.updateOne({ invoiceId }, { $set: { status: 'PAID', paidAt: new Date() } });
            invDoc = await Invoice.findOne({ invoiceId }).lean();
        }

        const isPurchase = invDoc && !invoiceId.startsWith('MANUAL-') && !invoiceId.startsWith('REDEEM-');
        const priceNominal = invDoc ? (invDoc.payAmount || invDoc.amount) : 0;
        const priceStr = priceNominal ? `Rp ${Number(priceNominal).toLocaleString('id-ID')}` : '-';

        logger.add('PREMIUM', `[${isPurchase ? 'PEMBELIAN QRIS' : 'UPGRADE'}] User ${userId} (${user.username ? '@' + user.username : user.firstName}) berhasil di-upgrade ke PREMIUM (${planName || days + ' Hari'}${priceNominal ? ` - ${priceStr}` : ''})`);

        const formatWaktu = typeof global.formatWaktuGaul === 'function'
            ? global.formatWaktuGaul
            : (d) => new Date(d).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });

        const expiredStr = newUntil ? formatWaktu(new Date(newUntil)) : 'SELAMANYA (LIFETIME)';

        if (global.bot && global.bot.telegram) {
            const successText = `<b>${EMOJIS.CHECK} PEMBAYARAN BERHASIL & DIKONFIRMASI!</b>

<blockquote>${EMOJIS.PREMIUM} Akun Anda telah resmi aktif sebagai <b>PREMIUM</b>!
${EMOJIS.STAR} Paket: <b>${planName || (days >= 3650 ? 'Permanen' : days + ' Hari')}</b>
${priceNominal ? `${EMOJIS.KEY} Total Pembayaran: <b>${priceStr}</b>\n` : ''}${EMOJIS.CALENDAR} Masa Aktif: <b>${expiredStr}</b></blockquote>

<blockquote expandable><b>Keuntungan Akun Premium Anda:</b>
• ${EMOJIS.CHECK} <b>Unlimited Kuota Limit</b>
• ${EMOJIS.CHECK} <b>Bisa Cek Massal</b> (10 nomor detect, 5 limitin)
• ${EMOJIS.CHECK} <b>Slot Sender WA</b> hingga 5 sesi
• ${EMOJIS.CHECK} <b>Akses Server Prioritas</b></blockquote>`.trim();

            global.bot.telegram.sendMessage(userId, successText, {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: 'MENU UTAMA', callback_data: 'back_home', icon_custom_emoji_id: EMOJI_IDS.BOT }]
                    ]
                }
            }).catch(() => {});

            if (typeof global.sendChannelReport === 'function') {
                global.sendChannelReport({
                    type: 'PREMIUM',
                    user: { id: userId, username: user.username, firstName: user.firstName },
                    count: days,
                    meta: {
                        planName: planName || (days >= 3650 ? 'Permanen' : `${days} Hari`),
                        invoiceId,
                        price: priceNominal,
                        uniqueCode: invDoc?.uniqueCode,
                        expiredStr: expiredStr,
                        method: isPurchase ? 'AustinPay (QRIS Otomatis)' : 'Admin / Sistem'
                    }
                }).catch(() => {});
            }
        }

        return true;
    }

    async activateApiPlan(userId, planId, invoiceId = '', planName = '', days = 30) {
        let user = await User.findOne({ userId });
        if (!user && typeof global.checkUser === 'function') {
            user = await global.checkUser(userId);
        }
        if (!user) return false;

        const now = Date.now();
        const newExpiry = now + (Number(days) * 86400 * 1000);

        await User.updateOne({ userId }, {
            $set: {
                apiPlanId: planId,
                apiPlanExpiry: newExpiry,
                apiUsage: null,
                apiExpiryNotifiedAt: null,
                lastInteraction: now
            }
        });

        if (global.userCache) global.userCache.delete(userId);

        if (invoiceId) {
            await Invoice.updateOne({ invoiceId }, { $set: { status: 'PAID', paidAt: new Date() } });
        }

        const formatWaktu = typeof global.formatWaktuGaul === 'function'
            ? global.formatWaktuGaul
            : (d) => new Date(d).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
        const expiredStr = formatWaktu(new Date(newExpiry));

        logger.add('PAYMENT', `[API PLAN] User ${userId} (${user.username ? '@' + user.username : user.firstName}) aktif paket API "${planName}" s/d ${expiredStr}`);

        if (global.bot && global.bot.telegram) {
            const successText = `<b>${EMOJIS.CHECK} PEMBAYARAN BERHASIL & API AKTIF!</b>

<blockquote>${EMOJIS.KEY} Paket API: <b>${planName}</b>
${EMOJIS.CALENDAR} Aktif s/d: <b>${expiredStr}</b></blockquote>

Sekarang kamu bisa generate API Key lewat menu <b>AMBIL APIKEY</b>.`.trim();

            global.bot.telegram.sendMessage(userId, successText, {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [[{ text: 'AMBIL API KEY', callback_data: 'menu_ambilapikey', icon_custom_emoji_id: EMOJI_IDS.KEY }]]
                }
            }).catch(() => {});

            if (typeof global.sendChannelReport === 'function') {
                global.sendChannelReport({
                    type: 'API_PLAN',
                    user: { id: userId, username: user.username, firstName: user.firstName },
                    count: days,
                    meta: {
                        planName,
                        invoiceId,
                        expiredStr,
                        method: 'AustinPay (QRIS Otomatis)'
                    }
                }).catch(() => {});
            }
        }

        return true;
    }

    startPoller() {
        if (this.pollTimer) return;
        logger.add('PAYMENT', 'Payment Poller aktif (setiap 15 detik).');

        this.pollTimer = setInterval(async () => {
            if (this.isPolling) return;
            this.isPolling = true;

            try {
                const twentyMinAgo = new Date(Date.now() - 20 * 60 * 1000);
                const pendingInvoices = await Invoice.find({
                    status: 'PENDING',
                    createdAt: { $gte: twentyMinAgo }
                }).limit(10).lean();

                for (const inv of pendingInvoices) {
                    try {
                        const check = await this.checkInvoiceStatus(inv.invoiceId);
                        if (check.isPaid) {
                            logger.add('PAYMENT', `Invoice ${inv.invoiceId} terdeteksi PAID via auto-poller!`);
                        }
                    } catch (err) {
                        // ignore single check error
                    }
                    await new Promise(r => setTimeout(r, 1000));
                }
            } catch (err) {
                logger.add('ERROR', `Payment Poller Error: ${err.message}`);
            } finally {
                this.isPolling = false;
            }
        }, 15000);
    }
}

const paymentManager = new PaymentManager();
module.exports = paymentManager;
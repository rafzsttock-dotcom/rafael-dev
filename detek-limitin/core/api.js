const crypto = require('crypto');
const config = require('../config');
const { User, Setting } = require('../database');
const WaManager = require('../core/wa');
const logger = require('../core/logger');

// ─── Rate limit ────────────────────────────────────────────────────────────────
// Map<userId, number[]> — timestamps of recent requests
const apiRateLimit = new Map();
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60_000;

// Cleanup stale entries every 5 minutes to avoid memory leak
setInterval(() => {
    const now = Date.now();
    for (const [uid, timestamps] of apiRateLimit.entries()) {
        const fresh = timestamps.filter(ts => now - ts < RATE_LIMIT_WINDOW_MS);
        if (fresh.length === 0) {
            apiRateLimit.delete(uid);
        } else {
            apiRateLimit.set(uid, fresh);
        }
    }
}, 5 * 60_000);

function consumeRateLimit(userId) {
    const now = Date.now();
    const window = (apiRateLimit.get(userId) || []).filter(ts => now - ts < RATE_LIMIT_WINDOW_MS);
    if (window.length >= RATE_LIMIT_MAX) return false;
    window.push(now);
    apiRateLimit.set(userId, window);
    return true;
}

function getRateLimitRemaining(userId) {
    const now = Date.now();
    const window = (apiRateLimit.get(userId) || []).filter(ts => now - ts < RATE_LIMIT_WINDOW_MS);
    return Math.max(0, RATE_LIMIT_MAX - window.length);
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
function generateApiKey() {
    return 'dl_' + crypto.randomBytes(24).toString('hex');
}

function isPremiumActive(user) {
    if (!user || !user.premium) return false;
    if (!user.premiumUntil) return true; // lifetime
    return user.premiumUntil > Date.now();
}

// ─── API Plan helpers ──────────────────────────────────────────────────────────
let _apiPlansCache = null;
let _apiPlansCacheAt = 0;
const API_PLANS_CACHE_TTL = 60_000; // 1 minute

async function getApiPlans() {
    if (_apiPlansCache && Date.now() - _apiPlansCacheAt < API_PLANS_CACHE_TTL) {
        return _apiPlansCache;
    }
    try {
        const setting = await Setting.findOne({ key: 'api_plans' });
        if (setting && Array.isArray(setting.value) && setting.value.length > 0) {
            _apiPlansCache = setting.value;
            _apiPlansCacheAt = Date.now();
            return _apiPlansCache;
        }
    } catch (_) { /* fall through */ }
    _apiPlansCache = config.apiPlans || [];
    _apiPlansCacheAt = Date.now();
    return _apiPlansCache;
}

function invalidateApiPlansCache() {
    _apiPlansCache = null;
    _apiPlansCacheAt = 0;
}

function isApiPlanActive(user) {
    if (!user || !user.apiPlanId) return false;
    if (!user.apiPlanExpiry) return false;
    return user.apiPlanExpiry > Date.now();
}

async function getActivePlanConfig(user) {
    const plans = await getApiPlans();
    if (!user.apiPlanId) return null;
    return plans.find(p => p.id === user.apiPlanId) || null;
}

function getQuotaResetMs(quotaPeriod) {
    const now = new Date();
    if (quotaPeriod === 'daily') {
        const next = new Date(now);
        next.setHours(0, 0, 0, 0);
        next.setDate(next.getDate() + 1);
        return next.getTime();
    }
    if (quotaPeriod === 'monthly') {
        const next = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
        return next.getTime();
    }
    // 'lifetime' — never reset (use plan expiry)
    return null;
}

async function checkAndIncrementQuota(user, type, count = 1) {
    // Returns { allowed: bool, remaining: number|null, used: number, max: number|null }
    const isOwner = String(user.userId) === String(config.ownerId);
    if (isOwner) return { allowed: true, remaining: null, used: 0, max: null };

    const plan = await getActivePlanConfig(user);
    if (!plan) {
        // No API plan — if premium active, allow unlimited
        if (isPremiumActive(user)) return { allowed: true, remaining: null, used: 0, max: null };
        return { allowed: false, remaining: 0, used: 0, max: 0 };
    }

    const maxKey = type === 'cekBio' ? 'maxCekBio' : type === 'detect' ? 'maxDetect' : 'maxLimitin';
    const planMax = plan[maxKey] ?? -1;
    if (planMax === -1) return { allowed: true, remaining: null, used: 0, max: null }; // unlimited

    // User boleh set limit custom (lebih rendah dari plan max)
    let customLimits = user.apiCustomLimits || {};
    if (typeof customLimits === 'string') { try { customLimits = JSON.parse(customLimits); } catch (_) { customLimits = {}; } }
    const customMax = customLimits[type];
    const max = (typeof customMax === 'number' && customMax >= 0 && customMax < planMax) ? customMax : planMax;

    // Load / initialise usage
    let usage = user.apiUsage || {};
    if (typeof usage === 'string') {
        try { usage = JSON.parse(usage); } catch (_) { usage = {}; }
    }

    const now = Date.now();
    const initialized = usage.cekBio !== undefined || usage.detect !== undefined || usage.limitin !== undefined;

    if (plan.quotaPeriod === 'lifetime') {
        // Quota jalan terus sampai plan expired — hanya init sekali di awal
        if (!initialized) {
            usage = { cekBio: 0, detect: 0, limitin: 0, resetAt: null };
        }
    } else {
        // daily / monthly — reset kalau sudah lewat waktu reset
        const resetAt = usage.resetAt || 0;
        const shouldReset = resetAt && now >= resetAt;
        if (!initialized || shouldReset) {
            const nextReset = getQuotaResetMs(plan.quotaPeriod);
            usage = { cekBio: 0, detect: 0, limitin: 0, resetAt: nextReset };
        }
    }

    const used = Number(usage[type] || 0);
    if (used + count > max) {
        return { allowed: false, remaining: Math.max(0, max - used), used, max };
    }

    // Commit increment
    usage[type] = used + count;
    user.apiUsage = usage;
    await user.save();

    return { allowed: true, remaining: max - usage[type], used: usage[type], max };
}

async function getUserByApiKey(apiKey) {
    if (!apiKey || typeof apiKey !== 'string') return null;
    return User.findOne({ apiKey: apiKey.trim() }).lean();
}

function validatePhoneNumber(num) {
    const clean = String(num || '').replace(/\D/g, '');
    if (clean.length < 7 || clean.length > 15) return null;
    return clean;
}

// ─── Middleware ─────────────────────────────────────────────────────────────────
async function apiAuth(req, res, next) {
    const key = (
        req.headers['x-api-key'] ||
        req.query.api_key ||
        (req.body && req.body.api_key)
    );

    if (!key) {
        return res.status(401).json({
            success: false,
            error: 'API Key diperlukan.',
            hint: 'Kirim header X-API-Key atau query ?api_key=dl_xxx'
        });
    }

    let user;
    try {
        user = await getUserByApiKey(key);
    } catch (err) {
        logger.add('ERROR', `API Auth DB error: ${err.message}`);
        return res.status(500).json({ success: false, error: 'Auth error' });
    }

    if (!user) {
        return res.status(401).json({ success: false, error: 'API Key tidak valid.' });
    }

    const isOwner = String(user.userId) === String(config.ownerId);

    if (!isOwner && !isPremiumActive(user) && !isApiPlanActive(user)) {
        return res.status(403).json({
            success: false,
            error: 'Akses API tidak aktif. Beli paket API atau Premium lewat bot Telegram.',
            hint: 'Gunakan /start di bot untuk membeli paket.'
        });
    }

    if (!consumeRateLimit(user.userId)) {
        return res.status(429).json({
            success: false,
            error: `Rate limit: maks ${RATE_LIMIT_MAX} request per menit per API Key.`,
            retry_after: 60
        });
    }

    req.apiUser = user;
    req.apiIsOwner = isOwner;
    next();
}

// ─── Routes ───────────────────────────────────────────────────────────────────
function registerApiRoutes(app) {
    const path = require('path');

    // ── Docs HTML ────────────────────────────────────────────────────────────
    app.get('/docs', (req, res) => {
        res.sendFile(path.join(__dirname, '..', 'assets', 'api-docs.html'));
    });
    app.get('/api/docs.html', (req, res) => {
        res.sendFile(path.join(__dirname, '..', 'assets', 'api-docs.html'));
    });

    // ── Docs JSON ────────────────────────────────────────────────────────────
    app.get('/api/docs', (req, res) => {
        res.json({
            name: 'DetekLimitin API',
            version: '1.1',
            bot_username: config.botUsername || '',
            bot_url: config.botUsername ? `https://t.me/${config.botUsername}` : '',
            auth: 'Header X-API-Key atau query ?api_key=dl_xxx',
            rate_limit: `${RATE_LIMIT_MAX} request per menit`,
            note: 'API Key hanya bisa didapat setelah beli Premium.',
            endpoints: [
                { method: 'GET',    path: '/api/docs',          auth: false, description: 'Dokumentasi ini' },
                { method: 'POST',   path: '/api/generate-key',  auth: false, description: 'Generate API Key (wajib Premium)' },
                { method: 'DELETE', path: '/api/revoke-key',    auth: true,  description: 'Revoke API Key aktif' },
                { method: 'GET',    path: '/api/me',            auth: true,  description: 'Info akun & sisa limit' },
                { method: 'PATCH',  path: '/api/quota',         auth: true,  description: 'Set/reset limit custom per fitur (cekBio/detect/limitin)' },
                { method: 'GET',    path: '/api/sessions',      auth: true,  description: 'Status sesi WhatsApp' },
                { method: 'POST',   path: '/api/cek-bio',       auth: true,  description: 'Cek bio massal (butuh sesi WA aktif)' },
                { method: 'POST',   path: '/api/detect',        auth: true,  description: 'Cek status OTP / cooldown nomor' },
                { method: 'POST',   path: '/api/limitin',       auth: true,  description: 'Kirim OTP berulang ke nomor (limitin)' },
            ]
        });
    });

    // ── Generate API Key ──────────────────────────────────────────────────────
    app.post('/api/generate-key', async (req, res) => {
        try {
            const telegramId = Number(req.body && req.body.telegram_id);
            if (!telegramId || isNaN(telegramId)) {
                return res.status(400).json({ success: false, error: 'telegram_id (number) diperlukan.' });
            }

            const user = await User.findOne({ userId: telegramId });
            if (!user) {
                return res.status(404).json({
                    success: false,
                    error: 'User tidak ditemukan. Buka bot Telegram dulu dengan /start.'
                });
            }

            const isOwner = String(telegramId) === String(config.ownerId);
            if (!isOwner && !isPremiumActive(user)) {
                return res.status(403).json({
                    success: false,
                    error: 'Hanya user Premium yang bisa generate API Key.',
                    hint: 'Beli premium lewat bot Telegram.'
                });
            }

            const alreadyHasKey = Boolean(user.apiKey);
            const newKey = generateApiKey();
            user.apiKey = newKey;
            user.apiKeyCreatedAt = Date.now();
            await user.save();

            logger.add('API', `API Key ${alreadyHasKey ? 'di-regenerate' : 'dibuat'} untuk user ${telegramId}`);

            res.json({
                success: true,
                api_key: newKey,
                regenerated: alreadyHasKey,
                message: 'Simpan API Key ini — hanya ditampilkan sekali. Jangan bagikan ke siapapun.'
            });
        } catch (err) {
            logger.add('ERROR', `Generate API Key error: ${err.message}`);
            res.status(500).json({ success: false, error: 'Server error.' });
        }
    });

    // ── Revoke API Key ────────────────────────────────────────────────────────
    app.delete('/api/revoke-key', apiAuth, async (req, res) => {
        try {
            await User.updateOne(
                { userId: req.apiUser.userId },
                { $set: { apiKey: '', apiKeyCreatedAt: null } }
            );
            logger.add('API', `API Key di-revoke oleh user ${req.apiUser.userId}`);
            res.json({ success: true, message: 'API Key berhasil di-revoke.' });
        } catch (err) {
            logger.add('ERROR', `Revoke API Key error: ${err.message}`);
            res.status(500).json({ success: false, error: 'Server error.' });
        }
    });

    // ── Me ────────────────────────────────────────────────────────────────────
    app.get('/api/me', apiAuth, async (req, res) => {
        try {
            const u = req.apiUser;
            const premiumExp = u.premiumUntil
                ? new Date(u.premiumUntil).toISOString()
                : (u.premium ? 'lifetime' : null);

            const apiPlanActive = isApiPlanActive(u);
            const plan = apiPlanActive ? await getActivePlanConfig(u) : null;

            let usage = u.apiUsage || {};
            if (typeof usage === 'string') {
                try { usage = JSON.parse(usage); } catch (_) { usage = {}; }
            }

            let customLimits = u.apiCustomLimits || {};
            if (typeof customLimits === 'string') { try { customLimits = JSON.parse(customLimits); } catch (_) { customLimits = {}; } }

            const effectiveMax = (planMax, type) => {
                if (planMax === -1) return null;
                const c = customLimits[type];
                return (typeof c === 'number' && c >= 0 && c < planMax) ? c : planMax;
            };

            const quota = plan ? {
                planId: plan.id,
                planName: plan.name,
                expiresAt: u.apiPlanExpiry ? new Date(u.apiPlanExpiry).toISOString() : null,
                quotaPeriod: plan.quotaPeriod,
                resetAt: usage.resetAt ? new Date(usage.resetAt).toISOString() : null,
                cekBio: { used: Number(usage.cekBio || 0), max: effectiveMax(plan.maxCekBio, 'cekBio'), planMax: plan.maxCekBio === -1 ? null : plan.maxCekBio, custom: customLimits.cekBio ?? null },
                detect: { used: Number(usage.detect || 0), max: effectiveMax(plan.maxDetect, 'detect'), planMax: plan.maxDetect === -1 ? null : plan.maxDetect, custom: customLimits.detect ?? null },
                limitin: { used: Number(usage.limitin || 0), max: effectiveMax(plan.maxLimitin, 'limitin'), planMax: plan.maxLimitin === -1 ? null : plan.maxLimitin, custom: customLimits.limitin ?? null }
            } : null;

            res.json({
                success: true,
                userId: u.userId,
                username: u.username || null,
                premium: isPremiumActive(u),
                premiumUntil: premiumExp,
                apiPlan: apiPlanActive ? { id: u.apiPlanId, expiresAt: u.apiPlanExpiry ? new Date(u.apiPlanExpiry).toISOString() : null } : null,
                limit: u.limit,
                apiKeyCreatedAt: u.apiKeyCreatedAt
                    ? new Date(u.apiKeyCreatedAt).toISOString()
                    : null,
                quota,
                rateLimit: {
                    remaining: getRateLimitRemaining(u.userId),
                    max: RATE_LIMIT_MAX,
                    window: '60s'
                }
            });
        } catch (err) {
            logger.add('ERROR', `API me: ${err.message}`);
            res.status(500).json({ success: false, error: 'Server error.' });
        }
    });

    // ── Custom Quota ──────────────────────────────────────────────────────────
    app.patch('/api/quota', apiAuth, async (req, res) => {
        try {
            const u = req.apiUser;
            if (!isApiPlanActive(u) && !req.apiIsOwner) {
                return res.status(403).json({ success: false, error: 'Tidak ada plan API aktif.' });
            }

            const plan = await getActivePlanConfig(u);
            const { cekBio, detect, limitin } = req.body || {};

            let customLimits = u.apiCustomLimits || {};
            if (typeof customLimits === 'string') { try { customLimits = JSON.parse(customLimits); } catch (_) { customLimits = {}; } }

            const validate = (val, planMax, field) => {
                if (val === null || val === undefined) return { ok: true, v: undefined }; // skip
                if (val === 'default' || val === -1) return { ok: true, v: null }; // reset ke default
                const n = Number(val);
                if (isNaN(n) || n < 0 || !Number.isInteger(n)) return { ok: false, msg: `${field} harus integer >= 0 atau "default"` };
                if (planMax !== -1 && n > planMax) return { ok: false, msg: `${field} tidak boleh melebihi plan max (${planMax})` };
                return { ok: true, v: n };
            };

            const planMax = plan ? { cekBio: plan.maxCekBio, detect: plan.maxDetect, limitin: plan.maxLimitin } : { cekBio: -1, detect: -1, limitin: -1 };
            const checks = [
                { key: 'cekBio', val: cekBio, planMax: planMax.cekBio },
                { key: 'detect', val: detect, planMax: planMax.detect },
                { key: 'limitin', val: limitin, planMax: planMax.limitin }
            ];

            for (const { key, val, planMax: pm } of checks) {
                if (val === undefined) continue;
                const r = validate(val, pm, key);
                if (!r.ok) return res.status(400).json({ success: false, error: r.msg });
                if (r.v === null) delete customLimits[key]; // reset ke default
                else customLimits[key] = r.v;
            }

            await User.updateOne({ userId: u.userId }, { $set: { apiCustomLimits: customLimits } });

            res.json({
                success: true,
                message: 'Custom limit berhasil diupdate.',
                customLimits: {
                    cekBio: customLimits.cekBio ?? null,
                    detect: customLimits.detect ?? null,
                    limitin: customLimits.limitin ?? null
                }
            });
        } catch (err) {
            logger.add('ERROR', `PATCH /api/quota: ${err.message}`);
            res.status(500).json({ success: false, error: 'Server error.' });
        }
    });

    // ── Sessions ──────────────────────────────────────────────────────────────
    app.get('/api/sessions', apiAuth, (req, res) => {
        const userId = req.apiUser.userId;
        const status = WaManager.getSessionStatus(userId);
        const isReady = WaManager.isSessionReady(userId);
        const activeSessions = typeof WaManager.getActiveSessions === 'function'
            ? WaManager.getActiveSessions(userId)
            : [];

        res.json({
            success: true,
            status,
            ready: isReady,
            sessions: activeSessions.map(s => ({
                sessionId: s.sessionId,
                phone: s.phoneNumber || null
            })),
            hint: isReady
                ? 'Sesi aktif. Siap untuk Cek Bio.'
                : 'Belum ada sesi WA. Connect lewat bot Telegram dulu.'
        });
    });

    // ── Cek Bio ───────────────────────────────────────────────────────────────
    app.post('/api/cek-bio', apiAuth, async (req, res) => {
        try {
            const { numbers, mode = 'simple', speed = 'normal' } = req.body || {};

            if (!Array.isArray(numbers) || numbers.length === 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Field "numbers" harus array dan tidak boleh kosong.'
                });
            }
            if (numbers.length > 50) {
                return res.status(400).json({
                    success: false,
                    error: 'Maksimum 50 nomor per request.'
                });
            }

            const cleanNumbers = numbers
                .map(n => validatePhoneNumber(n))
                .filter(Boolean);

            if (cleanNumbers.length === 0) {
                return res.status(400).json({ success: false, error: 'Tidak ada nomor valid dalam array.' });
            }

            if (!WaManager.isSessionReady(req.apiUser.userId)) {
                return res.status(503).json({
                    success: false,
                    error: 'Sesi WhatsApp belum aktif.',
                    hint: 'Connect WhatsApp dulu lewat bot Telegram, lalu coba lagi.'
                });
            }

            // Quota check — per nomor (bukan per request)
            const quotaCheck = await checkAndIncrementQuota(req.apiUser, 'cekBio', cleanNumbers.length);
            if (!quotaCheck.allowed) {
                return res.status(429).json({
                    success: false,
                    error: `Kuota Cek Bio habis. Tersisa: ${quotaCheck.remaining} nomor dari ${quotaCheck.max}`,
                    quota: { used: quotaCheck.used, max: quotaCheck.max, remaining: quotaCheck.remaining }
                });
            }

            // speedMode: 'brutal' = detail mode, 'normal' = simple
            const speedMode = (mode === 'detail' || speed === 'brutal') ? 'brutal' : 'normal';

            // Timeout 120 detik untuk 50 nomor
            const TIMEOUT_MS = 120_000;
            const result = await Promise.race([
                WaManager.checkBio(req.apiUser.userId, cleanNumbers, speedMode, null, false),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS)
                )
            ]);

            const summary = {
                total: cleanNumbers.length,
                registered: (result.business || []).length + (result.private || []).length + (result.repe || []).length,
                unregistered: (result.invalid || []).length,
                business: (result.business || []).length,
                private: (result.private || []).length,
                repe: (result.repe || []).length,
                cancelled: result.isCancelled || false,
                interrupted: result.senderLoggedOut || false
            };

            const formatEntry = (entry) => ({
                number: entry.number,
                registered: true,
                type: entry.isBusiness ? 'business' : (entry.isRepe ? 'repe' : 'private'),
                name: entry.name || null,
                bio: entry.bio || null,
                hasBio: Boolean(entry.hasBio),
                profilePic: entry.hasPP || false,
                isVerified: entry.isVerified || false,
            });

            res.json({
                success: true,
                mode,
                summary,
                results: {
                    business: (result.business || []).map(formatEntry),
                    private: (result.private || []).map(formatEntry),
                    repe: (result.repe || []).map(formatEntry),
                    unregistered: (result.invalid || []).map(n => ({
                        number: typeof n === 'string' ? n : n.number,
                        registered: false
                    }))
                }
            });
        } catch (err) {
            if (err.message === 'timeout') {
                return res.status(504).json({
                    success: false,
                    error: 'Timeout: Cek Bio membutuhkan waktu terlalu lama. Kurangi jumlah nomor.'
                });
            }
            logger.add('ERROR', `API cek-bio: ${err.message}`);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // ── Detect ────────────────────────────────────────────────────────────────
    app.post('/api/detect', apiAuth, async (req, res) => {
        try {
            const { number } = req.body || {};

            if (!number) {
                return res.status(400).json({
                    success: false,
                    error: 'Field "number" diperlukan.'
                });
            }

            const cleanNum = validatePhoneNumber(number);
            if (!cleanNum) {
                return res.status(400).json({
                    success: false,
                    error: 'Nomor tidak valid. Gunakan format internasional, contoh: 6281234567890'
                });
            }

            const quotaCheck = await checkAndIncrementQuota(req.apiUser, 'detect', 1);
            if (!quotaCheck.allowed) {
                return res.status(429).json({
                    success: false,
                    error: `Kuota Detect habis (${quotaCheck.used}/${quotaCheck.max} nomor terpakai).`,
                    quota: { used: quotaCheck.used, max: quotaCheck.max, remaining: quotaCheck.remaining }
                });
            }

            const result = await WaManager.detectRealtimeStatus(cleanNum);

            res.json({
                success: true,
                number: cleanNum,
                status: result.status,
                formatted: result.formatted,
                sms: result.sms,
                wa_old: result.wa_old,
                isWaOldAvailable: result.isWaOldAvailable
            });
        } catch (err) {
            logger.add('ERROR', `API detect: ${err.message}`);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // ── Limitin ───────────────────────────────────────────────────────────────
    app.post('/api/limitin', apiAuth, async (req, res) => {
        try {
            const { number, method = 'sms', max_attempts = 5 } = req.body || {};

            if (!number) {
                return res.status(400).json({ success: false, error: 'Field "number" diperlukan.' });
            }

            const cleanNum = validatePhoneNumber(number);
            if (!cleanNum) {
                return res.status(400).json({
                    success: false,
                    error: 'Nomor tidak valid. Gunakan format internasional, contoh: 6281234567890'
                });
            }

            const quotaCheckLimitin = await checkAndIncrementQuota(req.apiUser, 'limitin', 1);
            if (!quotaCheckLimitin.allowed) {
                return res.status(429).json({
                    success: false,
                    error: `Kuota Limitin habis (${quotaCheckLimitin.used}/${quotaCheckLimitin.max} terpakai).`,
                    quota: { used: quotaCheckLimitin.used, max: quotaCheckLimitin.max, remaining: quotaCheckLimitin.remaining }
                });
            }

            const VALID_METHODS = ['sms', 'voice', 'wa_old', 'flash'];
            if (!VALID_METHODS.includes(method)) {
                return res.status(400).json({
                    success: false,
                    error: `Method tidak valid. Pilih: ${VALID_METHODS.join(', ')}`
                });
            }

            const maxAttempts = Math.min(Math.max(Number(max_attempts) || 5, 1), 10);

            // Timeout: 5 menit (worst case 10 attempts × ~30s cooldown)
            const TIMEOUT_MS = 300_000;
            const abortController = new AbortController();
            const timeoutId = setTimeout(() => abortController.abort(), TIMEOUT_MS);

            let results;
            try {
                results = await WaManager.sendOtpWithRetry(
                    req.apiUser.userId,
                    cleanNum,
                    method,
                    maxAttempts,
                    null,
                    abortController.signal
                );
            } finally {
                clearTimeout(timeoutId);
            }

            const lastResult = results[results.length - 1] || {};
            const sentCount = results.filter(r => r.sent).length;
            const finalStatus = lastResult.sent ? 'sent'
                : (lastResult.banned || lastResult.blocked) ? 'blocked'
                : lastResult.disabled ? 'disabled'
                : lastResult.status === 'aborted' ? 'timeout'
                : 'cooldown';

            res.json({
                success: true,
                number: cleanNum,
                method,
                status: finalStatus,
                sent_count: sentCount,
                total_attempts: results.length,
                results
            });
        } catch (err) {
            logger.add('ERROR', `API limitin: ${err.message}`);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    logger.add('SYSTEM', 'API routes registered: /api/docs, /api/generate-key, /api/revoke-key, /api/me, /api/sessions, /api/cek-bio, /api/detect, /api/limitin');
}

module.exports = { registerApiRoutes, getApiPlans, invalidateApiPlansCache };

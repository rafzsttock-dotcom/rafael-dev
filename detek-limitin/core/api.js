const crypto = require('crypto');
const config = require('../config');
const { User } = require('../database');
const WaManager = require('../core/wa');
const logger = require('../core/logger');

// In-memory rate limit for API
const apiRateLimit = new Map();

function generateApiKey() {
    return 'dl_' + crypto.randomBytes(24).toString('hex');
}

async function getUserByApiKey(apiKey) {
    if (!apiKey) return null;
    const user = await User.findOne({ apiKey }).lean();
    return user;
}

function rateLimit(userId, maxPerMinute = 30) {
    const now = Date.now();
    const window = apiRateLimit.get(userId) || [];
    const recent = window.filter(ts => now - ts < 60000);
    if (recent.length >= maxPerMinute) return false;
    recent.push(now);
    apiRateLimit.set(userId, recent);
    return true;
}

function apiAuth(req, res, next) {
    const key = req.headers['x-api-key'] || req.query.api_key || req.body.api_key;
    if (!key) {
        return res.status(401).json({ success: false, error: 'API Key required. Get it by purchasing premium.' });
    }
    getUserByApiKey(key).then(user => {
        if (!user) {
            return res.status(401).json({ success: false, error: 'Invalid API Key' });
        }
        if (!user.premium) {
            return res.status(403).json({ success: false, error: 'API Key requires active Premium. Buy premium first.' });
        }
        if (!rateLimit(user.userId)) {
            return res.status(429).json({ success: false, error: 'Rate limit exceeded (30 req/min)' });
        }
        req.apiUser = user;
        next();
    }).catch(err => {
        logger.add('ERROR', `API Auth error: ${err.message}`);
        res.status(500).json({ success: false, error: 'Auth error' });
    });
}

function registerApiRoutes(app) {
    const path = require('path');

    // Serve beautiful HTML docs
    app.get('/docs', (req, res) => {
        res.sendFile(path.join(__dirname, '..', 'assets', 'api-docs.html'));
    });
    app.get('/api/docs.html', (req, res) => {
        res.sendFile(path.join(__dirname, '..', 'assets', 'api-docs.html'));
    });

    // Documentation JSON
    app.get('/api/docs', (req, res) => {
        res.json({
            name: 'DetekLimitin API',
            version: '1.0',
            base_url: `http://localhost:${process.env.PORT || 5055}/api`,
            auth: 'Header: X-API-Key or query/body api_key',
            note: 'API Key hanya bisa didapat setelah beli Premium.',
            endpoints: [
                {
                    method: 'GET',
                    path: '/api/docs',
                    description: 'Dokumentasi ini'
                },
                {
                    method: 'POST',
                    path: '/api/generate-key',
                    description: 'Generate API Key (harus login sebagai owner atau user premium via telegram id)',
                    body: { telegram_id: 'number (wajib premium)' }
                },
                {
                    method: 'POST',
                    path: '/api/cek-bio',
                    description: 'Cek bio massal',
                    auth: true,
                    body: { numbers: ['628xxx', '628yyy'], mode: 'simple|detail' }
                },
                {
                    method: 'POST',
                    path: '/api/detect',
                    description: 'Detect status / OTP endpoint',
                    auth: true,
                    body: { number: '628xxx', method: 'sms|voice|wa' }
                },
                {
                    method: 'GET',
                    path: '/api/me',
                    description: 'Info user dari API Key',
                    auth: true
                }
            ]
        });
    });

    // Generate API Key (for premium users)
    app.post('/api/generate-key', async (req, res) => {
        try {
            const { telegram_id } = req.body;
            if (!telegram_id) {
                return res.status(400).json({ success: false, error: 'telegram_id required' });
            }
            const user = await User.findOne({ userId: Number(telegram_id) });
            if (!user) {
                return res.status(404).json({ success: false, error: 'User not found. Start the bot first.' });
            }
            if (!user.premium && Number(telegram_id) !== Number(config.ownerId)) {
                return res.status(403).json({ success: false, error: 'Must have Premium to generate API Key. Buy premium first.' });
            }
            const newKey = generateApiKey();
            user.apiKey = newKey;
            await user.save();
            logger.add('API', `API Key generated for user ${telegram_id}`);
            res.json({ success: true, api_key: newKey, message: 'Simpan API Key ini. Hanya ditampilkan sekali.' });
        } catch (err) {
            logger.add('ERROR', `Generate key error: ${err.message}`);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // Me
    app.get('/api/me', apiAuth, (req, res) => {
        const u = req.apiUser;
        res.json({
            success: true,
            userId: u.userId,
            username: u.username,
            premium: u.premium,
            premiumUntil: u.premiumUntil,
            limit: u.limit
        });
    });

    // Cek Bio
    app.post('/api/cek-bio', apiAuth, async (req, res) => {
        try {
            const { numbers, mode = 'simple' } = req.body;
            if (!Array.isArray(numbers) || numbers.length === 0) {
                return res.status(400).json({ success: false, error: 'numbers array required' });
            }
            if (numbers.length > 50) {
                return res.status(400).json({ success: false, error: 'Max 50 numbers per request' });
            }
            // Note: This is a simplified call. Full implementation needs active WA session.
            // For now return placeholder if no session, or call the real function.
            const results = await WaManager.executeCheckBio(req.apiUser.userId, numbers, mode === 'detail' ? 'brutal' : 'normal', null, false).catch(() => null);
            res.json({
                success: true,
                mode,
                count: numbers.length,
                results: results || { message: 'Cek Bio membutuhkan session WA aktif. Connect WA dulu lewat bot.' }
            });
        } catch (err) {
            logger.add('ERROR', `API cek-bio: ${err.message}`);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // Detect
    app.post('/api/detect', apiAuth, async (req, res) => {
        try {
            const { number, method = 'sms' } = req.body;
            if (!number) {
                return res.status(400).json({ success: false, error: 'number required' });
            }
            const result = await WaManager.cekOtpRealtimeDirect(null, number, method).catch(e => ({ error: e.message }));
            res.json({ success: true, number, method, result });
        } catch (err) {
            logger.add('ERROR', `API detect: ${err.message}`);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    logger.add('SYSTEM', 'API routes registered: /api/docs, /api/generate-key, /api/me, /api/cek-bio, /api/detect');
}

module.exports = { registerApiRoutes };

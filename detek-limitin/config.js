const path = require('path');

// Load .env jika ada (opsional, tidak wajib package dotenv)
try {
    require('dotenv').config({ path: path.join(__dirname, '.env') });
} catch (_) {
    // dotenv belum diinstall — tetap jalan pakai process.env / default
}

function env(key, fallback = '') {
    const v = process.env[key];
    return v === undefined || v === '' ? fallback : v;
}

function envInt(key, fallback) {
    const v = parseInt(env(key, ''), 10);
    return Number.isFinite(v) ? v : fallback;
}

function envBool(key, fallback = false) {
    const v = env(key, '').toLowerCase();
    if (v === '1' || v === 'true' || v === 'yes') return true;
    if (v === '0' || v === 'false' || v === 'no') return false;
    return fallback;
}

function envList(key) {
    return env(key, '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
}

const config = {
    // =========================
    // BOT CONFIG
    // =========================
    botToken: env('BOT_TOKEN', 'ISI_TOKEN_BOT_TELEGRAM'),
    botUsername: env('BOT_USERNAME', 'namabotmu'), // Tanpa "@"

    // =========================
    // OWNER
    // =========================
    ownerId: envInt('OWNER_ID', 123456789),
    ownerContact: {
        ownerName: env('OWNER_NAME', 'Owner'),
        telegram: env('OWNER_TELEGRAM', 'username_owner')
    },

    // =========================
    // FORCE SUBSCRIBE
    // Support Channel & Group
    // Username publik: "@channel"
    // Private: -100xxxxxxxxxx
    // Bisa juga diatur dari Owner Panel (/fsub)
    // =========================
    forceSub: envList('FORCE_SUB'),

    // =========================
    // LOGS CHANNEL & GROUP
    // =========================
    chLogs: env('CH_LOGS', '') || null,

    // =========================
    // DATABASE (Local JSON)
    // =========================
    databaseType: 'local_json',

    // =========================
    // ASSETS
    // =========================
    menuImage: path.join(__dirname, 'assets', 'menu.jpg'),

    // =========================
    // PROXY (opsional, untuk WA OTP endpoint)
    // =========================
    proxy: {
        enabled: envBool('PROXY_ENABLED', false),
        timeout: envInt('PROXY_TIMEOUT', 10000),
        urls: envList('PROXY_URLS')
    },

    // =========================
    // AUSTINPAY PAYMENT GATEWAY
    // Daftar: https://austinstore.id
    // =========================
    austinpay: {
        apiKey: env('AUSTINPAY_API_KEY', ''),
        apiSecret: env('AUSTINPAY_API_SECRET', ''),
        baseUrl: env('AUSTINPAY_BASE_URL', 'https://austinstore.id')
    },

    premiumPlans: [
        { id: 'plan_3d', name: 'Paket Hemat (3 Hari)', days: 3, price: 5000, desc: 'Akses Premium 3 Hari' },
        { id: 'plan_7d', name: 'Paket Mingguan (7 Hari)', days: 7, price: 10000, desc: 'Akses Premium 7 Hari' },
        { id: 'plan_30d', name: 'Paket Bulanan (30 Hari)', days: 30, price: 25000, desc: 'Akses Premium 30 Hari' },
        { id: 'plan_permanent', name: 'Paket Permanen (Lifetime)', days: 3650, price: 50000, desc: 'Akses Premium Selamanya' }
    ],

    apiPlans: [
        { id: 'api_ujicoba', name: 'Uji Coba (1 Hari)', days: 1, price: 10000, desc: 'Paket Uji Coba API',
          maxCekBio: 2000, maxDetect: 100, maxLimitin: 20, maxNumbers: 50, quotaPeriod: 'lifetime' },
        { id: 'api_tester', name: 'Tester (3 Hari)', days: 3, price: 25000, desc: 'Paket Tester API',
          maxCekBio: 3000, maxDetect: 150, maxLimitin: 30, maxNumbers: 50, quotaPeriod: 'lifetime' },
        { id: 'api_basic', name: 'Basic (1 Minggu)', days: 7, price: 55000, desc: 'Paket Basic API',
          maxCekBio: 10000, maxDetect: 500, maxLimitin: 100, maxNumbers: 50, quotaPeriod: 'lifetime' },
        { id: 'api_plush', name: 'Plush (1 Bulan)', days: 30, price: 155000, desc: 'Paket Plush API',
          maxCekBio: 50000, maxDetect: 10000, maxLimitin: 500, maxNumbers: 50, quotaPeriod: 'lifetime' },
        { id: 'api_pro', name: 'Pro (1 Bulan)', days: 30, price: 255000, desc: 'Paket Pro API',
          maxCekBio: -1, maxDetect: 50000, maxLimitin: 5000, maxNumbers: 50, quotaPeriod: 'daily' },
        { id: 'api_promax', name: 'ProMax (3 Bulan)', days: 90, price: 355000, desc: 'Paket ProMax API',
          maxCekBio: -1, maxDetect: -1, maxLimitin: -1, maxNumbers: 50, quotaPeriod: 'lifetime' }
    ]
};

module.exports = config;

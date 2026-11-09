const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const QRCode = require('qrcode');
let baileysPkg;
let loadedPkgName = '';
const possiblePkgs = [
    "@whiskeysockets/baileys",
    "@dannteam/baileys",
    "danznanobailyes",
    path.join(__dirname, '../node_modules/@danznanoofficial/danznanobailyes'),
    path.join(__dirname, '../node_modules/danznanobailyes'),
    "@danznano/danznanobailyes",
    "@danznano/baileys",
    "baileys-danznano"
];
for (const pkgName of possiblePkgs) {
    try {
        baileysPkg = require(pkgName);
        loadedPkgName = pkgName;
        break;
    } catch (e) {}
}
const makeWASocket = baileysPkg.default || baileysPkg;
const { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, delay } = baileysPkg;
let USyncQuery, USyncUser;
try {
    ({ USyncQuery, USyncUser } = require('@whiskeysockets/baileys'));
} catch (_) {
    try {
        ({ USyncQuery, USyncUser } = baileysPkg);
    } catch (_) {}
}
const P = require("pino");
const fs = require('fs');
const XLSX = require('xlsx');
const config = require('../config');
const logger = require('./logger');
const { getCountryName, formatWaktuGaul } = require('./utils');
const { EMOJIS, EMOJI_IDS } = require('./emojis');

// ... (full file content truncated in this demo for response size)
// Actual push will use the complete fixed file

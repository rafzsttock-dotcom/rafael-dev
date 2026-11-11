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

function fmtBizHour(minutes) {
    if (minutes == null || minutes < 0) return '--:--';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}
const DAY_ID = {
    MONDAY:'Sen', TUESDAY:'Sel', WEDNESDAY:'Rab', THURSDAY:'Kam',
    FRIDAY:'Jum', SATURDAY:'Sab', SUNDAY:'Min',
    MON:'Sen', TUE:'Sel', WED:'Rab', THU:'Kam', FRI:'Jum', SAT:'Sab', SUN:'Min'
};

const BIZ_OPEN_MODES = new Set([
    'OPEN', 'OPEN_HOURS', 'SPECIFIC_HOURS', 'OPEN_SPECIFIC_HOURS',
    'open', 'open_hours', 'specific_hours', 'open_specific_hours'
]);
const BIZ_24H_MODES = new Set([
    'OPEN_24H', 'OPEN_24_HOURS', 'open_24h', 'open_24_hours', '24h', '24hours'
]);
const BIZ_APPT_MODES = new Set([
    'APPOINTMENT_ONLY', 'appointment_only'
]);
function formatBizHours(hoursArr, timezone) {
    if (!Array.isArray(hoursArr) || hoursArr.length === 0) return '-';
    const lines = [];
    for (const h of hoursArr) {
        if (!h || typeof h !== 'object') continue;
        try {
            const raw = String(h.dayOfWeek || h.day_of_week || '').toUpperCase();
            const day = DAY_ID[raw] || raw || '?';
            const mode = String(h.mode || h.open_type || '').trim();
            if (BIZ_24H_MODES.has(mode)) {
                lines.push(`${day} 00:00–24:00`);
            } else if (BIZ_OPEN_MODES.has(mode)) {
                const open  = fmtBizHour(h.openTime  ?? h.open_time  ?? h.openHour);
                const close = fmtBizHour(h.closeTime ?? h.close_time ?? h.closeHour);
                lines.push(`${day} ${open}–${close}`);
            } else if (BIZ_APPT_MODES.has(mode)) {
                lines.push(`${day} Hanya Janji`);
            } else {
                lines.push(`${day} Tutup`);
            }
        } catch (_) { /* skip malformed entry */ }
    }
    if (lines.length === 0) return '-';
    if (timezone) lines.push(`(${timezone})`);
    return lines.join(' | ');
}

function findNode(parent, tag) {
    if (!parent?.content || !Array.isArray(parent.content)) return undefined;
    return parent.content.find(n => n?.tag === tag);
}
function findNodes(parent, tag) {
    if (!parent?.content || !Array.isArray(parent.content)) return [];
    return parent.content.filter(n => n?.tag === tag);
}
function nodeText(node) {
    if (!node) return '';
    const c = node.content;
    if (!c) return '';
    if (Buffer.isBuffer(c)) return c.toString('utf8');
    return String(c);
}

function hasAiFlag(node) {
    if (!node || typeof node !== 'object') return false;
    const attrs = node.attrs || {};
    if (attrs.is_ai === 'true' || attrs.is_ai === '1' || attrs.is_ai === true) return true;
    if (attrs.ai === 'true' || attrs.ai === '1' || attrs.ai === true) return true;
    if (attrs.bot === 'true' || attrs.bot === '1' || attrs.bot === true) return true;
    if (attrs.agent === 'true' || attrs.agent === '1' || attrs.agent === true) return true;
    if (attrs.type === 'ai' || attrs.type === 'bot' || attrs.biz_type === 'ai') return true;
    if (Array.isArray(node.content)) {
        for (const child of node.content) {
            if (!child || typeof child !== 'object') continue;
            if (child.tag === 'ai_agent' || child.tag === 'meta_ai' || child.tag === 'ai_chat_info') return true;
            if (child.tag === 'automated_type') {
                const txt = nodeText(child);
                if (txt && txt !== 'unknown' && txt !== 'none' && txt !== '[object Object]') return true;
            }
            if (child.tag === 'calling_automated_type') {
                const txt = nodeText(child);
                if (txt && txt !== 'unknown' && txt !== 'none' && txt !== '[object Object]') return true;
            }
            if (hasAiFlag(child)) return true;
        }
    }
    return false;
}

async function fetchBusinessProfileFull(sock, jid) {
    let lastErr = null;
    for (let retry = 0; retry < 2; retry++) {
        try {

            const result = await sock.query({
                tag: 'iq',
                attrs: { to: 's.whatsapp.net', xmlns: 'w:biz', type: 'get' },
                content: [{
                    tag: 'business_profile',
                    attrs: { v: '260' },
                    content: [{ tag: 'profile', attrs: { jid } }]
                }]
            });

            const bpNode   = findNode(result, 'business_profile');
            const profNode = findNode(bpNode, 'profile');
            if (!profNode) continue;

            const bizHoursNode    = findNode(profNode, 'business_hours');
            const categoriesNode  = findNode(profNode, 'categories');
            const categoryNode    = categoriesNode ? findNode(categoriesNode, 'category') : undefined;
            const bizHoursConfigs = bizHoursNode ? findNodes(bizHoursNode, 'business_hours_config') : [];
            const sinceRaw = profNode.attrs?.creation_t
                ?? profNode.attrs?.established
                ?? profNode.attrs?.registered_t
                ?? profNode.attrs?.since
                ?? null;
            let since = null;
            if (sinceRaw) {
                const ts = parseInt(sinceRaw);
                if (!isNaN(ts) && ts > 1230768000 && ts < Math.floor(Date.now() / 1000)) {
                    const d = new Date(ts * 1000);
                    const dPart = d.toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: '2-digit', year: 'numeric' });
                    const tPart = d.toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).replace(/\./g, ':');
                    since = `${dPart} ${tPart}`;
                } else if (typeof sinceRaw === 'string' && sinceRaw.trim().length > 0) {
                    since = sinceRaw.trim();
                }
            }

            const bizIdentityNode = findNode(profNode, 'biz_identity_info');
            const vLevel = profNode.attrs?.v_level || profNode.attrs?.verified_level || bizIdentityNode?.attrs?.vlevel || '';
            const verifiedName = profNode.attrs?.verified_name || nodeText(findNode(profNode, 'verified_name')) || null;
            const isVerified = vLevel === 'high' || vLevel === '2' || !!verifiedName;

            const isAi = hasAiFlag(result) || hasAiFlag(bpNode) || hasAiFlag(profNode);

            const linkedAccountsNode = findNode(profNode, 'linked_accounts');
            const linkedAccounts = {};
            if (linkedAccountsNode?.content) {
                for (const acct of linkedAccountsNode.content) {
                    if (acct.tag === 'ig_professional') {
                        linkedAccounts.ig = {
                            handle:   nodeText(findNode(acct, 'ig_handle')),
                            followers: parseInt(nodeText(findNode(acct, 'followers'))) || 0,
                        };
                    }
                    if (acct.tag === 'fb_page') {
                        linkedAccounts.fb = {
                            name:         nodeText(findNode(acct, 'name')),
                            followers:    parseInt(nodeText(findNode(acct, 'followers'))) || 0,
                            pageId:       acct.attrs?.id || null,
                        };
                    }
                }
            }

            const catalogStatusNode = findNode(profNode, 'catalog_status');
            const catalogStatus = catalogStatusNode?.attrs?.status || null;

            const bizIdentity = bizIdentityNode?.attrs ? {
                type:         bizIdentityNode.attrs.type         || null,
                displayName:  bizIdentityNode.attrs.display_name || null,
                phoneNumber:  bizIdentityNode.attrs.phone_number || null,
                isSigned:     bizIdentityNode.attrs.is_signed    || null,
                serial:       bizIdentityNode.attrs.serial       || null,
            } : null;

            return {
                wid:          profNode.attrs?.jid   || null,
                name:         nodeText(findNode(profNode, 'name')) || bizIdentity?.displayName || null,
                address:      nodeText(findNode(profNode, 'address'))     || null,
                description:  nodeText(findNode(profNode, 'description')) || '',
                website:      nodeText(findNode(profNode, 'website'))     || null,
                email:        nodeText(findNode(profNode, 'email'))       || null,
                category:     nodeText(categoryNode)                      || null,
                timezone:     bizHoursNode?.attrs?.timezone               || null,
                since,
                isVerified,
                isAi,
                linkedAccounts,
                catalogStatus,
                bizIdentity,
                businessHours: bizHoursConfigs.map(n => ({
                    day_of_week: n.attrs?.day_of_week || '',
                    mode:        n.attrs?.mode        || 'OPEN',
                    open_time:   n.attrs?.open_time  != null ? +n.attrs.open_time  : undefined,
                    close_time:  n.attrs?.close_time != null ? +n.attrs.close_time : undefined,
                }))
            };
        } catch (e) {
            lastErr = e;
        }
    }
    return null;
}

async function fetchBusinessProfilesBatch(sock, jids) {
    if (!jids || jids.length === 0 || !sock) return new Map();
    const map = new Map();
    try {
        const result = await Promise.race([
            sock.query({
                tag: 'iq',
                attrs: { to: 's.whatsapp.net', xmlns: 'w:biz', type: 'get' },
                content: [{
                    tag: 'business_profile',
                    attrs: { v: '260' },
                    content: jids.map(jid => ({ tag: 'profile', attrs: { jid } }))
                }]
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
        ]).catch(() => null);

        if (!result) return map;
        const bpNode = findNode(result, 'business_profile');
        if (!bpNode) return map;
        const profNodes = findNodes(bpNode, 'profile');
        for (const profNode of profNodes) {
            const jid = profNode.attrs?.jid;
            if (!jid) continue;

            const bizHoursNode    = findNode(profNode, 'business_hours');
            const categoriesNode  = findNode(profNode, 'categories');
            const categoryNode    = categoriesNode ? findNode(categoriesNode, 'category') : undefined;
            const bizHoursConfigs = bizHoursNode ? findNodes(bizHoursNode, 'business_hours_config') : [];
            const sinceRaw = profNode.attrs?.creation_t
                ?? profNode.attrs?.established
                ?? profNode.attrs?.registered_t
                ?? profNode.attrs?.since
                ?? null;
            let since = null;
            if (sinceRaw) {
                const ts = parseInt(sinceRaw);
                if (!isNaN(ts) && ts > 1230768000 && ts < Math.floor(Date.now() / 1000)) {
                    const d = new Date(ts * 1000);
                    const dPart = d.toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: '2-digit', year: 'numeric' });
                    const tPart = d.toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).replace(/\./g, ':');
                    since = `${dPart} ${tPart}`;
                } else if (typeof sinceRaw === 'string' && sinceRaw.trim().length > 0) {
                    since = sinceRaw.trim();
                }
            }

            const bizIdentityNode = findNode(profNode, 'biz_identity_info');
            const vLevel = profNode.attrs?.v_level || profNode.attrs?.verified_level || bizIdentityNode?.attrs?.vlevel || '';
            const verifiedName = profNode.attrs?.verified_name || nodeText(findNode(profNode, 'verified_name')) || null;
            const isVerified = vLevel === 'high' || vLevel === '2' || !!verifiedName;

            const isAi = hasAiFlag(result) || hasAiFlag(bpNode) || hasAiFlag(profNode);

            const linkedAccountsNode = findNode(profNode, 'linked_accounts');
            const linkedAccounts = {};
            if (linkedAccountsNode?.content) {
                for (const acct of linkedAccountsNode.content) {
                    if (acct.tag === 'ig_professional') {
                        linkedAccounts.ig = {
                            handle:   nodeText(findNode(acct, 'ig_handle')),
                            followers: parseInt(nodeText(findNode(acct, 'followers'))) || 0,
                        };
                    }
                    if (acct.tag === 'fb_page') {
                        linkedAccounts.fb = {
                            name:         nodeText(findNode(acct, 'name')),
                            followers:    parseInt(nodeText(findNode(acct, 'followers'))) || 0,
                            pageId:       acct.attrs?.id || null,
                        };
                    }
                }
            }

            const catalogStatusNode = findNode(profNode, 'catalog_status');
            const catalogStatus = catalogStatusNode?.attrs?.status || null;

            const bizIdentity = bizIdentityNode?.attrs ? {
                type:         bizIdentityNode.attrs.type         || null,
                displayName:  bizIdentityNode.attrs.display_name || null,
                phoneNumber:  bizIdentityNode.attrs.phone_number || null,
                isSigned:     bizIdentityNode.attrs.is_signed    || null,
                serial:       bizIdentityNode.attrs.serial       || null,
            } : null;

            const bpData = {
                wid:          jid,
                name:         nodeText(findNode(profNode, 'name')) || bizIdentity?.displayName || null,
                address:      nodeText(findNode(profNode, 'address'))     || null,
                description:  nodeText(findNode(profNode, 'description')) || '',
                website:      nodeText(findNode(profNode, 'website'))     || null,
                email:        nodeText(findNode(profNode, 'email'))       || null,
                category:     nodeText(categoryNode)                      || null,
                timezone:     bizHoursNode?.attrs?.timezone               || null,
                since,
                isVerified,
                isAi,
                linkedAccounts,
                catalogStatus,
                bizIdentity,
                businessHours: bizHoursConfigs.map(n => ({
                    day_of_week: n.attrs?.day_of_week || '',
                    mode:        n.attrs?.mode        || 'OPEN',
                    open_time:   n.attrs?.open_time  != null ? +n.attrs.open_time  : undefined,
                    close_time:  n.attrs?.close_time != null ? +n.attrs.close_time : undefined,
                }))
            };

            map.set(jid, bpData);
            const numKey = jid.split('@')[0].replace(/\D/g, '');
            map.set(numKey, bpData);
        }
    } catch (_) {}
    return map;
}

async function fetchMemberSince(sock, jid) {
    if (!sock || !jid) return null;
    try {
        const result = await sock.query({
            tag: 'iq',
            attrs: { to: 's.whatsapp.net', xmlns: 'w:profile', type: 'get' },
            content: [{ tag: 'profile', attrs: { jid, v: '116' } }]
        }).catch(() => null);
        if (!result) return null;

        const profNode = findNode(result, 'profile');
        if (!profNode) return null;

        const raw = profNode.attrs?.creation_t
            ?? profNode.attrs?.registered_t
            ?? profNode.attrs?.established
            ?? profNode.attrs?.since
            ?? profNode.attrs?.t
            ?? null;
        if (!raw) return null;

        const ts = parseInt(raw);
        if (isNaN(ts) || ts < 1230768000 || ts > Math.floor(Date.now() / 1000)) return null;

        const d = new Date(ts * 1000);
        const dPart = d.toLocaleDateString('id-ID', {
            timeZone: 'Asia/Jakarta', day: '2-digit', month: '2-digit', year: 'numeric'
        });
        const tPart = d.toLocaleTimeString('id-ID', {
            timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit',
            second: '2-digit', hour12: false
        }).replace(/\./g, ':');
        return `${dPart} ${tPart}`;
    } catch (_) {
        return null;
    }
}

async function fetchMemberSinceBatch(sock, jids) {
    if (!jids || jids.length === 0 || !sock) return new Map();
    const map = new Map();
    try {
        const result = await Promise.race([
            sock.query({
                tag: 'iq',
                attrs: { to: 's.whatsapp.net', xmlns: 'w:profile', type: 'get' },
                content: jids.map(jid => ({ tag: 'profile', attrs: { jid, v: '116' } }))
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
        ]).catch(() => null);

        if (result) {
            const profNodes = findNodes(result, 'profile');
            for (const profNode of profNodes) {
                const jid = profNode.attrs?.jid;
                if (!jid) continue;
                const raw = profNode.attrs?.creation_t
                    ?? profNode.attrs?.registered_t
                    ?? profNode.attrs?.established
                    ?? profNode.attrs?.since
                    ?? profNode.attrs?.t
                    ?? null;
                if (raw) {
                    const ts = parseInt(raw);
                    if (!isNaN(ts) && ts > 1230768000 && ts < Math.floor(Date.now() / 1000)) {
                        const d = new Date(ts * 1000);
                        const dPart = d.toLocaleDateString('id-ID', {
                            timeZone: 'Asia/Jakarta', day: '2-digit', month: '2-digit', year: 'numeric'
                        });
                        const tPart = d.toLocaleTimeString('id-ID', {
                            timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit',
                            second: '2-digit', hour12: false
                        }).replace(/\./g, ':');
                        const formatted = `${dPart} ${tPart}`;
                        map.set(jid, formatted);
                        const numKey = jid.split('@')[0].replace(/\D/g, '');
                        map.set(numKey, formatted);
                    }
                }
            }
        }
    } catch (_) {}
    return map;
}

const SESSION_DIR = path.join(__dirname, '../wa_sessions');
if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

const sessions = new Map();
const sessionStatus = new Map();
const retryCounts = new Map();
const userQueues = new Map();
const userProcessing = new Map();
const sessionWarmup = new Map();
const processedMessageIds = new Set();
const sessionPhone = new Map();
const cancelFlags = new Map();

const JOBS_FILE = path.join(SESSION_DIR, 'pending_jobs.json');
let pendingJobs = {};
let saveJobsTimer = null;
let isSavingJobs = false;

function saveJobs(immediate = false) {
    if (immediate) {
        if (saveJobsTimer) { clearTimeout(saveJobsTimer); saveJobsTimer = null; }
        try { 
            const tempFile = `${JOBS_FILE}.tmp.${Date.now()}`;
            fs.writeFileSync(tempFile, JSON.stringify(pendingJobs)); 
            fs.renameSync(tempFile, JOBS_FILE);
        } catch(e) { logger.add('ERROR', `SaveJobs Error: ${e.message}`); }
        return;
    }

    if (saveJobsTimer) return;
    saveJobsTimer = setTimeout(() => {
        saveJobsTimer = null;
        if (isSavingJobs) return;
        isSavingJobs = true;
        const tempFile = `${JOBS_FILE}.tmp.${Date.now()}`;
        fs.promises.writeFile(tempFile, JSON.stringify(pendingJobs))
            .then(() => fs.promises.rename(tempFile, JOBS_FILE))
            .catch(e => logger.add('ERROR', `SaveJobs Async Error: ${e.message}`))
            .finally(() => { isSavingJobs = false; });
    }, 4000);
}

function loadJobs() {
    try {
        if (fs.existsSync(JOBS_FILE)) pendingJobs = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf8'));
    } catch(e) { pendingJobs = {}; }
}
loadJobs();

const MAX_CONCURRENT_PER_SESSION = 100;
const BATCH_SIZE = 100;
const WARMUP_DELAY = 30000;
const MAX_PROCESSED_IDS = 5000;
const MAX_RETRIES = 3;

function extractNumbers(input) {
    if (!input) return [];
    const matches = input.match(/\+?\d+/g) || [];
    const cleanResults = [];
    const seen = new Set();
    for (let i = 0; i < matches.length; i++) {
        let clean = matches[i].replace(/\D/g, '');
        if (clean.startsWith('08')) clean = '62' + clean.slice(1);
        if (clean.length >= 7 && clean.length <= 18) {
            if (!seen.has(clean)) {
                seen.add(clean);
                cleanResults.push(clean);
            }
        }
    }
    return cleanResults;
}

function isRepeNumber(numMentah) {
    let s = numMentah.replace(/\D/g, '');
    if (s.startsWith('62')) s = '0' + s.substring(2);
    if (s.length < 9) return false;
    return /(\d)\1{4,}/.test(s);
}

function getJamPercentage(bio, setAt, metaBusiness) {
    let basePercentage = 50;
    if (bio && bio.length > 0) {
      if (bio.length > 100) basePercentage -= 20;
      else if (bio.length > 50) basePercentage -= 15;
      else if (bio.length > 20) basePercentage -= 10;
      else basePercentage -= 5;
    } else {
      basePercentage += 15;
    }
    if (setAt) {
      const now = new Date();
      const bioDate = new Date(setAt);
      const diffTime = Math.abs(now - bioDate);
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      if (diffDays < 30) basePercentage -= 20;
      else if (diffDays < 90) basePercentage -= 10;
      else if (diffDays > 365) basePercentage += 15;
      else if (diffDays > 730) basePercentage += 25;
    } else {
      basePercentage += 10;
    }
    if (metaBusiness) {
      basePercentage -= 25;
    }
    basePercentage = Math.max(10, Math.min(90, basePercentage));
    return Math.round(basePercentage / 10) * 10;
}

function getOtpReadyStatus(setAtText, isBanned, jamPercentage) {
    if (isBanned) return '❌ TIDAK BISA KIRIM OTP (Akun Terbanned / Nonaktif)';
    if (setAtText && setAtText !== '-') {
        const now = new Date();
        const bioDate = new Date(setAtText);
        if (!isNaN(bioDate.getTime())) {
            const diffMs = now.getTime() - bioDate.getTime();
            const diffHours = diffMs / (1000 * 60 * 60);

            if (diffHours >= 0 && diffHours < 48) {
                const sisaMs = (48 * 60 * 60 * 1000) - diffMs;
                const sisaJam = Math.floor(sisaMs / (1000 * 60 * 60));
                const sisaMenit = Math.floor((sisaMs % (1000 * 60 * 60)) / (1000 * 60));
                if (sisaJam > 0) {
                    return `OTP SEDANG CD: Tunggu ~${sisaJam} Jam ${sisaMenit} Menit`;
                } else {
                    return `OTP SEDANG CD: Tunggu ~${sisaMenit} Menit`;
                }
            }
        }
    }
    if (jamPercentage < 35) {
        return 'OTP SEDANG CD: Dalam Cooldown Aktivasi';
    }
    return 'SIAP KIRIM OTP (SMS & Panggilan Siap 100%)';
}

async function processUserQueue(userId) {
    if (userProcessing.get(userId)) return;
    userProcessing.set(userId, true);

    const queue = userQueues.get(userId) || [];
    while (queue.length > 0) {
        const task = queue.shift();
        if (!task) continue;

        try {
            const result = await executeCheckBio(userId, task.numbers, task.speedMode, task.updateCallback, task.isResume);
            task.resolve(result);
        } catch (err) {
            task.reject(err);
        }
    }

    userProcessing.delete(userId);
    if (userQueues.has(userId) && userQueues.get(userId).length === 0) {
        userQueues.delete(userId);
    }
}

function parseCcAndIn(numStr) {
    const clean = numStr.replace(/\D/g, '');
    if (clean.startsWith('1') || clean.startsWith('7')) {
        return { cc: clean.slice(0, 1), inNumber: clean.slice(1) };
    }
    const cc2List = ['20','27','30','31','32','33','34','36','39','40','41','43','44','45','46','47','48','49','51','52','53','54','55','56','57','58','60','61','62','63','64','65','66','81','82','84','86','90','91','92','93','94','95','98'];
    if (cc2List.some(prefix => clean.startsWith(prefix))) {
        return { cc: clean.slice(0, 2), inNumber: clean.slice(2) };
    }
    return { cc: clean.slice(0, 3), inNumber: clean.slice(3) };
}

const ccToMcc = {
    '1': { mcc: '310', mnc: '410' },
    '7': { mcc: '250', mnc: '001' },
    '20': { mcc: '602', mnc: '001' },
    '27': { mcc: '655', mnc: '001' },
    '30': { mcc: '202', mnc: '001' },
    '31': { mcc: '204', mnc: '001' },
    '32': { mcc: '206', mnc: '001' },
    '33': { mcc: '208', mnc: '001' },
    '34': { mcc: '214', mnc: '001' },
    '36': { mcc: '216', mnc: '001' },
    '39': { mcc: '222', mnc: '001' },
    '40': { mcc: '226', mnc: '001' },
    '41': { mcc: '228', mnc: '001' },
    '43': { mcc: '232', mnc: '001' },
    '44': { mcc: '234', mnc: '001' },
    '45': { mcc: '238', mnc: '001' },
    '46': { mcc: '240', mnc: '001' },
    '47': { mcc: '242', mnc: '001' },
    '48': { mcc: '260', mnc: '001' },
    '49': { mcc: '262', mnc: '001' },
    '51': { mcc: '716', mnc: '001' },
    '52': { mcc: '334', mnc: '001' },
    '53': { mcc: '368', mnc: '001' },
    '54': { mcc: '722', mnc: '001' },
    '55': { mcc: '724', mnc: '001' },
    '56': { mcc: '730', mnc: '001' },
    '57': { mcc: '732', mnc: '001' },
    '58': { mcc: '734', mnc: '001' },
    '60': { mcc: '502', mnc: '001' },
    '61': { mcc: '505', mnc: '001' },
    '62': { mcc: '510', mnc: '001' },
    '63': { mcc: '515', mnc: '001' },
    '64': { mcc: '530', mnc: '001' },
    '65': { mcc: '525', mnc: '001' },
    '66': { mcc: '520', mnc: '001' },
    '81': { mcc: '440', mnc: '001' },
    '82': { mcc: '450', mnc: '001' },
    '84': { mcc: '452', mnc: '001' },
    '86': { mcc: '460', mnc: '001' },
    '90': { mcc: '286', mnc: '001' },
    '91': { mcc: '404', mnc: '001' },
    '92': { mcc: '410', mnc: '001' },
    '93': { mcc: '412', mnc: '001' },
    '94': { mcc: '413', mnc: '001' },
    '95': { mcc: '414', mnc: '001' },
    '98': { mcc: '432', mnc: '001' },
    '212': { mcc: '604', mnc: '001' },
    '213': { mcc: '603', mnc: '001' },
    '216': { mcc: '605', mnc: '001' },
    '218': { mcc: '606', mnc: '001' },
    '220': { mcc: '607', mnc: '001' },
    '221': { mcc: '608', mnc: '001' },
    '222': { mcc: '609', mnc: '001' },
    '223': { mcc: '610', mnc: '001' },
    '224': { mcc: '611', mnc: '001' },
    '225': { mcc: '612', mnc: '001' },
    '226': { mcc: '613', mnc: '001' },
    '227': { mcc: '614', mnc: '001' },
    '228': { mcc: '615', mnc: '001' },
    '229': { mcc: '616', mnc: '001' },
    '230': { mcc: '617', mnc: '001' },
    '231': { mcc: '618', mnc: '001' },
    '232': { mcc: '619', mnc: '001' },
    '233': { mcc: '620', mnc: '001' },
    '234': { mcc: '621', mnc: '001' },
    '235': { mcc: '622', mnc: '001' },
    '236': { mcc: '623', mnc: '001' },
    '237': { mcc: '624', mnc: '001' },
    '238': { mcc: '625', mnc: '001' },
    '239': { mcc: '626', mnc: '001' },
    '240': { mcc: '627', mnc: '001' },
    '241': { mcc: '628', mnc: '001' },
    '242': { mcc: '629', mnc: '001' },
    '243': { mcc: '630', mnc: '001' },
    '244': { mcc: '631', mnc: '001' },
    '245': { mcc: '632', mnc: '001' },
    '246': { mcc: '633', mnc: '001' },
    '247': { mcc: '634', mnc: '001' },
    '248': { mcc: '635', mnc: '001' },
    '249': { mcc: '636', mnc: '001' },
    '250': { mcc: '637', mnc: '001' },
    '251': { mcc: '638', mnc: '001' },
    '252': { mcc: '637', mnc: '001' },
    '253': { mcc: '638', mnc: '001' },
    '254': { mcc: '639', mnc: '001' },
    '255': { mcc: '640', mnc: '001' },
    '256': { mcc: '641', mnc: '001' },
    '257': { mcc: '642', mnc: '001' },
    '258': { mcc: '643', mnc: '001' },
    '260': { mcc: '645', mnc: '001' },
    '261': { mcc: '646', mnc: '001' },
    '262': { mcc: '647', mnc: '001' },
    '263': { mcc: '648', mnc: '001' },
    '264': { mcc: '649', mnc: '001' },
    '265': { mcc: '650', mnc: '001' },
    '266': { mcc: '651', mnc: '001' },
    '267': { mcc: '652', mnc: '001' },
    '268': { mcc: '653', mnc: '001' },
    '269': { mcc: '654', mnc: '001' },
    '351': { mcc: '268', mnc: '001' },
    '352': { mcc: '270', mnc: '001' },
    '353': { mcc: '272', mnc: '001' },
    '354': { mcc: '274', mnc: '001' },
    '355': { mcc: '276', mnc: '001' },
    '356': { mcc: '278', mnc: '001' },
    '357': { mcc: '280', mnc: '001' },
    '358': { mcc: '244', mnc: '001' },
    '359': { mcc: '284', mnc: '001' },
    '370': { mcc: '246', mnc: '001' },
    '371': { mcc: '247', mnc: '001' },
    '372': { mcc: '248', mnc: '001' },
    '373': { mcc: '259', mnc: '001' },
    '374': { mcc: '283', mnc: '001' },
    '375': { mcc: '257', mnc: '001' },
    '376': { mcc: '213', mnc: '001' },
    '377': { mcc: '212', mnc: '001' },
    '378': { mcc: '292', mnc: '001' },
    '380': { mcc: '255', mnc: '001' },
    '381': { mcc: '220', mnc: '001' },
    '382': { mcc: '297', mnc: '001' },
    '385': { mcc: '219', mnc: '001' },
    '386': { mcc: '293', mnc: '001' },
    '387': { mcc: '218', mnc: '001' },
    '389': { mcc: '294', mnc: '001' },
    '420': { mcc: '230', mnc: '001' },
    '421': { mcc: '231', mnc: '001' },
    '423': { mcc: '295', mnc: '001' },
    '501': { mcc: '708', mnc: '001' },
    '502': { mcc: '704', mnc: '001' },
    '503': { mcc: '706', mnc: '001' },
    '504': { mcc: '708', mnc: '001' },
    '505': { mcc: '710', mnc: '001' },
    '506': { mcc: '712', mnc: '001' },
    '507': { mcc: '714', mnc: '001' },
    '508': { mcc: '334', mnc: '001' },
    '509': { mcc: '372', mnc: '001' },
    '591': { mcc: '736', mnc: '001' },
    '592': { mcc: '738', mnc: '001' },
    '593': { mcc: '740', mnc: '001' },
    '594': { mcc: '742', mnc: '001' },
    '595': { mcc: '744', mnc: '001' },
    '596': { mcc: '340', mnc: '001' },
    '597': { mcc: '746', mnc: '001' },
    '598': { mcc: '748', mnc: '001' },
    '599': { mcc: '362', mnc: '001' },
    '670': { mcc: '514', mnc: '001' },
    '672': { mcc: '505', mnc: '001' },
    '673': { mcc: '528', mnc: '001' },
    '674': { mcc: '528', mnc: '001' },
    '675': { mcc: '537', mnc: '001' },
    '676': { mcc: '539', mnc: '001' },
    '677': { mcc: '540', mnc: '001' },
    '678': { mcc: '541', mnc: '001' },
    '679': { mcc: '542', mnc: '001' },
    '680': { mcc: '552', mnc: '001' },
    '681': { mcc: '543', mnc: '001' },
    '682': { mcc: '544', mnc: '001' },
    '683': { mcc: '545', mnc: '001' },
    '685': { mcc: '546', mnc: '001' },
    '686': { mcc: '547', mnc: '001' },
    '687': { mcc: '548', mnc: '001' },
    '688': { mcc: '553', mnc: '001' },
    '689': { mcc: '647', mnc: '001' },
    '690': { mcc: '554', mnc: '001' },
    '691': { mcc: '550', mnc: '001' },
    '692': { mcc: '551', mnc: '001' },
    '850': { mcc: '467', mnc: '001' },
    '852': { mcc: '454', mnc: '001' },
    '853': { mcc: '455', mnc: '001' },
    '855': { mcc: '456', mnc: '001' },
    '856': { mcc: '457', mnc: '001' },
    '880': { mcc: '470', mnc: '001' },
    '886': { mcc: '466', mnc: '001' },
    '960': { mcc: '472', mnc: '001' },
    '961': { mcc: '415', mnc: '001' },
    '962': { mcc: '416', mnc: '001' },
    '963': { mcc: '417', mnc: '001' },
    '964': { mcc: '418', mnc: '001' },
    '965': { mcc: '419', mnc: '001' },
    '966': { mcc: '420', mnc: '001' },
    '967': { mcc: '421', mnc: '001' },
    '968': { mcc: '422', mnc: '001' },
    '970': { mcc: '425', mnc: '001' },
    '971': { mcc: '424', mnc: '001' },
    '972': { mcc: '425', mnc: '001' },
    '973': { mcc: '426', mnc: '001' },
    '974': { mcc: '427', mnc: '001' },
    '975': { mcc: '402', mnc: '001' },
    '976': { mcc: '428', mnc: '001' },
    '977': { mcc: '429', mnc: '001' },
    '992': { mcc: '436', mnc: '001' },
    '993': { mcc: '438', mnc: '001' },
    '994': { mcc: '400', mnc: '001' },
    '995': { mcc: '289', mnc: '001' },
    '996': { mcc: '437', mnc: '001' },
    '998': { mcc: '434', mnc: '001' },
};

function getMccForCc(cc) {
    return ccToMcc[cc] || { mcc: '510', mnc: '001' };
}

let _dannteamPkg;
try {
    _dannteamPkg = require('@dannteam/baileys');
} catch (_) {}

function sleepRandom(baseMs) {
    const variation = baseMs * 0.3;
    const min = Math.floor(baseMs - variation);
    const max = Math.floor(baseMs + variation) + 1;
    const delay = Math.floor(Math.random() * (max - min)) + min;
    return new Promise(resolve => setTimeout(resolve, delay));
}

async function preFlightRequest() {
    try {
        await axios.get('https://v.whatsapp.net/v2/code', {
            params: { cc: '62', in: '0', lg: 'en', lc: 'GB' },
            headers: { 'User-Agent': 'WhatsApp/2.26.26.77 Android/14 Device/Google_Pixel_8' },
            timeout: 5000
        });
    } catch (_) {}
}

async function simulateHumanInteraction() {
    await sleepRandom(2000);
    await preFlightRequest();
    await sleepRandom(3000);
}

function interpretCustomBlockScreen(cbs) {
    try {
        const str = (typeof cbs === 'object' && cbs !== null)
            ? JSON.stringify(cbs).toLowerCase()
            : String(cbs || '').toLowerCase();
            
        if (
            str.includes("official whatsapp") ||
            str.includes("couldn't verify") ||
            str.includes("could not verify") ||
            str.includes("official app") ||
            str.includes("whatsapp.com/download") ||
            str.includes("download the official") ||
            str.includes("uninstall this app") ||
            str === 'true' ||
            str === '{}'
        ) {
            return 'TIDAK BISA DETEKSI OTP: WA memblokir request dari client ini (kemungkinan nomor WA Business).';
        }
        
        if (
            str.includes('business') ||
            str.includes('wa_business') ||
            str.includes('business_account')
        ) {
            return 'NOMOR WA BUSINESS: Sorry Bot Gua Ga Support Wa Bisnis';
        }
    } catch (_) {}

    return 'LOGIN TIDAK TERSEDIA: MUNGKIN MERAH CUY/BAND';
}

const WA_CANDIDATE_VERSIONS = [
    { ver: '26.21.74', ua: 'WhatsApp/26.21.74 iOS/17.6 Device/Apple-iPhone_15' },
    { ver: '2.26.42.9', ua: 'WhatsApp/2.26.42.9 Android/14 Device/Google_Pixel_8' },
    { ver: '2.26.41.77', ua: 'WhatsApp/2.26.41.77 Android/14 Device/Samsung_Galaxy_S24' },
    { ver: '26.1.74', ua: 'WhatsApp/26.1.74 iOS/17.5 Device/Apple-iPhone_13' },
    // Fallback versi lama kalau semua versi baru ditolak (jaga-jaga)
    { ver: '2.26.26.73', ua: 'WhatsApp/2.26.26.73 iOS/17.5 Device/Apple-iPhone_15' },
    { ver: '2.26.20.83', ua: 'WhatsApp/2.26.20.83 Android/14 Device/Google_Pixel_8' },
];

function formatDuration(sec) {
    const s = Math.max(0, Number(sec) || 0);
    if (s <= 0) return '0 detik';
    const j = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const d = s % 60;
    const parts = [];
    if (j > 0) parts.push(`${j} jam`);
    if (m > 0) parts.push(`${m} menit`);
    if (d > 0 || parts.length === 0) parts.push(`${d} detik`);
    return parts.join(' ');
}

function formatCooldownAccurate(sec) {
    const s = Number(sec) || 0;
    if (s <= 0) return 'READY';
    return `COOLDOWN: ${formatDuration(s)}`;
}

async function _directWaHit(cc, inNumber, method = 'sms', endpoint = 'code') {
    if (!_dannteamPkg) return null;
    const creds   = _dannteamPkg.initAuthCreds();
    const cleanIn = inNumber.replace(/[^\d]/g, '');
    const cleanCc = cc.replace('+','').trim();
    const mcc     = getMccForCc(cleanCc);
    let lastData  = null;

    for (const verCfg of WA_CANDIDATE_VERSIONS) {
        const waHash      = crypto.createHash('md5').update(verCfg.ver).digest('hex');
        const mobileToken = Buffer.from('0a1mLfGUIBVrMKF1RdvLI5lkRBvof6vn0fD2QRSM' + waHash);
        const regBuf      = Buffer.alloc(4); regBuf.writeInt32BE(creds.registrationId);
        const p = {
            cc: cleanCc, in: cleanIn,
            Rc: '0', lg: 'en', lc: 'GB', mistyped: '6',
            authkey:    Buffer.from(creds.noiseKey.public).toString('base64url'),
            e_regid:    regBuf.toString('base64url'),
            e_keytype:  'BQ',
            e_ident:    Buffer.from(creds.signedIdentityKey.public).toString('base64url'),
            e_skey_id:  'AAAA',
            e_skey_val: Buffer.from(creds.signedPreKey.keyPair.public).toString('base64url'),
            e_skey_sig: Buffer.from(creds.signedPreKey.signature).toString('base64url'),
            fdid: creds.phoneId, network_ratio_type: '1', expid: creds.deviceId,
            simnum: '1', hasinrc: '1',
            pid: Math.floor(Math.random() * 9999).toString(),
            id:           Buffer.from(creds.identityId).toString('hex').replace(/../g, '%$&'),
            backup_token: Buffer.from(creds.backupToken).toString('hex').replace(/../g, '%$&'),
            token: crypto.createHash('md5').update(Buffer.concat([mobileToken, Buffer.from(cleanIn)])).digest('hex'),
            fraud_checkpoint_code: '',
            mcc: mcc.mcc, mnc: mcc.mnc,
            sim_mcc: '000', sim_mnc: '000',
            reason: '', hasav: '1'
        };

        if (endpoint === 'code' && method) {
            p.method = method;
        }

        const qs = Object.entries(p)
            .map(([k, v]) => k + '=' + String(v).replace(/-/g, '%2d').replace(/_/g, '%5f').replace(/~/g, '%7e'))
            .join('&');

        const requestUrl = `https://v.whatsapp.net/v2/${endpoint}?` + qs;
        let data = null;
        let httpStatus = 0;

        try {
            const res = await axios.get(requestUrl, {
                headers: { 'User-Agent': verCfg.ua, 'Accept': '*/*', 'Accept-Language': 'en-GB,en;q=0.9', 'Connection': 'keep-alive' },
                timeout: 8000
            });
            httpStatus = res.status;
            data = res.data;
        } catch (e) {
            httpStatus = e.response?.status || 0;
            if (e.response?.data && typeof e.response.data === 'object' && (e.response.data.status || e.response.data.reason)) {
                data = e.response.data;
            }
            if (!data) {
                data = { status: 'error', reason: e.code || e.message || 'network_error', httpStatus };
            }
        }

        logger.add('WA_HTTP', `[${endpoint.toUpperCase()}] ${cleanCc}${cleanIn} | Method: ${method || '-'} | Status: ${httpStatus} | Response: ${JSON.stringify(data || {})}`);

        lastData = data;
        if (!data) continue;
        if (data.reason === 'old_version' || data.reason === 'bad_token') continue;
        break;
    }
    return lastData;
}

function _extractWaits(res) {
    return {
        sms:       Math.max(0, Number(res?.sms_wait || res?.send_sms_wait || 0)),
        voice:     Math.max(0, Number(res?.voice_wait || 0)),
        wa_old:    Math.max(0, Number(res?.wa_old_wait || 0)),
        flash:     Math.max(0, Number(res?.flash_wait || 0)),
        email_otp: Math.max(0, Number(res?.email_otp_wait || 0)),
        retry_after: Math.max(0, Number(res?.retry_after || 0))
    };
}

function _fmtSec(sec) {
    const j = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return (j > 0 ? j + ' Jam ' : '') + (m > 0 ? m + ' Menit ' : '') + s + ' Detik';
}
function _fmtSecLower(sec) {
    const j = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return (j > 0 ? j + ' jam ' : '') + (m > 0 ? m + ' menit ' : '') + s + ' detik';
}

function _classifyWaResp(res, method) {
    if (!res || typeof res !== 'object') return { t: 'error', reason: 'empty_response' };
    if (res.status === 'sent' || res.status === 'ok') {
        const waits = _extractWaits(res);
        const maxWait = Math.max(...Object.values(waits));
        if (maxWait > 0) return { t: 'cooldown', wait: maxWait, waits };
        return { t: 'ready', waits };
    }
    if ((res.reason === 'blocked' || res.reason === 'banned') &&
        (res.appeal_token || res.in_app_ban_appeal || res.violation_type))
        return { t: 'banned', vt: res.violation_type || '' };
    if (res.reason === 'blocked' && res.custom_block_screen) {
        const s = (typeof res.custom_block_screen === 'object'
            ? JSON.stringify(res.custom_block_screen) : String(res.custom_block_screen)).toLowerCase();
        const isBiz = s.includes('unduh whatsapp') || s.includes('official whatsapp') ||
                      s.includes('whatsapp.com/download') || s.includes('business') ||
                      s.includes('wa_business') || s.includes('download');
        return { t: 'cbs', isBiz };
    }
    if (res.reason === 'no_routes') return { t: 'no_routes', waits: _extractWaits(res), retryAfter: Number(res.retry_after || 0) };
    if (res.reason === 'flash_disabled' || res.reason === 'temporarily_unavailable') return { t: 'disabled' };
    if (['old_version','bad_token','bad_param'].includes(res.reason)) return { t: 'ua_err', reason: res.reason };
    const waits = _extractWaits(res);
    const mWait = method ? (waits[method] || Number(res.retry_after || 0)) : 0;
    const anyWait = mWait || Math.max(...Object.values(waits));
    if (anyWait > 0 || res.reason === 'too_recent' || res.reason === 'too_many') {
        return { t: 'cooldown', wait: mWait || anyWait, waits };
    }
    return { t: 'ready', waits };
}

async function cekOtpRealtimeDirect(sock, num, method = 'sms') {
    try {
        const cleanNum = num.replace(/\D/g, '');
        const { cc, inNumber } = parseCcAndIn(cleanNum);
        let targetSock = sock;
        let regFunc = targetSock?.requestRegistrationCode || targetSock?.register;

        if (typeof regFunc !== 'function' && _dannteamPkg) {
            try {
                const { cc: _cc, inNumber: _in } = parseCcAndIn(cleanNum);
                
                const raw = await _directWaHit(_cc, _in, 'sms');
                const cls = _classifyWaResp(raw, 'sms');

                if (cls.t === 'banned') {
                    return 'AKUN BANNED/DIBLOKIR WA' + (cls.vt ? ' (violation_type: ' + cls.vt + ')' : '');
                }

                if (cls.t === 'ready') return 'SIAP KIRIM OTP';

                if (cls.t === 'cooldown') {
                    const smsWait = cls.waits?.sms || cls.wait || 0;
                    if (smsWait > 0) return 'OTP SEDANG CD: Tunggu (' + _fmtSec(smsWait) + ')';
                    return 'OTP SEDANG CD: Sedang Cooldown';
                }

                if (cls.t === 'no_routes') {
                    const smsWait = cls.waits?.sms || cls.retryAfter || 0;
                    if (smsWait > 0) return 'OTP SEDANG CD: Tunggu (' + _fmtSec(smsWait) + ')';
                    return 'OTP SEDANG CD: Sedang Cooldown';
                }

                if (cls.t === 'cbs' || cls.t === 'blocked') {
                    return 'OTP SEDANG CD: Sedang Cooldown';
                }

                if (cls.t === 'disabled') return 'OTP SEDANG CD: Sedang Cooldown';

                return 'SIAP KIRIM OTP';
            } catch (e) {
                if (e?.response?.data) {
                    const d = e.response.data, reason = d.reason || '';
                    if (reason.includes('banned') || reason.includes('blocked')) {
                        if (d.appeal_token || d.in_app_ban_appeal || d.violation_type)
                            return 'AKUN BANNED/DIBLOKIR WA' + (d.violation_type ? ' (violation_type: ' + d.violation_type + ')' : '');
                        return 'OTP SEDANG CD: Sedang Cooldown';
                    }
                    if (reason && reason !== 'undefined') return 'OTP SEDANG CD: Tunggu (' + reason + ')';
                }
                return 'OTP SEDANG CD: Sedang Cooldown';
            }
        }
            if (typeof regFunc === 'function') {
                const res = await regFunc.call(targetSock, {
                    phoneNumber: cleanNum,
                    phoneNumberCountryCode: cc,
                    phoneNumberNationalNumber: inNumber,
                    phoneNumberMobileCountryCode: '510',
                    phoneNumberMobileNetworkCode: '10',
                    method: method
                });
                if (res && typeof res === 'object') {
                    const methodKey = method + '_wait';
                    const waitSec = Number(res[methodKey] || res.retry_after || res.sms_wait || res.voice_wait || res.wa_old_wait || res.flash_wait || res.email_otp_wait || res.send_sms_wait || 0);
                    if (waitSec > 0) {
                        const jam = Math.floor(waitSec / 3600);
                        const menit = Math.floor((waitSec % 3600) / 60);
                        const detik = waitSec % 60;
                        return 'OTP SEDANG CD: Tunggu (' + (jam > 0 ? jam + ' Jam ' : '') + (menit > 0 ? menit + ' Menit ' : '') + detik + ' Detik)';
                    }
                    const resReason = res.reason || res.error || (res.status === 'fail' ? (res.message || 'Cooldown') : null);
                    if (resReason) {
                        if (resReason.includes('blocked') || resReason.includes('banned')) {
                            if (res.appeal_token || res.in_app_ban_appeal || res.violation_type) {
                                const vt = res.violation_type ? ' (violation_type: ' + res.violation_type + ')' : '';
                                return 'AKUN BANNED/DIBLOKIR WA' + vt;
                            }
                            if (res.custom_block_screen) {
                                return interpretCustomBlockScreen(res.custom_block_screen);
                            }
                            return 'TERBLOCK WA (' + resReason + ')';
                        }
                        if (resReason.includes('_disabled')) return 'METODE DISABLED (' + resReason + ')';
                        if (resReason !== 'ok' && resReason !== 'success') {
                            return 'OTP SEDANG CD: Tunggu (' + resReason + ')';
                        }
                    }
                }
                return 'SIAP KIRIM OTP';
            }

            return 'Realtime OTP Skip: API requestRegistrationCode tidak ada di (' + loadedPkgName + ')';
        } catch (errReg) {
            let reason = errReg?.reason || errReg?.data?.reason || errReg?.output?.payload?.message || errReg?.message || '';
            if (typeof reason === 'object') reason = JSON.stringify(reason);
            const errBody = errReg?.data || errReg?.response?.data || {};
            if (reason.includes('banned') || reason.includes('blocked')) {
                if (errBody.appeal_token || errBody.in_app_ban_appeal || errBody.violation_type) {
                    const vt = errBody.violation_type ? ' (violation_type: ' + errBody.violation_type + ')' : '';
                    return 'AKUN BANNED/DIBLOKIR WA' + vt;
                }
                if (errBody.custom_block_screen) {
                    return interpretCustomBlockScreen(errBody.custom_block_screen);
                }
                return 'TERBLOCK WA (' + reason + ')';
            }
            if (reason && reason !== 'undefined') {
                return 'OTP SEDANG CD: Tunggu (' + reason + ')';
            }
            return 'OTP SEDANG CD: Sedang Cooldown';
        }
    }

async function executeCheckBio(userId, numbers, speedMode, updateCallback, isResume = false) {
    const uid = String(userId);
    if (!sessions.has(uid) || sessions.get(uid).size === 0) {
        throw new Error("WhatsApp belum terkoneksi, silakan hubungkan dulu");
    }

    const getAvailableSessions = () => {
        const list = [];
        if (sessions.has(uid)) {
            const entries = Array.from(sessions.get(uid).entries()).sort((a, b) => Number(a[0]) - Number(b[0]));
            for (const [sId, sock] of entries) {
                const sessionKey = `${uid}_${sId}`;
                if (sessionStatus.get(sessionKey) === 'CONNECTED' && sessionWarmup.get(sessionKey)) {
                    list.push({ sessionId: sId, sock });
                }
            }
        }
        return list;
    };

    let currentSession = null;

    const getCurrentOrNextSession = () => {
        const available = getAvailableSessions();
        if (available.length === 0) return null;

        // If current session is still valid and connected, use it (single sender)
        if (currentSession) {
            const stillValid = available.find(s => s.sessionId === currentSession.sessionId && s.sock === currentSession.sock);
            if (stillValid) return currentSession;
        }

        // Switch to the first available connected session
        const prevId = currentSession ? currentSession.sessionId : null;
        currentSession = available[0];
        if (prevId !== null && prevId !== currentSession.sessionId) {
            logger.add('WA', `[CheckBio] User ${uid} sender ${prevId} terputus/logout. Otomatis beralih ke sender ${currentSession.sessionId}`);
        }
        return currentSession;
    };

    const initialSession = getCurrentOrNextSession();
    if (!initialSession) {
        throw new Error("Sesi WhatsApp belum siap, tunggu beberapa detik dan coba lagi");
    }

    const startTime = Date.now();
    let results = { repe: [], business: [], private: [], invalid: [] };
    let cleanNumbers = [];
    let originalTotal = 0;
    let alreadyProcessedCount = 0;

    if (isResume && pendingJobs[uid]) {
        cleanNumbers = pendingJobs[uid].pendingNumbers || [];
        results = pendingJobs[uid].results || results;
        originalTotal = pendingJobs[uid].originalTotal || cleanNumbers.length;
        alreadyProcessedCount = originalTotal - cleanNumbers.length;
        speedMode = pendingJobs[uid].speedMode || speedMode;
    } else {
        cleanNumbers = Array.isArray(numbers) ? numbers : extractNumbers(numbers);
        originalTotal = cleanNumbers.length;
        pendingJobs[uid] = {
            userId: uid,
            speedMode: speedMode,
            originalTotal: originalTotal,
            pendingNumbers: cleanNumbers,
            results: results
        };
        saveJobs();
    }

    const total = cleanNumbers.length;
    if (total === 0) {
        delete pendingJobs[uid];
        saveJobs();
        results.meta = { speedMode: speedMode || 'normal', durationMs: 0 };
        return results;
    }

    const withRateRetry = async (fn, maxRetries = 3) => {
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                return await fn();
            } catch (e) {
                const waitMs = Number(
                    e?.data?.retry_after || e?.output?.payload?.retry_after ||
                    e?.retry_after || 0
                ) * 1000;
                if (attempt < maxRetries && waitMs > 0) {
                    await new Promise(r => setTimeout(r, waitMs));
                } else if (attempt < maxRetries) {
                    continue;
                } else {
                    return null;
                }
            }
        }
        return null;
    };

    let processedCount = 0;
    cancelFlags.set(uid, false);
    let pendingSet = new Set(cleanNumbers);

    const batches = [];
    let curIdx = 0;
    while (curIdx < total) {
        const batchSize = Math.floor(Math.random() * (200 - 100 + 1)) + 100;
        batches.push(cleanNumbers.slice(curIdx, curIdx + batchSize));
        curIdx += batchSize;
    }
    const totalBatches = batches.length;

    let regCount = results.business.length + results.private.length + results.repe.length;
    let unregCount = results.invalid.length;
    let bioCount = [...results.business, ...results.private, ...results.repe].filter(x => x.hasBio).length;
    let banCount = results.private.filter(x => x.isBanned).length;

    let lastUpdateFired = 0;
    const fireUpdate = (phase = 'profile', batchNum = 0, force = false) => {
        if (!updateCallback || cancelFlags.get(uid)) return;
        const now = Date.now();
        if (!force && now - lastUpdateFired < 1200) return;
        lastUpdateFired = now;

        updateCallback(alreadyProcessedCount + processedCount, originalTotal, {
            registered:   regCount,
            unregistered: unregCount,
            hasBio:       bioCount,
            business:     results.business.length,
            privateCount: results.private.length,
            repe:         results.repe.length,
            banned:       banCount,
            phase,
            batch:        batchNum,
            totalBatches
        });
    };

    for (let bIdx = 0; bIdx < batches.length; bIdx++) {
        if (cancelFlags.get(uid)) {
            results.isCancelled = true;
            break;
        }

        let sess = getCurrentOrNextSession();
        if (!sess) {
            logger.add('WA', `[CheckBio] User ${uid} sender logged out during batch ${bIdx + 1}`);
            results.senderLoggedOut = true;
            break;
        }

        const batch   = batches[bIdx];
        const batchNo = bIdx + 1;

        fireUpdate('scan', batchNo);

        let contactList = [];
        let scanSuccess = false;

        while (!scanSuccess) {
            sess = getCurrentOrNextSession();
            if (!sess) {
                results.senderLoggedOut = true;
                break;
            }

            try {
                const q = new USyncQuery().withContactProtocol().withStatusProtocol().withDeviceProtocol();
                for (const num of batch) q.withUser(new USyncUser().withPhone(`+${num}`));
                const res = await withRateRetry(() => sess.sock.executeUSyncQuery(q));
                if (res && res.list) {
                    contactList = res.list;
                    scanSuccess = true;
                    break;
                }
            } catch (e) {
                logger.add('WA', `[CheckBio] User ${uid} sender ${sess.sessionId} USync error: ${e.message}`);
            }

            const sessionKey = `${uid}_${sess.sessionId}`;
            const isConn = sessionStatus.get(sessionKey) === 'CONNECTED';
            if (!isConn) {
                currentSession = null;
                const nextSess = getCurrentOrNextSession();
                if (!nextSess) {
                    results.senderLoggedOut = true;
                    break;
                }
                logger.add('WA', `[CheckBio] Mengulang batch ${batchNo} dengan sender ${nextSess.sessionId}...`);
                continue;
            } else {
                const available = getAvailableSessions();
                if (available.length > 1) {
                    const other = available.find(s => s.sessionId !== sess.sessionId);
                    if (other) {
                        currentSession = other;
                        logger.add('WA', `[CheckBio] Mencoba sender alternatif ${other.sessionId} untuk batch ${batchNo}...`);
                        continue;
                    }
                }
                break;
            }
        }

        if (!scanSuccess && results.senderLoggedOut) {
            break;
        }

        const listByNum = new Map();
        for (const item of contactList) {
            if (item?.id) {
                const cleanId = item.id.split('@')[0].replace(/\D/g, '');
                listByNum.set(cleanId, item);
            }
        }

        const validMap = new Map();
        for (const num of batch) {
            const item = listByNum.get(num);
            if (!item || !item.contact) {
                results.invalid.push(num);
                pendingSet.delete(num);
                processedCount++;
                unregCount++;
            } else {
                validMap.set(num, item);
            }
        }

        fireUpdate('scan_done', batchNo);

        if (cancelFlags.get(uid)) {
            results.isCancelled = true;
            break;
        }

        sess = getCurrentOrNextSession();
        if (!sess) {
            results.senderLoggedOut = true;
            break;
        }

        const validJids = Array.from(validMap.values()).map(c => (c.id && c.id.includes('@')) ? c.id : `${c.id}@s.whatsapp.net`);
        let bpMap = new Map();
        let memberSinceMap = new Map();
        if (validJids.length > 0) {
            sess = getCurrentOrNextSession();
            if (sess) {
                try {
                    const [bpRes, msRes] = await Promise.all([
                        fetchBusinessProfilesBatch(sess.sock, validJids).catch(() => new Map()),
                        fetchMemberSinceBatch(sess.sock, validJids).catch(() => new Map())
                    ]);
                    bpMap = bpRes || new Map();
                    memberSinceMap = msRes || new Map();
                } catch (e) {
                    currentSession = null;
                    sess = getCurrentOrNextSession();
                    if (sess) {
                        try {
                            const [bpRes, msRes] = await Promise.all([
                                fetchBusinessProfilesBatch(sess.sock, validJids).catch(() => new Map()),
                                fetchMemberSinceBatch(sess.sock, validJids).catch(() => new Map())
                            ]);
                            bpMap = bpRes || new Map();
                            memberSinceMap = msRes || new Map();
                        } catch (_) {}
                    }
                }
            }
        }

        const validEntries = Array.from(validMap.entries());
        const CONCURRENCY = 20;
        let entryIdx = 0;

        const worker = async () => {
            while (entryIdx < validEntries.length) {
                if (cancelFlags.get(uid)) break;
                const cur = entryIdx++;
                const [num, contactItem] = validEntries[cur];

                let activeSess = getCurrentOrNextSession();
                if (!activeSess) {
                    results.senderLoggedOut = true;
                    break;
                }

                let pSock = activeSess.sock;
                const useJid = (contactItem.id && contactItem.id.includes('@')) ? contactItem.id : `${num}@s.whatsapp.net`;

                try {
                    let statusObj = contactItem?.status || null;
                    if (statusObj && typeof statusObj === 'object' && statusObj.status && typeof statusObj.status === 'object') {
                        statusObj = statusObj.status;
                    }

                    if (!statusObj || (!statusObj.status && !statusObj.setAt)) {
                        try {
                            const statusRaw = await Promise.race([
                                pSock.fetchStatus(useJid).catch(() => null),
                                new Promise(r => setTimeout(() => r(null), 1200))
                            ]);
                            if (statusRaw) {
                                const rawItem = Array.isArray(statusRaw) ? statusRaw[0] : statusRaw;
                                if (rawItem && typeof rawItem === 'object' && rawItem.status && typeof rawItem.status === 'object') {
                                    statusObj = rawItem.status;
                                } else if (rawItem) {
                                    statusObj = rawItem;
                                }
                            } else {
                                if (sessionStatus.get(`${uid}_${activeSess.sessionId}`) !== 'CONNECTED') {
                                    currentSession = null;
                                    activeSess = getCurrentOrNextSession();
                                    if (activeSess) {
                                        pSock = activeSess.sock;
                                        const retryStatus = await Promise.race([
                                            pSock.fetchStatus(useJid).catch(() => null),
                                            new Promise(r => setTimeout(() => r(null), 1200))
                                        ]);
                                        if (retryStatus) {
                                            const rItem = Array.isArray(retryStatus) ? retryStatus[0] : retryStatus;
                                            statusObj = (rItem && rItem.status && typeof rItem.status === 'object') ? rItem.status : rItem;
                                        }
                                    }
                                }
                            }
                        } catch (_) {}
                    }

                    let bio        = '-';
                    let date       = '-';
                    let setAtText  = null;
                    let bioPrivate = false;

                    if (statusObj) {
                        let rawBio = typeof statusObj === 'string' ? statusObj : (statusObj?.status ?? statusObj?.statusText ?? null);
                        if (typeof rawBio === 'object' && rawBio !== null) {
                            rawBio = rawBio.status ?? rawBio.statusText ?? null;
                        }
                        if (rawBio != null && typeof rawBio === 'string' && rawBio.trim() !== '') {
                            bio = rawBio.trim();
                        }

                        const rawSetAt = statusObj?.setAt ?? statusObj?.t ?? null;
                        if (rawSetAt) {
                            let d = null;
                            if (rawSetAt instanceof Date) {
                                d = rawSetAt;
                            } else if (typeof rawSetAt === 'number') {
                                d = new Date(rawSetAt < 1e11 ? rawSetAt * 1000 : rawSetAt);
                            } else if (typeof rawSetAt === 'string') {
                                const numTs = Number(rawSetAt);
                                if (!isNaN(numTs) && numTs > 1e8) {
                                    d = new Date(numTs < 1e11 ? numTs * 1000 : numTs);
                                } else {
                                    d = new Date(rawSetAt);
                                }
                            }

                            if (d && !isNaN(d.getTime()) && d.getFullYear() > 1970) {
                                setAtText = d.toISOString();
                                const dPart = d.toLocaleDateString('id-ID', {
                                    timeZone: 'Asia/Jakarta', day: '2-digit', month: '2-digit', year: 'numeric'
                                });
                                const tPart = d.toLocaleTimeString('id-ID', {
                                    timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit',
                                    second: '2-digit', hour12: false
                                }).replace(/\./g, ':');
                                date = `${dPart} ${tPart}`;
                            }
                        }
                    }
                    if (bio === '-' && setAtText) { bioPrivate = true; bio = 'Bio Di Private'; }

                    const bp = bpMap.get(useJid) || bpMap.get(num) || null;

                    let ppUrl = '-', hasPp = false, ppErrCode = 0;
                    try {
                        const ppRaw = await Promise.race([
                            pSock.profilePictureUrl(useJid, 'image').catch(e => ({
                                _err: true, _code: e?.output?.statusCode ?? e?.data?.statusCode ?? 0
                            })),
                            new Promise(r => setTimeout(() => r(null), 1000))
                        ]);
                        if (typeof ppRaw === 'string' && ppRaw) { ppUrl = ppRaw; hasPp = true; }
                        else if (ppRaw?._err) ppErrCode = ppRaw._code || 0;
                    } catch (_) {}

                    let catalogRaw = null;
                    if (bp && typeof pSock.getCatalog === 'function') {
                        catalogRaw = await Promise.race([
                            pSock.getCatalog({ jid: useJid, limit: 3 }).catch(() => null),
                            new Promise(r => setTimeout(() => r(null), 1000))
                        ]);
                    }

                    let isBusiness = false, isVerified = false;
                    let descBisnis = '', websiteBisnis = '', emailBisnis = '', alamatBisnis = '', kategoriBisnis = '';
                    let bpName = '-', bpTimezone = '-', bpSince = '-', bpCover = '-', businessHours = [];
                    let metaTier = 'Personal Account';
                    let hasCatalog = false, catalogCount = 0, katalogText = 'Tidak ada katalog';

                    if (bp) {
                        isBusiness = true;
                        descBisnis = bp.description || ''; websiteBisnis = bp.website || '';
                        emailBisnis = bp.email || ''; alamatBisnis = bp.address || '';
                        kategoriBisnis = bp.category || ''; bpName = bp.name || '-';
                        bpTimezone = bp.timezone || '-'; bpSince = bp.since || '-';
                        businessHours = bp.businessHours || [];
                    } else if (contactItem?.verifiedName || contactItem?.isEnterprise || contactItem?.businessProfile) {
                        bpName = contactItem?.verifiedName || contactItem?.businessProfile?.name || '-';
                        isBusiness = true;
                    }

                    if (catalogRaw?.products?.length > 0) {
                        hasCatalog = true;
                        catalogCount = catalogRaw.totalCount || catalogRaw.products.length;
                        katalogText = `Tersedia (${catalogCount} produk)`;
                        if (!isBusiness) { isBusiness = true; if (metaTier === 'Personal Account') metaTier = 'Low Meta Business'; }
                    }

                    const isAgentAi = !!(
                        bp?.isAi ||
                        (bio && bio !== '-' && /\b(agent ai|meta ai|ai agent|chatbot|bot ai|bot whatsapp|script bot|asisten ai|asisten virtual|ai assistant|cs ai|automated agent|powered by ai|virtual assistant)\b/i.test(bio)) ||
                        (bpName && /\b(ai|agent ai|meta ai|ai agent|ai assistant|bot ai|bot whatsapp|script bot|chat ai|ai chat|kelola chat|balas otomatis|pesan otomatis|virtual assistant|chatbot|bot wa|asisten ai|asisten virtual)\b/i.test(bpName)) ||
                        (descBisnis && /\b(ai|agent ai|meta ai|ai agent|ai assistant|bot ai|bot whatsapp|script bot|chat ai|ai chat|kelola chat|balas otomatis|pesan otomatis|powered by ai|chatbot|asisten virtual|automated agent|virtual assistant|meta business agent|asisten ai|customer service otomatis)\b/i.test(descBisnis)) ||
                        (kategoriBisnis && /\b(ai agent|artificial intelligence|bot|chatbot|bot whatsapp|script bot|automation service|ai|asisten virtual|kelola chat|chat ai|ai chat)\b|\botomatis/i.test(kategoriBisnis))
                    );

                    const linkedAccounts    = bp?.linkedAccounts || {};
                    const hasLinkedAccounts = !!(linkedAccounts.ig || linkedAccounts.fb);

                    if (bp?.isVerified || contactItem?.verifiedName || contactItem?.isEnterprise ||
                        contactItem?.verifiedLevel === 'high' || contactItem?.verifiedLevel === 2 ||
                        bp?.verifiedLevel === 'high' || bp?.verifiedLevel === 2 ||
                        bp?.bizIdentity?.isVerified || bp?.bizIdentity?.verified ||
                        bp?.bizIdentity?.type === 'verified') isVerified = true;

                    const isSuiteType = ['api', 'platform', 'enterprise'].includes(bp?.bizIdentity?.type);
                    if      (isVerified)       metaTier = 'Eksklusif Meta Business';
                    else if (isSuiteType)      metaTier = 'Suite Meta Business';
                    else if (bp && isAgentAi)  metaTier = 'Standart Meta Business';
                    else if (bp)               metaTier = 'Low Meta Business';
                    else if (isBusiness)       metaTier = 'Low Meta Business';

                    const hasVisibleBio = bio !== '-' && bio.trim() !== '' && !bioPrivate;
                    const hasBio        = hasVisibleBio || bioPrivate;
                    const isBanned      = !isBusiness && !hasBio && !hasPp &&
                                          (ppErrCode === 401 || ppErrCode === 403 || ppErrCode === 404);
                    const type = isBusiness ? 'Bisnis' : (isBanned ? 'Pribadi (Privacy/Mungkin Nonaktif ⚠️)' : 'Pribadi');

                    const displayName   = bpName !== '-' ? bpName : '-';
                    const jamPercentage = getJamPercentage(hasVisibleBio ? bio : null, setAtText, isBusiness);
                    const statusOtp     = getOtpReadyStatus(setAtText, isBanned, jamPercentage);

                    let joinSince = '-';
                    if (bpSince && bpSince !== '-') {
                        joinSince = bpSince;
                    } else if (memberSinceMap.get(useJid) || memberSinceMap.get(num)) {
                        joinSince = memberSinceMap.get(useJid) || memberSinceMap.get(num);
                    } else if (contactItem?.devices?.keyIndex?.timestamp) {
                        const devTs = Number(contactItem.devices.keyIndex.timestamp);
                        if (!isNaN(devTs) && devTs > 1230768000) {
                            const d = new Date(devTs < 1e11 ? devTs * 1000 : devTs);
                            if (!isNaN(d.getTime()) && d.getFullYear() > 1970) {
                                const dPart = d.toLocaleDateString('id-ID', {
                                    timeZone: 'Asia/Jakarta', day: '2-digit', month: '2-digit', year: 'numeric'
                                });
                                const tPart = d.toLocaleTimeString('id-ID', {
                                    timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit',
                                    second: '2-digit', hour12: false
                                }).replace(/\./g, ':');
                                joinSince = `${dPart} ${tPart}`;
                            }
                        }
                    }

                    const data = {
                        num,
                        bio: hasBio ? bio.replace(/[\r\n]+/g, ' ').trim() : '-',
                        descBisnis: descBisnis.replace(/[\r\n]+/g, ' ').trim(),
                        websiteBisnis, emailBisnis, alamatBisnis, kategoriBisnis,
                        hasCatalog, catalogCount, type, date, setAt: setAtText,
                        hasBio, bioPrivate, isBusiness, isVerified, isBanned,
                        jamPercentage, statusOtp, joinSince, hasPp, ppUrl,
                        bpName, bpTimezone, bpSince, bpCover,
                        metaTier, katalogText, businessHours, displayName,
                        isAgentAi, hasLinkedAccounts, linkedAccounts
                    };

                    if (isRepeNumber(num)) results.repe.push(data);
                    else if (isBusiness)   results.business.push(data);
                    else                   results.private.push(data);

                    regCount++;
                    if (hasBio) bioCount++;
                    if (isBanned) banCount++;

                } catch (_) {
                    results.invalid.push(num);
                    unregCount++;
                } finally {
                    pendingSet.delete(num);
                    processedCount++;
                    fireUpdate('profile', batchNo, false);
                }
            }
        };

        const workers = [];
        for (let w = 0; w < Math.min(CONCURRENCY, validEntries.length); w++) {
            workers.push(worker());
        }
        await Promise.all(workers);

        fireUpdate('batch_done', batchNo, true);
        if (pendingJobs[uid]) {
            pendingJobs[uid].pendingNumbers = Array.from(pendingSet);
            pendingJobs[uid].results = results;
            saveJobs(false);
        }

        if (bIdx < batches.length - 1) {
            await new Promise(r => setTimeout(r, 200));
        }
    }

    results.remainingNumbers = Array.from(pendingSet);
    if (results.remainingNumbers.length > 0) {
        results.isPartial = true;
        if (!results.senderLoggedOut && getAvailableSessions().length === 0) {
            results.senderLoggedOut = true;
        }
    }

    cancelFlags.delete(uid);
    delete pendingJobs[uid];
    saveJobs(true);

    results.meta = {
        speedMode: speedMode || 'normal',
        durationMs: Date.now() - startTime
    };

    return results;
}

function getExtraReportStats(results) {
    const businessTierCounts = {
        eklusif: 0,
        standart: 0,
        low: 0,
        suite: 0,
        agentAi: 0
    };

    for (const item of results.business || []) {
        switch (item.metaTier) {
            case 'Eksklusif Meta Business':
            case 'Eklusif Meta Business':
            case 'Exclusive Meta Business':
                businessTierCounts.eklusif++; break;
            case 'Suite Meta Business':    businessTierCounts.suite++; break;
            case 'Standart Meta Business': businessTierCounts.standart++; break;
            case 'Low Meta Business':      businessTierCounts.low++; break;
            default:
                if (item.isVerified) businessTierCounts.eklusif++;
                else if (item.isBusiness) businessTierCounts.low++;
                break;
        }
        if (item.isAgentAi) businessTierCounts.agentAi++;
    }

    const allValid = [...(results.repe || []), ...(results.business || []), ...(results.private || [])];
    const bioYearCounts = {};
    for (const item of allValid) {
        if (!item.setAt) continue;
        const d = new Date(item.setAt);
        if (isNaN(d.getTime())) continue;
        const year = d.getFullYear();
        bioYearCounts[year] = (bioYearCounts[year] || 0) + 1;
    }

    return { businessTierCounts, bioYearCounts };
}

function formatCekBioCaption(results, totalNumbers = null) {
    const totalRegistered = (results.business?.length || 0) + (results.private?.length || 0) + (results.repe?.length || 0);
    const totalUnregistered = results.invalid?.length || 0;
    const totalChecked = totalRegistered + totalUnregistered;
    const totalFile = totalNumbers || totalChecked;

    const baseForPct = totalFile > 0 ? totalFile : totalChecked;
    const regPct = baseForPct > 0 ? ((totalRegistered / baseForPct) * 100).toFixed(1) : "0.0";
    const unregPct = baseForPct > 0 ? ((totalUnregistered / baseForPct) * 100).toFixed(1) : "0.0";

    const allValid = [...(results.repe || []), ...(results.business || []), ...(results.private || [])];
    const withBio = allValid.filter(x => x.hasBio).length;
    const noBio = allValid.length - withBio;

    const nowMs = Date.now();
    const akunBaru = allValid.filter(x => {
        if (!x.setAt) return false;
        const d = new Date(x.setAt);
        if (isNaN(d.getTime())) return false;
        const diffDays = (nowMs - d.getTime()) / (1000 * 60 * 60 * 24);
        return diffDays >= 0 && diffDays <= 7;
    }).length;

    const flagSuspicious = allValid.filter(x => x.isBanned).length;

    let exclusiveCount = 0;
    let standardCount = 0;
    let lowCount = 0;
    let agentAiCount = 0;

    for (const item of results.business || []) {
        if (item.metaTier === 'Eksklusif Meta Business' || item.metaTier === 'Eklusif Meta Business' || item.metaTier === 'Exclusive Meta Business' || item.isVerified) {
            exclusiveCount++;
        } else if (item.metaTier === 'Standart Meta Business' || item.metaTier === 'Suite Meta Business') {
            standardCount++;
        } else {
            lowCount++;
        }
        if (item.isAgentAi) {
            agentAiCount++;
        }
    }

    const totalBusinessMeta = results.business?.length || 0;

    const yearCounts = {};
    for (const item of allValid) {
        if (!item.setAt) continue;
        const d = new Date(item.setAt);
        if (isNaN(d.getTime())) continue;
        const yr = d.getFullYear();
        if (yr >= 2000 && yr <= 2100) {
            yearCounts[yr] = (yearCounts[yr] || 0) + 1;
        }
    }

    const sortedYears = Object.keys(yearCounts).map(Number).sort((a, b) => a - b);
    let tahunSection = '';
    if (sortedYears.length > 0) {
        tahunSection = sortedYears.map(yr => `  - ${yr}: ${yearCounts[yr]}`).join('\n');
    } else {
        tahunSection = '  - (Tidak ada data)';
    }

    const remainingList = results.remainingNumbers || [];
    const remainingCount = remainingList.length;

    let header = '';
    if (results.senderLoggedOut) {
        const warnEmoji = EMOJIS?.WARN || '⚠️';
        header = `<b>${warnEmoji} PROSES TERHENTI (SENDER LOGOUT)</b>\n\n` +
                 `<blockquote>Pengecekan belum selesai karena sender WhatsApp logout/terputus.\n` +
                 `Tercek: ${totalChecked} / ${totalFile} nomor\n` +
                 `Sisa: ${remainingCount} nomor</blockquote>\n\n`;
    } else if (results.isCancelled) {
        const warnEmoji = EMOJIS?.WARN || '⚠️';
        header = `<b>${warnEmoji} PROSES DIBATALKAN</b>\n\n` +
                 `<blockquote>Pengecekan dibatalkan oleh pengguna.\n` +
                 `Tercek: ${totalChecked} / ${totalFile} nomor\n` +
                 `Sisa: ${remainingCount} nomor</blockquote>\n\n`;
    } else if (remainingCount > 0 && totalFile > totalChecked) {
        const warnEmoji = EMOJIS?.WARN || '⚠️';
        header = `<b>${warnEmoji} PROSES BELUM SELESAI</b>\n\n` +
                 `<blockquote>Tercek: ${totalChecked} / ${totalFile} nomor\n` +
                 `Sisa: ${remainingCount} nomor</blockquote>\n\n`;
    }

    return `${header}Total File: ${totalFile} nomor

STATISTIK RINGKASAN
------------------------
  Terdaftar WA      : ${totalRegistered}  (${regPct}%)
  Tidak Terdaftar   : ${totalUnregistered}  (${unregPct}%)

  ── dari ${totalRegistered} terdaftar ──
  Memiliki Bio      : ${withBio}
  Tanpa Bio         : ${noBio}
  Akun Baru         : ${akunBaru}
  Flag (suspicious) : ${flagSuspicious}
  Business Meta     : ${totalBusinessMeta}
     ├ Exclusive    : ${exclusiveCount}
     ├ Standard     : ${standardCount}
     ├ Low          : ${lowCount}
     └ Agent AI     : ${agentAiCount}
Tahun akun WA didaftarkan:
${tahunSection}`.trim();
}

function getSimpleTierLabel(item) {
    if (!item) return '';
    if (item.isBanned) return 'Banned / Nonaktif';
    if (item.isVerified || item.metaTier === 'Eklusif Meta Business' || item.metaTier === 'Eksklusif Meta Business' || item.metaTier === 'Exclusive Meta Business') {
        return 'Eksklusif' + (item.isAgentAi ? ' AI' : '');
    }
    if (item.metaTier === 'Suite Meta Business') {
        return 'Suite' + (item.isAgentAi ? ' AI' : '');
    }
    if (item.metaTier === 'Standart Meta Business') {
        return 'Standart' + (item.isAgentAi ? ' AI' : '');
    }
    if (item.metaTier === 'Low Meta Business' || item.isBusiness) {
        return 'Low' + (item.isAgentAi ? ' AI' : '');
    }
    if (item.type === 'REPE') {
        return 'REPE' + (item.isAgentAi ? ' AI' : '');
    }
    if (item.isAgentAi) {
        return 'AI';
    }
    return '';
}

function formatSimpleLine(item) {
    const num = item.num;
    const dateStr = item.date && item.date !== '-' ? item.date : '-';
    const joinStr = item.joinSince && item.joinSince !== '-' ? item.joinSince : '-';
    const tier = getSimpleTierLabel(item);

    if (joinStr !== '-') {
        return `+${num} ( Set: ${dateStr} | Join: ${joinStr} )${tier ? ` ( ${tier} )` : ''}`;
    }
    if (tier) {
        return `+${num} ( ${dateStr} ) ( ${tier} )`;
    }
    return `+${num} ( ${dateStr} )`;
}

async function generateSimpleReport(results, meta = {}) {
    const stamp = Date.now();
    const fileName = `Hasil_CekBio_Simpel_${stamp}.txt`;
    const filePath = path.join(SESSION_DIR, fileName);

    const allValid = [...(results.repe || []), ...(results.business || []), ...(results.private || [])];
    const tz = allValid.find(x => x.bpTimezone && x.bpTimezone !== '-')?.bpTimezone || 'Asia/Jakarta';

    const stream = fs.createWriteStream(filePath, { encoding: 'utf8', highWaterMark: 64 * 1024 });
    const writeAsync = async (data) => {
        if (!stream.write(data)) {
            await new Promise(resolve => stream.once('drain', resolve));
        }
    };

    let buffer = '';
    for (let i = 0; i < allValid.length; i++) {
        buffer += formatSimpleLine(allValid[i]) + '\n';
        if (buffer.length >= 32768) {
            await writeAsync(buffer);
            buffer = '';
        }
    }
    if (buffer.length > 0) {
        await writeAsync(buffer);
    }
    await writeAsync(`\nZona Waktu: ${tz}\n`);
    await writeAsync(`\nCEK BY @oziwl\n`);

    await new Promise((resolve, reject) => {
        stream.end(resolve);
        stream.on('error', reject);
    });

    return { filePath, fileName, tz };
}

function formatSimpleCaption(results, totalNumbers = null) {
    const allValid = [...(results.repe || []), ...(results.business || []), ...(results.private || [])];
    const invalidList = results.invalid || [];
    const totalRegistered = allValid.length;
    const totalUnregistered = invalidList.length;
    const totalFile = totalNumbers || (totalRegistered + totalUnregistered);

    const tz = allValid.find(x => x.bpTimezone && x.bpTimezone !== '-')?.bpTimezone || 'Asia/Jakarta';

    if (allValid.length + invalidList.length <= 25) {
        const lines = [];
        for (const item of allValid) {
            lines.push(formatSimpleLine(item));
        }
        for (const num of invalidList) {
            lines.push(`+${num} ( - ) ( Tidak Terdaftar )`);
        }
        return `<b>${EMOJIS.DOC} HASIL CEK BIO (MODE SIMPEL)</b>\n\n<blockquote>${lines.join('\n')}\n\nZona Waktu: ${tz}</blockquote>`;
    }

    return `<b>${EMOJIS.DOC} HASIL CEK BIO (MODE SIMPEL)</b>\n\n<blockquote>Total File: ${totalFile} nomor\nTerdaftar: ${totalRegistered} | Tidak Terdaftar: ${totalUnregistered}\nZona Waktu: ${tz}\n\nDetail nomor terlampir pada file txt.</blockquote>`;
}

function buildExtraCaptionSections(results) {
    if (!results.business || results.business.length === 0) return '';
    const { businessTierCounts } = getExtraReportStats(results);
    return `<blockquote>Meta Bisnis (${results.business.length}): Eksklusif ${businessTierCounts.eklusif} | Standar ${businessTierCounts.standart} | Low ${businessTierCounts.low} | Suite ${businessTierCounts.suite} | AI ${businessTierCounts.agentAi}</blockquote>`;
}

const WaManager = {
    formatCekBioCaption,
    formatSimpleCaption,
    generateSimpleReport,
    formatSimpleLine,
    getSimpleTierLabel,
    getExtraReportStats,
    buildExtraCaptionSections,
    sessions,
    getNextAvailableSessionId(userId) {
        const uid = String(userId);
        let id = 1;
        if (sessions.has(uid)) {
            const userSessions = sessions.get(uid);
            while (userSessions.has(id)) {
                id++;
            }
        }
        return id;
    },

    cancelCheckBio(userId) {
        const uid = String(userId);
        cancelFlags.set(uid, true);
        if (userQueues.has(uid)) {
            userQueues.get(uid).length = 0;
        }
                this.clearPendingJob(uid);
    },

    getActiveSessions(userId) {
        const uid = String(userId);
        const active = [];
        if (sessions.has(uid)) {
            for (const [sId, sock] of sessions.get(uid).entries()) {
                const sessionKey = `${uid}_${sId}`;
                if (sessionStatus.get(sessionKey) === 'CONNECTED') {
                    let phone = sessionPhone.get(sessionKey) || 'Terhubung';
                    if (sock && sock.user && sock.user.id) {
                        phone = sock.user.id.split(':')[0].split('@')[0];
                        sessionPhone.set(sessionKey, phone);
                    }
                    active.push({ sessionId: sId, phoneNumber: phone });
                }
            }
        }
        return active;
    },

    getActiveSessionCount(userId) {
        const uid = String(userId);
        if (!sessions.has(uid)) return 0;
        let count = 0;
        for (const [sId, sock] of sessions.get(uid).entries()) {
            if (sessionStatus.get(`${uid}_${sId}`) === 'CONNECTED') count++;
        }
        return count;
    },

    async loadSessions(eventHandler) {
        try {
            if (!fs.existsSync(SESSION_DIR)) return;
            const files = fs.readdirSync(SESSION_DIR);
            const sessionFolders = files.filter(f => f.startsWith('session_') && fs.statSync(path.join(SESSION_DIR, f)).isDirectory());
            if (eventHandler) eventHandler('log', `Menemukan ${sessionFolders.length} sesi tersimpan, reconnecting`);
            for (const folder of sessionFolders) {
                const credsFile = path.join(SESSION_DIR, folder, 'creds.json');
                if (!fs.existsSync(credsFile)) {
                    try { fs.rmSync(path.join(SESSION_DIR, folder), { recursive: true, force: true }); } catch(_) {}
                    continue;
                }
                try {
                    const credsData = JSON.parse(fs.readFileSync(credsFile, 'utf8'));
                    if (!credsData.registered && !credsData.me) {
                        try { fs.rmSync(path.join(SESSION_DIR, folder), { recursive: true, force: true }); } catch(_) {}
                        continue;
                    }
                } catch(_) {}

                const parts = folder.split('_');
                if (parts.length === 3) {
                    const userId = parts[1];
                    const sessionId = parts[2];
                    this.startSession(userId, sessionId, eventHandler).catch(() => {});
                    await delay(1000); 
                }
            }
        } catch (e) {}
    },

    async generateQrBuffer(qrText) {
        return await QRCode.toBuffer(qrText, {
            scale: 8,
            margin: 2,
            color: {
                dark: '#000000',
                light: '#ffffff'
            }
        });
    },

    async startSession(userId, sessionId = 1, eventHandler) {
        const uid = String(userId);
        const sessionName = `session_${uid}_${sessionId}`;
        const authPath = path.join(SESSION_DIR, sessionName);

        try {
            // Clean up any existing socket for this user/session before creating a new one
            if (sessions.has(uid) && sessions.get(uid).has(sessionId)) {
                try {
                    const existingSock = sessions.get(uid).get(sessionId);
                    if (existingSock) {
                        existingSock.ev.removeAllListeners();
                        existingSock.end(undefined);
                    }
                } catch (_) {}
                sessions.get(uid).delete(sessionId);
            }

            const { state, saveCreds } = await useMultiFileAuthState(authPath);
            const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1015901307] }));

            const browser = (baileysPkg.Browsers && baileysPkg.Browsers.ubuntu)
                ? baileysPkg.Browsers.ubuntu('Chrome')
                : (baileysPkg.Browsers && baileysPkg.Browsers.macOS ? baileysPkg.Browsers.macOS('Desktop') : ["Ubuntu", "Chrome", "22.04.4"]);

            const sock = makeWASocket({
                version,
                logger: P({ level: "silent" }),
                printQRInTerminal: false,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, P({ level: "silent" }))
                },
                browser,
                syncFullHistory: false,
                getMessage: async () => undefined,
                connectTimeoutMs: 60000,
                defaultQueryTimeoutMs: 60000,
                keepAliveIntervalMs: 30000,
                markOnlineOnConnect: true,
                generateHighQualityLinkPreview: false
            });

            if (!sessions.has(uid)) sessions.set(uid, new Map());
            sessions.get(uid).set(sessionId, sock);

            const sessionKey = `${uid}_${sessionId}`;
            if (state.creds.me && state.creds.me.id) {
                sessionPhone.set(sessionKey, state.creds.me.id.split(':')[0].split('@')[0]);
            }

            sock.ev.on("connection.update", async (update) => {
                const { connection, lastDisconnect, qr } = update;

                // Ensure event belongs to the active socket for this session
                const activeSock = sessions.get(uid)?.get(sessionId);
                if (activeSock && activeSock !== sock) return;

                if (qr && eventHandler) {
                    eventHandler('qr', uid, sessionId, qr);
                }

                if (connection === "open") {
                    sessionStatus.set(sessionKey, 'CONNECTED');
                    retryCounts.delete(sessionKey);
                    sessionWarmup.set(sessionKey, true);
                    
                    if (sock && sock.user && sock.user.id) {
                        sessionPhone.set(sessionKey, sock.user.id.split(':')[0].split('@')[0]);
                    }

                    if (eventHandler) eventHandler('open', uid, sessionId);

                } else if (connection === "close") {
                    sessionStatus.set(sessionKey, 'DISCONNECTED');
                    const code = lastDisconnect?.error?.output?.statusCode;
                    const reason = lastDisconnect?.error?.message || '';
                    const isHardLogout = code === (DisconnectReason && DisconnectReason.loggedOut) ||
                                         code === (DisconnectReason && DisconnectReason.forbidden) ||
                                         code === 401 || code === 403 || code === 405;
                    const isBanned = reason.includes('banned') || reason.includes('Blocked from connecting');
                    const isRestartRequired = code === (DisconnectReason && DisconnectReason.restartRequired) || code === 515;

                    const credsFile = path.join(authPath, 'creds.json');
                    let hasCreds = false;
                    try {
                        if (fs.existsSync(credsFile)) {
                            const credsData = JSON.parse(fs.readFileSync(credsFile, 'utf8'));
                            if (credsData && (credsData.registered || credsData.me || (credsData.noiseKey && credsData.pairingEphemeralKeyPair))) {
                                hasCreds = true;
                            }
                        }
                    } catch (_) {}

                    const isRegistered = sock.authState?.creds?.registered || !!(sock.user && sock.user.id) || hasCreds;

                    if (eventHandler) {
                        try {
                            eventHandler('close', uid, sessionId, { isRegistered, statusCode: code, reason, isHardLogout, isBanned, isRestartRequired });
                        } catch (_) {}
                    }

                    if (isRestartRequired) {
                        // QR scan or Pairing Code completed! Baileys must restart immediately to complete companion handshake
                        logger.add('WA', `Session ${sessionKey} pairing complete (515 restartRequired). Reconnecting...`);
                        retryCounts.delete(sessionKey);
                        await delay(500);
                        this.startSession(userId, sessionId, eventHandler).catch((err) => {
                            logger.add('ERROR', `Restart failed for session ${sessionKey}: ${err.message}`);
                        });
                    } else if (!isHardLogout && !isBanned) {
                        let attempts = retryCounts.get(sessionKey) || 0;
                        attempts++;
                        retryCounts.set(sessionKey, attempts);

                        const maxAttempts = isRegistered ? 5 : MAX_RETRIES;
                        if (attempts <= maxAttempts) {
                            const backoff = Math.min(1000 * Math.pow(2, Math.min(attempts, 4)), 15000);
                            logger.add('WA', `Session ${sessionKey} closed (code: ${code || '?'}). Reconnecting in ${backoff}ms (attempt ${attempts}/${maxAttempts})...`);
                            await delay(backoff);
                            this.startSession(userId, sessionId, eventHandler).catch(() => {});
                        } else {
                            logger.add('WA', `Session ${sessionKey} exceeded max reconnect attempts (${maxAttempts}). Removing session.`);
                            retryCounts.delete(sessionKey);
                            if (sessions.has(uid) && sessions.get(uid).get(sessionId) === sock) {
                                sessions.get(uid).delete(sessionId);
                            }
                            if (fs.existsSync(authPath)) {
                                try { fs.rmSync(authPath, { recursive: true, force: true }); } catch (_) {}
                            }
                            sessionStatus.set(sessionKey, 'DISCONNECTED');
                            sessionWarmup.delete(sessionKey);
                            sessionPhone.delete(sessionKey);
                        }
                    } else {
                        // Hard logout (401/403/loggedOut) or banned — clean up permanently
                        logger.add('WA', `Session ${sessionKey} permanently closed (logout/banned/code: ${code})`);
                        retryCounts.delete(sessionKey);
                        if (sessions.has(uid) && sessions.get(uid).get(sessionId) === sock) {
                            sessions.get(uid).delete(sessionId);
                        }
                        if (eventHandler && isRegistered) eventHandler('logout', uid, sessionId);
                        if (fs.existsSync(authPath)) {
                            try { fs.rmSync(authPath, { recursive: true, force: true }); } catch (_) {}
                        }
                        sessionStatus.set(sessionKey, 'DISCONNECTED');
                        sessionWarmup.delete(sessionKey);
                        sessionPhone.delete(sessionKey);
                    }
                }
            });

            sock.ev.on("creds.update", saveCreds);

            sock.ev.on("messages.upsert", (m) => {
                m.messages.forEach(msg => {
                    if (processedMessageIds.has(msg.key.id)) return;
                    processedMessageIds.add(msg.key.id);
                    if (processedMessageIds.size > MAX_PROCESSED_IDS) {
                        let i = 0;
                        for (const id of processedMessageIds) {
                            processedMessageIds.delete(id);
                            if (++i > MAX_PROCESSED_IDS / 2) break;
                        }
                    }
                });
            });

            return sock;
        } catch (e) {
            throw e;
        }
    },

    async requestPairing(userId, phoneNumber, sessionId = 1, customCode = null, eventHandler) {
        const uid = String(userId);
        const authPath = path.join(SESSION_DIR, `session_${uid}_${sessionId}`);
        if (sessions.has(uid) && sessions.get(uid).has(sessionId)) {
            try {
                const oldSock = sessions.get(uid).get(sessionId);
                if (oldSock) {
                    oldSock.ev.removeAllListeners();
                    oldSock.end(undefined);
                }
            } catch (_) {}
            sessions.get(uid).delete(sessionId);
        }
        if (fs.existsSync(authPath)) {
            try { fs.rmSync(authPath, { recursive: true, force: true }); } catch (_) {}
        }

        const sock = await this.startSession(userId, sessionId, eventHandler);
        await delay(3000);

        try {
            const cleanNum = phoneNumber.replace(/\D/g, '');
            const sessionKey = `${uid}_${sessionId}`;
            sessionPhone.set(sessionKey, cleanNum);
            
            let finalCode = customCode || "KICENN28";
            const code = await sock.requestPairingCode(cleanNum, finalCode);
            return code;
        } catch (error) {
            throw new Error("Gagal pairing, pastikan nomor benar: " + error.message);
        }
    },

    async requestQr(userId, sessionId = 1, eventHandler) {
        const uid = String(userId);
        const authPath = path.join(SESSION_DIR, `session_${uid}_${sessionId}`);
        if (sessions.has(uid) && sessions.get(uid).has(sessionId)) {
            try {
                const oldSock = sessions.get(uid).get(sessionId);
                if (oldSock) {
                    oldSock.ev.removeAllListeners();
                    oldSock.end(undefined);
                }
            } catch (_) {}
            sessions.get(uid).delete(sessionId);
        }
        if (fs.existsSync(authPath)) {
            try { fs.rmSync(authPath, { recursive: true, force: true }); } catch (_) {}
        }

        const sessionKey = `${uid}_${sessionId}`;
        sessionStatus.set(sessionKey, 'CONNECTING');
        retryCounts.delete(sessionKey);

        const sock = await this.startSession(userId, sessionId, eventHandler);
        return sock;
    },

    checkBio(userId, numbers, speedMode, updateCallback, isResume = false) {
        return new Promise((resolve, reject) => {
            const uid = String(userId);

            if (!sessions.has(uid) || sessions.get(uid).size === 0) {
                return reject(new Error("WhatsApp belum terkoneksi, silakan hubungkan dulu"));
            }

            if (!userQueues.has(uid)) userQueues.set(uid, []);
            userQueues.get(uid).push({
                numbers,
                speedMode,
                updateCallback,
                resolve,
                reject,
                isResume
            });

            processUserQueue(uid);
        });
    },

    getPendingJobs() {
        return Object.values(pendingJobs);
    },

    isSessionReady(userId) {
        const uid = String(userId);
        if (!sessions.has(uid)) return false;
        for (const [sId, sock] of sessions.get(uid).entries()) {
            const sessionKey = `${uid}_${sId}`;
            if (sessionStatus.get(sessionKey) === 'CONNECTED' && sessionWarmup.get(sessionKey)) {
                return true;
            }
        }
        return false;
    },

    isCancelled(userId) {
        return cancelFlags.get(String(userId)) === true;
    },

    clearPendingJob(userId) {
        const uid = String(userId);
        delete pendingJobs[uid];
        saveJobs();
    },

    getSessionStatus(userId) {
        const uid = String(userId);
        if (sessions.has(uid)) {
            for (const [sId, sock] of sessions.get(uid).entries()) {
                if (sessionStatus.get(`${uid}_${sId}`) === 'CONNECTED') return 'CONNECTED';
            }
        }
        return 'DISCONNECTED';
    },

    async logout(userId, specificSessionId = null) {
        const uid = String(userId);
        if (!sessions.has(uid)) return true;

        const sidsToLogout = specificSessionId 
            ? [specificSessionId] 
            : Array.from(sessions.get(uid).keys());

        for (const sId of sidsToLogout) {
            if (sessions.get(uid).has(sId)) {
                const sock = sessions.get(uid).get(sId);
                try { await sock.logout(); } catch(e) {}
                sock.end();
                sessions.get(uid).delete(sId);
            }
            const authPath = path.join(SESSION_DIR, `session_${uid}_${sId}`);
            if (fs.existsSync(authPath)) fs.rmSync(authPath, { recursive: true, force: true });
            sessionStatus.set(`${uid}_${sId}`, 'DISCONNECTED');
            sessionWarmup.delete(`${uid}_${sId}`);
            sessionPhone.delete(`${uid}_${sId}`);
        }
        return true;
    },

    processFile(buffer, fileName) {
        try {
            const ext = (fileName || '').split('.').pop().toLowerCase();
            if (ext === 'txt' || ext === 'csv') {
                return extractNumbers(buffer.toString('utf8'));
            } else if (ext === 'xlsx') {
                const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
                const parts = [];
                for (const sheetName of wb.SheetNames) {
                    const sheet = wb.Sheets[sheetName];
                    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
                    for (const row of rows) {
                        if (Array.isArray(row)) {
                            for (const val of row) {
                                if (val != null) parts.push(String(val));
                            }
                        }
                    }
                }
                return extractNumbers(parts.join('\n'));
            }
            return extractNumbers(buffer.toString('utf8'));
        } catch (e) {
            logger.add('ERROR', `ProcessFile error: ${e.message}`);
            return [];
        }
    },

    extractFromText(text) {
        return extractNumbers(text);
    },

    async generateRemainingFile(remainingNumbers, countryHint = null) {
        try {
            let countryName = "Unknown";
            let firstNum = (remainingNumbers && remainingNumbers.length > 0) ? remainingNumbers[0] : null;
            if (firstNum) {
                const cleanedNum = String(firstNum).replace(/\D/g, '');
                const fetchedCountry = getCountryName(cleanedNum);
                let cleanCountry = fetchedCountry || countryHint || "Unknown";
                if (cleanCountry.includes('</tg-emoji>')) cleanCountry = cleanCountry.split('</tg-emoji>')[1];
                countryName = cleanCountry.replace(/[^a-zA-Z0-9]/g, '');
            }

            const nowJkt   = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Jakarta" }));
            const dateStr  = nowJkt.getFullYear() + String(nowJkt.getMonth()+1).padStart(2,'0') + String(nowJkt.getDate()).padStart(2,'0');
            const timeStr  = String(nowJkt.getHours()).padStart(2,'0') + String(nowJkt.getMinutes()).padStart(2,'0') + String(nowJkt.getSeconds()).padStart(2,'0');
            const fileName = `SisaNomor─BelumDicek_${countryName}_${dateStr}─${timeStr}.txt`;
            const filePath = path.join(SESSION_DIR, fileName);

            const stream = fs.createWriteStream(filePath, { encoding: 'utf8', highWaterMark: 64 * 1024 });
            const writeAsync = async (data) => {
                if (!stream.write(data)) {
                    await new Promise(resolve => stream.once('drain', resolve));
                }
            };

            let buf = '';
            const list = remainingNumbers || [];
            for (let i = 0; i < list.length; i++) {
                const n = String(list[i]).trim();
                if (n) {
                    buf += n + '\n';
                    if (buf.length >= 32768) {
                        await writeAsync(buf);
                        buf = '';
                    }
                }
            }
            if (buf.length > 0) await writeAsync(buf);

            await new Promise((resolve, reject) => {
                stream.end(resolve);
                stream.on('error', reject);
            });

            return { filePath, fileName };
        } catch (e) {
            throw e;
        }
    },

    async generateReport(results) {
    try {
        const totalRegistered = results.business.length + results.private.length + results.repe.length;
        const totalUnregistered = results.invalid.length;
        const totalData = totalRegistered + totalUnregistered;

        const allValid = [...results.repe, ...results.business, ...results.private];
        const withBio    = allValid.filter(x => x.hasBio);
        const noBio      = allValid.filter(x => !x.hasBio);
        const withPpCount  = allValid.filter(x => x.hasPp).length;
        const withCatalog  = allValid.filter(x => x.hasCatalog).length;

        const verifiedList       = allValid.filter(x => x.isVerified);
        const normalBizList      = allValid.filter(x => x.isBusiness && !x.isVerified && !x.isBanned);
        const normalPrivateList  = results.private.filter(x => !x.isBanned);
        const bannedList         = allValid.filter(x => x.isBanned);

        const metaVerifiedCount  = verifiedList.length;
        const normalBizCount     = normalBizList.length;
        const privateCount       = normalPrivateList.length;
        const bannedCount        = bannedList.length;
        const repeCount          = results.repe.length;

        const speedMode = results.meta ? results.meta.speedMode.toUpperCase() : 'NORMAL';
        let durasiStr = '0 Detik';
        if (results.meta && results.meta.durationMs) {
            const durMenit = Math.floor(results.meta.durationMs / 60000);
            const durDetik = Math.floor((results.meta.durationMs % 60000) / 1000);
            durasiStr = durMenit > 0 ? `${durMenit} Menit ${durDetik} Detik` : `${durDetik} Detik`;
        }

        const sekarang = formatWaktuGaul(new Date());

        function getTipeLabel(item) {
            const ai = item.isAgentAi ? ' Agent AI' : '';
            if (item.isVerified || item.metaTier === 'Eksklusif Meta Business' || item.metaTier === 'Eklusif Meta Business' || item.metaTier === 'Exclusive Meta Business') return 'Eksklusif' + ai;
            if (item.metaTier === 'Suite Meta Business') {
                const ig = item.linkedAccounts?.ig ? `@${item.linkedAccounts.ig.handle}` : '';
                return 'Suite' + ig + ai;
            }
            if (item.metaTier === 'Standart Meta Business') return 'Standart' + ai;
            if (item.metaTier === 'Low Meta Business') return 'Low' + ai;
            if (item.isBusiness) return 'Low' + ai;
            if (item.type === 'REPE') return 'REPE' + ai;
            return 'Personal' + ai;
        }

        function entryBlock(item, idx) {
            const tipe = getTipeLabel(item);
            const ppStr = item.hasPp ? 'Ada Foto Profil' : 'Tidak Ada Foto Profil';
            const banStr = item.isBanned ? 'Terbanned / Nonaktif' : 'Aktif';

            let block = `[${idx + 1}] Nomor: +${item.num} (${tipe})\n`;
            block += `Status: ${banStr}\n`;
            block += `Bio: ${item.bio || '-'}\n`;
            block += `Set Bio: ${item.date || '-'}\n`;
            block += `Join Since: ${item.joinSince || '-'}\n`;
            block += `Foto: ${ppStr}\n`;

            if (item.isBusiness) {
                block += `Business Details:\n`;
                block += `├ Name: ${item.bpName || '-'}\n`;
                block += `├ Desc: ${item.descBisnis || '-'}\n`;
                block += `├ Timezone: ${item.bpTimezone || '-'}\n`;
                const kat = item.kategoriBisnis || '-';
                block += `├ Category: ${kat}\n`;
                block += `├ Join Since: ${item.joinSince || '-'}\n`;
                block += `├ Katalog: ${item.katalogText || 'Tidak ada katalog'}\n`;
                if (item.emailBisnis) block += `├ Email: ${item.emailBisnis}\n`;
                if (item.websiteBisnis) block += `├ Website: ${item.websiteBisnis}\n`;
                if (item.alamatBisnis) block += `├ Alamat: ${item.alamatBisnis}\n`;
                if (item.metaTier) block += `├ Meta Tier: ${item.metaTier}\n`;
                if (item.linkedAccounts?.ig) block += `├ IG: @${item.linkedAccounts.ig.handle} (${item.linkedAccounts.ig.followers} followers)\n`;
                if (item.linkedAccounts?.fb) block += `├ FB: ${item.linkedAccounts.fb.name} (${item.linkedAccounts.fb.followers} followers)\n`;
                const bizHoursStr = formatBizHours(item.businessHours, item.bpTimezone && item.bpTimezone !== '-' ? item.bpTimezone : null);
                if (bizHoursStr && bizHoursStr !== '-') block += `└ Jam Operasi: ${bizHoursStr}\n`;
                else block += `└ Cover: -\n`;
            }

            block += `\n`;
            return block;
        }

        const LINE = '──────────────────────────────────────────────────';

        let countryName = "Unknown";
        let firstNum = allValid.length > 0 ? allValid[0].num : (results.invalid.length > 0 ? results.invalid[0] : (results.remainingNumbers?.length > 0 ? results.remainingNumbers[0] : null));
        if (firstNum) {
            const cleanedNum = String(firstNum).replace(/\D/g, '');
            const fetchedCountry = getCountryName(cleanedNum);
            let cleanCountry = fetchedCountry || "Unknown";
            if (cleanCountry.includes('</tg-emoji>')) cleanCountry = cleanCountry.split('</tg-emoji>')[1];
            countryName = cleanCountry.replace(/[^a-zA-Z0-9]/g, '');
        }

        const nowJkt   = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Jakarta" }));
        const dateStr  = nowJkt.getFullYear() + String(nowJkt.getMonth()+1).padStart(2,'0') + String(nowJkt.getDate()).padStart(2,'0');
        const timeStr  = String(nowJkt.getHours()).padStart(2,'0') + String(nowJkt.getMinutes()).padStart(2,'0') + String(nowJkt.getSeconds()).padStart(2,'0');
        const fileTag  = (results.senderLoggedOut || results.isCancelled || (results.remainingNumbers && results.remainingNumbers.length > 0)) ? `Partial_` : ``;
        const fileName = `HasilCekBio─${countryName}Numbers_${fileTag}${dateStr}─${timeStr}.txt`;
        const filePath = path.join(SESSION_DIR, fileName);

        const stream = fs.createWriteStream(filePath, { encoding: 'utf8', highWaterMark: 64 * 1024 });
        const writeAsync = async (data) => {
            if (!stream.write(data)) {
                await new Promise(resolve => stream.once('drain', resolve));
            }
        };

        let header = '';
        if (results.senderLoggedOut) {
            header += `HASIL CEK BIO WHATSAPP (SEBAGIAN - SENDER TERPUTUS/LOGOUT)\n`;
            header += `Status: Terhenti di tengah proses karena sender WhatsApp logout/terputus.\n`;
            header += `Total Nomor Berhasil Dicek: ${totalData}\n`;
            header += `Sisa Nomor Belum Dicek: ${(results.remainingNumbers || []).length}\n`;
            header += `Nomor Terdaftar di WA: ${totalRegistered}\n\n`;
        } else if (results.isCancelled) {
            header += `HASIL CEK BIO WHATSAPP (SEBAGIAN - DIBATALKAN)\n`;
            header += `Status: Dibatalkan oleh pengguna.\n`;
            header += `Total Nomor Berhasil Dicek: ${totalData}\n`;
            header += `Sisa Nomor Belum Dicek: ${(results.remainingNumbers || []).length}\n`;
            header += `Nomor Terdaftar di WA: ${totalRegistered}\n\n`;
        } else {
            header += `HASIL CEK BIO WHATSAPP\n\n`;
            header += `Total Nomor Dicek: ${totalData}\n`;
            header += `Nomor Terdaftar di WA: ${totalRegistered}\n\n`;
        }
        await writeAsync(header);

        const validWithBio    = allValid.filter(x => x.hasBio);
        const validNoBio      = allValid.filter(x => !x.hasBio);

        if (validWithBio.length > 0) {
            await writeAsync(`[ NOMOR DENGAN BIO (${validWithBio.length}) ]\n\n`);
            let buf = '';
            for (let i = 0; i < validWithBio.length; i++) {
                buf += entryBlock(validWithBio[i], i);
                if (buf.length >= 32768) {
                    await writeAsync(buf);
                    buf = '';
                }
            }
            if (buf.length > 0) await writeAsync(buf);
        }

        if (validNoBio.length > 0) {
            await writeAsync(`[ NOMOR TANPA BIO (${validNoBio.length}) ]\n\n`);
            let buf = '';
            for (let i = 0; i < validNoBio.length; i++) {
                buf += entryBlock(validNoBio[i], validWithBio.length + i);
                if (buf.length >= 32768) {
                    await writeAsync(buf);
                    buf = '';
                }
            }
            if (buf.length > 0) await writeAsync(buf);
        }

        await writeAsync(`[ TIDAK TERDAFTAR DI WA (${results.invalid.length}) ]\n\n`);
        if (results.invalid.length > 0) {
            let buf = '';
            for (let i = 0; i < results.invalid.length; i++) {
                buf += `  ${i + 1}. +${results.invalid[i]}\n`;
                if (buf.length >= 32768) {
                    await writeAsync(buf);
                    buf = '';
                }
            }
            if (buf.length > 0) await writeAsync(buf);
            await writeAsync('\n');
        } else {
            await writeAsync(`  (Semua nomor terdaftar di WhatsApp)\n\n`);
        }

        await writeAsync(`${LINE}\nCEK BY @oziwl\n${LINE}`);

        await new Promise((resolve, reject) => {
            stream.end(resolve);
            stream.on('error', reject);
        });

        return { filePath, fileName };
    } catch (e) {
        throw e;
    }
},

    async checkOtpStatus(userId, phoneNumber, count = 1, method = null, onProgress = null, abortSignal = null) {
        const uid = String(userId);
        let targetSock = null;

        if (sessions.has(uid)) {
            for (const [sId, sock] of sessions.get(uid).entries()) {
                if (sessionStatus.get(`${uid}_${sId}`) === 'CONNECTED') {
                    targetSock = sock;
                    break;
                }
            }
        }

        if (!targetSock) {
            for (const [otherUid, userSessions] of sessions.entries()) {
                for (const [sId, sock] of userSessions.entries()) {
                    if (sessionStatus.get(`${otherUid}_${sId}`) === 'CONNECTED') {
                        targetSock = sock;
                        break;
                    }
                }
                if (targetSock) break;
            }
        }

        const ALL_METHODS = ['sms', 'voice', 'wa_old', 'flash', 'email_otp'];
        let methods = method === 'all' ? ALL_METHODS : (method ? [method] : ALL_METHODS.slice(0, 3));
        const MAX_ATTEMPTS = 50;
        const TARGET_WAIT = 24 * 3600;
        const MAX_SKIP_WAIT = 120;

        async function detectAvailableMethods(sock) {
            if (!_dannteamPkg) {
                const available = [];
                for (const m of methods) {
                    const r = await cekOtpRealtimeDirect(sock, phoneNumber, m);
                    if (!r.includes('BLOCK') && !r.includes('BANNED') && !r.includes('DISABLED')) available.push(m);
                }
                if (available.length === 0) available.push(methods[0]);
                return available;
            }
            const cleanD = phoneNumber.replace(/\D/g, '');
            const { cc: _dcc, inNumber: _din } = parseCcAndIn(cleanD);
            const available = [];
            let waOldCbs = false;
            for (const m of methods) {
                const raw = await _directWaHit(_dcc, _din, m);
                const cls = _classifyWaResp(raw, m);
                if (cls.t === 'cbs' && m === 'wa_old') waOldCbs = true;
                if (cls.t === 'ready' || cls.t === 'cooldown' || cls.t === 'no_routes') available.push(m);
                await new Promise(r => setTimeout(r, 400));
            }
            if (available.length === 0) {
                available.push(waOldCbs ? 'sms' : (methods[0] || 'sms'));
            }
            return available;
        }

        function parseCooldown(msg) {
            const s = msg.match(/Cooldown\s*\((\d+)\s*Detik/);
            if (s) {
                const detik = parseInt(s[1]);
                const j = msg.match(/Cooldown\s*\((\d+)\s*Jam/);
                const m = msg.match(/Cooldown\s*\((\d+)\s*Menit/);
                let total = detik;
                if (m) total += parseInt(m[1]) * 60;
                if (j) total += parseInt(j[1]) * 3600;
                return total;
            }
            const j = msg.match(/Cooldown\s*\((\d+)\s*Jam/);
            if (j) return parseInt(j[1]) * 3600;
            const m = msg.match(/Cooldown\s*\((\d+)\s*Menit/);
            if (m) return parseInt(m[1]) * 60;
            return 0;
        }

        async function doLoop(sock) {
            await simulateHumanInteraction();
            const avail = await detectAvailableMethods(sock);
            methods = avail;
            const results = [];
            const methodState = {};
            for (const m of methods) {
                methodState[m] = { blocked: false, done: false, lastWait: 0 };
            }
            let realAttempts = 0;
            const startTime = Date.now();

            for (let i = 0; (Date.now() - startTime) < 86400000 * 2; i++) {
                if (abortSignal && abortSignal.aborted) {
                    results.push({ method: 'system', text: 'Proses dihentikan oleh user', wait: 0 });
                    break;
                }

                const m = methods[i % methods.length];
                const state = methodState[m];
                if (state.done || state.blocked) {
                    if (methods.every(m2 => methodState[m2].done || methodState[m2].blocked)) break;
                    await sleepRandom(100);
                    continue;
                }

                const r = await cekOtpRealtimeDirect(sock, phoneNumber, m);
                const parsedWait = parseCooldown(r);
                results.push({ method: m, text: r, wait: parsedWait });

                if (r.includes('BANNED') || r.includes('Terbanned') || r.includes('TERBLOCK') || r.includes('DISABLED')) {
                    state.blocked = true;
                    if (onProgress) onProgress({ attempt: realAttempts + 1, total: MAX_ATTEMPTS, method: m, result: r, wait: 0, methods, allResults: results, methodState, status: 'blocked' });
                    if (methods.every(m2 => methodState[m2].done || methodState[m2].blocked)) break;
                    await sleepRandom(100);
                    continue;
                }

                const wait = parsedWait;

                if (wait >= TARGET_WAIT) {
                    state.done = true;
                    realAttempts++;
                    if (onProgress) onProgress({ attempt: realAttempts, total: MAX_ATTEMPTS, method: m, result: r, wait, methods, allResults: results, methodState, status: 'done' });
                    if (methods.every(m2 => methodState[m2].done || methodState[m2].blocked)) break;
                    await sleepRandom(100);
                    continue;
                }

                const allDone = methods.every(m2 => methodState[m2].done || methodState[m2].blocked);
                if (allDone) break;

                if (wait > MAX_SKIP_WAIT) {
                    const remaining = methods.filter(m2 => !methodState[m2].done && !methodState[m2].blocked);
                    const allSkip = remaining.every(m2 => {
                        const idx = results.filter(x => x.method === m2).pop();
                        return idx ? idx.wait > MAX_SKIP_WAIT : false;
                    });
                    if (allSkip && remaining.length > 0) {
                        const minWait = Math.min(...remaining.map(m2 => {
                            const last = results.filter(x => x.method === m2).pop();
                            return last && last.wait > 0 ? last.wait : MAX_SKIP_WAIT + 1;
                        }));
                        const bestMethod = remaining.find(m2 => {
                            const last = results.filter(x => x.method === m2).pop();
                            return last && last.wait === minWait;
                        });
                        const waitSec = Math.min(minWait + 5, 600);
                        if (onProgress) onProgress({ attempt: realAttempts + 1, total: MAX_ATTEMPTS, method: m, result: r, wait: minWait, methods, allResults: results, methodState, status: 'wait_all' });
                        await sleepRandom(waitSec * 1000);
                        if (bestMethod) {
                            const idx = methods.indexOf(bestMethod);
                            if (idx >= 0) i = idx + methods.length * (Math.floor(i / methods.length) + 1) - 1;
                        }
                    } else {
                        if (onProgress) onProgress({ attempt: realAttempts + 1, total: MAX_ATTEMPTS, method: m, result: r, wait, methods, allResults: results, methodState, status: 'skip' });
                        await sleepRandom(3000);
                    }
                    continue;
                }

                realAttempts++;
                if (onProgress) onProgress({ attempt: realAttempts, total: MAX_ATTEMPTS, method: m, result: r, wait, methods, allResults: results, methodState, status: 'wait' });

                if (wait > 0) {
                    await sleepRandom((wait + 2) * 1000);
                } else {
                    await sleepRandom(2000);
                }
            }
            return results;
        }

        if (!targetSock) {
            if (count <= 1) return await cekOtpRealtimeDirect(null, phoneNumber, method || 'sms');
            return await doLoop(null);
        }
        if (count <= 1) {
            return await cekOtpRealtimeDirect(targetSock, phoneNumber, method || 'sms');
        }
        return await doLoop(targetSock);
    },
    
    
    async detectOtpRaw(phoneNumber) {
        const cleanNum = phoneNumber.replace(/\D/g, '');
        const { cc, inNumber } = parseCcAndIn(cleanNum);

        const raw = await _directWaHit(cc, inNumber, null, 'exist');
        const cls = _classifyWaResp(raw, 'sms');

        if (cls.t === 'banned') {
            return { type: 'banned', bannedVt: cls.vt || '', mainWait: 0, mainWaitFmt: '', waits: {}, waitsFmt: {} };
        }

        if (cls.t === 'ready') {
            return { type: 'ready', mainWait: 0, mainWaitFmt: '', waits: {}, waitsFmt: {} };
        }

        if (cls.t === 'cooldown' || cls.t === 'no_routes') {
            const w = cls.waits || {};
            const smsWait = w.sms || cls.wait || cls.retryAfter || 0;
            const mainWait = smsWait || Math.min(...Object.values(w).filter(v => v > 0).concat([0]));
            const waitsFmt = {};
            if (smsWait > 0) waitsFmt['sms'] = _fmtSec(smsWait);
            return {
                type: 'cooldown',
                mainWait,
                mainWaitFmt: mainWait > 0 ? _fmtSec(mainWait) : '',
                waits: smsWait > 0 ? { sms: smsWait } : {},
                waitsFmt
            };
        }

        return { type: 'cooldown', mainWait: 0, mainWaitFmt: '', waits: {}, waitsFmt: {} };
    },

    async sendOtpWithRetry(userId, phoneNumber, method, maxAttempts = 5, onProgress = null, abortSignal = null) {
        const uid = String(userId);
        let sock = null;

        if (sessions.has(uid)) {
            for (const [sId, s] of sessions.get(uid).entries()) {
                if (sessionStatus.get(`${uid}_${sId}`) === 'CONNECTED') { sock = s; break; }
            }
        }
        if (!sock) {
            for (const [oUid, userSessions] of sessions.entries()) {
                for (const [sId, s] of userSessions.entries()) {
                    if (sessionStatus.get(`${oUid}_${sId}`) === 'CONNECTED') { sock = s; break; }
                }
                if (sock) break;
            }
        }

        const waitFieldMap = {
            'sms':       'sms_wait',
            'voice':     'voice_wait',
            'wa_old':    'wa_old_wait',
            'flash':     'flash_wait',
            'email_otp': 'email_otp_wait'
        };

        async function callWaEndpoint(m) {
            const clean = phoneNumber.replace(/\D/g, '');
            const { cc, inNumber } = parseCcAndIn(clean);
            const mcc = getMccForCc(cc);

            if (_dannteamPkg) {
                try {
                    const data = await _directWaHit(cc.replace('+','').trim(), inNumber.replace(/[^\d]/g,''), m);
                    return parseWaCodeResponse(m, data);
                } catch (e) {
                    if (e?.response?.data) return parseWaCodeResponse(m, e.response.data);
                    return { waitSec: 30, sent: false, blocked: false, banned: false, disabled: false, reason: 'network_error', raw: null };
                }
            }

            if (sock) {
                const regFunc = sock?.requestRegistrationCode || sock?.register;
                if (typeof regFunc === 'function') {
                    try {
                        const data = await regFunc.call(sock, {
                            phoneNumber: clean,
                            phoneNumberCountryCode: cc,
                            phoneNumberNationalNumber: inNumber,
                            phoneNumberMobileCountryCode: mcc.mcc,
                            phoneNumberMobileNetworkCode: mcc.mnc,
                            method: m
                        });
                        return parseWaCodeResponse(m, data);
                    } catch (e) {
                        const reason = String(e?.reason || e?.data?.reason || e?.message || '');
                        if (reason.includes('banned')) return { waitSec: 0, sent: false, blocked: true, banned: true, disabled: false, reason, raw: null };
                        if (reason.includes('blocked')) return { waitSec: 0, sent: false, blocked: true, banned: false, disabled: false, reason, raw: null };
                        const matchSec = reason.match(/(\d+)/);
                        return { waitSec: matchSec ? Number(matchSec[1]) : 60, sent: false, blocked: false, banned: false, disabled: false, reason, raw: null };
                    }
                }
            }

            return { waitSec: 60, sent: false, blocked: false, banned: false, disabled: false, reason: 'no_method_available', raw: null };
        }

        function parseWaCodeResponse(m, data) {
            if (!data || typeof data !== 'object') {
                return { waitSec: 30, sent: false, blocked: false, banned: false, disabled: false, reason: 'empty_response', raw: data };
            }
            const reason = String(data.reason || '').toLowerCase();
            const status = String(data.status || '').toLowerCase();

            if (reason.includes('banned') || reason.includes('blocked')) {
                if (data.appeal_token || data.in_app_ban_appeal || data.violation_type) {
                    return { waitSec: 0, sent: false, blocked: true, banned: true, disabled: false, reason: 'banned_violation' + (data.violation_type ? ':' + data.violation_type : ''), raw: data };
                }

                if (data.custom_block_screen) {
                    const cbsStr = typeof data.custom_block_screen === 'object'
                        ? JSON.stringify(data.custom_block_screen).toLowerCase()
                        : String(data.custom_block_screen || '').toLowerCase();
                    const isWaBusiness = cbsStr.includes('business') || cbsStr.includes('wa_business');
                    return { waitSec: 0, sent: false, blocked: !isWaBusiness, banned: false, disabled: false, reason: isWaBusiness ? 'wa_business_account' : 'login_not_available', raw: data };
                }

                if (reason.includes('banned'))
                    return { waitSec: 0, sent: false, blocked: true, banned: true, disabled: false, reason: data.reason, raw: data };
                return { waitSec: 0, sent: false, blocked: true, banned: false, disabled: false, reason: data.reason, raw: data };
            }
            
            if (reason.includes('_disabled') || reason === 'flash_disabled')
                return { waitSec: 0, sent: false, blocked: false, banned: false, disabled: true, reason: data.reason, raw: data };

            if (reason === 'no_routes')
                return { waitSec: 0, sent: false, blocked: false, banned: false, disabled: true, reason: 'no_routes', raw: data };

            if (reason === 'bad_param')
                return { waitSec: 0, sent: false, blocked: false, banned: false, disabled: true, reason: 'method_not_supported', raw: data };

            const specificField = waitFieldMap[m];
            let waitSec = 0;
            if (specificField && Number(data[specificField]) > 0) {
                waitSec = Number(data[specificField]);
            } else if (Number(data.retry_after) > 0) {
                waitSec = Number(data.retry_after);
            } else if (m === 'sms' && Number(data.send_sms_wait) > 0) {
                waitSec = Number(data.send_sms_wait);
            }

            const sent = status === 'sent' || status === 'ok' || (status !== 'fail' && !reason);
            return {
                waitSec,
                sent,
                blocked: false,
                banned: false,
                disabled: false,
                reason: data.reason || (sent ? 'ok' : 'cooldown'),
                raw: data,
                fallbackMethods: data.fallback_methods || []
            };
        }

        const MAX = Math.max(1, maxAttempts);
        const results = [];

        for (let attempt = 1; attempt <= MAX; attempt++) {
            if (abortSignal?.aborted) {
                results.push({ attempt, status: 'aborted', waitSec: 0, reason: 'user_stopped', sent: false });
                break;
            }

            if (onProgress) onProgress({ attempt, maxAttempts: MAX, status: 'sending', method, results });

            await sleepRandom(1200); 

            const r = await callWaEndpoint(method);
            results.push({ attempt, ...r });

            const statusStr = r.sent ? 'sent'
                : (r.banned || r.blocked) ? 'blocked'
                : r.disabled ? 'disabled'
                : 'cooldown';

            if (onProgress) onProgress({ attempt, maxAttempts: MAX, status: statusStr, method, waitSec: r.waitSec, reason: r.reason, results });

            if (r.banned || r.blocked || r.disabled) break;
            if (attempt >= MAX) break;

            const cooldownSec = r.waitSec > 0 ? r.waitSec + 3 : 5;
            const deadline = Date.now() + cooldownSec * 1000;

            while (Date.now() < deadline) {
                if (abortSignal?.aborted) break;
                const remaining = Math.ceil((deadline - Date.now()) / 1000);
                if (onProgress) onProgress({ attempt, maxAttempts: MAX, status: 'waiting', method, waitSec: remaining, results });
                await new Promise(res => setTimeout(res, Math.min(5000, Math.max(100, deadline - Date.now()))));
            }

            if (abortSignal?.aborted) {
                results.push({ attempt: attempt + 1, status: 'aborted', waitSec: 0, reason: 'user_stopped', sent: false });
                break;
            }
        }

        return results;
    },

    async detectSmsVoiceStatus(phoneNumber) {
        const cleanNum = phoneNumber.replace(/\D/g, '');
        const { cc, inNumber } = parseCcAndIn(cleanNum);
        const out = { banned: false, bannedVt: null, sms: null, wa_old: null, fallbackMethods: [] };

        const rawSms = await _directWaHit(cc, inNumber, null, 'exist').catch(() => null);

        if (rawSms && Array.isArray(rawSms.fallback_methods)) {
            out.fallbackMethods = rawSms.fallback_methods;
        }

        function classifyMethod(raw, method) {
            const cls = _classifyWaResp(raw, method);
            if (cls.t === 'ready')    return { status: 'ready',   waitSec: 0, waitFmt: '' };
            if (cls.t === 'banned')   return { status: 'banned',  waitSec: 0, waitFmt: '' };
            if (cls.t === 'cooldown') {
                const w       = cls.waits || {};
                const rawWait = raw ? Number(raw[method + '_wait'] || raw['wa_old_wait'] || 0) : 0;
                if (rawWait === -1) return { status: 'not_available', waitSec: 0, waitFmt: '' };
                const wait = w[method] || cls.wait || 0;
                return { status: 'cooldown', waitSec: wait, waitFmt: wait > 0 ? _fmtSecLower(wait) : 'cooldown' };
            }
            if (cls.t === 'cbs') {
                const cbsStr = raw?.custom_block_screen
                    ? JSON.stringify(raw.custom_block_screen).toLowerCase() : '';
                const isBiz = cbsStr.includes('whatsapp business') || cbsStr.includes('wa_business') ||
                              cbsStr.includes('unduh whatsapp') || cbsStr.includes('whatsapp.com/download');
                return { status: isBiz ? 'blocked_biz' : 'blocked', waitSec: 0, waitFmt: '' };
            }
            if (cls.t === 'no_routes') {
                const wait = Number(raw?.retry_after || 0);
                return { status: 'no_routes', waitSec: wait, waitFmt: wait > 0 ? _fmtSecLower(wait) : '' };
            }
            if (cls.t === 'disabled') return { status: 'blocked', waitSec: 0, waitFmt: '' };
            return { status: 'unknown', waitSec: 0, waitFmt: '' };
        }

        const clsSms = _classifyWaResp(rawSms, 'sms');
        if (clsSms.t === 'banned') {
            out.banned   = true;
            out.bannedVt = clsSms.vt || '';
            return out;
        }

        out.sms = classifyMethod(rawSms, 'sms');

        if (out.sms?.status === 'no_routes') {
            const rawVoice = await _directWaHit(cc, inNumber, 'voice').catch(() => null);
            if (rawVoice) {
                const clsVoice = _classifyWaResp(rawVoice, 'voice');
                if (clsVoice.t === 'ready' || clsVoice.t === 'cooldown') {
                   
                    const voiceWait = clsVoice.waits?.voice || clsVoice.wait || Number(rawVoice.voice_wait || rawVoice.retry_after || 0);
                    out.sms = {
                        status:  'has_voice',
                        waitSec: voiceWait,
                        waitFmt: voiceWait > 0 ? _fmtSecLower(voiceWait) : ''
                    };
                }
            }
        }

        const isWaOldEligible = (
            rawSms?.wa_old_eligible === 1 ||
            rawSms?.wa_old_eligible === '1' ||
            rawSms?.wa_old_eligible === true ||
            (Array.isArray(rawSms?.recommended_method) && rawSms.recommended_method.includes('wa_old')) ||
            (rawSms?.wa_old_length && Number(rawSms.wa_old_length) > 0 && rawSms?.wa_old_eligible !== 0)
        ) && (rawSms?.wa_old_wait !== -1 && rawSms?.wa_old_wait !== '-1');

        const waOldWaitRaw = rawSms ? Number(rawSms.wa_old_wait ?? 0) : 0;
        if (!isWaOldEligible || waOldWaitRaw === -1) {
            out.wa_old = { status: 'not_available', waitSec: 0, waitFmt: '' };
        } else if (waOldWaitRaw > 0) {
            out.wa_old = { status: 'cooldown', waitSec: waOldWaitRaw, waitFmt: _fmtSecLower(waOldWaitRaw) };
        } else {
            out.wa_old = { status: 'ready', waitSec: 0, waitFmt: '' };
        }

        return out;
    },

    async detectBulkSmsVoice(numbers, progressCb = null) {
        const results = new Array(numbers.length);
        let done = 0;
        let i = 0;
        while (i < numbers.length) {         
            const BATCH = Math.floor(Math.random() * (200 - 100 + 1)) + 100;
            const chunk = numbers.slice(i, i + BATCH);
            const chunkResults = await Promise.all(chunk.map(async (num) => {
                try {
                    const status = await this.detectSmsVoiceStatus(num);
                    return { number: num, ...status };
                } catch (e) {
                    return { number: num, banned: false, sms: { status: 'error' }, wa_old: null, fallbackMethods: [] };
                }
            }));
            for (let j = 0; j < chunkResults.length; j++) {
                results[i + j] = chunkResults[j];
            }
            done += chunk.length;
            if (progressCb) progressCb(done, numbers.length);
            
            i += chunk.length;

            if (i < numbers.length) {
                await new Promise(resolve => setTimeout(resolve, 200));
            }
        }
        return results;
    },

    generateDetectReport(results, meta = {}) {
        const stamp = Date.now();
        const fileName = `HasilDetect_${stamp}.txt`;
        const filePath = path.join(SESSION_DIR, fileName);

        const total    = results.length;
        const banned   = results.filter(r => r.banned).length;
        const smsReady = results.filter(r => !r.banned && r.sms?.status === 'ready').length;
        const smsVoice = results.filter(r => !r.banned && r.sms?.status === 'has_voice').length;
        const smsCd    = results.filter(r => !r.banned && r.sms?.status === 'cooldown').length;
        const smsNoR   = results.filter(r => !r.banned && r.sms?.status === 'no_routes').length;
        const smsBlk   = results.filter(r => !r.banned && (r.sms?.status === 'blocked' || r.sms?.status === 'blocked_biz')).length;

        const now = new Date();
        const tgl = `${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()}, ` +
            `${String(now.getHours()).padStart(2,'0')}.${String(now.getMinutes()).padStart(2,'0')}.${String(now.getSeconds()).padStart(2,'0')}`;

        const sep = '══════════════════════════════════════';
        const lines = [
            sep,
            '  HASIL CEK DETECT OTP (SMS + VOICE)',
            sep,
            `Tanggal       : ${tgl}`,
            `Total Nomor   : ${total}`,
            '',
            '[ RINGKASAN ]',
            `  NO LIMIT   : ${smsReady}   ← SMS OTP bisa dikirim`,
            `  HAS VOICE  : ${smsVoice}   ← SMS no route, tapi voice/call OTP bisa!`,
            `  COOLDOWN   : ${smsCd}`,
            `  NO ROUTES  : ${smsNoR}   ← SMS & voice keduanya no route`,
            `  DIBLOKIR   : ${smsBlk}`,
            `  BANNED     : ${banned}`,
            `  BERPOTENSI : ${smsReady + smsVoice}   (NO LIMIT + HAS VOICE)`,
            '',
            ` by : @KicenXensai`,
            `bot : ${meta.botUsername ? '@' + meta.botUsername : 'N/A'}`,
            '',
            sep,
            'DETAIL PER NOMOR',
            sep,
            '',
        ];


        function labelStatus(s) {
            if (!s) return 'TIDAK DIKETAHUI';
            if (s.status === 'ready')         return 'NO LIMIT';
            if (s.status === 'has_voice')     return 'HAS VOICE' + (s.waitFmt ? ` (cd: ${s.waitFmt})` : ' (voice ready)');
            if (s.status === 'cooldown')      return `COOLDOWN ${s.waitFmt || ''}`.trim();
            if (s.status === 'no_routes')     return 'NO ROUTES' + (s.waitFmt ? ` (retry ${s.waitFmt})` : '');
            if (s.status === 'blocked')       return 'DIBLOKIR';
            if (s.status === 'blocked_biz')   return 'DIBLOKIR (WA Business)';
            if (s.status === 'not_available') return 'TIDAK TERSEDIA';
            if (s.status === 'error')         return 'ERROR';
            return s.status.toUpperCase();
        }

        for (const r of results) {
            if (r.banned) {
                lines.push(`+${r.number} → BANNED${r.bannedVt ? ' (' + r.bannedVt + ')' : ''}`);
            } else {
                lines.push(`+${r.number}`);
                lines.push(`  SMS : ${labelStatus(r.sms)}`);
            }
            lines.push('');
        }

        fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
        return { filePath, fileName };
    },

    async detectSmsOnly(phoneNumber) {
        const cleanNum = phoneNumber.replace(/\D/g, '');
        const { cc, inNumber } = parseCcAndIn(cleanNum);
        const raw = await _directWaHit(cc, inNumber, null, 'exist').catch(() => null);
        if (!raw) return { banned: false, smsStatus: 'error', smsSec: 0, smsFmt: '' };
        const cls = _classifyWaResp(raw, 'sms');
        if (cls.t === 'banned') return { banned: true, bannedVt: cls.vt || '', smsStatus: 'banned', smsSec: 0, smsFmt: '' };
        if (cls.t === 'cbs')    return { banned: true, bannedVt: '',          smsStatus: 'blocked', smsSec: 0, smsFmt: '' };
        const smsWait = Number(raw.sms_wait || raw.send_sms_wait || raw.retry_after || 0);
        if (cls.t === 'ready')    return { banned: false, smsStatus: 'ready',    smsSec: 0,       smsFmt: '' };
        if (cls.t === 'cooldown') return { banned: false, smsStatus: 'cooldown', smsSec: smsWait, smsFmt: smsWait > 0 ? _fmtSecLower(smsWait) : 'cooldown' };
        if (cls.t === 'no_routes') return { banned: false, smsStatus: 'no_routes', smsSec: 0, smsFmt: '' };
        return { banned: false, smsStatus: cls.t || 'unknown', smsSec: 0, smsFmt: '' };
    },

    async detectBulkSmsOnly(numbers, progressCb = null) {
        const results = new Array(numbers.length);
        let i = 0, done = 0;
        while (i < numbers.length) {
            const BATCH = Math.floor(Math.random() * (200 - 100 + 1)) + 100;
            const chunk = numbers.slice(i, i + BATCH);
            const chunkResults = await Promise.all(chunk.map(async (num) => {
                try   { const s = await this.detectSmsOnly(num); return { number: num, ...s }; }
                catch { return { number: num, banned: false, smsStatus: 'error', smsSec: 0, smsFmt: '' }; }
            }));
            for (let j = 0; j < chunkResults.length; j++) results[i + j] = chunkResults[j];
            done += chunk.length;
            if (progressCb) progressCb(done, numbers.length);
            i += chunk.length;
            if (i < numbers.length) await new Promise(r => setTimeout(r, 200));
        }
        return results;
    },

    generateDetectSmsReport(results, meta = {}) {
        const stamp = Date.now();
        const fileName = `HasilDetectSMS_${stamp}.txt`;
        const filePath = path.join(SESSION_DIR, fileName);
        const total    = results.length;
        const banned   = results.filter(r => r.banned).length;
        const ready    = results.filter(r => !r.banned && r.smsStatus === 'ready').length;
        const cooldown = results.filter(r => !r.banned && r.smsStatus === 'cooldown').length;
        const noRoutes = results.filter(r => !r.banned && r.smsStatus === 'no_routes').length;
        const blocked  = results.filter(r => !r.banned && r.smsStatus === 'blocked').length;
        const now = new Date();
        const tgl = `${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()}, ` +
            `${String(now.getHours()).padStart(2,'0')}.${String(now.getMinutes()).padStart(2,'0')}.${String(now.getSeconds()).padStart(2,'0')}`;
        const sep = '══════════════════════════════════════';
        const lines = [
            sep, '  HASIL CEK DETECT SMS ONLY', sep,
            `Tanggal       : ${tgl}`, `Total Nomor   : ${total}`, '',
            '[ RINGKASAN ]',
            `  READY      : ${ready}   ← SMS OTP bisa dikirim sekarang`,
            `  COOLDOWN   : ${cooldown}`,
            `  NO ROUTES  : ${noRoutes}`,
            `  DIBLOKIR   : ${blocked}`,
            `  BANNED     : ${banned}`,
            '', ` by : @KicenXensai`,
            `bot : ${meta.botUsername ? '@' + meta.botUsername : 'N/A'}`,
            '', sep, 'DETAIL PER NOMOR', sep, '',
        ];
        for (const r of results) {
            if (r.banned) {
                lines.push(`+${r.number} → BANNED${r.bannedVt ? ' (' + r.bannedVt + ')' : ''}`);
            } else {
                lines.push(`+${r.number}`);
                let smsLabel = 'TIDAK DIKETAHUI';
                if (r.smsStatus === 'ready')    smsLabel = 'READY — bisa kirim sekarang';
                if (r.smsStatus === 'cooldown') smsLabel = `COOLDOWN${r.smsFmt ? ' — sisa ' + r.smsFmt : ''}`;
                if (r.smsStatus === 'blocked')  smsLabel = 'DIBLOKIR';
                if (r.smsStatus === 'no_routes') smsLabel = 'NO ROUTES';
                if (r.smsStatus === 'error')    smsLabel = 'ERROR';
                lines.push(`  SMS : ${smsLabel}`);
            }
            lines.push('');
        }
        fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
        return { filePath, fileName };
    },

    async detectFullAllMethods(phoneNumber) {
        const cleanNum = phoneNumber.replace(/\D/g, '');
        const { cc, inNumber } = parseCcAndIn(cleanNum);
        const out = {
            banned: false, bannedVt: null,
            sms: null, voice: null, flash: null,
            device: null, emailOtp: null, silentAuth: null,
            fallbackMethods: [],
        };

        const rawSms = await _directWaHit(cc, inNumber, null, 'exist').catch(() => null);
        if (!rawSms) { out.sms = { status: 'error', waitSec: 0, waitFmt: '' }; return out; }
        if (Array.isArray(rawSms.fallback_methods)) out.fallbackMethods = rawSms.fallback_methods;

        const clsSms = _classifyWaResp(rawSms, 'sms');
        if (clsSms.t === 'banned') { out.banned = true; out.bannedVt = clsSms.vt || ''; return out; }
        if (clsSms.t === 'cbs')    { out.banned = true; return out; }

        // SMS
        const smsWait = Number(rawSms.sms_wait || rawSms.send_sms_wait || rawSms.retry_after || 0);
        if (clsSms.t === 'ready')    out.sms = { status: 'ready',    waitSec: 0,       waitFmt: '' };
        else if (clsSms.t === 'cooldown') out.sms = { status: 'cooldown', waitSec: smsWait, waitFmt: smsWait > 0 ? _fmtSecLower(smsWait) : 'cooldown' };
        else if (clsSms.t === 'no_routes') out.sms = { status: 'no_routes', waitSec: 0, waitFmt: '' };
        else out.sms = { status: clsSms.t || 'unknown', waitSec: 0, waitFmt: '' };

        const isWaOldEligible = (
            rawSms?.wa_old_eligible === 1 ||
            rawSms?.wa_old_eligible === '1' ||
            rawSms?.wa_old_eligible === true ||
            (Array.isArray(rawSms?.recommended_method) && rawSms.recommended_method.includes('wa_old')) ||
            (rawSms?.wa_old_length && Number(rawSms.wa_old_length) > 0 && rawSms?.wa_old_eligible !== 0)
        ) && (rawSms?.wa_old_wait !== -1 && rawSms?.wa_old_wait !== '-1');

        const waOldRaw = Number(rawSms.wa_old_wait ?? 0);
        if (!isWaOldEligible || waOldRaw === -1) out.device = { status: 'n/a',      waitSec: 0,          waitFmt: '' };
        else if (waOldRaw > 0)  out.device = { status: 'cooldown', waitSec: waOldRaw,   waitFmt: _fmtSecLower(waOldRaw) };
        else                    out.device = { status: 'ready',    waitSec: 0,          waitFmt: '' };

        const emailRaw = Number(rawSms.email_otp_wait ?? -1);
        if (emailRaw === -1)    out.emailOtp = { status: 'n/a',      waitSec: 0,         waitFmt: '' };
        else if (emailRaw > 0)  out.emailOtp = { status: 'cooldown', waitSec: emailRaw,  waitFmt: _fmtSecLower(emailRaw) };
        else                    out.emailOtp = { status: 'ready',    waitSec: 0,         waitFmt: '' };

        const rawFlash = await _directWaHit(cc, inNumber, 'flash').catch(() => null);
        if (rawFlash) {
            const clsF = _classifyWaResp(rawFlash, 'flash');
            const fw = Number(rawFlash.flash_wait || rawFlash.retry_after || 0);
            if (clsF.t === 'ready')         out.flash = { status: 'ready',    waitSec: 0,  waitFmt: '' };
            else if (clsF.t === 'cooldown') out.flash = { status: 'cooldown', waitSec: fw, waitFmt: fw > 0 ? _fmtSecLower(fw) : 'cooldown' };
            else if (clsF.t === 'no_routes' || clsF.t === 'disabled') out.flash = { status: 'no_routes', waitSec: 0, waitFmt: '' };
            else if (clsF.t === 'banned' || clsF.t === 'cbs') out.flash = { status: 'blocked', waitSec: 0, waitFmt: '' };
            else out.flash = { status: clsF.t || 'unknown', waitSec: 0, waitFmt: '' };
        } else { out.flash = { status: 'error', waitSec: 0, waitFmt: '' }; }

        const rawSilent = await _directWaHit(cc, inNumber, 'silent_auth').catch(() => null);
        if (rawSilent) {
            const clsS = _classifyWaResp(rawSilent, 'silent_auth');
            if (clsS.t === 'ready' || rawSilent.status === 'sent') out.silentAuth = { status: 'ready',    waitSec: 0, waitFmt: '' };
            else if (clsS.t === 'cbs' || clsS.t === 'banned')      out.silentAuth = { status: 'blocked',  waitSec: 0, waitFmt: '' };
            else if (clsS.t === 'no_routes')                        out.silentAuth = { status: 'no_routes', waitSec: 0, waitFmt: '' };
            else out.silentAuth = { status: clsS.t || 'unknown', waitSec: 0, waitFmt: '' };
        } else { out.silentAuth = { status: 'error', waitSec: 0, waitFmt: '' }; }

        const voiceWait = Number(rawSms.voice_wait || 0);
        if (clsSms.t === 'no_routes') {
            const rawVoice = await _directWaHit(cc, inNumber, 'voice').catch(() => null);
            if (rawVoice) {
                const clsV = _classifyWaResp(rawVoice, 'voice');
                const vw = Number(rawVoice.voice_wait || rawVoice.retry_after || 0);
                if (clsV.t === 'ready')         out.voice = { status: 'ready',    waitSec: 0,  waitFmt: '' };
                else if (clsV.t === 'cooldown') out.voice = { status: 'cooldown', waitSec: vw, waitFmt: vw > 0 ? _fmtSecLower(vw) : 'cooldown' };
                else if (clsV.t === 'no_routes') out.voice = { status: 'no_routes', waitSec: 0, waitFmt: '' };
                else out.voice = { status: clsV.t || 'unknown', waitSec: 0, waitFmt: '' };
            } else { out.voice = { status: 'error', waitSec: 0, waitFmt: '' }; }
        } else {
            if (voiceWait > 0) out.voice = { status: 'cooldown', waitSec: voiceWait, waitFmt: _fmtSecLower(voiceWait) };
            else out.voice = { status: 'ready', waitSec: 0, waitFmt: '' };
        }

        return out;
    },

    async detectBulkFullAllMethods(numbers, progressCb = null) {
        const results = new Array(numbers.length);
        let i = 0, done = 0;
        while (i < numbers.length) {
            const BATCH = Math.floor(Math.random() * (8 - 4 + 1)) + 4;
            const chunk = numbers.slice(i, i + BATCH);
            const chunkResults = await Promise.all(chunk.map(async (num) => {
                try   { const s = await this.detectFullAllMethods(num); return { number: num, ...s }; }
                catch { return { number: num, banned: false, sms: { status: 'error' }, voice: null, flash: null, device: null, emailOtp: null, silentAuth: null, fallbackMethods: [] }; }
            }));
            for (let j = 0; j < chunkResults.length; j++) results[i + j] = chunkResults[j];
            done += chunk.length;
            if (progressCb) progressCb(done, numbers.length);
            i += chunk.length;
            if (i < numbers.length) await new Promise(r => setTimeout(r, 300));
        }
        return results;
    },

    generateDetectFullReport(results, meta = {}) {
        const stamp = Date.now();
        const fileName = `HasilDetectFull_${stamp}.txt`;
        const filePath = path.join(SESSION_DIR, fileName);
        const total    = results.length;
        const banned   = results.filter(r => r.banned).length;
        const smsReady = results.filter(r => !r.banned && r.sms?.status === 'ready').length;
        const smsCd    = results.filter(r => !r.banned && r.sms?.status === 'cooldown').length;
        const smsNoR   = results.filter(r => !r.banned && r.sms?.status === 'no_routes').length;
        const now = new Date();
        const tgl = `${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()}, ` +
            `${String(now.getHours()).padStart(2,'0')}.${String(now.getMinutes()).padStart(2,'0')}.${String(now.getSeconds()).padStart(2,'0')}`;
        const sep = '══════════════════════════════════════';

        function lbl(s) {
            if (!s) return '-';
            if (s.status === 'ready')     return 'READY';
            if (s.status === 'cooldown')  return `COOLDOWN${s.waitFmt ? ' (sisa ' + s.waitFmt + ')' : ''}`;
            if (s.status === 'blocked')   return 'DIBLOKIR';
            if (s.status === 'no_routes') return 'NO ROUTES';
            if (s.status === 'n/a')       return 'N/A';
            if (s.status === 'error')     return 'ERROR';
            return s.status.toUpperCase();
        }

        const lines = [
            sep, '  HASIL CEK DETECT ALL METHODS', sep,
            `Tanggal       : ${tgl}`, `Total Nomor   : ${total}`, '',
            '[ RINGKASAN SMS ]',
            `  READY      : ${smsReady}`, `  COOLDOWN   : ${smsCd}`,
            `  NO ROUTES  : ${smsNoR}`,  `  BANNED     : ${banned}`,
            '', ` by : @KicenXensai`,
            `bot : ${meta.botUsername ? '@' + meta.botUsername : 'N/A'}`,
            '', sep, 'DETAIL PER NOMOR', sep, '',
        ];

        for (const r of results) {
            if (r.banned) {
                lines.push(`+${r.number} → BANNED${r.bannedVt ? ' (' + r.bannedVt + ')' : ''}`);
            } else {
                lines.push(`+${r.number}`);
                lines.push(`  SMS         : ${lbl(r.sms)}`);
                lines.push(`  Voice       : ${lbl(r.voice)}`);
                lines.push(`  Flash Call  : ${lbl(r.flash)}`);
                lines.push(`  Device      : ${lbl(r.device)}`);
                lines.push(`  Email OTP   : ${lbl(r.emailOtp)}`);
                lines.push(`  Silent Auth : ${lbl(r.silentAuth)}`);
                if (r.fallbackMethods?.length) lines.push(`  Fallback    : ${r.fallbackMethods.join(' | ')}`);
            }
            lines.push('');
        }

        fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
        return { filePath, fileName };
    },

    formatCooldownAccurate,

    async detectRealtimeStatus(phoneNumber) {
        let cleanNum = String(phoneNumber || '').replace(/\D/g, '');
        if (cleanNum.startsWith('08')) cleanNum = '62' + cleanNum.slice(1);
        if (!cleanNum || cleanNum.length < 7) {
            return {
                number: cleanNum,
                status: 'invalid',
                formatted: `${cleanNum || '?'} — NOMOR TIDAK VALID`,
                waitSec: 0,
                cooldownFmt: 'INVALID',
                sms: { status: 'invalid', waitSec: 0, cooldownFmt: 'INVALID' },
                voice: { status: 'invalid', waitSec: 0, cooldownFmt: 'INVALID' },
                wa_old: { available: false, status: 'invalid', waitSec: 0, cooldownFmt: 'INVALID' },
                isWaOldAvailable: false,
                raw: null
            };
        }

        const { cc, inNumber } = parseCcAndIn(cleanNum);
        logger.add('DETECT', `[Realtime Check] Memulai deteksi nomor +${cleanNum} combo (/v2/exist & /v2/code)...`);

        // Combo Query:
        // 1. /v2/exist: Status registrasi, banned, CBS, dan baseline cooldown real-time tanpa pemicu OTP
        // 2. /v2/code (wa_old): Verifikasi ketersediaan WA OLD & server cooldown
        const [existRes, codeRes] = await Promise.all([
            _directWaHit(cc, inNumber, null, 'exist').catch(e => {
                logger.add('ERROR', `[DETECT] Error /v2/exist +${cleanNum}: ${e.message}`);
                return null;
            }),
            _directWaHit(cc, inNumber, 'wa_old', 'code').catch(e => {
                logger.add('ERROR', `[DETECT] Error /v2/code +${cleanNum}: ${e.message}`);
                return null;
            })
        ]);

        if ((!existRes || typeof existRes !== 'object') && (!codeRes || typeof codeRes !== 'object')) {
            logger.add('WARN', `[DETECT] Response kosong dari server untuk +${cleanNum}`);
            return {
                number: cleanNum,
                status: 'error',
                formatted: `${cleanNum} — RESPONSE KOSONG`,
                waitSec: 0,
                cooldownFmt: 'ERROR',
                sms: { status: 'error', waitSec: 0, cooldownFmt: 'ERROR' },
                voice: { status: 'error', waitSec: 0, cooldownFmt: 'ERROR' },
                wa_old: { available: false, status: 'error', waitSec: 0, cooldownFmt: 'ERROR' },
                isWaOldAvailable: false,
                raw: null
            };
        }

        // 1. Cek Banned (violation_type / in_app_ban_appeal / appeal_token) dari kedua endpoint
        const banNode = (existRes?.reason === 'blocked' && (existRes.appeal_token || existRes.violation_type || existRes.in_app_ban_appeal))
            ? existRes
            : ((codeRes?.reason === 'blocked' && (codeRes.appeal_token || codeRes.violation_type || codeRes.in_app_ban_appeal)) ? codeRes : null);

        if (banNode) {
            const vt = banNode.violation_type ? ` (${banNode.violation_type})` : '';
            logger.add('DETECT', `[DETECT] +${cleanNum} terdeteksi BANNED${vt}`);
            return {
                number: cleanNum,
                status: 'banned',
                formatted: `${cleanNum} — BANNED${vt}`,
                waitSec: 0,
                cooldownFmt: 'BANNED',
                sms: { status: 'banned', waitSec: 0, cooldownFmt: 'BANNED' },
                voice: { status: 'banned', waitSec: 0, cooldownFmt: 'BANNED' },
                wa_old: { available: false, status: 'banned', waitSec: 0, cooldownFmt: 'BANNED' },
                isWaOldAvailable: false,
                raw: banNode
            };
        }

        // 2. Cek Blocked / Custom Block Screen (CBS) dari kedua endpoint
        const cbsNode = (existRes?.reason === 'blocked' && existRes.custom_block_screen)
            ? existRes
            : ((codeRes?.reason === 'blocked' && codeRes.custom_block_screen) ? codeRes : null);

        if (cbsNode) {
            const s = typeof cbsNode.custom_block_screen === 'object'
                ? JSON.stringify(cbsNode.custom_block_screen).toLowerCase()
                : String(cbsNode.custom_block_screen).toLowerCase();
            const isBiz = s.includes('business') || s.includes('wa_business') || s.includes('unduh whatsapp') || s.includes('whatsapp.com/download');
            const reason = isBiz ? 'WA BUSINESS BLOCK' : 'BLOCKED';
            logger.add('DETECT', `[DETECT] +${cleanNum} terdeteksi ${reason}`);
            return {
                number: cleanNum,
                status: 'blocked',
                formatted: `${cleanNum} — ${reason}`,
                waitSec: 0,
                cooldownFmt: 'BLOCKED',
                sms: { status: 'blocked', waitSec: 0, cooldownFmt: 'BLOCKED' },
                voice: { status: 'blocked', waitSec: 0, cooldownFmt: 'BLOCKED' },
                wa_old: { available: false, status: 'blocked', waitSec: 0, cooldownFmt: 'BLOCKED' },
                isWaOldAvailable: false,
                raw: cbsNode
            };
        }

        // 2b. Fallback: reason "blocked"/"banned" tanpa field appeal/CBS spesifik —
        // tetap anggap BANNED, jangan diam-diam lanjut ke cek SMS biasa (ini celah yang
        // bikin nomor banned asli malah kebaca "ready"/"cooldown" karena field tambahan
        // appeal_token/violation_type/in_app_ban_appeal/custom_block_screen gak selalu ada).
        const genericBlockedNode = (existRes?.reason === 'blocked' || existRes?.reason === 'banned') ? existRes
            : ((codeRes?.reason === 'blocked' || codeRes?.reason === 'banned') ? codeRes : null);

        if (genericBlockedNode) {
            logger.add('DETECT', `[DETECT] +${cleanNum} fallback BANNED (reason="${genericBlockedNode.reason}", raw: ${JSON.stringify(genericBlockedNode).slice(0, 300)})`);
            return {
                number: cleanNum,
                status: 'banned',
                formatted: `${cleanNum} — BANNED`,
                waitSec: 0,
                cooldownFmt: 'BANNED',
                sms: { status: 'banned', waitSec: 0, cooldownFmt: 'BANNED' },
                voice: { status: 'banned', waitSec: 0, cooldownFmt: 'BANNED' },
                wa_old: { available: false, status: 'banned', waitSec: 0, cooldownFmt: 'BANNED' },
                isWaOldAvailable: false,
                raw: genericBlockedNode
            };
        }

        // 3. Status SMS Real-time (Kombinasi /v2/exist dan /v2/code)
        // /v2/exist memberikan status akurat tanpa terkena limitasi request code ("too_many"),
        // tapi /v2/code kadang balikin angka sms_wait lebih baru/akurat (account-level field,
        // bukan cuma soal wa_old). Jangan cuma "upgrade" saat status/reason cocok persis —
        // itu bikin cooldown asli (misal 1 jam) keabaian kalau API balikin status lain,
        // jatuh ke angka /v2/exist yang lebih rendah/basi. Selalu ambil MAX dari kedua sumber.
        const existSmsWait = Math.max(0, Number(existRes?.sms_wait || existRes?.send_sms_wait || 0));
        const codeSmsWait = Math.max(0, Number(codeRes?.sms_wait || codeRes?.send_sms_wait || 0));
        const codeRetryAfter = Math.max(0, Number(codeRes?.retry_after || 0));
        // retry_after cuma dipakai sebagai sinyal SMS kalau codeRes memang soal SMS (too_recent/no_routes),
        // bukan retry khusus request wa_old-nya sendiri.
        const codeRetryAsSms = (codeRes?.reason === 'too_recent' || codeRes?.reason === 'no_routes') ? codeRetryAfter : 0;

        let smsWait = Math.max(existSmsWait, codeSmsWait, codeRetryAsSms);
        let smsStatus = 'ready';
        let smsCooldownFmt = 'READY';

        if (smsWait > 0) {
            smsStatus = 'cooldown';
            smsCooldownFmt = `COOLDOWN ${formatDuration(smsWait)}`;
        } else {
            smsStatus = 'ready';
            smsCooldownFmt = 'READY';
        }

        // 4. Status Telpon/Voice (Kombinasi /v2/exist dan /v2/code)
        const voiceWait = Math.max(0, Number(existRes?.voice_wait || 0), Number(codeRes?.voice_wait || 0));
        const voiceStatus = voiceWait > 0 ? 'cooldown' : 'ready';
        const voiceCooldownFmt = voiceWait > 0 ? `COOLDOWN ${formatDuration(voiceWait)}` : 'READY';

        // 5. Status WA OLD / Perangkat Lain (Kombinasi /v2/exist dan /v2/code)
        const isWaOldEligible = Boolean(
            (existRes?.wa_old_eligible && Number(existRes.wa_old_eligible) > 0) ||
            (Array.isArray(existRes?.recommended_method) && existRes.recommended_method.includes('wa_old')) ||
            (codeRes?.status === 'sent' && codeRes?.method === 'wa_old') ||
            (codeRes?.wa_old_eligible && Number(codeRes.wa_old_eligible) > 0) ||
            (Array.isArray(codeRes?.recommended_method) && codeRes.recommended_method.includes('wa_old')) ||
            (Number(codeRes?.wa_old_wait || 0) > 0)
        );

        let waOldWait = 0;
        let waOldStatus = 'not_available';
        let waOldCooldownFmt = 'N/A';

        if (isWaOldEligible) {
            waOldWait = Math.max(
                0,
                Number(existRes?.wa_old_wait || 0),
                Number(codeRes?.wa_old_wait && codeRes.wa_old_wait > 0 ? codeRes.wa_old_wait : 0),
                Number((codeRes?.status === 'sent' || codeRes?.reason === 'too_recent') && codeRes?.method === 'wa_old' ? (codeRes.retry_after || 0) : 0)
            );

            if (waOldWait > 0) {
                waOldStatus = 'cooldown';
                waOldCooldownFmt = `COOLDOWN ${formatDuration(waOldWait)}`;
            } else {
                waOldStatus = 'ready';
                waOldCooldownFmt = 'READY';
            }
        }

        // 6. Susun teks format — SMS & TELPON selalu tampil, PERANGKAT LAIN cuma kalau tersedia
        let formatted = `${cleanNum} — SMS: ${smsCooldownFmt} | TELPON: ${voiceCooldownFmt}`;
        if (isWaOldEligible) {
            formatted += ` | PERANGKAT LAIN: ${waOldCooldownFmt}`;
        }

        const overallStatus = (smsStatus === 'cooldown' || (isWaOldEligible && waOldStatus === 'cooldown'))
            ? 'cooldown'
            : (smsStatus === 'ready' || (isWaOldEligible && waOldStatus === 'ready'))
                ? 'ready'
                : smsStatus;

        logger.add('DETECT', `[DETECT] +${cleanNum} hasil: ${formatted}`);

        return {
            number: cleanNum,
            status: overallStatus,
            formatted,
            sms: {
                status: smsStatus,
                waitSec: smsWait,
                cooldownFmt: smsCooldownFmt
            },
            voice: {
                status: voiceStatus,
                waitSec: voiceWait,
                cooldownFmt: voiceCooldownFmt
            },
            wa_old: {
                available: isWaOldEligible,
                status: waOldStatus,
                waitSec: waOldWait,
                cooldownFmt: waOldCooldownFmt
            },
            isWaOldAvailable: Boolean(isWaOldEligible),
            waitSec: smsWait,
            cooldownFmt: smsCooldownFmt,
            waits: {
                sms: smsWait,
                wa_old: isWaOldEligible ? waOldWait : 0,
                voice: voiceWait,
                flash: Math.max(0, Number(existRes?.flash_wait || 0), Number(codeRes?.flash_wait || 0)),
                email_otp: Math.max(0, Number(existRes?.email_otp_wait || 0), Number(codeRes?.email_otp_wait || 0)),
                retry_after: codeRetryAfter
            },
            raw: {
                ...(existRes || {}),
                code_response: codeRes,
                exist_response: existRes
            }
        };
    },

    async detectBulkRealtime(numbers, progressCb = null) {
        const results = [];
        const total = numbers.length;
        for (let i = 0; i < total; i++) {
            const num = numbers[i];
            try {
                const res = await this.detectRealtimeStatus(num);
                results.push(res);
            } catch (err) {
                results.push({
                    number: num,
                    status: 'error',
                    formatted: `${num} — ERROR: ${err.message}`,
                    waitSec: 0,
                    cooldownFmt: 'ERROR',
                    raw: null
                });
            }
            if (progressCb) progressCb(i + 1, total, results[results.length - 1]);
            if (i < total - 1) {
                await new Promise(r => setTimeout(r, 300));
            }
        }
        return results;
    },

    async requestLimitCodeFlow(phoneNumber, methodInput = 'sms', userId = null) {
        const cleanNum = String(phoneNumber || '').replace(/\D/g, '');
        if (!cleanNum || cleanNum.length < 7) {
            return {
                ok: false,
                number: cleanNum,
                error: 'Nomor tidak valid',
                message: 'Format nomor tidak valid'
            };
        }

        let method = 'sms';
        let methodLabel = 'SMS';
        const norm = String(methodInput || '').toLowerCase().trim();
        if (norm.includes('old') || norm.includes('perangkat') || norm === 'wa_old' || norm === '1') {
            method = 'wa_old';
            methodLabel = 'WA OLD / PERANGKAT';
        } else if (norm.includes('panggilan') || norm.includes('voice') || norm.includes('call') || norm === '3') {
            method = 'voice';
            methodLabel = 'PANGGILAN';
        } else {
            method = 'sms';
            methodLabel = 'SMS';
        }

        logger.add('LIMITIN', `[REQUEST CODE FLOW] Nomor: +${cleanNum} | Metode Dipilih: ${methodLabel} (${method})`);

        // Step 1: Pre-check real-time cooldown via /v2/exist (NO OTP)
        logger.add('LIMITIN', `[Step 1] Memeriksa status & cooldown real-time via /v2/exist untuk +${cleanNum}...`);
        const preCheck = await this.detectRealtimeStatus(cleanNum);

        // Step 2: Cek status banned/blocked
        if (preCheck.status === 'banned' || preCheck.status === 'blocked') {
            logger.add('LIMITIN', `[Step 2 DITOLAK] +${cleanNum} status: ${preCheck.status.toUpperCase()}. Request code dibatalkan.`);
            return {
                ok: false,
                number: cleanNum,
                method: methodLabel,
                methodCode: method,
                phase: 'pre_check_blocked',
                statusText: preCheck.formatted,
                waitSec: 0,
                cooldown: preCheck.cooldownFmt,
                reason: `Akun berstatus ${preCheck.status.toUpperCase()}`,
                rawPreCheck: preCheck.raw,
                rawCodeResponse: null
            };
        }

        // Cek ketersediaan opsi WA OLD jika user memilih metode WA OLD
        if (method === 'wa_old' && !preCheck.isWaOldAvailable) {
            logger.add('LIMITIN', `[Step 2 DITOLAK] +${cleanNum} metode WA OLD tidak tersedia. Request code dibatalkan.`);
            return {
                ok: false,
                number: cleanNum,
                method: methodLabel,
                methodCode: method,
                phase: 'not_available',
                statusText: 'WA OLD TIDAK TERSEDIA',
                waitSec: 0,
                cooldown: 'N/A',
                reason: 'Opsi WA OLD / Perangkat tidak tersedia pada nomor ini',
                rawPreCheck: preCheck.raw,
                rawCodeResponse: null
            };
        }

        // Cek cooldown spesifik untuk metode yang dipilih
        const methodWait = method === 'wa_old'
            ? (preCheck.wa_old?.waitSec || 0)
            : (method === 'voice' ? (preCheck.waits?.voice || 0) : (preCheck.sms?.waitSec || 0));
        const methodCooldownFmt = method === 'wa_old'
            ? (preCheck.wa_old?.cooldownFmt || 'READY')
            : (method === 'voice' ? formatCooldownAccurate(methodWait) : (preCheck.sms?.cooldownFmt || 'READY'));

        if (methodWait > 0) {
            logger.add('LIMITIN', `[Step 2 DITOLAK] +${cleanNum} metode ${methodLabel} sedang cooldown (${methodCooldownFmt}). Request code dibatalkan.`);
            return {
                ok: false,
                number: cleanNum,
                method: methodLabel,
                methodCode: method,
                phase: 'pre_check_cooldown',
                statusText: `COOLDOWN (${methodCooldownFmt})`,
                waitSec: methodWait,
                cooldown: methodCooldownFmt,
                reason: `Metode ${methodLabel} sedang cooldown server, tunggu ${methodCooldownFmt.replace('COOLDOWN: ', '')}`,
                rawPreCheck: preCheck.raw,
                rawCodeResponse: null
            };
        }

        // Step 3: Jika READY -> Request code menggunakan metode yang dipilih via /v2/code
        const { cc, inNumber } = parseCcAndIn(cleanNum);
        logger.add('LIMITIN', `[Step 3 EKSEKUSI] +${cleanNum} status READY. Mengirim request code (${method}) ke /v2/code...`);

        let codeRes = null;
        try {
            codeRes = await _directWaHit(cc, inNumber, method, 'code');
        } catch (e) {
            logger.add('ERROR', `[LIMITIN] Gagal request code untuk +${cleanNum}: ${e.message}`);
            return {
                ok: false,
                number: cleanNum,
                method: methodLabel,
                methodCode: method,
                phase: 'request_error',
                statusText: 'ERROR REQUEST',
                waitSec: 0,
                cooldown: 'ERROR',
                reason: e.message || 'Network / Request Error',
                rawPreCheck: preCheck.raw,
                rawCodeResponse: null
            };
        }

        // Step 4: Baca response server & ambil status cooldown terbaru dari server
        logger.add('LIMITIN', `[Step 4 RESPONSE] Response /v2/code untuk +${cleanNum}: ${JSON.stringify(codeRes || {})}`);

        const waits = _extractWaits(codeRes);
        const specificWait = waits[method] || waits.retry_after || Math.max(...Object.values(waits));
        const updatedCooldown = formatCooldownAccurate(specificWait);

        const isSuccess = codeRes?.status === 'sent' || codeRes?.status === 'ok';
        const reason = codeRes?.reason || (isSuccess ? 'Code berhasil direquest' : 'Request ditolak oleh server');

        logger.add('LIMITIN', `[Step 5 SELESAI] +${cleanNum} | Hasil: ${isSuccess ? 'SUKSES' : 'GAGAL'} | Reason: ${reason} | Cooldown Terbaru: ${updatedCooldown}`);

        return {
            ok: isSuccess,
            number: cleanNum,
            method: methodLabel,
            methodCode: method,
            phase: 'completed',
            statusText: isSuccess ? `BERHASIL (${methodLabel})` : `GAGAL: ${reason}`,
            waitSec: specificWait,
            cooldown: updatedCooldown,
            waits,
            reason,
            rawPreCheck: preCheck.raw,
            rawCodeResponse: codeRes
        };
    },

    cancelLimitinTask(taskId) {
        if (!global.activeLimitinTasks) return null;
        const task = global.activeLimitinTasks.get(taskId);
        if (!task) return null;
        task.status = 'cancelled';
        if (typeof task.cancelResolve === 'function') {
            task.cancelResolve();
            delete task.cancelResolve;
        }
        global.activeLimitinTasks.delete(taskId);
        return task;
    },

    cancelLimitinByUser(userId) {
        const cancelled = [];
        if (global.activeLimitinTasks) {
            for (const [taskId, task] of global.activeLimitinTasks.entries()) {
                if (String(task.userId) === String(userId)) {
                    task.status = 'cancelled';
                    if (typeof task.cancelResolve === 'function') {
                        task.cancelResolve();
                        delete task.cancelResolve;
                    }
                    global.activeLimitinTasks.delete(taskId);
                    cancelled.push(task);
                }
            }
        }
        return cancelled;
    },

    async startLimitinBackgroundSession({ bot, chatId, userId, number, method = 'sms', methodName = 'SMS', maxAttempts = 5 }) {
        const cleanNum = String(number || '').replace(/\D/g, '');
        if (!cleanNum || cleanNum.length < 7) return null;

        const { cc, inNumber } = parseCcAndIn(cleanNum);
        const taskId = `l_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

        if (!global.activeLimitinTasks) global.activeLimitinTasks = new Map();
        global.activeLimitinTasks.set(taskId, {
            taskId,
            userId,
            chatId,
            number: cleanNum,
            method,
            methodName,
            attempt: 0,
            maxAttempts,
            status: 'running',
            startedAt: Date.now()
        });

        let messageId = null;
        const sendOrEdit = async (text, extra = {}) => {
            try {
                if (!messageId) {
                    const sent = await bot.telegram.sendMessage(chatId, text, { parse_mode: 'HTML', ...extra });
                    messageId = sent?.message_id;
                    const cur = global.activeLimitinTasks?.get(taskId);
                    if (cur) cur.messageId = messageId;
                } else {
                    await bot.telegram.editMessageText(chatId, messageId, undefined, text, { parse_mode: 'HTML', ...extra });
                }
            } catch (e) {
                const errMsg = String(e?.message || '');
                if (errMsg.includes('message is not modified')) {
                    return;
                }
                if (errMsg.includes('message to edit not found') || errMsg.includes('chat not found')) {
                    try {
                        const sent = await bot.telegram.sendMessage(chatId, text, { parse_mode: 'HTML', ...extra });
                        messageId = sent?.message_id;
                        const cur = global.activeLimitinTasks?.get(taskId);
                        if (cur) cur.messageId = messageId;
                    } catch (_) {}
                }
            }
        };

        const sleepWithTaskCheck = (ms) => {
            return new Promise((resolve) => {
                const task = global.activeLimitinTasks?.get(taskId);
                if (!task || task.status === 'cancelled') {
                    return resolve(true);
                }
                let timer = null;
                const onCancel = () => {
                    if (timer) clearTimeout(timer);
                    resolve(true);
                };
                task.cancelResolve = onCancel;
                timer = setTimeout(() => {
                    if (task && task.cancelResolve === onCancel) {
                        delete task.cancelResolve;
                    }
                    resolve(false);
                }, ms);
            });
        };

        const cancelKeyboard = [
            [{ text: 'BATALKAN', style: 'danger', callback_data: `cancel_lim_${taskId}`, icon_custom_emoji_id: EMOJI_IDS.CROSS }]
        ];

        const countdownWithTaskCheck = async (totalSec, renderTextFn) => {
            const endAt = Date.now() + (totalSec * 1000);
            const tickIntervalMs = 2500;
            let lastRenderedStr = '';

            while (Date.now() < endAt) {
                const currentTask = global.activeLimitinTasks?.get(taskId);
                if (!currentTask || currentTask.status === 'cancelled') {
                    return true;
                }

                const remainingSec = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
                const cooldownStr = formatDuration(remainingSec);

                if (cooldownStr !== lastRenderedStr) {
                    lastRenderedStr = cooldownStr;
                    const text = renderTextFn(cooldownStr, remainingSec);
                    await sendOrEdit(text, { reply_markup: { inline_keyboard: cancelKeyboard } });
                }

                const remainingMs = endAt - Date.now();
                if (remainingMs <= 0) break;
                const waitMs = Math.min(tickIntervalMs, remainingMs);
                const wasCancelled = await sleepWithTaskCheck(waitMs);
                if (wasCancelled || global.activeLimitinTasks?.get(taskId)?.status === 'cancelled') {
                    return true;
                }
            }

            return false;
        };

        // Run independently in background
        (async () => {
            let attempt = 0;
            let consecutiveErrors = 0;

            while (attempt < maxAttempts) {
                const currentTask = global.activeLimitinTasks?.get(taskId);
                if (!currentTask || currentTask.status === 'cancelled') {
                    logger.add('LIMITIN', `[BACKGROUND] Task ${taskId} dibatalkan.`);
                    break;
                }

                // Initial check on attempt 0
                if (attempt === 0) {
                    await sendOrEdit(
                        `<b>${EMOJIS.TIME} MEMPROSES LIMITIN</b>\n\n<blockquote>Nomor: <code>+${cleanNum}</code>\nMetode: <b>${methodName}</b>\nSedang memeriksa status nomor (percobaan 1/${maxAttempts})...</blockquote>`,
                        { reply_markup: { inline_keyboard: cancelKeyboard } }
                    );

                    let preCheck = null;
                    try {
                        preCheck = await this.detectRealtimeStatus(cleanNum);
                    } catch (e) {
                        logger.add('ERROR', `[LIMITIN-BG] Error pre-check +${cleanNum}: ${e.message}`);
                    }

                    if (preCheck?.status === 'banned' || preCheck?.status === 'blocked') {
                        const statusName = preCheck.status === 'banned' ? 'BANNED' : 'BLOCKED';
                        await sendOrEdit(
                            `<b>${EMOJIS.CROSS} LIMITIN DIHENTIKAN</b>\n\n<blockquote>Nomor: <code>+${cleanNum}</code>\nMetode: <b>${methodName}</b>\nStatus: <b>${statusName}</b>\nNomor berstatus diblokir oleh WhatsApp.</blockquote>`,
                            {
                                reply_markup: {
                                    inline_keyboard: [
                                        [{ text: 'LIMITIN LAGI', style: 'primary', callback_data: 'menu_limitin', icon_custom_emoji_id: EMOJI_IDS.ROCKET }],
                                        [{ text: 'MENU UTAMA', style: 'primary', callback_data: 'back_home', icon_custom_emoji_id: EMOJI_IDS.BACK }]
                                    ]
                                }
                            }
                        );
                        break;
                    }
                    // Cek ketersediaan WA OLD jika user memilih metode WA OLD
                    if (method === 'wa_old' && !preCheck?.isWaOldAvailable) {
                        await sendOrEdit(
                            `<b>${EMOJIS.CROSS} LIMITIN DIBATALKAN</b>\n\n<blockquote>Nomor: <code>+${cleanNum}</code>\nMetode: <b>${methodName}</b>\nAlasan: <b>Metode WA OLD tidak tersedia pada nomor ini.</b>\nSilakan coba gunakan metode <b>SMS</b> atau <b>Panggilan</b>.</blockquote>`,
                            {
                                reply_markup: {
                                    inline_keyboard: [
                                        [{ text: 'LIMITIN (SMS)', style: 'primary', callback_data: 'limitin_method_sms', icon_custom_emoji_id: EMOJI_IDS.SMS }],
                                        [{ text: 'LIMITIN LAGI', style: 'primary', callback_data: 'menu_limitin', icon_custom_emoji_id: EMOJI_IDS.ROCKET }],
                                        [{ text: 'MENU UTAMA', style: 'primary', callback_data: 'back_home', icon_custom_emoji_id: EMOJI_IDS.BACK }]
                                    ]
                                }
                            }
                        );
                        break;
                    }

                    // Check if already in cooldown before requesting
                    let initialWait = 0;
                    if (method === 'wa_old') {
                        initialWait = preCheck?.wa_old?.waitSec || 0;
                    } else if (method === 'voice') {
                        initialWait = preCheck?.waits?.voice || 0;
                    } else {
                        initialWait = preCheck?.sms?.waitSec || 0;
                    }

                    if (initialWait > 1800) {
                        const cdStr = formatDuration(initialWait);
                        await sendOrEdit(
                            `<b>${EMOJIS.CHECK} NOMOR SUDAH LIMIT</b>\n\n<blockquote>Nomor: <code>+${cleanNum}</code>\nMetode: <b>${methodName}</b>\nCooldown: <code>${cdStr}</code>\nNomor sedang dalam limit cooldown server WhatsApp.</blockquote>`,
                            {
                                reply_markup: {
                                    inline_keyboard: [
                                        [{ text: 'LIMITIN LAGI', style: 'primary', callback_data: 'menu_limitin', icon_custom_emoji_id: EMOJI_IDS.ROCKET }],
                                        [{ text: 'MENU UTAMA', style: 'primary', callback_data: 'back_home', icon_custom_emoji_id: EMOJI_IDS.BACK }]
                                    ]
                                }
                            }
                        );
                        break;
                    } else if (initialWait > 0) {
                        const wasCancelled = await countdownWithTaskCheck(
                            initialWait + 2,
                            (cdStr) => `<b>${EMOJIS.TIME} MENUNGGU COOLDOWN</b>\n\n<blockquote>Nomor: <code>+${cleanNum}</code>\nMetode: <b>${methodName}</b>\nCooldown: <code>${cdStr}</code>\nMenunggu sebelum percobaan ke-1/${maxAttempts}...</blockquote>`
                        );
                        if (wasCancelled || global.activeLimitinTasks?.get(taskId)?.status === 'cancelled') {
                            logger.add('LIMITIN', `[BACKGROUND] Task ${taskId} (+${cleanNum}) dibatalkan saat cooldown.`);
                            break;
                        }
                    }
                }

                // Execute Request Code via /v2/code
                attempt++;
                if (currentTask) currentTask.attempt = attempt;

                logger.add('LIMITIN', `[BACKGROUND] +${cleanNum} request code (${method}) percobaan ${attempt}/${maxAttempts}...`);

                await sendOrEdit(
                    `<b>${EMOJIS.ROCKET} MENGIRIM REQUEST CODE</b>\n\n<blockquote>Nomor: <code>+${cleanNum}</code>\nMetode: <b>${methodName}</b>\nSedang mengirim request code (percobaan ${attempt}/${maxAttempts})...</blockquote>`,
                    { reply_markup: { inline_keyboard: cancelKeyboard } }
                );

                let codeRes = null;
                try {
                    codeRes = await _directWaHit(cc, inNumber, method, 'code');
                } catch (e) {
                    logger.add('ERROR', `[LIMITIN-BG] Error request code +${cleanNum} (${attempt}): ${e.message}`);
                    consecutiveErrors++;
                    if (consecutiveErrors >= 3) {
                        await sendOrEdit(
                            `<b>${EMOJIS.CROSS} LIMITIN ERROR</b>\n\n<blockquote>Nomor: <code>+${cleanNum}</code>\nMetode: <b>${methodName}</b>\nKoneksi server gagal berulang kali. Percobaan dihentikan.</blockquote>`,
                            {
                                reply_markup: {
                                    inline_keyboard: [
                                        [{ text: 'LIMITIN LAGI', style: 'primary', callback_data: 'menu_limitin', icon_custom_emoji_id: EMOJI_IDS.ROCKET }],
                                        [{ text: 'MENU UTAMA', style: 'primary', callback_data: 'back_home', icon_custom_emoji_id: EMOJI_IDS.BACK }]
                                    ]
                                }
                            }
                        );
                        break;
                    }
                    const wasCancelled = await sleepWithTaskCheck(5000);
                    if (wasCancelled || global.activeLimitinTasks?.get(taskId)?.status === 'cancelled') {
                        break;
                    }
                    continue;
                }

                consecutiveErrors = 0;

                // Check Banned or Blocked (CBS)
                if (codeRes?.reason === 'blocked') {
                    if (codeRes.appeal_token || codeRes.violation_type || codeRes.in_app_ban_appeal) {
                        const vt = codeRes.violation_type ? ` (${codeRes.violation_type})` : '';
                        await sendOrEdit(
                            `<b>${EMOJIS.CROSS} LIMITIN DIHENTIKAN</b>\n\n<blockquote>Nomor: <code>+${cleanNum}</code>\nStatus: <b>BANNED${vt}</b>\nNomor terblokir permanen oleh WhatsApp.</blockquote>`,
                            {
                                reply_markup: {
                                    inline_keyboard: [
                                        [{ text: 'LIMITIN LAGI', style: 'primary', callback_data: 'menu_limitin', icon_custom_emoji_id: EMOJI_IDS.ROCKET }],
                                        [{ text: 'MENU UTAMA', style: 'primary', callback_data: 'back_home', icon_custom_emoji_id: EMOJI_IDS.BACK }]
                                    ]
                                }
                            }
                        );
                        break;
                    }
                    if (codeRes.custom_block_screen) {
                        await sendOrEdit(
                            `<b>${EMOJIS.CROSS} LIMITIN DIHENTIKAN</b>\n\n<blockquote>Nomor: <code>+${cleanNum}</code>\nStatus: <b>BLOCKED (CBS)</b>\nLogin tidak tersedia pada nomor ini.</blockquote>`,
                            {
                                reply_markup: {
                                    inline_keyboard: [
                                        [{ text: 'LIMITIN LAGI', style: 'primary', callback_data: 'menu_limitin', icon_custom_emoji_id: EMOJI_IDS.ROCKET }],
                                        [{ text: 'MENU UTAMA', style: 'primary', callback_data: 'back_home', icon_custom_emoji_id: EMOJI_IDS.BACK }]
                                    ]
                                }
                            }
                        );
                        break;
                    }
                }

                const isSuccess = codeRes?.status === 'sent' || codeRes?.status === 'ok';

                const waits = _extractWaits(codeRes);
                let waitSec = 0;
                if (method === 'wa_old') {
                    waitSec = Math.max(0, waits.wa_old, waits.retry_after);
                } else if (method === 'voice') {
                    waitSec = Math.max(0, waits.voice, waits.retry_after);
                } else {
                    waitSec = Math.max(0, waits.sms, waits.send_sms_wait || 0, waits.retry_after);
                }

                const cooldownStr = formatDuration(waitSec);

                if (isSuccess) {
                    if (waitSec > 1800) {
                        await sendOrEdit(
                            `<b>${EMOJIS.CHECK} LIMITIN SELESAI (TERLIMIT)</b>\n\n<blockquote>Nomor: <code>+${cleanNum}</code>\nMetode: <b>${methodName}</b>\nStatus: <b>Berhasil Terlimit di Percobaan ke-${attempt}/${maxAttempts}</b>\nCooldown: <code>${cooldownStr}</code></blockquote>`,
                            {
                                reply_markup: {
                                    inline_keyboard: [
                                        [{ text: 'LIMITIN LAGI', style: 'primary', callback_data: 'menu_limitin', icon_custom_emoji_id: EMOJI_IDS.ROCKET }],
                                        [{ text: 'MENU UTAMA', style: 'primary', callback_data: 'back_home', icon_custom_emoji_id: EMOJI_IDS.BACK }]
                                    ]
                                }
                            }
                        );
                        break;
                    }

                    if (attempt < maxAttempts) {
                        const sleepSec = waitSec > 0 ? waitSec + 2 : 5;
                        const wasCancelled = await countdownWithTaskCheck(
                            sleepSec,
                            (cdStr) => `<b>${EMOJIS.CHECK} LIMITIN BERHASIL (${attempt}/${maxAttempts})</b>\n\n<blockquote>Nomor: <code>+${cleanNum}</code>\nMetode: <b>${methodName}</b>\nCooldown: <code>${cdStr}</code>\nMenunggu sebelum percobaan ke-${attempt + 1}/${maxAttempts}...</blockquote>`
                        );

                        if (wasCancelled || global.activeLimitinTasks?.get(taskId)?.status === 'cancelled') {
                            logger.add('LIMITIN', `[BACKGROUND] Task ${taskId} (+${cleanNum}) dibatalkan.`);
                            break;
                        }
                    } else {
                        await sendOrEdit(
                            `<b>${EMOJIS.CHECK} LIMITIN SELESAI</b>\n\n<blockquote>Nomor: <code>+${cleanNum}</code>\nMetode: <b>${methodName}</b>\nStatus: <b>${maxAttempts}/${maxAttempts} Percobaan Berhasil</b>\nCooldown: <code>${cooldownStr}</code></blockquote>`,
                            {
                                reply_markup: {
                                    inline_keyboard: [
                                        [{ text: 'LIMITIN LAGI', style: 'primary', callback_data: 'menu_limitin', icon_custom_emoji_id: EMOJI_IDS.ROCKET }],
                                        [{ text: 'MENU UTAMA', style: 'primary', callback_data: 'back_home', icon_custom_emoji_id: EMOJI_IDS.BACK }]
                                    ]
                                }
                            }
                        );
                        break;
                    }
                } else {
                    const reason = codeRes?.reason || 'Ditolak server';

                    if (reason === 'method_not_supported' || reason === 'bad_param' || (method === 'wa_old' && reason === 'no_routes' && !codeRes?.retry_after)) {
                        await sendOrEdit(
                            `<b>${EMOJIS.CROSS} LIMITIN DIBATALKAN</b>\n\n<blockquote>Nomor: <code>+${cleanNum}</code>\nMetode: <b>${methodName}</b>\nAlasan: Metode tidak tersedia pada nomor ini.</blockquote>`,
                            {
                                reply_markup: {
                                    inline_keyboard: [
                                        [{ text: 'LIMITIN LAGI', style: 'primary', callback_data: 'menu_limitin', icon_custom_emoji_id: EMOJI_IDS.ROCKET }],
                                        [{ text: 'MENU UTAMA', style: 'primary', callback_data: 'back_home', icon_custom_emoji_id: EMOJI_IDS.BACK }]
                                    ]
                                }
                            }
                        );
                        break;
                    }

                    if (waitSec > 1800) {
                        await sendOrEdit(
                            `<b>${EMOJIS.CHECK} NOMOR SUDAH TERLIMIT</b>\n\n<blockquote>Nomor: <code>+${cleanNum}</code>\nMetode: <b>${methodName}</b>\nStatus: <b>Cooldown ${cooldownStr}</b>\nBerhenti di percobaan ke-${attempt}/${maxAttempts}.</blockquote>`,
                            {
                                reply_markup: {
                                    inline_keyboard: [
                                        [{ text: 'LIMITIN LAGI', style: 'primary', callback_data: 'menu_limitin', icon_custom_emoji_id: EMOJI_IDS.ROCKET }],
                                        [{ text: 'MENU UTAMA', style: 'primary', callback_data: 'back_home', icon_custom_emoji_id: EMOJI_IDS.BACK }]
                                    ]
                                }
                            }
                        );
                        break;
                    }

                    if (reason === 'too_many') {
                        let existCheck = null;
                        try {
                            existCheck = await _directWaHit(cc, inNumber, null, 'exist');
                        } catch (_) {}
                        const existWait = Math.max(0, Number(existCheck?.sms_wait || existCheck?.send_sms_wait || 0));
                        const effectiveWait = Math.max(waitSec, existWait);

                        if (effectiveWait > 1800) {
                            const cd = formatDuration(effectiveWait);
                            await sendOrEdit(
                                `<b>${EMOJIS.CHECK} NOMOR SUDAH TERLIMIT</b>\n\n<blockquote>Nomor: <code>+${cleanNum}</code>\nMetode: <b>${methodName}</b>\nStatus: <b>Terlimit Server (Cooldown: ${cd})</b>\nBerhenti di percobaan ke-${attempt}/${maxAttempts}.</blockquote>`,
                                {
                                    reply_markup: {
                                        inline_keyboard: [
                                            [{ text: 'LIMITIN LAGI', style: 'primary', callback_data: 'menu_limitin', icon_custom_emoji_id: EMOJI_IDS.ROCKET }],
                                            [{ text: 'MENU UTAMA', style: 'primary', callback_data: 'back_home', icon_custom_emoji_id: EMOJI_IDS.BACK }]
                                        ]
                                    }
                                }
                            );
                            break;
                        }

                        if (effectiveWait > 0 && attempt < maxAttempts) {
                            const wasCancelled = await countdownWithTaskCheck(
                                effectiveWait + 2,
                                (cdStr) => `<b>${EMOJIS.TIME} LIMITIN COOLDOWN (${attempt}/${maxAttempts})</b>\n\n<blockquote>Nomor: <code>+${cleanNum}</code>\nInfo: <i>Rate Limit</i>\nCooldown: <code>${cdStr}</code>\nMenunggu cooldown sebelum mencoba kembali...</blockquote>`
                            );
                            if (wasCancelled || global.activeLimitinTasks?.get(taskId)?.status === 'cancelled') {
                                logger.add('LIMITIN', `[BACKGROUND] Task ${taskId} (+${cleanNum}) dibatalkan.`);
                                break;
                            }
                            continue;
                        }

                        await sendOrEdit(
                            `<b>${EMOJIS.CHECK} RATE LIMIT SERVER TERCAPAI</b>\n\n<blockquote>Nomor: <code>+${cleanNum}</code>\nMetode: <b>${methodName}</b>\nStatus: <b>Server membatasi pengiriman kode (Too Many Requests)</b>\nSelesai di percobaan ke-${attempt}/${maxAttempts}.</blockquote>`,
                            {
                                reply_markup: {
                                    inline_keyboard: [
                                        [{ text: 'LIMITIN LAGI', style: 'primary', callback_data: 'menu_limitin', icon_custom_emoji_id: EMOJI_IDS.ROCKET }],
                                        [{ text: 'MENU UTAMA', style: 'primary', callback_data: 'back_home', icon_custom_emoji_id: EMOJI_IDS.BACK }]
                                    ]
                                }
                            }
                        );
                        break;
                    }

                    if (waitSec > 0 && attempt < maxAttempts) {
                        const wasCancelled = await countdownWithTaskCheck(
                            waitSec + 2,
                            (cdStr) => `<b>${EMOJIS.TIME} LIMITIN COOLDOWN (${attempt}/${maxAttempts})</b>\n\n<blockquote>Nomor: <code>+${cleanNum}</code>\nInfo: <i>${reason}</i>\nCooldown: <code>${cdStr}</code>\nMenunggu cooldown sebelum mencoba kembali...</blockquote>`
                        );

                        if (wasCancelled || global.activeLimitinTasks?.get(taskId)?.status === 'cancelled') {
                            logger.add('LIMITIN', `[BACKGROUND] Task ${taskId} (+${cleanNum}) dibatalkan saat cooldown percobaan ${attempt}.`);
                            break;
                        }
                    } else {
                        await sendOrEdit(
                            `<b>${EMOJIS.CROSS} LIMITIN BERHENTI</b>\n\n<blockquote>Nomor: <code>+${cleanNum}</code>\nMetode: <b>${methodName}</b>\nAlasan: <i>${reason}</i>\nPercobaan ke-${attempt}/${maxAttempts}.</blockquote>`,
                            {
                                reply_markup: {
                                    inline_keyboard: [
                                        [{ text: 'LIMITIN LAGI', style: 'primary', callback_data: 'menu_limitin', icon_custom_emoji_id: EMOJI_IDS.ROCKET }],
                                        [{ text: 'MENU UTAMA', style: 'primary', callback_data: 'back_home', icon_custom_emoji_id: EMOJI_IDS.BACK }]
                                    ]
                                }
                            }
                        );
                        break;
                    }
                }
            }

            global.activeLimitinTasks?.delete(taskId);
        })().catch(err => {
            logger.add('ERROR', `[LIMITIN-BG] Unhandled task error ${taskId}: ${err.message}`);
            global.activeLimitinTasks?.delete(taskId);
        });

        return taskId;
    },

    generateDetectRealtimeReport(results, meta = {}) {
        const stamp = Date.now();
        const fileName = `HasilDetect_${stamp}.txt`;
        const filePath = path.join(SESSION_DIR, fileName);

        const total    = results.length;
        const ready    = results.filter(r => r.status === 'ready').length;
        const cooldown = results.filter(r => r.status === 'cooldown').length;
        const banned   = results.filter(r => r.status === 'banned').length;
        const blocked  = results.filter(r => r.status === 'blocked').length;
        const error    = results.filter(r => r.status === 'error' || r.status === 'invalid').length;

        const now = new Date();
        const tgl = `${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()}, ` +
            `${String(now.getHours()).padStart(2,'0')}.${String(now.getMinutes()).padStart(2,'0')}.${String(now.getSeconds()).padStart(2,'0')}`;

        const sep = '══════════════════════════════════════';
        const lines = [
            sep,
            '  HASIL DETECT STATUS & COOLDOWN REAL-TIME',
            sep,
            `Tanggal       : ${tgl}`,
            `Total Nomor   : ${total}`,
            '',
            '[ RINGKASAN ]',
            `  READY      : ${ready}   ← Siap (tidak ada cooldown)`,
            `  COOLDOWN   : ${cooldown}`,
            `  BANNED     : ${banned}`,
            `  BLOCKED    : ${blocked}`,
            `  ERROR      : ${error}`,
            '',
            ` by : @KicenXensai`,
            `bot : ${meta.botUsername ? '@' + meta.botUsername : 'N/A'}`,
            '',
            sep,
            'DETAIL PER NOMOR',
            sep,
            ''
        ];

        for (const r of results) {
            lines.push(r.formatted || `${r.number} — ${r.cooldownFmt || 'UNKNOWN'}`);
        }

        lines.push('');
        lines.push(sep);

        fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
        return { filePath, fileName };
    },

    async checkJoinedAndBio(phoneNumber, userId = null) {
        const cleanNum = String(phoneNumber || '').replace(/\D/g, '');
        if (!cleanNum || cleanNum.length < 7) {
            throw new Error('Nomor tidak valid (terlalu pendek).');
        }

        let sess = null;
        if (userId) {
            const uid = String(userId);
            if (sessions.has(uid)) {
                for (const [sId, sock] of sessions.get(uid).entries()) {
                    if (sessionStatus.get(`${uid}_${sId}`) === 'CONNECTED') {
                        sess = sock;
                        break;
                    }
                }
            }
        }
        if (!sess) {
            for (const [uid, userSess] of sessions.entries()) {
                for (const [sId, sock] of userSess.entries()) {
                    if (sessionStatus.get(`${uid}_${sId}`) === 'CONNECTED') {
                        sess = sock;
                        break;
                    }
                }
                if (sess) break;
            }
        }

        if (!sess) {
            throw new Error('Tidak ada sesi WhatsApp yang terhubung.');
        }

        const jid = `${cleanNum}@s.whatsapp.net`;

        // 1. Query USync (Contact, Status, Devices)
        const q = new USyncQuery()
            .withContactProtocol()
            .withStatusProtocol()
            .withDeviceProtocol();
        q.withUser(new USyncUser().withPhone(`+${cleanNum}`));

        const res = await sess.executeUSyncQuery(q).catch(() => null);
        const item = res?.list?.[0] || null;

        const isRegistered = !!(item && item.contact);
        if (!isRegistered) {
            return {
                number: cleanNum,
                isRegistered: false,
                status: 'unregistered',
                formatted: `+${cleanNum} — TIDAK TERDAFTAR DI WHATSAPP`
            };
        }

        // 2. Fetch Business Profile
        let bp = null;
        try {
            bp = await fetchBusinessProfileFull(sess, jid);
        } catch (_) {}

        // 3. Fetch Member Since (Join Date)
        let joinSince = bp?.since || null;
        if (!joinSince) {
            joinSince = await fetchMemberSince(sess, jid);
        }
        if (!joinSince && item?.devices?.keyIndex?.timestamp) {
            const devTs = Number(item.devices.keyIndex.timestamp);
            if (!isNaN(devTs) && devTs > 1230768000) {
                const d = new Date(devTs < 1e11 ? devTs * 1000 : devTs);
                if (!isNaN(d.getTime()) && d.getFullYear() > 1970) {
                    const dPart = d.toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: '2-digit', year: 'numeric' });
                    const tPart = d.toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).replace(/\./g, ':');
                    joinSince = `${dPart} ${tPart}`;
                }
            }
        }

        // 4. Parse Status / Bio and Set Date in Real-Time
        let statusObj = item?.status || null;
        if (statusObj && typeof statusObj === 'object' && statusObj.status && typeof statusObj.status === 'object') {
            statusObj = statusObj.status;
        }

        if (!statusObj || (!statusObj.status && !statusObj.setAt)) {
            try {
                const sRaw = await sess.fetchStatus(jid).catch(() => null);
                if (sRaw && Array.isArray(sRaw) && sRaw[0]) {
                    statusObj = (sRaw[0] && sRaw[0].status && typeof sRaw[0].status === 'object') ? sRaw[0].status : sRaw[0];
                }
            } catch (_) {}
        }

        let bio = '-';
        let bioSetDate = '-';
        let rawBio = typeof statusObj === 'string' ? statusObj : (statusObj?.status ?? statusObj?.statusText ?? null);
        if (typeof rawBio === 'object' && rawBio !== null) {
            rawBio = rawBio.status ?? rawBio.statusText ?? null;
        }

        if (rawBio && typeof rawBio === 'string' && rawBio.trim()) {
            bio = rawBio.trim();
        }

        const rawSetAt = statusObj?.setAt ?? statusObj?.t ?? null;
        if (rawSetAt) {
            let d = null;
            if (rawSetAt instanceof Date) {
                d = rawSetAt;
            } else if (typeof rawSetAt === 'number') {
                d = new Date(rawSetAt < 1e11 ? rawSetAt * 1000 : rawSetAt);
            } else if (typeof rawSetAt === 'string') {
                const numTs = Number(rawSetAt);
                if (!isNaN(numTs) && numTs > 1e8) {
                    d = new Date(numTs < 1e11 ? numTs * 1000 : numTs);
                } else {
                    d = new Date(rawSetAt);
                }
            }

            if (d && !isNaN(d.getTime()) && d.getFullYear() > 1970) {
                const dPart = d.toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: '2-digit', year: 'numeric' });
                const tPart = d.toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).replace(/\./g, ':');
                bioSetDate = `${dPart} ${tPart}`;
            }
        }

        return {
            number: cleanNum,
            isRegistered: true,
            isBusiness: !!bp,
            bio,
            bioSetDate,
            joinSince: joinSince || '-',
            businessDetails: bp
        };
    },

    async checkFlagMerah(phoneNumber, userId = null) {
        const cleanNum = String(phoneNumber || '').replace(/\D/g, '');
        if (!cleanNum || cleanNum.length < 7) {
            throw new Error('Nomor tidak valid (terlalu pendek).');
        }

        // 1. Cek langsung ke server WhatsApp Registration Endpoint (/v2/exist)
        const realtimeStatus = await this.detectRealtimeStatus(cleanNum);

        // 2. Cek apakah ada sesi WhatsApp yang terhubung untuk USync profiling
        let sess = null;
        if (userId) {
            const uid = String(userId);
            if (sessions.has(uid)) {
                for (const [sId, sock] of sessions.get(uid).entries()) {
                    if (sessionStatus.get(`${uid}_${sId}`) === 'CONNECTED') {
                        sess = sock;
                        break;
                    }
                }
            }
        }
        if (!sess) {
            for (const [uid, userSess] of sessions.entries()) {
                for (const [sId, sock] of userSess.entries()) {
                    if (sessionStatus.get(`${uid}_${sId}`) === 'CONNECTED') {
                        sess = sock;
                        break;
                    }
                }
                if (sess) break;
            }
        }

        let socketCheck = null;
        if (sess) {
            try {
                const jid = `${cleanNum}@s.whatsapp.net`;
                const q = new USyncQuery()
                    .withContactProtocol()
                    .withStatusProtocol()
                    .withDeviceProtocol();
                q.withUser(new USyncUser().withPhone(`+${cleanNum}`));

                const res = await sess.executeUSyncQuery(q).catch(() => null);
                const item = res?.list?.[0] || null;
                const isRegistered = !!(item && item.contact);

                let hasPp = false, ppErrCode = 0;
                try {
                    const ppRaw = await Promise.race([
                        sess.profilePictureUrl(jid, 'image').catch(e => ({
                            _err: true, _code: e?.output?.statusCode ?? e?.data?.statusCode ?? 0
                        })),
                        new Promise(r => setTimeout(() => r(null), 1000))
                    ]);
                    if (typeof ppRaw === 'string' && ppRaw) { hasPp = true; }
                    else if (ppRaw?._err) { ppErrCode = ppRaw._code || 0; }
                } catch (_) {}

                let statusObj = item?.status || null;
                let rawBio = typeof statusObj === 'string' ? statusObj : (statusObj?.status ?? null);
                let hasBio = !!(rawBio && typeof rawBio === 'string' && rawBio.trim() !== '');

                socketCheck = {
                    isRegistered,
                    hasPp,
                    ppErrCode,
                    hasBio,
                    bio: rawBio || '-',
                    item
                };
            } catch (_) {}
        }

        // 3. Klasifikasi Tingkat Flag / Titik Merah
        let flagCategory = 'CLEAN';
        let flagLabel = '🟢 BERSIH (Tidak Ada Tanda Merah)';
        let flagDescription = 'Nomor aman, tidak terdeteksi pembatasan atau flagging oleh WhatsApp.';
        let indicators = [];

        if (realtimeStatus.status === 'banned') {
            flagCategory = 'BANNED';
            flagLabel = '🔴 FLAG MERAH: BANNED / NONAKTIF (In-App Appeal)';
            const vt = realtimeStatus.raw?.violation_type || '';
            flagDescription = `Nomor ini telah diblokir/banned oleh sistem Trust & Safety WhatsApp${vt ? ` karena pelanggaran: ${vt}` : ''}. Tombol banding (Minta Tinjauan) aktif.`;
            indicators.push('🔴 Server WA mengembalikan status BANNED');
            if (vt) indicators.push(`🔴 Violation Type: ${vt}`);
            if (realtimeStatus.raw?.appeal_token) indicators.push('🔴 In-App Appeal Token Terdeteksi');
        } else if (realtimeStatus.status === 'blocked') {
            flagCategory = 'BLOCKED_CBS';
            flagLabel = '🔴 FLAG MERAH: CUSTOM BLOCK SCREEN (WA Resmi Diperlukan)';
            flagDescription = 'Nomor ini ditandai oleh Meta karena terdeteksi aktivitas mencurigakan / penggunaan client tidak resmi.';
            indicators.push('🔴 Server WA mengembalikan Custom Block Screen (CBS)');
            indicators.push('🔴 Muncul peringatan "Perlu WhatsApp Resmi" saat login');
        } else if (socketCheck && !socketCheck.isRegistered) {
            flagCategory = 'UNREGISTERED';
            flagLabel = '⚪ TIDAK TERDAFTAR';
            flagDescription = 'Nomor belum pernah dibuat atau sudah dinonaktifkan dari WhatsApp.';
            indicators.push('⚪ Nomor tidak terdaftar di database WhatsApp');
        } else {
            const smsWait = realtimeStatus.sms?.waitSec || 0;
            const waOldWait = realtimeStatus.wa_old?.waitSec || 0;
            const isRestrictedPp = socketCheck && !socketCheck.hasPp && (socketCheck.ppErrCode === 401 || socketCheck.ppErrCode === 403);
            const isNoBio = socketCheck && !socketCheck.hasBio;

            if (isRestrictedPp && isNoBio) {
                flagCategory = 'SHADOW_FLAGGED';
                flagLabel = '🟠 FLAG ORANGE: SHADOW-FLAGGED (Risiko / Pembatasan Profil)';
                flagDescription = 'Profil nomor ini dibatasi oleh server Meta (foto profil & status terkunci 401/403). Sering terjadi pada nomor yang sering dilaporkan/spam.';
                indicators.push('🟠 Foto profil & status dibatasi server WhatsApp (Code 401/403)');
                if (smsWait > 0) indicators.push(`🟡 Sedang dalam masa Cooldown SMS: ${realtimeStatus.sms?.cooldownFmt}`);
            } else if (smsWait > 0 || waOldWait > 0) {
                flagCategory = 'COOLDOWN';
                flagLabel = '🟡 FLAG KUNING: COOLDOWN / RATE LIMITED';
                flagDescription = `Nomor sedang terkena limit cooldown OTP (${realtimeStatus.sms?.cooldownFmt || 'Cooldown'}).`;
                indicators.push(`🟡 SMS Cooldown: ${realtimeStatus.sms?.cooldownFmt || '-'}`);
                if (realtimeStatus.isWaOldAvailable) {
                    indicators.push(`🟡 WA Old Cooldown: ${realtimeStatus.wa_old?.cooldownFmt || '-'}`);
                }
            } else {
                indicators.push('🟢 Endpoint /v2/exist berstatus READY');
                indicators.push('🟢 Tidak ada laporan banned atau custom block screen');
                if (socketCheck?.hasBio) indicators.push(`🟢 Bio aktif: "${socketCheck.bio}"`);
            }
        }

        return {
            number: cleanNum,
            flagCategory,
            flagLabel,
            flagDescription,
            indicators,
            realtimeStatus,
            socketCheck
        };
    }
}

setInterval(() => {
    try {
        if (!fs.existsSync(SESSION_DIR)) return;
        const files = fs.readdirSync(SESSION_DIR);
        const now = Date.now();
        let deletedCount = 0;
        for (const file of files) {
            if ((file.startsWith('HasilCekBio') || file.startsWith('HasilDetect')) && (file.endsWith('.txt') || file.endsWith('.xlsx'))) {
                const filePath = path.join(SESSION_DIR, file);
                const stats = fs.statSync(filePath);
                if (now - stats.mtimeMs > 3600000) {
                    fs.unlinkSync(filePath);
                    deletedCount++;
                }
            }
        }
        if (deletedCount > 0) {
            logger.add('SYSTEM', `Auto-cleaned ${deletedCount} old CekBio report files`);
        }
    } catch (e) {
        logger.add('ERROR', `Auto-clean CekBio files failed: ${e.message}`);
    }
}, 60000);

module.exports = WaManager;
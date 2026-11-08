const fs = require('fs');
const path = require('path');
const moment = require('moment');

const colors = {
    reset: "\x1b[0m",
    bright: "\x1b[1m",
    dim: "\x1b[2m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    magenta: "\x1b[35m",
    cyan: "\x1b[36m",
    white: "\x1b[37m",
    gold: "\x1b[38;5;214m",
    orange: "\x1b[38;5;208m",
    pink: "\x1b[38;5;205m",
    purple: "\x1b[38;5;129m",
    gray: "\x1b[38;5;240m",
    lime: "\x1b[38;5;154m",
    teal: "\x1b[38;5;38m"
};

class Logger {
    constructor() {
        this.logs = [];
        this.printBuffer = [];
        this.isReady = false;
        this.MAX_LOGS = 200;
        this.startTime = new Date();
        this.totalAppeals = 0;
        this.totalSuccess = 0;
        this.totalFailed = 0;
        this.logPath = path.join(__dirname, '../latest.log');
        this.crashLogPath = path.join(__dirname, '../crash.log');
        this.ensureLogFiles();
        this.rotateLogIfNeeded();
    }

    ensureLogFiles() {
        if (!fs.existsSync(this.logPath)) {
            fs.writeFileSync(this.logPath, '=== Bot Activity Log ===\n');
        }
        if (!fs.existsSync(this.crashLogPath)) {
            fs.writeFileSync(this.crashLogPath, '=== CRASH LOG ===\n');
        }
    }

    rotateLogIfNeeded() {
        try {
            const stat = fs.statSync(this.logPath);
            if (stat.size > 5 * 1024 * 1024) {
                const backup = this.logPath + '.1';
                if (fs.existsSync(backup)) fs.unlinkSync(backup);
                fs.renameSync(this.logPath, backup);
                fs.writeFileSync(this.logPath, '=== Log rotated ===\n');
            }
        } catch (e) {}
    }

    add(type, message, stack = '') {
        const time = new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' });
        const fullTime = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
        const ms = Date.now() % 1000;
        const logEntry = { time: fullTime, type: type, msg: message, stack: stack || '' };

        this.logs.unshift(logEntry);
        if (this.logs.length > this.MAX_LOGS) this.logs.pop();

        let logString = `[${fullTime}.${ms.toString().padStart(3,'0')}] [${type}] ${message}\n`;
        if (stack) logString += `Stack: ${stack}\n`;

        try {
            fs.appendFileSync(this.logPath, logString, 'utf8');
            if (type === 'CRITICAL' || type === 'ERROR') {
                fs.appendFileSync(this.crashLogPath, logString, 'utf8');
            }
        } catch (e) {}

        let color = colors.reset;
        if (type === 'SUCCESS' || type === 'SYSTEM') color = colors.green;
        else if (type === 'ERROR' || type === 'CRITICAL') color = colors.red;
        else if (type === 'INFO') color = colors.cyan;
        else if (type === 'BROADCAST') color = colors.yellow;
        else if (type === 'WA') color = colors.blue;
        else if (type === 'DEBUG') color = colors.dim;
        else if (type === 'REPLY') color = colors.gold;

        const formattedLog = `${colors.bright}[${time}.${ms}] ${color}[${type}]${colors.reset} ${message}`;

        if (!this.isReady) {
            this.printBuffer.push({ type, log: formattedLog, stack });
        } else {
            console.log(formattedLog);
            if (stack) console.log(colors.red + stack + colors.reset);
        }
    }

    showBanner() {
        console.clear();
        console.log(`\n${colors.magenta}  ┌──────────────────────────────────────┐${colors.reset}`);
        console.log(`${colors.gold}  │     ✦  WA CEK BIO  ✦     │${colors.reset}`);
        console.log(`${colors.magenta}  └──────────────────────────────────────┘${colors.reset}\n`);
        console.log(`${colors.cyan}  ▸ Runtime    : Node.js${colors.reset}`);
        console.log(`${colors.cyan}  ▸ Developer  : @oziwl${colors.reset}`);
        console.log(`${colors.cyan}  ▸ Telegram   : @oziwl${colors.reset}`);
        console.log(`${colors.cyan}  ▸ Channel    : -${colors.reset}`);
        console.log(`\n${colors.magenta}  ──────────────────────────────────────${colors.reset}\n`);
    }

    showStatus(botUsername, totalUsers, premiumCount, emailCount) {
        const uptime = this.getUptime();

        console.log(`${colors.green}  ┌──── SYSTEM MONITOR ─────────────────────┐${colors.reset}`);
        console.log(`${colors.cyan}  ▸ Bot      : @${botUsername}${colors.reset}`);
        console.log(`${colors.cyan}  ▸ Start    : ${moment(this.startTime).format('YYYY-MM-DD HH:mm:ss')}${colors.reset}`);
        console.log(`${colors.cyan}  ▸ Uptime   : ${uptime}${colors.reset}`);
        console.log(`${colors.cyan}  ▸ Users    : ${totalUsers} total │ ${premiumCount} premium${colors.reset}`);
        console.log(`${colors.green}  ├──── STATISTIK ──────────────────────────┤${colors.reset}`);
        console.log(`${colors.white}  ▸ Total    : ${this.totalAppeals}${colors.reset}`);
        console.log(`${colors.green}  ▸ Sukses   : ${this.totalSuccess}${colors.reset}`);
        console.log(`${colors.red}  ▸ Gagal    : ${this.totalFailed}${colors.reset}`);
        console.log(`${colors.green}  └─────────────────────────────────────────┘${colors.reset}\n`);

        this.isReady = true;
        if (this.printBuffer.length > 0) {
            const orderMap = { 'SYSTEM': 1, 'WA': 2, 'IMAP': 3 };
            this.printBuffer.sort((a, b) => {
                const orderA = orderMap[a.type] || 99;
                const orderB = orderMap[b.type] || 99;
                return orderA - orderB;
            });
            this.printBuffer.forEach(entry => {
                console.log(entry.log);
                if (entry.stack) console.log(colors.red + entry.stack + colors.reset);
            });
            this.printBuffer = [];
        }
    }

    logAction(userId, target, status, emailUsed) {
        this.totalAppeals++;
        if (status === 'SUCCESS') this.totalSuccess++;
        else this.totalFailed++;

        const timestamp = moment().format('HH:mm:ss');
        const colorStatus = status === 'SUCCESS' ? colors.green : colors.red;
        
        const logMsg = `${colors.cyan}[${timestamp}]${colors.reset} ${colorStatus}[${status}]${colors.reset} ${colors.white}Target: ${target} | User: ${userId} | via: ${emailUsed}${colors.reset}`;
        console.log(logMsg);
        this.add('ACTION', `Target: ${target} | User: ${userId} | via: ${emailUsed} | Status: ${status}`);
    }

    getUptime() {
        const diff = new Date() - this.startTime;
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);
        return `${days}d ${hours}h ${minutes}m ${seconds}s`;
    }

    getLogs(limit = 15) {
        return this.logs.slice(0, limit);
    }

    clear() {
        this.logs.length = 0;
    }

    debug(message) {
        this.add('DEBUG', message);
    }
}

module.exports = new Logger();
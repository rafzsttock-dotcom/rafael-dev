# Deploy Bot — Telegram Multi-VPS Deployment Manager

**Date:** 2026-11-07  
**Author:** rafzsttock@gmail.com

## Overview

A Telegram bot built with Node.js that acts as a deployment manager for multiple VPS servers. The bot allows the owner to SSH into any registered VPS and deploy websites, bots, or any project — all from Telegram with clean inline keyboard UI.

## Tech Stack

- **Runtime:** Node.js
- **Bot Framework:** grammY
- **SSH:** node-ssh
- **Storage:** JSON file (data/config.json)
- **Process Manager:** pm2 (for running the bot itself)

## Security

- Bot only responds to `OWNER_CHAT_ID` set in `.env`
- All other users are silently ignored
- Credentials stored locally in `data/config.json` (gitignored)

## Environment Variables

```env
BOT_TOKEN=        # from @BotFather
OWNER_CHAT_ID=    # from @userinfobot
```

Both are required. Bot exits with clear error message if either is missing.

## File Structure

```
deploy-bot/
├── src/
│   ├── index.js              # entry point + env validation
│   ├── bot.js                # grammY bot setup
│   ├── handlers/
│   │   ├── menu.js           # main menu
│   │   ├── vps.js            # add/remove/list VPS
│   │   ├── deploy.js         # run deploy scripts
│   │   └── status.js         # check service status
│   ├── services/
│   │   ├── ssh.js            # SSH connection + command runner
│   │   └── storage.js        # read/write config.json
│   └── keyboards/
│       └── index.js          # all inline keyboards centralized
├── data/
│   └── config.json           # VPS data (gitignored)
├── .env
├── .env.example
├── package.json
└── ecosystem.config.js       # pm2 config
```

## Data Schema (config.json)

```json
{
  "vps": [
    {
      "id": "abc123",
      "name": "VPS Production",
      "host": "1.2.3.4",
      "port": 22,
      "user": "root",
      "authType": "password",
      "password": "secret",
      "projects": [
        {
          "id": "proj1",
          "name": "Portfolio",
          "type": "website",
          "path": "/var/www/portfolio",
          "deployScript": "git pull && npm ci && npm run build && pm2 restart portfolio"
        }
      ]
    }
  ]
}
```

`authType` is `"password"` or `"key"` (path to private key file).

## Bot Menus

### Main Menu (/start)
- 🖥 VPS List
- ➕ Add VPS
- 📊 Status All

### VPS Detail
- 🚀 Deploy
- 📊 Status
- ⚡ Run CMD
- 🗑 Delete
- ← Back

### Deploy Flow
1. Select VPS → Select Project → Confirm → Execute
2. Bot edits message every few seconds with live output
3. Final message shows success/failure + duration

### Add VPS Flow (conversation)
1. Name → Host/IP → Port → Username → Auth type → Password/Key path → Test connection → Save

## Deploy Output (simulated live)

```
🚀 Deploying Portfolio on VPS Production...

📡 Connecting... ✅
📥 git pull... done
📦 npm ci... done
🔨 npm run build... done
♻️  pm2 restart... done

✅ Deploy complete! (38s)
```

## pm2 Setup

```js
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'deploy-bot',
    script: 'src/index.js',
    restart_delay: 3000,
    max_restarts: 10
  }]
}
```

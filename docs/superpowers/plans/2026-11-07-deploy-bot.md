# Deploy Bot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Telegram bot (Node.js) that manages SSH deployments across multiple VPS servers with inline keyboard UI.

**Architecture:** grammY bot with owner-only auth middleware; conversations plugin handles multi-step add-VPS flow; node-ssh runs deploy scripts on remote servers; JSON file stores all VPS/project configs.

**Tech Stack:** Node.js, grammY v1, @grammyjs/conversations, node-ssh, dotenv, Jest

**Spec:** `docs/superpowers/specs/2026-11-07-deploy-bot-design.md`

## Global Constraints

- All files live under `deploy-bot/` in repo root
- Node.js ≥ 18
- Bot silently ignores any message not from `OWNER_CHAT_ID`
- `data/config.json` and `.env` are gitignored
- No external DB — JSON file only
- Keyboard callbacks use pattern `action:param1:param2` (colon-separated)

## Review Focus

- SSH connection with wrong password should show friendly error, not crash the bot
- Deploy script that exits non-zero should show failure message with exit code
- Adding a VPS while another add-VPS conversation is in progress should restart cleanly
- Callback queries from old messages (stale keyboards) should be answered gracefully
- Empty VPS list on "🖥 VPS List" should show helpful empty state, not crash

---

## File Map

| File | Responsibility |
|---|---|
| `src/index.js` | Env validation, bot start |
| `src/bot.js` | grammY instance, middleware, handler registration |
| `src/services/storage.js` | Read/write config.json, CRUD for VPS + projects |
| `src/services/ssh.js` | SSH connect, runCommand, testConnection |
| `src/keyboards/index.js` | All InlineKeyboard builders |
| `src/handlers/menu.js` | /start, main_menu callback |
| `src/handlers/vps.js` | VPS list, detail, delete, add-VPS conversation |
| `src/handlers/deploy.js` | Deploy flow: pick project → confirm → execute → live output |
| `src/handlers/status.js` | Per-VPS pm2 status, Status All |
| `src/handlers/cmd.js` | Run CMD: ask → execute → reply |
| `tests/storage.test.js` | Unit tests for storage service |
| `tests/ssh.test.js` | Unit tests for ssh service (mocked node-ssh) |

---

### Task 1: Project Scaffold

**Files:**
- Create: `deploy-bot/package.json`
- Create: `deploy-bot/.env.example`
- Create: `deploy-bot/.gitignore`
- Create: `deploy-bot/data/config.json`
- Create: `deploy-bot/ecosystem.config.js`

- [ ] **Step 1: Create `deploy-bot/` directory and `package.json`**

```json
{
  "name": "deploy-bot",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "start": "node src/index.js",
    "dev": "node --watch src/index.js",
    "test": "node --experimental-vm-modules node_modules/.bin/jest"
  },
  "dependencies": {
    "grammy": "^1.21.0",
    "@grammyjs/conversations": "^1.2.0",
    "node-ssh": "^13.1.0",
    "dotenv": "^16.4.0"
  },
  "devDependencies": {
    "jest": "^29.7.0"
  },
  "jest": {
    "testEnvironment": "node",
    "transform": {}
  }
}
```

- [ ] **Step 2: Create `.env.example`**

```env
BOT_TOKEN=        # from @BotFather
OWNER_CHAT_ID=    # from @userinfobot (send /start to get your ID)
```

- [ ] **Step 3: Create `.gitignore`**

```
node_modules/
.env
data/config.json
```

- [ ] **Step 4: Create `data/config.json` with empty state**

```json
{ "vps": [] }
```

- [ ] **Step 5: Create `ecosystem.config.js`**

```js
export default {
  apps: [{
    name: 'deploy-bot',
    script: 'src/index.js',
    restart_delay: 3000,
    max_restarts: 10
  }]
}
```

- [ ] **Step 6: Run `npm install` from `deploy-bot/`**

Expected: `node_modules/` created, no errors.

- [ ] **Step 7: Commit**

```bash
git add deploy-bot/
git commit -m "feat: scaffold deploy-bot project"
```

---

### Task 2: Storage Service

**Files:**
- Create: `deploy-bot/src/services/storage.js`
- Create: `deploy-bot/tests/storage.test.js`

**Produces:**
- `loadConfig()` → `{ vps: VPS[] }`
- `saveConfig(config)` → void
- `addVPS(vpsData)` → `VPS` (with generated `id`)
- `removeVPS(id)` → void
- `getVPS(id)` → `VPS | undefined`
- `listVPS()` → `VPS[]`
- `addProject(vpsId, projectData)` → `Project` (with generated `id`)
- `removeProject(vpsId, projectId)` → void

VPS shape: `{ id, name, host, port, user, authType, password?, keyPath?, projects: [] }`  
Project shape: `{ id, name, type, path, deployScript }`

- [ ] **Step 1: Write failing tests**

```js
// tests/storage.test.js
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// Override CONFIG_PATH before importing
const tmpDir = mkdtempSync(join(tmpdir(), 'deploy-bot-'))
process.env.CONFIG_PATH = join(tmpDir, 'config.json')
writeFileSync(process.env.CONFIG_PATH, JSON.stringify({ vps: [] }))

const { addVPS, listVPS, getVPS, removeVPS, addProject, removeProject } = await import('../src/services/storage.js')

test('addVPS returns vps with id', () => {
  const vps = addVPS({ name: 'VPS1', host: '1.2.3.4', port: 22, user: 'root', authType: 'password', password: 'pass' })
  expect(vps.id).toBeDefined()
  expect(vps.name).toBe('VPS1')
  expect(vps.projects).toEqual([])
})

test('listVPS returns added vps', () => {
  expect(listVPS().length).toBeGreaterThan(0)
})

test('getVPS returns vps by id', () => {
  const vps = listVPS()[0]
  expect(getVPS(vps.id)).toMatchObject({ name: 'VPS1' })
})

test('addProject adds project to vps', () => {
  const vps = listVPS()[0]
  const proj = addProject(vps.id, { name: 'Portfolio', type: 'website', path: '/var/www', deployScript: 'git pull' })
  expect(proj.id).toBeDefined()
  expect(getVPS(vps.id).projects).toHaveLength(1)
})

test('removeProject removes project', () => {
  const vps = listVPS()[0]
  const proj = vps.projects[0]
  removeProject(vps.id, proj.id)
  expect(getVPS(vps.id).projects).toHaveLength(0)
})

test('removeVPS removes vps', () => {
  const vps = listVPS()[0]
  removeVPS(vps.id)
  expect(listVPS()).toHaveLength(0)
})
```

- [ ] **Step 2: Run tests — verify they FAIL**

```bash
cd deploy-bot && npm test -- tests/storage.test.js
```
Expected: module not found error.

- [ ] **Step 3: Implement `src/services/storage.js`**

Use `process.env.CONFIG_PATH` with fallback to `new URL('../../data/config.json', import.meta.url)`.  
Use `crypto.randomUUID()` for ids.  
`loadConfig` reads and JSON-parses the file.  
`saveConfig` JSON-stringifies with 2-space indent and writes.  
All mutating functions call `loadConfig`, mutate, call `saveConfig`, return the item.

- [ ] **Step 4: Run tests — verify they PASS**

```bash
cd deploy-bot && npm test -- tests/storage.test.js
```

- [ ] **Step 5: Commit**

```bash
git add deploy-bot/src/services/storage.js deploy-bot/tests/storage.test.js
git commit -m "feat: storage service with CRUD for VPS and projects"
```

---

### Task 3: SSH Service

**Files:**
- Create: `deploy-bot/src/services/ssh.js`
- Create: `deploy-bot/tests/ssh.test.js`

**Produces:**
- `connectSSH(vpsConfig)` → `NodeSSH instance`
- `runCommand(ssh, cmd, cwd)` → `{ stdout, stderr, code }`
- `testConnection(vpsConfig)` → `{ ok: boolean, error?: string }`
- `disconnectSSH(ssh)` → void

- [ ] **Step 1: Write failing tests**

```js
// tests/ssh.test.js
import { jest } from '@jest/globals'

// Mock node-ssh
const mockSSH = {
  connect: jest.fn().mockResolvedValue(undefined),
  execCommand: jest.fn().mockResolvedValue({ stdout: 'ok', stderr: '', code: 0 }),
  dispose: jest.fn()
}
jest.unstable_mockModule('node-ssh', () => ({ NodeSSH: jest.fn(() => mockSSH) }))

const { connectSSH, runCommand, testConnection, disconnectSSH } = await import('../src/services/ssh.js')

const vpsConfig = { host: '1.2.3.4', port: 22, user: 'root', authType: 'password', password: 'pass' }

test('connectSSH calls ssh.connect with correct params', async () => {
  await connectSSH(vpsConfig)
  expect(mockSSH.connect).toHaveBeenCalledWith({ host: '1.2.3.4', port: 22, username: 'root', password: 'pass' })
})

test('runCommand returns stdout and code', async () => {
  const result = await runCommand(mockSSH, 'ls', '/var/www')
  expect(result).toMatchObject({ stdout: 'ok', code: 0 })
})

test('testConnection returns ok:true on success', async () => {
  const result = await testConnection(vpsConfig)
  expect(result.ok).toBe(true)
})

test('testConnection returns ok:false on SSH error', async () => {
  mockSSH.connect.mockRejectedValueOnce(new Error('auth failed'))
  const result = await testConnection(vpsConfig)
  expect(result.ok).toBe(false)
  expect(result.error).toMatch(/auth failed/)
})
```

- [ ] **Step 2: Run tests — verify they FAIL**

```bash
cd deploy-bot && npm test -- tests/ssh.test.js
```

- [ ] **Step 3: Implement `src/services/ssh.js`**

`connectSSH`: build connect options from `vpsConfig` — if `authType === 'key'` use `privateKeyPath: vpsConfig.keyPath` else `password: vpsConfig.password`; call `ssh.connect(opts)`.  
`runCommand`: call `ssh.execCommand(cmd, { cwd })`, return `{ stdout, stderr, code }`.  
`testConnection`: wrap `connectSSH` in try/catch; on success run `echo ok` then `dispose`; return `{ ok: true }` or `{ ok: false, error: err.message }`.  
`disconnectSSH`: call `ssh.dispose()`.

- [ ] **Step 4: Run tests — verify they PASS**

```bash
cd deploy-bot && npm test -- tests/ssh.test.js
```

- [ ] **Step 5: Commit**

```bash
git add deploy-bot/src/services/ssh.js deploy-bot/tests/ssh.test.js
git commit -m "feat: SSH service with connect, runCommand, testConnection"
```

---

### Task 4: Keyboards

**Files:**
- Create: `deploy-bot/src/keyboards/index.js`

**Produces:**
- `mainMenuKeyboard()` → `InlineKeyboard`
- `vpsListKeyboard(vpsList)` → `InlineKeyboard`
- `vpsDetailKeyboard(vpsId)` → `InlineKeyboard`
- `deployProjectKeyboard(projects, vpsId)` → `InlineKeyboard`
- `confirmDeployKeyboard(vpsId, projectId)` → `InlineKeyboard`
- `authTypeKeyboard()` → `InlineKeyboard`
- `statusDetailKeyboard(vpsId)` → `InlineKeyboard`
- `deleteConfirmKeyboard(vpsId)` → `InlineKeyboard`

Callback data patterns:
- `main_menu`
- `vps_list`
- `vps_detail:${vpsId}`
- `deploy_pick:${vpsId}`
- `deploy_confirm:${vpsId}:${projectId}`
- `deploy_run:${vpsId}:${projectId}`
- `status:${vpsId}`
- `status_all`
- `run_cmd:${vpsId}`
- `vps_delete:${vpsId}`
- `vps_delete_confirm:${vpsId}`
- `auth_password` / `auth_key`

- [ ] **Step 1: Implement `src/keyboards/index.js`**

Import `{ InlineKeyboard }` from `grammy`.  
Each function creates and returns an `InlineKeyboard` instance using `.text(label, callbackData)` and `.row()` for layout.  
`vpsListKeyboard`: one button per VPS using `vps_detail:${v.id}`, plus a `➕ Add VPS` button with callback `add_vps`, plus `← Back` → `main_menu`.  
`vpsDetailKeyboard`: four buttons in 2×2 grid + back row.  
`deployProjectKeyboard`: one button per project + back row.  
`confirmDeployKeyboard`: `✅ Deploy` + `❌ Cancel` → `main_menu`.

- [ ] **Step 2: Manual smoke check**

No automated test — keyboards are pure data builders verified visually. Verify no import errors:

```bash
cd deploy-bot && node -e "import('./src/keyboards/index.js').then(k => console.log(Object.keys(k)))"
```
Expected: lists all exported function names.

- [ ] **Step 3: Commit**

```bash
git add deploy-bot/src/keyboards/index.js
git commit -m "feat: inline keyboard builders"
```

---

### Task 5: Bot Setup + Auth Middleware + Entry Point

**Files:**
- Create: `deploy-bot/src/bot.js`
- Create: `deploy-bot/src/index.js`

**Produces:**
- `bot` — grammY `Bot` instance (default export from bot.js)
- `index.js` validates env and starts bot

- [ ] **Step 1: Implement `src/bot.js`**

```js
import { Bot, session } from 'grammy'
import { conversations, createConversation } from '@grammyjs/conversations'

export const bot = new Bot(process.env.BOT_TOKEN)

// Owner-only middleware
bot.use((ctx, next) => {
  if (String(ctx.from?.id) !== process.env.OWNER_CHAT_ID) return
  return next()
})

bot.use(session({ initial: () => ({}) }))
bot.use(conversations())
```

- [ ] **Step 2: Implement `src/index.js`**

Validate env on import: if `!process.env.BOT_TOKEN` log `❌ BOT_TOKEN kosong! Isi dulu di file .env` and `process.exit(1)`; same for `OWNER_CHAT_ID`.  
Import `'dotenv/config'` first line.  
Import `bot` from `./bot.js`.  
Import and register all handlers (stubs for now — will be filled in later tasks).  
Call `bot.start()` with `onStart: () => console.log('🤖 Deploy Bot running...')`.

- [ ] **Step 3: Verify env validation works**

```bash
cd deploy-bot && node src/index.js
```
Expected: `❌ BOT_TOKEN kosong! Isi dulu di file .env` and exit 1 (since .env is empty).

- [ ] **Step 4: Commit**

```bash
git add deploy-bot/src/bot.js deploy-bot/src/index.js
git commit -m "feat: bot setup with owner-only auth middleware"
```

---

### Task 6: Main Menu Handler

**Files:**
- Create: `deploy-bot/src/handlers/menu.js`
- Modify: `deploy-bot/src/index.js` — register menu handler

**Consumes:** `mainMenuKeyboard()` from keyboards

- [ ] **Step 1: Implement `src/handlers/menu.js`**

```js
export function registerMenuHandlers(bot) {
  bot.command('start', async (ctx) => {
    await ctx.reply(
      '🤖 *Deploy Bot*\n\nPilih aksi:',
      { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard() }
    )
  })

  bot.callbackQuery('main_menu', async (ctx) => {
    await ctx.answerCallbackQuery()
    await ctx.editMessageText(
      '🤖 *Deploy Bot*\n\nPilih aksi:',
      { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard() }
    )
  })
}
```

- [ ] **Step 2: Register in `src/index.js`**

Import `registerMenuHandlers` and call with `bot` before `bot.start()`.

- [ ] **Step 3: Commit**

```bash
git add deploy-bot/src/handlers/menu.js deploy-bot/src/index.js
git commit -m "feat: main menu /start handler"
```

---

### Task 7: VPS Handlers (List, Detail, Delete, Add VPS Conversation)

**Files:**
- Create: `deploy-bot/src/handlers/vps.js`
- Modify: `deploy-bot/src/index.js` — register vps handlers + conversation

**Consumes:** `listVPS`, `addVPS`, `removeVPS`, `addProject` from storage; `testConnection` from ssh; `vpsListKeyboard`, `vpsDetailKeyboard`, `deleteConfirmKeyboard`, `authTypeKeyboard` from keyboards

- [ ] **Step 1: Implement VPS list callback**

`vps_list` callback: call `listVPS()`; if empty reply `"Belum ada VPS. Tambah dulu!"` with Add VPS button; else show `vpsListKeyboard(vpsList)`.

- [ ] **Step 2: Implement VPS detail callback**

`vps_detail:*` callback: parse `vpsId` from callback data; get VPS; reply with VPS info + `vpsDetailKeyboard(vpsId)`.

```
🖥 *VPS Production*
Host: 1.2.3.4
User: root | Port: 22
Auth: password
Projects: 2
```

- [ ] **Step 3: Implement delete flow**

`vps_delete:*` → show `deleteConfirmKeyboard(vpsId)` with warning message.  
`vps_delete_confirm:*` → call `removeVPS(vpsId)` → edit message to `✅ VPS dihapus.` + back button.

- [ ] **Step 4: Implement add-VPS conversation**

```js
async function addVpsConversation(conversation, ctx) {
  await ctx.reply('📝 Nama VPS? (contoh: VPS Production)')
  const name = (await conversation.waitFor('message:text')).message.text

  await ctx.reply('🌐 Host / IP?')
  const host = (await conversation.waitFor('message:text')).message.text

  await ctx.reply('🔌 Port SSH? (default: 22, kirim 22 untuk skip)')
  const portStr = (await conversation.waitFor('message:text')).message.text
  const port = parseInt(portStr) || 22

  await ctx.reply('👤 Username? (contoh: root)')
  const user = (await conversation.waitFor('message:text')).message.text

  await ctx.reply('🔐 Tipe auth?', { reply_markup: authTypeKeyboard() })
  const authCtx = await conversation.waitFor('callback_query')
  await authCtx.answerCallbackQuery()
  const authType = authCtx.callbackQuery.data === 'auth_key' ? 'key' : 'password'

  let password, keyPath
  if (authType === 'password') {
    await ctx.reply('🔑 Password:')
    password = (await conversation.waitFor('message:text')).message.text
  } else {
    await ctx.reply('📄 Path ke private key (contoh: /root/.ssh/id_rsa):')
    keyPath = (await conversation.waitFor('message:text')).message.text
  }

  const testMsg = await ctx.reply('📡 Testing koneksi...')
  const result = await testConnection({ host, port, user, authType, password, keyPath })

  if (!result.ok) {
    await ctx.api.editMessageText(ctx.chat.id, testMsg.message_id, `❌ Koneksi gagal: ${result.error}`)
    return
  }

  addVPS({ name, host, port, user, authType, password, keyPath })
  await ctx.api.editMessageText(ctx.chat.id, testMsg.message_id, `✅ VPS *${name}* berhasil ditambahkan!`, { parse_mode: 'Markdown' })
}
```

Register with `bot.use(createConversation(addVpsConversation))`.  
`add_vps` callback: `await ctx.conversation.enter('addVpsConversation')`.

- [ ] **Step 5: Register all VPS handlers in `src/index.js`**

- [ ] **Step 6: Commit**

```bash
git add deploy-bot/src/handlers/vps.js deploy-bot/src/index.js
git commit -m "feat: VPS list, detail, delete, and add-VPS conversation"
```

---

### Task 8: Deploy Handler

**Files:**
- Create: `deploy-bot/src/handlers/deploy.js`
- Modify: `deploy-bot/src/index.js`

**Consumes:** `getVPS` from storage; `connectSSH`, `runCommand`, `disconnectSSH` from ssh; `deployProjectKeyboard`, `confirmDeployKeyboard` from keyboards

- [ ] **Step 1: Implement deploy project selection**

`deploy_pick:*` callback: get VPS projects; if empty show `"Belum ada project. Tambah via /addproject."` + back; else show `deployProjectKeyboard(projects, vpsId)`.

- [ ] **Step 2: Implement deploy confirmation**

`deploy_confirm:*:*` callback: parse `vpsId` and `projectId`; show project name + VPS name + `confirmDeployKeyboard`.

- [ ] **Step 3: Implement deploy execution with live output**

`deploy_run:*:*` callback:

```js
bot.callbackQuery(/^deploy_run:/, async (ctx) => {
  await ctx.answerCallbackQuery()
  const [, vpsId, projectId] = ctx.callbackQuery.data.split(':')
  const vps = getVPS(vpsId)
  const project = vps.projects.find(p => p.id === projectId)
  const startTime = Date.now()

  const statusMsg = await ctx.editMessageText(
    `🚀 Deploying *${project.name}* on *${vps.name}*...\n\n📡 Connecting...`,
    { parse_mode: 'Markdown' }
  )

  let ssh
  try {
    ssh = await connectSSH(vps)
    await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id,
      `🚀 Deploying *${project.name}* on *${vps.name}*...\n\n✅ Connected\n⏳ Running script...`,
      { parse_mode: 'Markdown' })

    const result = await runCommand(ssh, project.deployScript, project.path)
    const elapsed = Math.round((Date.now() - startTime) / 1000)

    if (result.code !== 0) {
      await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id,
        `❌ Deploy *gagal* (exit ${result.code})\n\n\`\`\`\n${result.stderr.slice(0, 800)}\n\`\`\``,
        { parse_mode: 'Markdown', reply_markup: backToMainKeyboard() })
    } else {
      await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id,
        `✅ Deploy *selesai!* (${elapsed}s)\n\n\`\`\`\n${result.stdout.slice(0, 800)}\n\`\`\``,
        { parse_mode: 'Markdown', reply_markup: backToMainKeyboard() })
    }
  } catch (err) {
    await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id,
      `❌ Error: ${err.message}`, { reply_markup: backToMainKeyboard() })
  } finally {
    if (ssh) disconnectSSH(ssh)
  }
})
```

Add `backToMainKeyboard()` to keyboards/index.js: single `← Back` button → `main_menu`.

- [ ] **Step 4: Register deploy handlers in `src/index.js`**

- [ ] **Step 5: Commit**

```bash
git add deploy-bot/src/handlers/deploy.js deploy-bot/src/index.js deploy-bot/src/keyboards/index.js
git commit -m "feat: deploy handler with live output"
```

---

### Task 9: Status + Run CMD Handlers

**Files:**
- Create: `deploy-bot/src/handlers/status.js`
- Create: `deploy-bot/src/handlers/cmd.js`
- Modify: `deploy-bot/src/index.js`

**Consumes:** `listVPS`, `getVPS` from storage; `connectSSH`, `runCommand`, `disconnectSSH` from ssh

- [ ] **Step 1: Implement per-VPS status**

`status:*` callback: SSH → `pm2 jlist` → parse JSON → format each process as `● name → ✅ online` or `● name → ❌ stopped`.  
If pm2 not found or error, show raw output.

- [ ] **Step 2: Implement Status All**

`status_all` callback: iterate all VPS; for each SSH → `pm2 jlist`; assemble one message with VPS sections; handle per-VPS errors inline (show `❌ unreachable`).

- [ ] **Step 3: Implement Run CMD conversation**

`run_cmd:*` callback: enter conversation `runCmdConversation(vpsId)`.  
Conversation: ask `⚡ Ketik command:` → wait text → SSH → run → reply with output in code block + elapsed time.

- [ ] **Step 4: Register handlers in `src/index.js`**

- [ ] **Step 5: Commit**

```bash
git add deploy-bot/src/handlers/status.js deploy-bot/src/handlers/cmd.js deploy-bot/src/index.js
git commit -m "feat: status and run-cmd handlers"
```

---

### Task 10: Wire, README, and Final Validation

**Files:**
- Create: `deploy-bot/README.md`
- Modify: `deploy-bot/src/index.js` — ensure all handlers registered, stale callback guard

- [ ] **Step 1: Add stale callback guard in `src/bot.js`**

After all handlers, add catch-all callback query handler:
```js
bot.on('callback_query', async (ctx) => {
  await ctx.answerCallbackQuery('⚠️ Tombol ini sudah expired. Ketik /start')
})
```

- [ ] **Step 2: Write `README.md`**

Sections: Requirements, Setup (clone → `npm install` → copy `.env.example` → fill values → `npm start`), How to get BOT_TOKEN (BotFather steps), How to get OWNER_CHAT_ID (@userinfobot), Running with pm2 (`pm2 start ecosystem.config.js`).

- [ ] **Step 3: Run all tests**

```bash
cd deploy-bot && npm test
```
Expected: all pass.

- [ ] **Step 4: Final commit**

```bash
git add deploy-bot/
git commit -m "feat: complete deploy-bot with README and stale callback guard"
```

- [ ] **Step 5: Push branch**

```bash
git push -u origin claude/clever-edison-dgofi9
```

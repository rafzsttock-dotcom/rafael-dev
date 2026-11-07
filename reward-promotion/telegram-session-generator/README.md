
# Telegram StringSession Generator (Node.js)

This script allows you to securely authenticate a Telegram user account using the [GramJS MTProto client](https://github.com/gram-js/gramjs) and generate a `StringSession`. This session string can be stored in a database for use in automated Telegram operations like group management, messaging, etc.

> **Mode sidecar (dipakai KODO/RewardEx).** Folder ini juga berisi `server.js`, sebuah HTTP
> service internal yang dipanggil dashboard admin: `POST /login/start` → `POST /login/code` →
> (opsional) `POST /login/password`, plus `POST /logout`. Wajib set `SESSION_GENERATOR_SECRET`
> dan kirim header `X-Service-Secret`. Jalankan dengan `npm start` atau lewat
> `docker compose up -d --build session-generator` dari repo utama. Service ini **tidak**
> menyimpan session; penyimpanan terenkripsi dilakukan oleh aplikasi utama.
> `index.js` (CLI interaktif) tetap bisa dipakai dengan `npm run generate`.

---

## 📦 Requirements

- Node.js (v14 or higher recommended)
- Telegram App credentials (from [my.telegram.org](https://my.telegram.org))

---

## 🔧 Setup

### 1. Clone the Project

```bash
git clone https://github.com/Emmynem/telegram-session-generator
cd telegram-session-generator
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Create a `.env` File

Create a `.env` file in the root of the project with the following:

```env
API_ID=your_telegram_api_id
API_HASH=your_telegram_api_hash
```

Get your `API_ID` and `API_HASH` from [https://my.telegram.org](https://my.telegram.org).

---

## 🚀 Usage

Run the index script to generate your Telegram `StringSession`:

```bash
node index.js
```

You will be prompted to enter:

- 📱 Your **phone number** (with country code)
- 🔐 Your **2FA password** (if enabled)
- 🔑 The **Telegram code** you receive

After successful login, a `StringSession` will be printed to your terminal:

```
👉 Save this stringSession securely in your database:
1A0B...<your-session-string>
```

---

## 💾 Store the Session

Save this session string securely in your database. It can be used to:

- Avoid logging in again
- Authenticate Telegram actions in other scripts (sending messages, inviting users, etc.)

Example usage in another script:

```js
const stringSession = new StringSession("your_saved_session_string");
```

---

## ⚠️ Security Notice

- Treat the session string like a password.
- **Do not share** or commit it to version control.
- Store it securely in an encrypted database field or secret manager.

---

## 📄 License

MIT

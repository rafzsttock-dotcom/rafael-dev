const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const input = require("input");
require("dotenv").config();

const apiId = parseInt(process.env.API_ID);
const apiHash = process.env.API_HASH;
const stringSession = new StringSession(""); // Empty session for first login

(async () => {
	console.log("Starting Telegram authentication...");

	const client = new TelegramClient(stringSession, apiId, apiHash, {
		connectionRetries: 5,
	});

	await client.start({
		phoneNumber: async () => await input.text("Enter your phone number: "),
		password: async () => await input.text("Enter your 2FA password (if any): "),
		phoneCode: async () => await input.text("Enter the code you received: "),
		onError: (err) => console.error(err),
	});

	console.log("\n✅ Login successful.");
	console.log("👉 Save this stringSession securely in your database:\n");
	console.log(client.session.save());
	console.log("\n🔐 Never share this session string publicly!");

	process.exit();
})();
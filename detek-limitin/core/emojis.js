const EMOJI_IDS = {
    BOT: '5258093637450866522',         // tgmacicons 🤖
    USER: '5258362837411045098',        // tgmacicons 👤
    OWNER: '6300766415355908268',       // DSPSIR 👑
    FREE: '5386476545005077284',        // H8fuo 🆓
    PREMIUM: '6271537028307881531',     // DSPSIR 💎
    GIFT: '6206027872121918710',        // Earning_ON 🎁
    REDEEM: '6206027872121918710',      // Earning_ON 🎁
    ID: '5969696910112463071',          // Emoji_iRaQsTore 🆔
    TAG: '5296348778012361146',         // tgmacicons 🏷
    CALENDAR: '5258105663359294787',    // tgmacicons 🗓
    TIME: '5199457120428249992',        // tgmacicons 🕘
    PHONE: '5258020476977946656',       // tgmacicons 📞
    PHONE_VOICE: '5386317244668070158', // H8fuo 📞 (Voice Call)
    SMS: '5258215846450305872',         // tgmacicons 💬 (Messages / SMS)
    DEVICE: '6206038905892902954',      // Earning_ON 📱 (Smartphone / Perangkat)
    PLUS: '5258108352008823107',        // tgmacicons ➕ (Add / Plus)
    CHECK: '6269414562844381041',       // DSPSIR ✅
    CROSS: '6271611232457855630',       // DSPSIR ❌ (Red X Cross)
    CROSS_RED: '6271611232457855630',   // DSPSIR ❌
    WARN: '6206077285720659346',        // Earning_ON ⚠️
    DOT_GREEN: '6084384451154941172',   // DSPSIR 🟢
    DOT_RED: '6082387218347857432',     // DSPSIR 🔴
    SEARCH: '5429571366384842791',      // tgmacicons 🔎
    ROCKET: '6147654280112248427',      // DSPSIR 🚀
    LIGHTNING: '6082519348721751560',   // DSPSIR ⚡️
    FOLDER: '5258514780469075716',      // tgmacicons 📂
    DOC: '5258477770735885832',         // tgmacicons 📄
    NOTE: '5257965174979042426',        // tgmacicons 📝
    BACKUP: '5258134813302332906',      // tgmacicons 📦
    REFRESH: '5258420634785947640',     // tgmacicons 🔄
    BACK: '5258236805890710909',        // tgmacicons ⬅️
    DOOR: '5258084656674250503',        // tgmacicons 🚪
    LOCK: '5258476306152038031',        // tgmacicons 🔒
    KEY: '6176966310920983412',         // DSPSIR 🔑
    QR: '5384574132190985929',          // H8fuo 📷
    GEAR: '5258096772776991776',        // tgmacicons ⚙
    GLOBE: '6114021507908767611',       // DSPSIR 🌎
    LINK: '5384296136137786648',        // H8fuo 🔗
    BROADCAST: '5260268501515377807',   // tgmacicons 📣
    PIN: '5258461531464539536',         // tgmacicons 📌
    DIAMOND: '5359719332542718652',     // tgmacicons 💎
    STAR: '5258185631355378853',        // tgmacicons ⭐️
    SHIELD: '6203944611119897090',      // Earning_ON 🛡
    PROHIBITED: '5275969776668134187',  // tgmacicons ⛔️
    BUSINESS: '5258260149037965799',    // tgmacicons 💼
    VERIFIED: '6269163801178804220',    // DSPSIR 🔵
    MUTE: '5258267368877989660',        // tgmacicons 🔇
    INFO: '5258503720928288433',        // tgmacicons ℹ️
    TROPHY: '6194737030165959506',       // DSPSIR 🏆
    CHART: '6206343625232619150',        // Earning_ON 📊
    CHART_UP: '5258391025281408576',     // tgmacicons 📈
    BOOK: '5258328383183396223',         // tgmacicons 📖
    BOOKS: '5260512129240276089',        // tgmacicons 📚
    MEDAL_GOLD: '6206419981161211268',   // Earning_ON 🥇
    MEDAL_SILVER: '6206222099132978580', // Earning_ON 🥈
    MEDAL_BRONZE: '6206311275538946838', // Earning_ON 🥉
    MEDAL: '6269232765468676321',        // DSPSIR 🎖️
    QUESTION: '6206306186002698906',     // Earning_ON ❓
    BULB: '5258216851472654189',         // tgmacicons 💡
    TOP: '6102866133516293283',          // DSPSIR 🔝
    NUM_1: '6206131290639439676',        // Earning_ON 1️⃣
    NUM_2: '6204065183736799071',        // Earning_ON 2️⃣
    NUM_3: '6206065281287066945',        // Earning_ON 3️⃣
    NUM_4: '6206163395519978583',        // Earning_ON 4️⃣
    NUM_5: '6206022615081949587',        // Earning_ON 5️⃣
    NUM_6: '6206288963183843221',        // Earning_ON 6️⃣
    NUM_7: '6206207148351820511',        // Earning_ON 7️⃣
    NUM_8: '6206050326210942294',        // Earning_ON 8️⃣
    NUM_9: '6205978299609388443',        // Earning_ON 9️⃣
    NUM_0: '6206095818504540991',        // Earning_ON 0️⃣
    FIRE: '6174589037932712505',         // DSPSIR 🔥

    // Detect report
    DETECT_CHART_TITLE: '5472252840112037845', // 📊 (judul report)
    DETECT_CHART_STAT: '6059654836918423763',  // 📊 (baris Total Numbers)
    DETECT_DOT_GREEN: '5325945307454789973',   // 🟢 (Ready / Available)
    DETECT_DOT_YELLOW: '6156694258557389464',  // 🟡 (Cooldown)
    DETECT_DOT_RED: '5188218389310500613',     // 🔴 (Blocked)
    DETECT_DOT_GREY: '5321166817035573333',    // ⚪ (Unclassified)
    DETECT_DONE: '6240257219577782589'         // ✅ (Scan completed)
};

const tgEmoji = (id, fallback = '✨') => `<tg-emoji emoji-id="${id}">${fallback}</tg-emoji>`;

const EMOJIS = {
    BOT: tgEmoji(EMOJI_IDS.BOT, '🤖'),
    USER: tgEmoji(EMOJI_IDS.USER, '👤'),
    OWNER: tgEmoji(EMOJI_IDS.OWNER, '👑'),
    FREE: tgEmoji(EMOJI_IDS.FREE, '🆓'),
    PREMIUM: tgEmoji(EMOJI_IDS.PREMIUM, '💎'),
    GIFT: tgEmoji(EMOJI_IDS.GIFT, '🎁'),
    REDEEM: tgEmoji(EMOJI_IDS.REDEEM, '🎁'),
    ID: tgEmoji(EMOJI_IDS.ID, '🆔'),
    TAG: tgEmoji(EMOJI_IDS.TAG, '🏷'),
    CALENDAR: tgEmoji(EMOJI_IDS.CALENDAR, '🗓'),
    TIME: tgEmoji(EMOJI_IDS.TIME, '🕘'),
    PHONE: tgEmoji(EMOJI_IDS.PHONE, '📞'),
    PHONE_VOICE: tgEmoji(EMOJI_IDS.PHONE_VOICE, '📞'),
    SMS: tgEmoji(EMOJI_IDS.SMS, '💬'),
    DEVICE: tgEmoji(EMOJI_IDS.DEVICE, '📱'),
    PLUS: tgEmoji(EMOJI_IDS.PLUS, '➕'),
    CHECK: tgEmoji(EMOJI_IDS.CHECK, '✅'),
    CROSS: tgEmoji(EMOJI_IDS.CROSS, '❌'),
    CROSS_RED: tgEmoji(EMOJI_IDS.CROSS_RED, '❌'),
    WARN: tgEmoji(EMOJI_IDS.WARN, '⚠️'),
    DOT_GREEN: tgEmoji(EMOJI_IDS.DOT_GREEN, '🟢'),
    DOT_RED: tgEmoji(EMOJI_IDS.DOT_RED, '🔴'),
    SEARCH: tgEmoji(EMOJI_IDS.SEARCH, '🔎'),
    ROCKET: tgEmoji(EMOJI_IDS.ROCKET, '🚀'),
    LIGHTNING: tgEmoji(EMOJI_IDS.LIGHTNING, '⚡️'),
    FOLDER: tgEmoji(EMOJI_IDS.FOLDER, '📂'),
    DOC: tgEmoji(EMOJI_IDS.DOC, '📄'),
    NOTE: tgEmoji(EMOJI_IDS.NOTE, '📝'),
    BACKUP: tgEmoji(EMOJI_IDS.BACKUP, '📦'),
    REFRESH: tgEmoji(EMOJI_IDS.REFRESH, '🔄'),
    BACK: tgEmoji(EMOJI_IDS.BACK, '⬅️'),
    DOOR: tgEmoji(EMOJI_IDS.DOOR, '🚪'),
    LOCK: tgEmoji(EMOJI_IDS.LOCK, '🔒'),
    KEY: tgEmoji(EMOJI_IDS.KEY, '🔑'),
    QR: tgEmoji(EMOJI_IDS.QR, '📷'),
    GEAR: tgEmoji(EMOJI_IDS.GEAR, '⚙'),
    GLOBE: tgEmoji(EMOJI_IDS.GLOBE, '🌎'),
    LINK: tgEmoji(EMOJI_IDS.LINK, '🔗'),
    BROADCAST: tgEmoji(EMOJI_IDS.BROADCAST, '📣'),
    PIN: tgEmoji(EMOJI_IDS.PIN, '📌'),
    DIAMOND: tgEmoji(EMOJI_IDS.DIAMOND, '💎'),
    STAR: tgEmoji(EMOJI_IDS.STAR, '⭐️'),
    SHIELD: tgEmoji(EMOJI_IDS.SHIELD, '🛡'),
    PROHIBITED: tgEmoji(EMOJI_IDS.PROHIBITED, '⛔️'),
    BUSINESS: tgEmoji(EMOJI_IDS.BUSINESS, '💼'),
    VERIFIED: tgEmoji(EMOJI_IDS.VERIFIED, '🔵'),
    MUTE: tgEmoji(EMOJI_IDS.MUTE, '🔇'),
    INFO: tgEmoji(EMOJI_IDS.INFO, 'ℹ️'),
    TROPHY: tgEmoji(EMOJI_IDS.TROPHY, '🏆'),
    CHART: tgEmoji(EMOJI_IDS.CHART, '📊'),
    CHART_UP: tgEmoji(EMOJI_IDS.CHART_UP, '📈'),
    BOOK: tgEmoji(EMOJI_IDS.BOOK, '📖'),
    BOOKS: tgEmoji(EMOJI_IDS.BOOKS, '📚'),
    MEDAL_GOLD: tgEmoji(EMOJI_IDS.MEDAL_GOLD, '🥇'),
    MEDAL_SILVER: tgEmoji(EMOJI_IDS.MEDAL_SILVER, '🥈'),
    MEDAL_BRONZE: tgEmoji(EMOJI_IDS.MEDAL_BRONZE, '🥉'),
    MEDAL: tgEmoji(EMOJI_IDS.MEDAL, '🎖️'),
    QUESTION: tgEmoji(EMOJI_IDS.QUESTION, '❓'),
    BULB: tgEmoji(EMOJI_IDS.BULB, '💡'),
    TOP: tgEmoji(EMOJI_IDS.TOP, '🔝'),
    NUM_1: tgEmoji(EMOJI_IDS.NUM_1, '1️⃣'),
    NUM_2: tgEmoji(EMOJI_IDS.NUM_2, '2️⃣'),
    NUM_3: tgEmoji(EMOJI_IDS.NUM_3, '3️⃣'),
    NUM_4: tgEmoji(EMOJI_IDS.NUM_4, '4️⃣'),
    NUM_5: tgEmoji(EMOJI_IDS.NUM_5, '5️⃣'),
    NUM_6: tgEmoji(EMOJI_IDS.NUM_6, '6️⃣'),
    NUM_7: tgEmoji(EMOJI_IDS.NUM_7, '7️⃣'),
    NUM_8: tgEmoji(EMOJI_IDS.NUM_8, '8️⃣'),
    NUM_9: tgEmoji(EMOJI_IDS.NUM_9, '9️⃣'),
    NUM_0: tgEmoji(EMOJI_IDS.NUM_0, '0️⃣'),
    FIRE: tgEmoji(EMOJI_IDS.FIRE, '🔥'),

    DETECT_CHART_TITLE: tgEmoji(EMOJI_IDS.DETECT_CHART_TITLE, '📊'),
    DETECT_CHART_STAT: tgEmoji(EMOJI_IDS.DETECT_CHART_STAT, '📊'),
    DETECT_DOT_GREEN: tgEmoji(EMOJI_IDS.DETECT_DOT_GREEN, '🟢'),
    DETECT_DOT_YELLOW: tgEmoji(EMOJI_IDS.DETECT_DOT_YELLOW, '🟡'),
    DETECT_DOT_RED: tgEmoji(EMOJI_IDS.DETECT_DOT_RED, '🔴'),
    DETECT_DOT_GREY: tgEmoji(EMOJI_IDS.DETECT_DOT_GREY, '⚪'),
    DETECT_DONE: tgEmoji(EMOJI_IDS.DETECT_DONE, '✅')
};

module.exports = {
    EMOJI_IDS,
    EMOJIS,
    tgEmoji
};

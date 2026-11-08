/** Bersihin teks supaya aman ditaruh di dalam code span/block Markdown Telegram. */
export const safe = (s) => String(s).replace(/`/g, "'")

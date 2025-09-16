// api/telegram.js
const TelegramBot = require('node-telegram-bot-api');
const connectToDB = require('../db');
const Telegram = require('../model');

const TOKEN  = process.env.BOT_TOKEN;
const SECRET = process.env.BOT_SECRET; // set this in webhook config and env
const DEBUG  = process.env.BOT_DEBUG === 'true'; // set to true to see debug replies

if (!TOKEN) throw new Error('BOT_TOKEN is not set');

const bot = new TelegramBot(TOKEN); // webhook mode (no polling)

bot.on('message', async (msg) => {
const chatId = msg.chat.id;
const textIn = (msg.text || '').trim();

// Ignore non-text
if (!textIn) return;

// Optional: quick debug echo so you know handler runs
if (DEBUG) {
    try { await bot.sendMessage(chatId, `👋 Received: ${textIn}`); }
    catch (e) { console.error('sendMessage (debug) error:', e); }
}

// Connect to DB with a timeout so we don't hang indefinitely
try {
    await withTimeout(connectToDB(), 10_000, 'DB connect timeout');
} catch (e) {
    console.error('DB connect error:', e);
    if (DEBUG) await safeSend(bot, chatId, '⚠️ DB connect error.');
    return; // don’t continue if no DB
}

try {
    const keyword = textIn;
    const keywordLower = keyword.toLowerCase();
    let docs = [];

    // ---------- 1) Atlas Search (exact phrase + strict equality CI) ----------
    try {
    const pipeline = [
        {
        $search: {
            index: 'telegramIndex', // ⬅️ ensure this name matches your Atlas Search index
            phrase: {
            query: keyword,
            path: [
                'blok_proses',
                'part_mesin',
                'function',
                'possible_failure_modes',
                'possible_effect',
                'possible_cause',
                'recommendation_actions'
            ],
            slop: 0
            }
        }
        },
        {
        $addFields: {
            _kw:   keywordLower,
            _blok: { $toLower: { $ifNull: ['$blok_proses', ''] } },
            _part: { $toLower: { $ifNull: ['$part_mesin', ''] } },
            _func: { $toLower: { $ifNull: ['$function', ''] } },
            _pfm:  { $toLower: { $ifNull: ['$possible_failure_modes', ''] } },
            _pe:   { $toLower: { $ifNull: ['$possible_effect', ''] } },
            _pc:   { $toLower: { $ifNull: ['$possible_cause', ''] } },
            _ra:   { $toLower: { $ifNull: ['$recommendation_actions', ''] } }
        }
        },
        {
        $match: {
            $expr: {
            $or: [
                { $eq: ['$_blok', '$_kw'] },
                { $eq: ['$_part', '$_kw'] },
                { $eq: ['$_func', '$_kw'] },
                { $eq: ['$_pfm',  '$_kw'] },
                { $eq: ['$_pe',   '$_kw'] },
                { $eq: ['$_pc',   '$_kw'] },
                { $eq: ['$_ra',   '$_kw'] }
            ]
            }
        }
        },
        { $project: { _kw: 0, _blok: 0, _part: 0, _func: 0, _pfm: 0, _pe: 0, _pc: 0, _ra: 0 } },
        { $limit: 5 }
    ];

    docs = await withTimeout(Telegram.aggregate(pipeline), 5000, 'Search pipeline timeout');
    } catch (e) {
    // If Atlas Search misconfigured, don’t die—just fall back.
    console.error('Atlas Search error:', e);
    }

    // ---------- 2) Fallback A: exact-equal with collation (case-insensitive) ----------
    if (!Array.isArray(docs) || docs.length === 0) {
    try {
        docs = await withTimeout(
        Telegram.find({
            $or: [
            { blok_proses: keyword },
            { part_mesin: keyword },
            { function: keyword },
            { possible_failure_modes: keyword },
            { possible_effect: keyword },
            { possible_cause: keyword },
            { recommendation_actions: keyword }
            ]
        }, null, { collation: { locale: 'id', strength: 1 } }) // strength:1 → ignore case/diacritics
        .limit(5)
        .lean(),
        4_000,
        'Fallback A timeout'
        );
    } catch (e) {
        console.error('Fallback A error:', e);
    }
    }

    // ---------- 3) Fallback B: regex contains (case-insensitive) across fields ----------
    if (!Array.isArray(docs) || docs.length === 0) {
    const rx = new RegExp(escapeRegex(keyword), 'i');
    try {
        docs = await withTimeout(
        Telegram.find({
            $or: [
            { blok_proses: rx },
            { part_mesin: rx },
            { function: rx },
            { possible_failure_modes: rx },
            { possible_effect: rx },
            { possible_cause: rx },
            { recommendation_actions: rx }
            ]
        })
        .limit(5)
        .lean(),
        4_000,
        'Fallback B timeout'
        );
    } catch (e) {
        console.error('Fallback B error:', e);
    }
    }

    if (!docs || docs.length === 0) {
    await safeSend(bot, chatId, `❌ Tidak ditemukan data untuk: ${keyword}`);
    return;
    }

    // Send results (one-by-one, small delay to avoid flood limit)
    for (const doc of docs) {
    const text =
`📌 *Failure Mode:* ${doc.possible_failure_modes ?? '-'}
⚙️ *Blok Proses:* ${doc.blok_proses ?? '-'}
🔩 *Part Mesin:* ${doc.part_mesin ?? '-'}
🛠 *Function:* ${doc.function ?? '-'}

❗️ *Possible Effect:* ${doc.possible_effect ?? '-'}
⚡️ *Possible Cause:* ${doc.possible_cause ?? '-'}
✅ *Recommendation:* ${doc.recommendation_actions ?? '-'}`;
    await safeSend(bot, chatId, text, { parse_mode: 'Markdown' });
    await sleep(250);
    }
} catch (e) {
    console.error('Handler fatal error:', e);
    // keep the webhook healthy; optional user-facing error:
    if (DEBUG) await safeSend(bot, chatId, '⚠️ Unexpected error.');
}
});

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(200).send('OK');

  // Re-enable this only *after* you set the webhook with secret_token
  if (SECRET && req.headers['x-telegram-bot-api-secret-token'] !== SECRET) {
    return res.status(401).send('Unauthorized');
  }

  try {
    await bot.processUpdate(req.body);
  } catch (e) {
    console.error('processUpdate error:', e);
  }
  return res.status(200).send('OK');
};

// ---------- helpers ----------
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function withTimeout(promise, ms, label = 'timeout') {
  let t;
  const timeout = new Promise((_, rej) => t = setTimeout(() => rej(new Error(label)), ms));
  try {
    const result = await Promise.race([promise, timeout]);
    return result;
  } finally {
    clearTimeout(t);
  }
}

async function safeSend(bot, chatId, text, opts) {
  try { await bot.sendMessage(chatId, text, opts); }
  catch (e) { console.error('sendMessage error:', e); }
}

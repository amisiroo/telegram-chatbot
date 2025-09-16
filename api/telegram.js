// api/telegram.js
// Vercel/Netlify-style HTTP webhook endpoint for node-telegram-bot-api.
// - No polling
// - Accepts Telegram webhooks and replies via sendMessage
// - Robust DB + search fallbacks + timeouts
// - Secret-token verification

const TelegramBot = require('node-telegram-bot-api');
const connectToDB = require('../db');
const Telegram = require('../model'); // your Mongoose model

const TOKEN  = process.env.BOT_TOKEN;
const SECRET = process.env.BOT_SECRET; // must match Telegram setWebhook's secret_token
const DEBUG  = process.env.BOT_DEBUG === 'true';

if (!TOKEN) throw new Error('BOT_TOKEN is not set');

// Create a bot instance without polling or internal webHook listener
const bot = new TelegramBot(TOKEN, { polling: false });

// --- Ensure DB connection (cache connection in your /db module for serverless) ---
let dbReadyPromise;
try {
  dbReadyPromise = connectToDB(); // should return a promise; don't block, await only inside handler
} catch (e) {
  console.error('DB connect immediate error:', e);
}

// ---------------- Core search handler ----------------
async function handleUpdate(update) {
  // Support message or edited_message, ignore other update types safely
  const msg = update.message || update.edited_message;
  if (!msg) return;

  const chatId = msg.chat?.id;
  const textIn = (msg.text || '').trim();

  if (!textIn) return;

  if (DEBUG) {
    await safeSend(bot, chatId, `👋 Received: ${textIn}`);
  }

  // Wait DB (but bounded)
  try {
    await withTimeout(dbReadyPromise, 5_000, 'DB connect timeout');
  } catch (e) {
    console.error('DB not ready:', e);
    // We can still reply something generic
    await safeSend(bot, chatId, '⚠️ Database not ready. Please try again.');
    return;
  }

  const keyword = textIn;
  const keywordLower = keyword.toLowerCase();
  let docs = [];

  // ---------- 1) Atlas Search (phrase + strict equality CI) ----------
  try {
    const pipeline = [
      {
        $search: {
          index: 'telegramIndex', // <-- ensure Atlas Search index name matches
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

    docs = await withTimeout(Telegram.aggregate(pipeline), 5_000, 'Search pipeline timeout');
  } catch (e) {
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
        }, null, { collation: { locale: 'id', strength: 1 } })
          .limit(5)
          .lean(),
        4_000,
        'Fallback A timeout'
      );
    } catch (e) {
      console.error('Fallback A error:', e);
    }
  }

  // ---------- 3) Fallback B: regex contains (case-insensitive) ----------
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

  // Send results (small delay to avoid flood)
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
}

// ---------------- HTTP handler (Vercel/Netlify) ----------------
module.exports = async (req, res) => {
  // Telegram only POSTs; reply 200 on others so uptime checks don’t error
  if (req.method !== 'POST') return res.status(200).send('OK');

  // Enforce Telegram secret header if you configured one
  if (SECRET) {
    const got = req.headers['x-telegram-bot-api-secret-token'];
    if (got !== SECRET) {
      // Log what you got (but not the actual secret)
      console.warn('Webhook denied: secret mismatch');
      return res.status(401).send('Unauthorized');
    }
  }

  try {
    // Process exactly one update (Telegram posts updates individually by default)
    await handleUpdate(req.body);
  } catch (e) {
    console.error('processUpdate error:', e);
    // Always 200 so Telegram doesn’t back off
  }

  return res.status(200).send('OK');
};

// ---------------- helpers ----------------
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
async function withTimeout(promise, ms, label = 'timeout') {
  let t;
  const timeout = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(label)), ms); });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(t);
  }
}
async function safeSend(bot, chatId, text, opts) {
  try {
    await bot.sendMessage(chatId, text, opts);
  } catch (e) {
    console.error('sendMessage error:', e?.response?.body || e);
  }
}

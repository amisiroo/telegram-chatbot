// /api/telegram.js  (CommonJS: no ESM imports here)
// This is a crash-proof handler for Vercel serverless.

let TelegramBot;         // lazy load to avoid top-level crash
let connectToDB;         // lazy import
let TelegramModel;       // lazy import (Mongoose model)
let bot;                 // initialized once per warm container

async function getBot() {
  if (bot) return bot;

  // Lazy require to avoid ESM/CJS conflicts at import time
  try {
    TelegramBot = require('node-telegram-bot-api');
  } catch (e) {
    console.error('node-telegram-bot-api require error:', e);
    return null;
  }

  const TOKEN = process.env.BOT_TOKEN;
  if (!TOKEN) {
    console.error('BOT_TOKEN is not set (env)');
    return null;
  }

  try {
    bot = new TelegramBot(TOKEN, { polling: false }); // webhook mode
    return bot;
  } catch (e) {
    console.error('Bot init error:', e);
    return null;
  }
}

async function getDB() {
  // Lazy import DB and model; do NOT crash if missing
  if (!connectToDB) {
    try {
      // Adjust the paths to your project layout
      connectToDB = require('../db');
    } catch (e) {
      console.error('DB module require error:', e);
      return null;
    }
  }
  if (!TelegramModel) {
    try {
      TelegramModel = require('../model'); // your Mongoose model
    } catch (e) {
      console.error('Model require error:', e);
      return null;
    }
  }
  try {
    // Ensure connectToDB doesn’t throw; if it returns a promise, await with timeout
    await withTimeout(Promise.resolve(connectToDB()), 5_000, 'DB connect timeout');
    return { TelegramModel };
  } catch (e) {
    console.error('DB connect error:', e);
    return null;
  }
}

module.exports = async (req, res) => {
  // Health check for GET (handy for testing in browser)
  if (req.method !== 'POST') return res.status(200).send('OK');

  // Secret header check (never crash)
  const SECRET = process.env.BOT_SECRET;
  if (SECRET) {
    const got = req.headers['x-telegram-bot-api-secret-token'];
    if (got !== SECRET) {
      console.warn('Webhook denied: secret mismatch');
      // Still return 401 (Telegram will keep trying)
      return res.status(401).send('Unauthorized');
    }
  }

  // Parse Telegram update safely
  const update = req.body || {};
  const msg = update.message || update.edited_message;
  const chatId = msg?.chat?.id;
  const textIn = (msg?.text || '').trim();

  // Initialize bot (never throw)
  const botInstance = await getBot();
  if (!botInstance) {
    // Don’t crash; inform user if we can
    if (chatId) await safeSend(null, chatId, '⚠️ Bot is not ready (token missing / init error).');
    return res.status(200).send('OK');
  }

  // Quick path: if no text, just ACK
  if (!textIn) return res.status(200).send('OK');

  // Debug echo (optional)
  if (process.env.BOT_DEBUG === 'true' && chatId) {
    await safeSend(botInstance, chatId, `👋 Received: ${textIn}`);
  }

  // Try DB, but don’t die if fails
  let db = await getDB();

  // If DB not ready, reply gracefully
  if (!db) {
    if (chatId) await safeSend(botInstance, chatId, '⚠️ Database not ready. Please try again.');
    return res.status(200).send('OK');
  }

  // ---- Query logic (safe & bounded) ----
  const Telegram = db.TelegramModel;
  const keyword = textIn;
  const keywordLower = keyword.toLowerCase();
  let docs = [];

  // 1) Atlas Search (if configured)
  try {
    const pipeline = [
      {
        $search: {
          index: 'telegramIndex', // change if your index is different
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

  // 2) Fallback A: exact + collation
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
        }, null, { collation: { locale: 'id', strength: 1 } }).limit(5).lean(),
        4_000,
        'Fallback A timeout'
      );
    } catch (e) {
      console.error('Fallback A error:', e);
    }
  }

  // 3) Fallback B: regex contains
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
        }).limit(5).lean(),
        4_000,
        'Fallback B timeout'
      );
    } catch (e) {
      console.error('Fallback B error:', e);
    }
  }

  if (!docs || docs.length === 0) {
    if (chatId) await safeSend(botInstance, chatId, `❌ Tidak ditemukan data untuk: ${keyword}`);
    return res.status(200).send('OK');
  }

  for (const doc of docs) {
    const out =
`📌 *Failure Mode:* ${doc.possible_failure_modes ?? '-'}
⚙️ *Blok Proses:* ${doc.blok_proses ?? '-'}
🔩 *Part Mesin:* ${doc.part_mesin ?? '-'}
🛠 *Function:* ${doc.function ?? '-'}

❗️ *Possible Effect:* ${doc.possible_effect ?? '-'}
⚡️ *Possible Cause:* ${doc.possible_cause ?? '-'}
✅ *Recommendation:* ${doc.recommendation_actions ?? '-'}`;

    if (chatId) await safeSend(botInstance, chatId, out, { parse_mode: 'Markdown' });
    await sleep(250);
  }

  return res.status(200).send('OK');
};

// ---------- helpers ----------
function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function withTimeout(promise, ms, label='timeout') {
  let t;
  const timeout = new Promise((_, rej) => t = setTimeout(() => rej(new Error(label)), ms));
  try { return await Promise.race([promise, timeout]); }
  finally { clearTimeout(t); }
}
async function safeSend(botInstance, chatId, text, opts) {
  try {
    if (!botInstance) return;
    await botInstance.sendMessage(chatId, text, opts);
  } catch (e) {
    console.error('sendMessage error:', e?.response?.body || e);
  }
}

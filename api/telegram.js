// api/telegram.js
const TelegramBot = require('node-telegram-bot-api');
const connectToDB = require('../db');
const Telegram = require('../model');

const token = process.env.BOT_TOKEN;
const secret = process.env.TG_SECRET_TOKEN || ''; // optional, recommended

if (!token) throw new Error('BOT_TOKEN is not set');

// Reuse the bot & listeners across cold starts
if (!global._bot) {
  const bot = new TelegramBot(token); // webhook mode (no polling)

  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;

    if (!msg.text) {
      return bot.sendMessage(chatId, 'Kirim kata kunci failure mode sebagai teks.');
    }

    const keyword = msg.text.trim();
    if (!keyword) {
      return bot.sendMessage(
        chatId,
        "Kirim kata kunci failure mode, contoh: `Shaft tidak berputar`",
        { parse_mode: "Markdown" }
      );
    }

    const keywordLower = keyword.toLowerCase();

    try {
      await connectToDB(); // cached (singleton) connection

      // --- Atlas Search: exact phrase, then strict equality (case-insensitive) ---
      const pipeline = [
        {
          $search: {
            index: 'telegramIndex', // <-- your Atlas Search index name
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
            _kw: keywordLower,
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

      let docs = await Telegram.aggregate(pipeline);

      // Fallback: exact-equal with collation (case-insensitive)
      if (!Array.isArray(docs) || docs.length === 0) {
        docs = await Telegram.find({
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
        .lean();
      }

      if (!docs || docs.length === 0) {
        return bot.sendMessage(chatId, `❌ Tidak ditemukan data untuk: ${keyword}`);
      }

      for (const doc of docs) {
        const text =
`📌 *Failure Mode:* ${doc.possible_failure_modes ?? '-'}
⚙️ *Blok Proses:* ${doc.blok_proses ?? '-'}
🔩 *Part Mesin:* ${doc.part_mesin ?? '-'}
🛠 *Function:* ${doc.function ?? '-'}

❗️ *Possible Effect:* ${doc.possible_effect ?? '-'}
⚡️ *Possible Cause:* ${doc.possible_cause ?? '-'}
✅ *Recommendation:* ${doc.recommendation_actions ?? '-'}`;

        await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
        await new Promise(r => setTimeout(r, 250)); // gentle rate-limit spacing
      }
    } catch (err) {
      console.error('handler error:', err);
      // avoid throwing; webhook must return 200 to prevent Telegram retry storms
    }
  });

  global._bot = bot;
}
const bot = global._bot;

// Vercel serverless handler
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(200).send('OK');

  // Optional: verify Telegram secret header if you set one during setWebhook
//   if (secret && req.headers['x-telegram-bot-api-secret-token'] !== secret) {
//     return res.status(401).send('Unauthorized');
//   }

  try {
    await bot.processUpdate(req.body); // process Telegram update payload
    return res.status(200).send('OK');
  } catch (e) {
    console.error('processUpdate error:', e);
    return res.status(200).send('OK'); // still 200 to stop retries
  }
};

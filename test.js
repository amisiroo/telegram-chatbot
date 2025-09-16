const TelegramBot = require('node-telegram-bot-api');
const connectToDB = require('./db.js')

// replace the value below with the Telegram token you receive from @BotFather
const token = '8385029705:AAE8vxpr1YYeK7DnNIEOr4A4hiQnYqFQqQU';

const bot = new TelegramBot(token, {polling: true});
connectToDB()
const Telegram = require('./model.js');

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
    const keyword = (msg.text || '').trim();
const keywordLower = keyword.toLowerCase();
  console.log(keywordLower)

  if (!keyword) {
    await bot.sendMessage(chatId, "Kirim kata kunci failure mode, contoh: `Shaft tidak berputar`", { parse_mode: "Markdown" });
    return;
  }

  try {


const pipeline = [
  {
    $search: {
      index: 'telegramIndex',
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
  {
    $project: { _kw: 0, _blok: 0, _part: 0, _func: 0, _pfm: 0, _pe: 0, _pc: 0, _ra: 0 }
  },
  { $limit: 5 }
];

const docs = await Telegram.aggregate(pipeline);


    if (docs.length < 1) {
      await bot.sendMessage(chatId, `❌ Tidak ditemukan data untuk: ${keyword}`);
      return;
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
    }

  } catch (err) {
    console.error(err);
    await bot.sendMessage(chatId, "⚠️ Terjadi kesalahan saat mengambil data.");
  }
});



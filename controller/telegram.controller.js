const { withTimeout, escapeRegex, safeSend, sleep } = require('../utilities/helpers')

async function processUpdate(botInstance, TelegramModel, update) {
  const msg = update.message || update.edited_message
  const chatId = msg?.chat?.id
  const textIn = (msg?.text || '').trim()

  if (!textIn) return

  if (process.env.BOT_DEBUG === 'true' && chatId) {
    await safeSend(botInstance, chatId, `👋 Received: ${textIn}`)
  }

  const keyword = textIn
  const keywordLower = keyword.toLowerCase()
  let docs = []
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
    ]
    docs = await withTimeout(TelegramModel.aggregate(pipeline), 5_000, 'Search pipeline timeout')
  } catch (e) {
    console.error('Atlas Search error:', e)
  }
  if (!Array.isArray(docs) || docs.length === 0) {
    try {
      docs = await withTimeout(
        TelegramModel.find({
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
      console.error('Fallback A error:', e)
    }
  }
  if (!Array.isArray(docs) || docs.length === 0) {
    const rx = new RegExp(escapeRegex(keyword), 'i')
    try {
      docs = await withTimeout(
        TelegramModel.find({
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
      console.error('Fallback B error:', e)
    }
  }

  if (!docs || docs.length === 0) {
    if (chatId) await safeSend(botInstance, chatId, `❌ Tidak ditemukan data untuk: ${keyword}`)
    return
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

    if (chatId) await safeSend(botInstance, chatId, out, { parse_mode: 'Markdown' })
    await sleep(250)
  }
}

module.exports = { processUpdate }

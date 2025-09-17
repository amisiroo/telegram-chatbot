const { getBot, getDB } = require('../main')
const { processUpdate } = require('../controller/telegram.controller')

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(200).send('OK')

  const SECRET = process.env.BOT_SECRET
  if (SECRET) {
    const got = req.headers['x-telegram-bot-api-secret-token']
    if (got !== SECRET) {
      console.warn('Webhook denied: secret mismatch')
      return res.status(401).send('Unauthorized')
    }
  }

  const update = req.body || {}
  const msg = update.message || update.edited_message
  const chatId = msg?.chat?.id

  const botInstance = await getBot()
  if (!botInstance) {
    const { safeSend } = require('../utilities/helpers')
    if (chatId) await safeSend(null, chatId, '⚠️ Bot is not ready (token missing / init error).')
    return res.status(200).send('OK')
  }

  const textIn = (msg?.text || '').trim()
  if (!textIn) return res.status(200).send('OK')

  const db = await getDB()
  if (!db) {
    const { safeSend } = require('../utilities/helpers')
    if (chatId) await safeSend(botInstance, chatId, '⚠️ Database not ready. Please try again.')
    return res.status(200).send('OK')
  }

  await processUpdate(botInstance, db.TelegramModel, update)
  return res.status(200).send('OK')
}

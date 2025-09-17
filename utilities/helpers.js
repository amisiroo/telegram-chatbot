function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

async function withTimeout(promise, ms, label = 'timeout') {
  let t
  const timeout = new Promise((_, rej) => {
    t = setTimeout(() => rej(new Error(label)), ms)
  })

  try {
    return await Promise.race([promise, timeout])
  } finally {
    clearTimeout(t)
  }
}

async function safeSend(botInstance, chatId, text, opts) {
  try {
    if (!botInstance || !chatId || !text) return
    await botInstance.sendMessage(chatId, text, opts)
  } catch (e) {
    console.error('sendMessage error:', e?.response?.body || e)
  }
}

module.exports = {
  escapeRegex,
  sleep,
  withTimeout,
  safeSend,
}

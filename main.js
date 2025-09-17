// /main.js
// Shared bot + DB singleton logic (no helpers here)

let TelegramBot;   // from node-telegram-bot-api
let connectToDB;   // from ./utilities/db
let TelegramModel; // from ./model/model
let bot;           // singleton bot instance  

// ---------- bot ----------
async function getBot() {
  if (bot) return bot;

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

// ---------- db ----------
async function getDB() {
  if (!connectToDB) {
    try {
      connectToDB = require('./utilities/db'); // ✅ your DB connector
    } catch (e) {
      console.error('DB module require error:', e);
      return null;
    }
  }
  if (!TelegramModel) {
    try {
      TelegramModel = require('./model/model'); // ✅ your Mongoose model
    } catch (e) {
      console.error('Model require error:', e);
      return null;
    }
  }

  const { withTimeout } = require('./utilities/helpers');
  try {
    await withTimeout(Promise.resolve(connectToDB()), 5_000, 'DB connect timeout');
    return { TelegramModel };
  } catch (e) {
    console.error('DB connect error:', e);
    return null;
  }
}

module.exports = { getBot, getDB };

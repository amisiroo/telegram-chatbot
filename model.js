// model.js
const mongoose = require('mongoose');

const TelegramSchema = new mongoose.Schema({
  blok_proses: String,
  part_mesin: String,
  function: String,
  possible_failure_modes: String,
  possible_effect: String,
  possible_cause: String,
  recommendation_actions: String,
}, { collection: 'telegram', timestamps: true });

module.exports = mongoose.models.Telegram
  || mongoose.model('Telegram', TelegramSchema);z

const mongoose = require('mongoose');

const telegramSchema = new mongoose.Schema({

  blok_proses: {
    type: String,
    required: true
  },
  part_mesin: {
    type: String,
    required: true
  },
  function: {
    type: String,
    required: true
  },
  possible_failure_modes:  {
    type: String,
    required: true
  },
  possible_effect:  {
    type: String,
    required: true
  },
  possible_cause:  {
    type: String,
    required: true
  },
  recommendation_actions: {
    type: String,
    required: true
  }

},{
    timestamps: true
});

const Telegram = mongoose.model('Telegram', telegramSchema, 'telegram');

module.exports = Telegram;
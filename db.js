// db.js
const mongoose = require('mongoose');

let cached = global._mongooseCached;
if (!cached) cached = global._mongooseCached = { conn: null, promise: null };

module.exports = async function connectToDB() {
  const uri = process.env.DATABASE_URL;  // put your URI in env
  if (!uri) throw new Error('DATABASE_URL is not set');

  if (cached.conn) return cached.conn;

  if (!cached.promise) {
    cached.promise = mongoose
      .connect(uri, { dbName: 'chatbot' }) // ensures DB = chatbot
      .then(() => mongoose.connection);
  }

  cached.conn = await cached.promise;
  return cached.conn;
};

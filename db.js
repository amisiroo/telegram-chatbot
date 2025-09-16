// db.js
const mongoose = require('mongoose');

let cached = global._mongooseCached || (global._mongooseCached = { conn: null, promise: null });

module.exports = async function connectToDB() {
  const uri = process.env.DATABASE_URL; // or MONGODB_URI — be consistent with Vercel env
  if (!uri) throw new Error('DATABASE_URL is not set');

  if (cached.conn) return cached.conn;

  if (!cached.promise) {
    console.log('[DB] connecting…');
    cached.promise = mongoose.connect(uri, {
      dbName: 'chatbot',
      serverSelectionTimeoutMS: 15000, // driver waits this long to find a server
      connectTimeoutMS: 15000,         // TCP connection timeout
      family: 4                        // force IPv4 (sometimes SRV resolves to IPv6 and fails)
    })
    .then(m => {
      console.log('[DB] connected to', m.connection.name);
      return m.connection;
    })
    .catch(err => {
      // print the real reason (DNS, TLS, auth, IP block, etc.)
      console.error('[DB] connect failed:', err.message);
      if (err.reason) console.error('[DB] reason:', err.reason);
      throw err;
    });
  }

  cached.conn = await cached.promise;
  return cached.conn;
};

const mongoose = require('mongoose');

const connectToDB = () => {
        const mongoUri = process.env.DATABASE_URL
        mongoose.connect(mongoUri)
        const db = mongoose.connection
        db.on('error', (error) => console.log(error));
        db.once('open', () => console.log(`Connected to Database : ${db.name}`));
}

module.exports = connectToDB;
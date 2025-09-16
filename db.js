const mongoose = require('mongoose');

const connectToDB = () => {
        const mongoUri = `mongodb+srv://rezamnf05_db_user:test_chatbot@test-chatbot.3baoozq.mongodb.net/chatbot?retryWrites=true&w=majority&appName=test-chatbot`
        mongoose.connect(mongoUri)
        const db = mongoose.connection
        db.on('error', (error) => console.log(error));
        db.once('open', () => console.log(`Connected to Database : ${db.name}`));
}

module.exports = connectToDB;
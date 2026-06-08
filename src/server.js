require('dotenv').config();
const express = require('express');
const cors = require('cors');
const db = require('./db');

const usersRoute = require('./routes/users');
const booksRoute = require('./routes/books');
const loansRoute = require('./routes/loans');
const adminRoute = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

app.use('/users', usersRoute);
app.use('/books', booksRoute);
app.use('/loans', loansRoute);
app.use('/admin', adminRoute);

app.get('/health', async (req, res) => {
    try {
        const result = await db.query('SELECT NOW() AS current_time');
        res.status(200).json({ status: 'OK', time: result.rows[0].current_time });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database connection failed' });
    }
});

app.listen(PORT, () => {
    console.log(`Server is perfectly running on port ${PORT}`);
});
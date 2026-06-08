const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/penalties', async (req, res) => {
    const limit = parseInt(req.query.limit) || 20; 
    const cursor = req.query.cursor ? parseInt(req.query.cursor) : null;

    try {
        let query = `
            SELECT user_id, name, penalty_end_date
            FROM users
            WHERE penalty_end_date > CURRENT_TIMESTAMP
        `;
        const values = [];

        if (cursor) {
            query += ` AND user_id < $1`;
            values.push(cursor);
        }

        query += ` ORDER BY user_id DESC LIMIT $${cursor ? 2 : 1}`;
        values.push(limit);

        const result = await db.query(query, values);

        const nextCursor = result.rows.length > 0 ? result.rows[result.rows.length - 1].user_id : null;

        res.status(200).json({
            data: result.rows,
            nextCursor: result.rows.length === limit ? nextCursor : null 
        });
    } catch (err) {
        res.status(500).json({ error: '제재 대상자 목록 조회 실패' });
    }
});

router.get('/loans', async (req, res) => {
    const limit = parseInt(req.query.limit) || 20;
    const cursor = req.query.cursor ? parseInt(req.query.cursor) : null;

    try {
        let query = `
            SELECT 
                l.loan_id, l.status, l.loan_date, l.due_date, l.return_date, l.is_extended,
                u.user_id, u.name,
                b.title, bc.copy_id
            FROM loans l
            JOIN users u ON l.user_id = u.user_id
            JOIN book_copies bc ON l.copy_id = bc.copy_id
            JOIN books b ON bc.isbn = b.isbn
        `;
        const values = [];

        if (cursor) {
            query += ` WHERE l.loan_id < $1`;
            values.push(cursor);
        }

        query += ` ORDER BY l.loan_id DESC LIMIT $${cursor ? 2 : 1}`;
        values.push(limit);

        const result = await db.query(query, values);

        const nextCursor = result.rows.length > 0 ? result.rows[result.rows.length - 1].loan_id : null;

        res.status(200).json({
            data: result.rows,
            nextCursor: result.rows.length === limit ? nextCursor : null
        });
    } catch (err) {
        res.status(500).json({ error: '전체 대출 이력 조회 실패' });
    }
});

router.get('/stats', async (req, res) => {
    try {
        const activeLoans = await db.query("SELECT COUNT(*) FROM loans WHERE status = 'ACTIVE'");
        const overdueLoans = await db.query("SELECT COUNT(*) FROM loans WHERE status = 'ACTIVE' AND due_date < CURRENT_TIMESTAMP");
        const totalUsers = await db.query("SELECT COUNT(*) FROM users WHERE deleted_at IS NULL");
        const totalCopies = await db.query("SELECT COUNT(*) FROM book_copies WHERE status = 'AVAILABLE'");

        res.status(200).json({
            activeLoans: parseInt(activeLoans.rows[0].count),
            overdueLoans: parseInt(overdueLoans.rows[0].count),
            totalUsers: parseInt(totalUsers.rows[0].count),
            totalCopies: parseInt(totalCopies.rows[0].count)
        });
    } catch (err) {
        res.status(500).json({ error: '통계 데이터 집계 실패' });
    }
});

module.exports = router;
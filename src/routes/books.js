const express = require('express');
const router = express.Router();
const db = require('../db');

router.post('/', async (req, res) => {
    const { isbn, title, author, publisher, pub_year } = req.body;
    try {
        const result = await db.query(
            'INSERT INTO books (isbn, title, author, publisher, pub_year) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [isbn, title, author, publisher, pub_year]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: '도서 등록 실패. ISBN 중복 확인 요망.' });
    }
});

router.put('/:isbn', async (req, res) => {
    const { isbn } = req.params;
    const { title, author, publisher, pub_year } = req.body;
    try {
        const result = await db.query(
            'UPDATE books SET title = $1, author = $2, publisher = $3, pub_year = $4 WHERE isbn = $5 RETURNING *',
            [title, author, publisher, pub_year, isbn]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: '도서를 찾을 수 없음' });
        res.status(200).json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: '도서 수정 실패' });
    }
});

router.post('/:isbn/copies', async (req, res) => {
    const { isbn } = req.params;
    try {
        const result = await db.query(
            "INSERT INTO book_copies (isbn, status) VALUES ($1, 'AVAILABLE') RETURNING copy_id, isbn, status",
            [isbn]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: '사본 등록 실패. 메타데이터가 존재하는지 확인 요망.' });
    }
});

router.patch('/copies/:copy_id/status', async (req, res) => {
    const { copy_id } = req.params;
    const { status } = req.body;

    const validStatuses = ['AVAILABLE', 'UNAVAILABLE'];
    if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: "유효하지 않은 상태" });
    }

    try {
        const result = await db.query(
            'UPDATE book_copies SET status = $1 WHERE copy_id = $2 RETURNING copy_id, status',
            [status, copy_id]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: '대상 사본을 찾을 수 없음' });
        res.status(200).json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: '도서 사본 상태 업데이트 실패' });
    }
});

router.get('/search', async (req, res) => {
    const { title, author } = req.query;
    try {
        let query = `
            SELECT 
                b.isbn, b.title, b.author, b.publisher, b.pub_year,
                COUNT(bc.copy_id) AS total_copies,
                COUNT(CASE WHEN bc.status = 'AVAILABLE' THEN 1 END) AS available_copies
            FROM books b
            LEFT JOIN book_copies bc ON b.isbn = bc.isbn
            WHERE 1=1
        `;
        const values = [];
        let idx = 1;

        if (title) {
            query += ` AND b.title ILIKE $${idx++}`;
            values.push(`%${title}%`);
        }
        if (author) {
            query += ` AND b.author ILIKE $${idx++}`;
            values.push(`%${author}%`);
        }

        query += ` GROUP BY b.isbn ORDER BY b.title ASC`;

        const result = await db.query(query, values);
        res.status(200).json(result.rows);
    } catch (err) {
        res.status(500).json({ error: '도서 검색 실패' });
    }
});

router.get('/:isbn/copies/status', async (req, res) => {
    const { isbn } = req.params;
    try {
        const result = await db.query(
            `SELECT 
                bc.copy_id,
                bc.status AS copy_status,
                l.loan_id,
                l.status AS loan_status,
                l.due_date,
                CASE WHEN l.status = 'ACTIVE' AND l.due_date > CURRENT_TIMESTAMP THEN CEIL(EXTRACT(EPOCH FROM (l.due_date - CURRENT_TIMESTAMP)) / 86400.0) ELSE 0 END AS remaining_days
             FROM book_copies bc
             LEFT JOIN loans l ON bc.copy_id = l.copy_id AND l.status = 'ACTIVE'
             WHERE bc.isbn = $1
             ORDER BY bc.copy_id ASC`,
            [isbn]
        );
        res.status(200).json(result.rows);
    } catch (err) {
        res.status(500).json({ error: '사본 상태 조회 실패' });
    }
});

router.get('/copies/:copy_id/history', async (req, res) => {
    const { copy_id } = req.params;
    const limit = parseInt(req.query.limit) || 5;
    const cursor = req.query.cursor ? parseInt(req.query.cursor) : null;
    const search = req.query.search ? req.query.search.trim() : null;

    try {
        let query = `
            SELECT l.loan_id, l.status, l.loan_date, l.due_date, l.return_date, u.user_id, u.name 
            FROM loans l 
            JOIN users u ON l.user_id = u.user_id 
            WHERE l.copy_id = $1
        `;
        const values = [copy_id];
        let paramIdx = 2;

        if (cursor) {
            query += ` AND l.loan_id < $${paramIdx++}`;
            values.push(cursor);
        }
        if (search) {
            query += ` AND (u.name ILIKE $${paramIdx} OR u.user_id::TEXT = $${paramIdx})`;
            paramIdx++;
            values.push(`%${search}%`);
        }

        query += ` ORDER BY l.loan_id DESC LIMIT $${paramIdx}`;
        values.push(limit);

        const result = await db.query(query, values);
        const nextCursor = result.rows.length === limit ? result.rows[result.rows.length - 1].loan_id : null;

        res.status(200).json({ data: result.rows, nextCursor });
    } catch (err) {
        res.status(500).json({ error: '도서 이력 조회 실패' });
    }
});

module.exports = router;
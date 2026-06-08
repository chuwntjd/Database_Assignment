const express = require('express');
const router = express.Router();
const db = require('../db');

router.post('/', async (req, res) => {
    const { name, email, phone } = req.body;
    try {
        const result = await db.query(
            'INSERT INTO users (name, email, phone) VALUES ($1, $2, $3) RETURNING user_id, name, email, phone, created_at',
            [name, email || null, phone || null]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({ error: '이미 존재하는 이메일 주소 혹은 전화번호입니다.' });
        }
        res.status(500).json({ error: '회원 생성 실패' });
    }
});

router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { name, email, phone } = req.body;
    try {
        const result = await db.query(
            `UPDATE users 
             SET name = $1, email = $2, phone = $3 
             WHERE user_id = $4 AND deleted_at IS NULL 
             RETURNING user_id, name, email, phone`,
            [name, email || null, phone || null, id]
        );
        
        if (result.rowCount === 0) return res.status(404).json({ error: '존재하지 않거나 삭제된 회원입니다.' });
        res.status(200).json(result.rows[0]);
    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({ error: '이메일 혹은 전화번호가 이미 존재합니다.' });
        }
        res.status(500).json({ error: '회원 정보 수정 실패' });
    }
});

router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await db.query(
            'UPDATE users SET deleted_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND deleted_at IS NULL RETURNING user_id',
            [id]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: '존재하지 않거나 이미 삭제된 회원' });
        res.status(200).json({ message: '회원 삭제 완료' });
    } catch (err) {
        res.status(500).json({ error: '회원 삭제 실패' });
    }
});

router.get('/search', async (req, res) => {
    const { name } = req.query;
    try {
        const result = await db.query(
            `SELECT user_id, name, email, phone, created_at, penalty_end_date 
             FROM users 
             WHERE name ILIKE $1 AND deleted_at IS NULL`,
            [`%${name}%`]
        );
        res.status(200).json(result.rows);
    } catch (err) {
        res.status(500).json({ error: '회원 검색 쿼리 실행 실패' });
    }
});

router.get('/:id/history', async (req, res) => {
    const { id } = req.params;
    const limit = parseInt(req.query.limit) || 5;
    const cursor = req.query.cursor ? parseInt(req.query.cursor) : null;
    const search = req.query.search ? req.query.search.trim() : null;

    try {
        let query = `
            SELECT l.loan_id, l.status, l.loan_date, l.due_date, l.return_date, b.title, bc.copy_id 
            FROM loans l 
            JOIN book_copies bc ON l.copy_id = bc.copy_id 
            JOIN books b ON bc.isbn = b.isbn 
            WHERE l.user_id = $1
        `;
        const values = [id];
        let paramIdx = 2;

        if (cursor) {
            query += ` AND l.loan_id < $${paramIdx++}`;
            values.push(cursor);
        }
        if (search) {
            query += ` AND (b.title ILIKE $${paramIdx} OR b.isbn ILIKE $${paramIdx})`;
            paramIdx++;
            values.push(`%${search}%`);
        }

        query += ` ORDER BY l.loan_id DESC LIMIT $${paramIdx}`;
        values.push(limit);

        const result = await db.query(query, values);
        const nextCursor = result.rows.length === limit ? result.rows[result.rows.length - 1].loan_id : null;

        res.status(200).json({ data: result.rows, nextCursor });
    } catch (err) {
        res.status(500).json({ error: '회원 이력 조회 실패' });
    }
});

router.get('/:id/current-loans', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await db.query(
            `SELECT 
                l.loan_id,
                bc.isbn,
                b.title,
                l.copy_id,
                l.loan_date,
                l.due_date,
                l.is_extended,
                CASE
                    WHEN l.due_date > CURRENT_TIMESTAMP 
                        THEN CEIL(EXTRACT(EPOCH FROM (l.due_date - CURRENT_TIMESTAMP)) / 86400.0)
                    ELSE 0
                END AS remaining_days,
                CASE
                    WHEN CURRENT_TIMESTAMP > l.due_date 
                        THEN CEIL(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - l.due_date)) / 86400.0)
                    ELSE 0
                END AS overdue_days
             FROM loans l
             JOIN book_copies bc ON l.copy_id = bc.copy_id
             JOIN books b ON bc.isbn = b.isbn
             WHERE l.user_id = $1 AND l.status = 'ACTIVE'
             ORDER BY l.due_date ASC`,
            [id]
        );
        res.status(200).json(result.rows);
    } catch (err) {
        res.status(500).json({ error: '회원 현재 대출 상태 조회 실패' });
    }
});

module.exports = router;
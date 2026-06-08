const express = require('express');
const router = express.Router();
const db = require('../db');

router.post('/', async (req, res) => {
    const { user_id, copy_id } = req.body;
    const client = await db.connect();

    try {
        await client.query('BEGIN');

        const userRes = await client.query(
            'SELECT penalty_end_date FROM users WHERE user_id = $1 AND deleted_at IS NULL FOR UPDATE',
            [user_id]
        );
        if (userRes.rowCount === 0) throw new Error('USER_NOT_FOUND');
        if (userRes.rows[0].penalty_end_date && new Date(userRes.rows[0].penalty_end_date) > new Date()) {
            throw new Error('USER_PENALIZED');
        }

        const loanCountRes = await client.query(
            "SELECT COUNT(*) FROM loans WHERE user_id = $1 AND status = 'ACTIVE'",
            [user_id]
        );
        if (parseInt(loanCountRes.rows[0].count) >= 3) throw new Error('LOAN_LIMIT_EXCEEDED');

        const copyRes = await client.query(
            "SELECT status FROM book_copies WHERE copy_id = $1 FOR UPDATE",
            [copy_id]
        );
        if (copyRes.rowCount === 0) throw new Error('COPY_NOT_FOUND');
        if (copyRes.rows[0].status !== 'AVAILABLE') throw new Error('COPY_UNAVAILABLE');

        const insertRes = await client.query(
            "INSERT INTO loans (user_id, copy_id, status) VALUES ($1, $2, 'ACTIVE') RETURNING loan_id, due_date",
            [user_id, copy_id]
        );

        await client.query('COMMIT');
        res.status(201).json(insertRes.rows[0]);
    } catch (err) {
        await client.query('ROLLBACK');
        
        if (err.code === '23505') return res.status(409).json({ error: '이미 대출 중입니다.' });
        
        const errorMap = {
            'USER_NOT_FOUND': { status: 404, msg: '유효하지 않거나 삭제된 회원' },
            'USER_PENALIZED': { status: 403, msg: '연체로 인해 대출이 정지된 상태' },
            'LOAN_LIMIT_EXCEEDED': { status: 403, msg: '최대 대출 권수(3권) 초과' },
            'COPY_NOT_FOUND': { status: 404, msg: '도서 사본을 찾을 수 없음' },
            'COPY_UNAVAILABLE': { status: 400, msg: '대출 불가능한 상태의 도서 사본' }
        };

        const mappedError = errorMap[err.message];
        if (mappedError) return res.status(mappedError.status).json({ error: mappedError.msg });

        res.status(500).json({ error: '대출 트랜잭션 중 오류 발생' });
    } finally {
        client.release();
    }
});

router.patch('/:loan_id/return', async (req, res) => {
    const { loan_id } = req.params;
    try {
        const result = await db.query(
            "UPDATE loans SET status = 'RETURNED', return_date = CURRENT_TIMESTAMP WHERE loan_id = $1 AND status = 'ACTIVE' RETURNING loan_id, user_id, return_date",
            [loan_id]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: '반납 처리 실패' });
        res.status(200).json({ message: '반납 완료', data: result.rows[0] });
    } catch (err) {
        res.status(500).json({ error: '반납 처리 실패' });
    }
});

router.patch('/:loan_id/extend', async (req, res) => {
    const { loan_id } = req.params;
    try {
        const result = await db.query(
            "UPDATE loans SET due_date = due_date + INTERVAL '7 days', is_extended = TRUE WHERE loan_id = $1 AND status = 'ACTIVE' AND is_extended = FALSE RETURNING loan_id, due_date",
            [loan_id]
        );
        if (result.rowCount === 0) return res.status(400).json({ error: '연장 불가.' });
        res.status(200).json({ message: '1주일 연장 완료', data: result.rows[0] });
    } catch (err) {
        res.status(500).json({ error: '연장 처리 실패' });
    }
});

router.patch('/users/:user_id/clear-penalty', async (req, res) => {
    const { user_id } = req.params;
    try {
        const result = await db.query(
            "UPDATE users SET penalty_end_date = NULL WHERE user_id = $1 RETURNING user_id",
            [user_id]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: '회원을 찾을 수 없음' });
        res.status(200).json({ message: '연체 기록이 초기화됨' });
    } catch (err) {
        res.status(500).json({ error: '연체 기록 초기화 실패' });
    }
});

module.exports = router;
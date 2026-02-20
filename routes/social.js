// routes/social.js
import express from 'express';
import { db } from '../db.js';

const router = express.Router();

// POST /api/report — report a message
router.post('/report', async (req, res) => {
    const { messageId, reporterId, reason } = req.body;
    if (!messageId || !reporterId || !reason) return res.status(400).json({ error: 'messageId, reporterId, reason required' });
    try {
        await db.execute({
            sql: 'INSERT INTO reports (message_id, reporter_id, reason) VALUES (?, ?, ?)',
            args: [messageId, reporterId, reason],
        });
        res.status(201).json({ message: 'Report submitted' });
    } catch (e) {
        console.error('Report error:', e);
        res.status(500).json({ error: 'Error submitting report' });
    }
});

// GET /api/reports — admin: get all pending reports
router.get('/reports', async (req, res) => {
    const status = req.query.status || 'pending';
    try {
        const result = await db.execute({
            sql: `SELECT r.id, r.reason, r.status, r.created_at, r.notes,
              m.content as message_content, m.id as message_id, m.room_id,
              u.name as reporter_name, u.id as reporter_id,
              author.name as author_name, author.id as author_id
            FROM reports r
            JOIN messages m ON r.message_id = m.id
            JOIN users u ON r.reporter_id = u.id
            JOIN users author ON m.user_id = author.id
            WHERE r.status = ?
            ORDER BY r.created_at DESC`,
            args: [status],
        });
        res.json(result.rows);
    } catch (e) {
        console.error('Reports error:', e);
        res.status(500).json({ error: 'Error fetching reports' });
    }
});

// PATCH /api/reports/:id — resolve or dismiss
router.patch('/reports/:id', async (req, res) => {
    const { id } = req.params;
    const { status, notes } = req.body;
    try {
        await db.execute({ sql: 'UPDATE reports SET status = ?, notes = ? WHERE id = ?', args: [status, notes || '', id] });
        res.json({ message: 'Report updated' });
    } catch (e) {
        res.status(500).json({ error: 'Error updating report' });
    }
});

// GET /api/match — find a compatible tandem partner and create a private room
router.get('/match', async (req, res) => {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: 'userId required' });
    try {
        const me = await db.execute({ sql: 'SELECT targetLang, nativelang, level FROM users WHERE id = ?', args: [userId] });
        if (!me.rows.length) return res.status(404).json({ error: 'User not found' });
        const { targetLang, nativelang, level } = me.rows[0];

        // Find user whose nativeLang = my targetLang and whose targetLang = my nativeLang
        const match = await db.execute({
            sql: `SELECT id, name, image, level FROM users
            WHERE id != ? AND nativelang = ? AND targetLang = ? AND banned_at IS NULL
            ORDER BY RANDOM() LIMIT 1`,
            args: [userId, targetLang || '', nativelang || ''],
        });

        if (!match.rows.length) return res.status(404).json({ error: 'No match found right now. Try again in a moment!' });

        const partner = match.rows[0];
        const roomName = `private_${Math.min(Number(userId), partner.id)}_${Math.max(Number(userId), partner.id)}_${Date.now()}`;

        const existing = await db.execute({ sql: 'SELECT id FROM rooms WHERE name = ?', args: [roomName] });
        let roomId;
        if (existing.rows.length > 0) {
            roomId = existing.rows[0].id.toString();
        } else {
            const result = await db.execute({
                sql: `INSERT INTO rooms (name, description, type, language) VALUES (?, ?, 'private', ?)`,
                args: [roomName, `Sesión privada entre compañeros de tandem`, targetLang || ''],
            });
            roomId = result.lastInsertRowid.toString();
        }

        res.json({ roomId, roomName, partner: { id: partner.id, name: partner.name, image: partner.image, level: partner.level } });
    } catch (e) {
        console.error('Match error:', e);
        res.status(500).json({ error: 'Match error' });
    }
});

export default router;

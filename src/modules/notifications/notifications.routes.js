// routes/notifications.js
import express from 'express';
import { db } from '../../config/database.js';
import { auth } from '../../../middleware/auth.js';

const router = express.Router();

// GET /api/notifications — get current user's notifications
router.get('/notifications', auth, async (req, res) => {
    const userId = req.user.id;
    const unreadOnly = req.query.unread_only === 'true';
    try {
        const result = await db.execute({
            sql: `SELECT id, user_id, type, title, body, data, is_read, created_at
                  FROM notifications
                  WHERE user_id = ?${unreadOnly ? ' AND is_read = 0' : ''}
                  ORDER BY created_at DESC
                  LIMIT 50`,
            args: [userId],
        });
        const notifications = result.rows.map(row => {
            let data = {};
            try { data = JSON.parse(row.data || '{}'); } catch { data = {}; }
            return { ...row, data, is_read: Boolean(row.is_read) };
        });
        res.json({ notifications });
    } catch (e) {
        console.error('Error fetching notifications:', e);
        res.status(500).json({ error: 'Error fetching notifications' });
    }
});

// GET /api/notifications/unread-count — count of unread notifications
router.get('/notifications/unread-count', auth, async (req, res) => {
    const userId = req.user.id;
    try {
        const result = await db.execute({
            sql: 'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0',
            args: [userId],
        });
        res.json({ count: Number(result.rows[0].count) });
    } catch (e) {
        console.error('Error fetching unread count:', e);
        res.status(500).json({ error: 'Error fetching unread count' });
    }
});

// POST /api/notifications/read-all — mark all as read for current user
router.post('/notifications/read-all', auth, async (req, res) => {
    const userId = req.user.id;
    try {
        await db.execute({
            sql: 'UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0',
            args: [userId],
        });
        res.json({ message: 'All notifications marked as read' });
    } catch (e) {
        console.error('Error marking all notifications as read:', e);
        res.status(500).json({ error: 'Error marking notifications as read' });
    }
});

// POST /api/notifications/:id/read — mark single notification as read (owner only)
router.post('/notifications/:id/read', auth, async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;
    try {
        const result = await db.execute({
            sql: 'SELECT id, user_id FROM notifications WHERE id = ?',
            args: [id],
        });
        if (!result.rows.length) return res.status(404).json({ error: 'Notification not found' });
        if (String(result.rows[0].user_id) !== String(userId)) {
            return res.status(403).json({ error: 'Access denied' });
        }
        await db.execute({
            sql: 'UPDATE notifications SET is_read = 1 WHERE id = ?',
            args: [id],
        });
        res.json({ message: 'Notification marked as read' });
    } catch (e) {
        console.error('Error marking notification as read:', e);
        res.status(500).json({ error: 'Error marking notification as read' });
    }
});

// DELETE /api/notifications/:id — delete single notification (owner only)
router.delete('/notifications/:id', auth, async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;
    try {
        const result = await db.execute({
            sql: 'SELECT id, user_id FROM notifications WHERE id = ?',
            args: [id],
        });
        if (!result.rows.length) return res.status(404).json({ error: 'Notification not found' });
        if (String(result.rows[0].user_id) !== String(userId)) {
            return res.status(403).json({ error: 'Access denied' });
        }
        await db.execute({
            sql: 'DELETE FROM notifications WHERE id = ?',
            args: [id],
        });
        res.json({ message: 'Notification deleted' });
    } catch (e) {
        console.error('Error deleting notification:', e);
        res.status(500).json({ error: 'Error deleting notification' });
    }
});

export default router;

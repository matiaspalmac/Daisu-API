// src/modules/notifications/notifications.routes.js
import express from 'express';
import { db } from '../../config/database.js';
import { auth } from '../../middleware/auth.js';
import { config } from '../../config/index.js';
import { NotFoundError, AuthorizationError } from '../../errors/index.js';

const router = express.Router();

router.get('/notifications', auth, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const unreadOnly = req.query.unread_only === 'true';
    const result = await db.execute({
      sql: `SELECT id, user_id, type, title, body, data, is_read, created_at
            FROM notifications WHERE user_id = ?${unreadOnly ? ' AND is_read = 0' : ''}
            ORDER BY created_at DESC LIMIT ?`,
      args: [userId, config.limits.notificationLimit],
    });
    const notifications = result.rows.map(row => {
      let data = {};
      try { data = JSON.parse(row.data || '{}'); } catch { data = {}; }
      return { ...row, data, is_read: Boolean(row.is_read) };
    });
    res.json({ notifications });
  } catch (err) { next(err); }
});

router.get('/notifications/unread-count', auth, async (req, res, next) => {
  try {
    const result = await db.execute({
      sql: 'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0',
      args: [req.user.id],
    });
    res.json({ count: Number(result.rows[0].count) });
  } catch (err) { next(err); }
});

router.post('/notifications/read-all', auth, async (req, res, next) => {
  try {
    await db.execute({ sql: 'UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0', args: [req.user.id] });
    res.json({ message: 'All notifications marked as read' });
  } catch (err) { next(err); }
});

router.post('/notifications/:id/read', auth, async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await db.execute({ sql: 'SELECT id, user_id FROM notifications WHERE id = ?', args: [id] });
    if (!result.rows.length) throw new NotFoundError('Notification not found');
    if (String(result.rows[0].user_id) !== String(req.user.id)) throw new AuthorizationError('Access denied');
    await db.execute({ sql: 'UPDATE notifications SET is_read = 1 WHERE id = ?', args: [id] });
    res.json({ message: 'Notification marked as read' });
  } catch (err) { next(err); }
});

router.delete('/notifications/:id', auth, async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await db.execute({ sql: 'SELECT id, user_id FROM notifications WHERE id = ?', args: [id] });
    if (!result.rows.length) throw new NotFoundError('Notification not found');
    if (String(result.rows[0].user_id) !== String(req.user.id)) throw new AuthorizationError('Access denied');
    await db.execute({ sql: 'DELETE FROM notifications WHERE id = ?', args: [id] });
    res.json({ message: 'Notification deleted' });
  } catch (err) { next(err); }
});

export default router;

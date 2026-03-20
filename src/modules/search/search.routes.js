// routes/search.js — Search endpoints for users, rooms, and messages
import { Router } from 'express';
import { db } from '../../config/database.js';
import { auth } from '../../../middleware/auth.js';

const router = Router();

// ────────────────────────────────────────────
// GET /search — Global search across entities
// ────────────────────────────────────────────
router.get('/search', auth, async (req, res) => {
  try {
    const { q, type = 'all' } = req.query;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 50);

    if (!q || q.trim().length < 2) {
      return res.status(400).json({ error: 'Search query must be at least 2 characters' });
    }

    const validTypes = ['all', 'users', 'rooms', 'messages'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: `Invalid type. Must be one of: ${validTypes.join(', ')}` });
    }

    const query = q.trim();
    const pattern = `%${query}%`;
    const results = {};

    // Search users
    if (type === 'all' || type === 'users') {
      const users = await db.execute({
        sql: `SELECT id, name, image, level, country
              FROM users
              WHERE name LIKE ? AND banned_at IS NULL
              LIMIT ?`,
        args: [pattern, limit],
      });
      results.users = users.rows;
    }

    // Search rooms
    if (type === 'all' || type === 'rooms') {
      const rooms = await db.execute({
        sql: `SELECT id, name, description, language, type
              FROM rooms
              WHERE (name LIKE ? OR description LIKE ?)
              LIMIT ?`,
        args: [pattern, pattern, limit],
      });
      results.rooms = rooms.rows;
    }

    // Search messages
    if (type === 'all' || type === 'messages') {
      const messages = await db.execute({
        sql: `SELECT m.id, SUBSTR(m.content, 1, 200) AS content, m.user_id,
                     u.name AS user_name, m.room_id, r.name AS room_name, m.sent_at
              FROM messages m
              JOIN users u ON u.id = m.user_id
              JOIN rooms r ON r.id = m.room_id
              WHERE m.content LIKE ? AND m.deleted_at IS NULL
              ORDER BY m.sent_at DESC
              LIMIT ?`,
        args: [pattern, limit],
      });
      results.messages = messages.rows;
    }

    res.json({ query, results });
  } catch (err) {
    console.error('Global search error:', err);
    res.status(500).json({ error: 'Search failed' });
  }
});

// ────────────────────────────────────────────
// GET /search/messages — Detailed message search
// ────────────────────────────────────────────
router.get('/search/messages', auth, async (req, res) => {
  try {
    const { q, room_id, user_id, language } = req.query;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    if (!q || q.trim().length < 2) {
      return res.status(400).json({ error: 'Search query must be at least 2 characters' });
    }

    const query = q.trim();
    const pattern = `%${query}%`;

    let sql = `SELECT m.id, m.content, m.user_id, u.name AS user_name, u.image AS user_image,
                      m.room_id, r.name AS room_name, m.detected_lang, m.sent_at
               FROM messages m
               JOIN users u ON u.id = m.user_id
               JOIN rooms r ON r.id = m.room_id
               WHERE m.content LIKE ? AND m.deleted_at IS NULL`;
    const args = [pattern];

    if (room_id) {
      sql += ' AND m.room_id = ?';
      args.push(room_id);
    }

    if (user_id) {
      sql += ' AND m.user_id = ?';
      args.push(user_id);
    }

    if (language) {
      sql += ' AND m.detected_lang = ?';
      args.push(language);
    }

    sql += ' ORDER BY m.sent_at DESC LIMIT ? OFFSET ?';
    args.push(limit, offset);

    const messages = await db.execute({ sql, args });

    res.json({ query, messages: messages.rows, limit, offset });
  } catch (err) {
    console.error('Message search error:', err);
    res.status(500).json({ error: 'Message search failed' });
  }
});

// ────────────────────────────────────────────
// GET /search/users — User search with filters
// ────────────────────────────────────────────
router.get('/search/users', auth, async (req, res) => {
  try {
    const { q, language, country, level } = req.query;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    let sql = `SELECT id, name, image, level, country, nativelang, targetLang, bio
               FROM users
               WHERE banned_at IS NULL`;
    const args = [];

    if (q && q.trim().length >= 2) {
      sql += ' AND name LIKE ?';
      args.push(`%${q.trim()}%`);
    }

    if (language) {
      sql += ' AND (nativelang = ? OR targetLang = ?)';
      args.push(language, language);
    }

    if (country) {
      sql += ' AND country = ?';
      args.push(country);
    }

    if (level) {
      sql += ' AND level = ?';
      args.push(level);
    }

    sql += ' ORDER BY last_active DESC LIMIT ? OFFSET ?';
    args.push(limit, offset);

    const users = await db.execute({ sql, args });

    res.json({ users: users.rows, limit, offset });
  } catch (err) {
    console.error('User search error:', err);
    res.status(500).json({ error: 'User search failed' });
  }
});

export default router;

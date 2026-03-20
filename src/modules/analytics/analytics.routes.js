// routes/analytics.js - Analytics & Dashboard Data
import express from 'express';
import { db } from '../../config/database.js';
import { auth, adminOnly } from '../../../middleware/auth.js';

const router = express.Router();

// GET /api/analytics/top-users — admin only
router.get('/analytics/top-users', auth, adminOnly, async (req, res) => {
  try {
    const result = await db.execute(`
      SELECT u.id, u.name, u.image, COUNT(m.id) as message_count,
             COUNT(DISTINCT m.room_id) as rooms_count,
             MAX(m.sent_at) as last_active
      FROM users u
      LEFT JOIN messages m ON u.id = m.user_id
      GROUP BY u.id
      ORDER BY message_count DESC
      LIMIT 10
    `);
    res.json(result.rows);
  } catch (e) {
    console.error('Error fetching top users:', e);
    res.status(500).json({ error: 'Error fetching top users' });
  }
});

// GET /api/analytics/messages-per-room — admin only
router.get('/analytics/messages-per-room', auth, adminOnly, async (req, res) => {
  try {
    const result = await db.execute(`
      SELECT r.id, r.name, r.language, r.level,
             COUNT(m.id) as message_count,
             COUNT(DISTINCT m.user_id) as unique_users,
             MAX(m.sent_at) as last_message
      FROM rooms r
      LEFT JOIN messages m ON r.id = m.room_id
      GROUP BY r.id
      ORDER BY message_count DESC
    `);
    res.json(result.rows);
  } catch (e) {
    console.error('Error fetching messages per room:', e);
    res.status(500).json({ error: 'Error fetching messages per room' });
  }
});

// GET /api/analytics/active-users-timeline — admin only, fixed SQL injection
router.get('/analytics/active-users-timeline', auth, adminOnly, async (req, res) => {
  try {
    const [h24, d7, d30] = await Promise.all([
      db.execute("SELECT COUNT(DISTINCT user_id) as count FROM messages WHERE sent_at > datetime('now', '-1 day')"),
      db.execute("SELECT COUNT(DISTINCT user_id) as count FROM messages WHERE sent_at > datetime('now', '-7 days')"),
      db.execute("SELECT COUNT(DISTINCT user_id) as count FROM messages WHERE sent_at > datetime('now', '-30 days')"),
    ]);

    res.json({
      '24h': h24.rows[0]?.count || 0,
      '7d': d7.rows[0]?.count || 0,
      '30d': d30.rows[0]?.count || 0,
    });
  } catch (e) {
    console.error('Error fetching active users timeline:', e);
    res.status(500).json({ error: 'Error fetching timeline' });
  }
});

// GET /api/analytics/languages — admin only
router.get('/analytics/languages', auth, adminOnly, async (req, res) => {
  try {
    const result = await db.execute(`
      SELECT r.language, COUNT(m.id) as message_count,
             COUNT(DISTINCT m.user_id) as unique_users,
             COUNT(DISTINCT r.id) as room_count
      FROM rooms r
      LEFT JOIN messages m ON r.id = m.room_id
      GROUP BY r.language
      ORDER BY message_count DESC
    `);
    res.json(result.rows);
  } catch (e) {
    console.error('Error fetching language stats:', e);
    res.status(500).json({ error: 'Error fetching language stats' });
  }
});

// GET /api/analytics/flood-detection — admin only
router.get('/analytics/flood-detection', auth, adminOnly, async (req, res) => {
  try {
    const result = await db.execute(`
      SELECT u.id, u.name, COUNT(m.id) as recent_messages,
             MAX(m.sent_at) as last_message_time, r.id as room_id, r.name as room_name
      FROM users u
      JOIN messages m ON u.id = m.user_id
      JOIN rooms r ON m.room_id = r.id
      WHERE m.sent_at > datetime('now', '-5 minutes')
      GROUP BY u.id, m.room_id
      HAVING recent_messages > 10
      ORDER BY recent_messages DESC
    `);
    res.json({
      flagged_users: result.rows,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    console.error('Error in flood detection:', e);
    res.status(500).json({ error: 'Error in flood detection' });
  }
});

// GET /api/analytics/audit-log — admin only
router.get('/analytics/audit-log', auth, adminOnly, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '100'), 500);
    const result = await db.execute({
      sql: `
      SELECT ma.id, ma.mod_id, u_mod.name as mod_name, ma.action,
             ma.target_user_id, u_target.name as target_name,
             ma.room_id, r.name as room_name,
             ma.details, ma.created_at
      FROM moderator_actions ma
      LEFT JOIN users u_mod ON ma.mod_id = u_mod.id
      LEFT JOIN users u_target ON ma.target_user_id = u_target.id
      LEFT JOIN rooms r ON ma.room_id = r.id
      ORDER BY ma.created_at DESC
      LIMIT ?
    `,
      args: [limit],
    });
    res.json(result.rows);
  } catch (e) {
    console.error('Error fetching audit log:', e);
    res.status(500).json({ error: 'Error fetching audit log' });
  }
});

// GET /api/analytics/banned-words — admin only
router.get('/analytics/banned-words', auth, adminOnly, async (req, res) => {
  try {
    const result = await db.execute({
      sql: 'SELECT word FROM banned_words ORDER BY word ASC',
      args: [],
    });
    res.json({ words: result.rows.map(r => r.word) });
  } catch (e) {
    console.error('Error fetching banned words:', e);
    res.status(500).json({ error: 'Error fetching banned words' });
  }
});

// POST /api/analytics/banned-words — admin only (verified via JWT)
router.post('/analytics/banned-words', auth, adminOnly, async (req, res) => {
  const { word } = req.body || {};
  if (!word) return res.status(400).json({ error: 'word required' });

  try {
    const normalizedWord = String(word).trim().toLowerCase();
    if (!normalizedWord) {
      return res.status(400).json({ error: 'word is required' });
    }

    await db.execute({
      sql: 'INSERT OR IGNORE INTO banned_words (word, created_by) VALUES (?, ?)',
      args: [normalizedWord, req.user.id],
    });

    await db.execute({
      sql: 'INSERT INTO moderator_actions (mod_id, action, details) VALUES (?, ?, ?)',
      args: [req.user.id, 'add_banned_word', JSON.stringify({ word: normalizedWord })],
    });

    res.json({ message: 'Word added to blacklist', word: normalizedWord });
  } catch (e) {
    console.error('Error adding banned word:', e);
    res.status(500).json({ error: 'Error adding word' });
  }
});

export default router;

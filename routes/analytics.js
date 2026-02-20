// routes/analytics.js - Analytics & Dashboard Data
import express from 'express';
import { db } from '../db.js';

const router = express.Router();

// GET /api/analytics/top-users — top 10 most active users
router.get('/analytics/top-users', async (req, res) => {
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

// GET /api/analytics/messages-per-room — message count by room
router.get('/analytics/messages-per-room', async (req, res) => {
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

// GET /api/analytics/active-users-timeline — users active over last 24h / 7d / 30d
router.get('/analytics/active-users-timeline', async (req, res) => {
  try {
    const periods = {
      '24h': "datetime('now', '-1 day')",
      '7d': "datetime('now', '-7 days')",
      '30d': "datetime('now', '-30 days')",
    };

    const data = {};
    for (const [period, timeExpr] of Object.entries(periods)) {
      const result = await db.execute({
        sql: `SELECT COUNT(DISTINCT user_id) as count FROM messages WHERE sent_at > ${timeExpr}`,
        args: [],
      });
      data[period] = result.rows[0]?.count || 0;
    }
    res.json(data);
  } catch (e) {
    console.error('Error fetching active users timeline:', e);
    res.status(500).json({ error: 'Error fetching timeline' });
  }
});

// GET /api/analytics/languages — messages by language
router.get('/analytics/languages', async (req, res) => {
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

// GET /api/analytics/flood-detection — detect frequent message spam
router.get('/analytics/flood-detection', async (req, res) => {
  try {
    // Detect users who sent >10 messages in last 5 minutes (potential spam)
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

// GET /api/analytics/audit-log — global moderation audit log
router.get('/analytics/audit-log', async (req, res) => {
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

// GET /api/analytics/banned-words
router.get('/analytics/banned-words', async (req, res) => {
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

// POST /api/analytics/banned-words (add new banned word)
router.post('/analytics/banned-words', async (req, res) => {
  const { word, requestingUserId } = req.body || {};
  if (!word || !requestingUserId) return res.status(400).json({ error: 'word and requestingUserId required' });

  // Verify admin
  try {
    const user = await db.execute({ sql: 'SELECT isAdmin FROM users WHERE id = ?', args: [requestingUserId] });
    if (!user.rows.length || !user.rows[0].isAdmin) {
      return res.status(403).json({ error: 'Only admins can add banned words' });
    }

    const normalizedWord = String(word).trim().toLowerCase();
    if (!normalizedWord) {
      return res.status(400).json({ error: 'word is required' });
    }

    await db.execute({
      sql: 'INSERT OR IGNORE INTO banned_words (word, created_by) VALUES (?, ?)',
      args: [normalizedWord, requestingUserId],
    });

    await db.execute({
      sql: 'INSERT INTO moderator_actions (mod_id, action, details) VALUES (?, ?, ?)',
      args: [requestingUserId, 'add_banned_word', JSON.stringify({ word: normalizedWord })],
    });

    res.json({ message: 'Word added to blacklist', word: normalizedWord });
  } catch (e) {
    console.error('Error adding banned word:', e);
    res.status(500).json({ error: 'Error adding word' });
  }
});

export default router;

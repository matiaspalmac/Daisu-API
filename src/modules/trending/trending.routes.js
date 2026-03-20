// routes/trending.js — trending/popular endpoints and reaction statistics
import express from 'express';
import { db } from '../../config/database.js';
import { auth } from '../../../middleware/auth.js';

const router = express.Router();

// Common stop words to filter out from word frequency analysis
const STOP_WORDS = new Set([
    // English
    'that', 'this', 'with', 'from', 'your', 'have', 'been', 'will', 'would', 'could',
    'should', 'their', 'there', 'they', 'them', 'then', 'than', 'what', 'when', 'where',
    'which', 'while', 'about', 'after', 'before', 'between', 'through', 'during', 'each',
    'some', 'were', 'does', 'done', 'doing', 'being', 'just', 'also', 'into', 'over',
    'such', 'only', 'very', 'more', 'most', 'other', 'like', 'here', 'well', 'back',
    'even', 'still', 'know', 'really', 'think', 'much', 'because', 'these', 'those',
    // Spanish
    'para', 'como', 'pero', 'esto', 'esta', 'esos', 'esas', 'esos', 'este', 'estos',
    'estas', 'algo', 'todo', 'toda', 'todos', 'todas', 'mucho', 'mucha', 'muchos',
    'muchas', 'otro', 'otra', 'otros', 'otras', 'poco', 'poca', 'pocos', 'pocas',
    'bien', 'aqui', 'alla', 'donde', 'cuando', 'quien', 'cual', 'sobre', 'entre',
    'desde', 'hasta', 'tiene', 'puede', 'hacer', 'hola', 'solo', 'sino', 'cada',
    'nada', 'mismo', 'misma', 'tambien', 'porque', 'aunque',
    // Japanese/general
    'です', 'ます', 'した', 'している', 'される',
]);

// GET /api/trending/rooms — rooms ranked by activity in the last 24 hours
router.get('/trending/rooms', auth, async (req, res) => {
    try {
        const result = await db.execute({
            sql: `SELECT r.id, r.name, r.description, r.language, r.level, r.type,
                         COUNT(m.id) as messages_24h,
                         (SELECT COUNT(DISTINCT user_id) FROM messages WHERE room_id = r.id AND sent_at > datetime('now', '-24 hours')) as active_users_24h
                  FROM rooms r
                  LEFT JOIN messages m ON r.id = m.room_id AND m.sent_at > datetime('now', '-24 hours') AND m.deleted_at IS NULL
                  GROUP BY r.id
                  HAVING messages_24h > 0
                  ORDER BY messages_24h DESC
                  LIMIT 10`,
            args: [],
        });

        res.json({ rooms: result.rows });
    } catch (err) {
        console.error('[trending/rooms]', err);
        res.status(500).json({ error: 'Failed to fetch trending rooms' });
    }
});

// GET /api/trending/users — most active users in the last 7 days
router.get('/trending/users', auth, async (req, res) => {
    try {
        const result = await db.execute({
            sql: `SELECT u.id, u.name, u.image, u.level, u.country, u.xp,
                         COUNT(m.id) as messages_7d,
                         COUNT(DISTINCT m.room_id) as rooms_active
                  FROM users u
                  JOIN messages m ON u.id = m.user_id AND m.sent_at > datetime('now', '-7 days') AND m.deleted_at IS NULL
                  WHERE u.banned_at IS NULL
                  GROUP BY u.id
                  ORDER BY messages_7d DESC
                  LIMIT 20`,
            args: [],
        });

        res.json({ users: result.rows });
    } catch (err) {
        console.error('[trending/users]', err);
        res.status(500).json({ error: 'Failed to fetch trending users' });
    }
});

// GET /api/trending/words — most used words in recent messages
router.get('/trending/words', auth, async (req, res) => {
    const { language } = req.query;

    try {
        let sql = `SELECT m.content
                   FROM messages m
                   JOIN rooms r ON m.room_id = r.id
                   WHERE m.sent_at > datetime('now', '-7 days')
                     AND m.deleted_at IS NULL`;
        const args = [];

        if (language) {
            sql += ` AND r.language = ?`;
            args.push(language);
        }

        sql += ` ORDER BY m.sent_at DESC LIMIT 500`;

        const result = await db.execute({ sql, args });

        // Process messages into word frequency map
        const wordCounts = new Map();

        for (const row of result.rows) {
            if (!row.content) continue;
            const words = row.content
                .toLowerCase()
                .replace(/[^\p{L}\p{N}\s]/gu, '') // keep letters, numbers, whitespace
                .split(/\s+/)
                .filter(w => w.length >= 4 && !STOP_WORDS.has(w));

            for (const word of words) {
                wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
            }
        }

        // Sort by count descending, take top 30
        const words = Array.from(wordCounts.entries())
            .map(([word, count]) => ({ word, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 30);

        res.json({ language: language || null, words });
    } catch (err) {
        console.error('[trending/words]', err);
        res.status(500).json({ error: 'Failed to fetch trending words' });
    }
});

// GET /api/trending/reactions — most used reactions in the last 7 days
router.get('/trending/reactions', auth, async (req, res) => {
    try {
        const result = await db.execute({
            sql: `SELECT emoji, COUNT(*) as count, COUNT(DISTINCT user_id) as unique_users
                  FROM reactions
                  WHERE created_at > datetime('now', '-7 days')
                  GROUP BY emoji
                  ORDER BY count DESC
                  LIMIT 20`,
            args: [],
        });

        res.json({ reactions: result.rows });
    } catch (err) {
        console.error('[trending/reactions]', err);
        res.status(500).json({ error: 'Failed to fetch trending reactions' });
    }
});

// GET /api/rooms/:roomId/activity — activity stats for a specific room
router.get('/rooms/:roomId/activity', auth, async (req, res) => {
    const { roomId } = req.params;

    try {
        const [
            messagesTodayRes,
            messagesWeekRes,
            messagesAllTimeRes,
            usersTodayRes,
            usersWeekRes,
            topUsersRes,
            topReactionsRes,
            peakHourRes,
        ] = await Promise.all([
            // Messages today
            db.execute({
                sql: `SELECT COUNT(*) as count FROM messages WHERE room_id = ? AND sent_at > datetime('now', '-1 day') AND deleted_at IS NULL`,
                args: [roomId],
            }),
            // Messages this week
            db.execute({
                sql: `SELECT COUNT(*) as count FROM messages WHERE room_id = ? AND sent_at > datetime('now', '-7 days') AND deleted_at IS NULL`,
                args: [roomId],
            }),
            // Messages all time
            db.execute({
                sql: `SELECT COUNT(*) as count FROM messages WHERE room_id = ? AND deleted_at IS NULL`,
                args: [roomId],
            }),
            // Unique users today
            db.execute({
                sql: `SELECT COUNT(DISTINCT user_id) as count FROM messages WHERE room_id = ? AND sent_at > datetime('now', '-1 day') AND deleted_at IS NULL`,
                args: [roomId],
            }),
            // Unique users this week
            db.execute({
                sql: `SELECT COUNT(DISTINCT user_id) as count FROM messages WHERE room_id = ? AND sent_at > datetime('now', '-7 days') AND deleted_at IS NULL`,
                args: [roomId],
            }),
            // Most active users in room (top 5)
            db.execute({
                sql: `SELECT u.id, u.name, u.image, COUNT(m.id) as msg_count
                      FROM messages m JOIN users u ON m.user_id = u.id
                      WHERE m.room_id = ? AND m.sent_at > datetime('now', '-7 days') AND m.deleted_at IS NULL
                      GROUP BY u.id ORDER BY msg_count DESC LIMIT 5`,
                args: [roomId],
            }),
            // Most used reactions in room
            db.execute({
                sql: `SELECT r.emoji, COUNT(*) as count
                      FROM reactions r
                      JOIN messages m ON r.message_id = m.id
                      WHERE m.room_id = ? AND r.created_at > datetime('now', '-7 days')
                      GROUP BY r.emoji ORDER BY count DESC LIMIT 10`,
                args: [roomId],
            }),
            // Peak hour
            db.execute({
                sql: `SELECT strftime('%H', sent_at) as hour, COUNT(*) as count
                      FROM messages WHERE room_id = ? AND sent_at > datetime('now', '-7 days') AND deleted_at IS NULL
                      GROUP BY hour ORDER BY count DESC LIMIT 1`,
                args: [roomId],
            }),
        ]);

        res.json({
            roomId,
            messages: {
                today: messagesTodayRes.rows[0]?.count ?? 0,
                thisWeek: messagesWeekRes.rows[0]?.count ?? 0,
                allTime: messagesAllTimeRes.rows[0]?.count ?? 0,
            },
            uniqueUsers: {
                today: usersTodayRes.rows[0]?.count ?? 0,
                thisWeek: usersWeekRes.rows[0]?.count ?? 0,
            },
            topUsers: topUsersRes.rows,
            topReactions: topReactionsRes.rows,
            peakHour: peakHourRes.rows[0] || null,
        });
    } catch (err) {
        console.error('[rooms/activity]', err);
        res.status(500).json({ error: 'Failed to fetch room activity' });
    }
});

export default router;

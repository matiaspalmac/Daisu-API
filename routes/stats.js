// routes/stats.js
import express from 'express';
import { db } from '../db.js';

const router = express.Router();

// GET /api/user/stats/:userId
router.get('/user/stats/:userId', async (req, res) => {
    const { userId } = req.params;
    try {
        // Basic stats from user_stats
        const statsRes = await db.execute({
            sql: 'SELECT * FROM user_stats WHERE user_id = ?',
            args: [userId],
        });
        const stats = statsRes.rows[0] || { messages_sent: 0, words_sent: 0, corrections_given: 0, streak: 0 };

        // Words this week (unique words > 4 chars from last 7 days)
        const weekMsgs = await db.execute({
            sql: `SELECT content FROM messages WHERE user_id = ? AND sent_at >= datetime('now', '-7 days')`,
            args: [userId],
        });
        const allWords = weekMsgs.rows.flatMap(r => r.content.toLowerCase().split(/\s+/).filter(w => w.length > 4));
        const uniqueWords = new Set(allWords).size;

        // Longest sentence by word count
        const allMsgs = await db.execute({ sql: 'SELECT content FROM messages WHERE user_id = ?', args: [userId] });
        const longestWords = allMsgs.rows.reduce((max, r) => {
            const words = r.content.trim().split(/\s+/).length;
            return words > max ? words : max;
        }, 0);

        // Messages this week
        const weekCount = weekMsgs.rows.length;

        // Member since
        const userRes = await db.execute({ sql: 'SELECT created_at, last_active FROM users WHERE id = ?', args: [userId] });
        const user = userRes.rows[0] || {};

        // Favorite Rooms (top 5 by message count)
        const favoriteRoomsRes = await db.execute({
            sql: `
              SELECT r.id, r.name, COUNT(m.id) as message_count
              FROM messages m
              JOIN rooms r ON m.room_id = r.id
              WHERE m.user_id = ?
              GROUP BY r.id, r.name
              ORDER BY message_count DESC
              LIMIT 5
            `,
            args: [userId],
        });
        const favorite_rooms = favoriteRoomsRes.rows || [];

        // Languages Statistics (message distribution by language)
        const langsRes = await db.execute({
            sql: `
              SELECT r.language, COUNT(m.id) as msg_count
              FROM messages m
              JOIN rooms r ON m.room_id = r.id
              WHERE m.user_id = ? AND r.language IS NOT NULL AND r.language != ''
              GROUP BY r.language
              ORDER BY msg_count DESC
            `,
            args: [userId],
        });
        const totalMsgsByLang = langsRes.rows.reduce((sum, row) => sum + (row.msg_count || 0), 0);
        const languages_stats = langsRes.rows.map(row => ({
            language: row.language || 'unknown',
            message_count: row.msg_count || 0,
            percentage: totalMsgsByLang > 0 ? (row.msg_count / totalMsgsByLang) * 100 : 0,
        }));

        res.json({
            messages_sent: Number(stats.messages_sent) || 0,
            words_sent: Number(stats.words_sent) || 0,
            corrections_given: Number(stats.corrections_given) || 0,
            streak: Number(stats.streak) || 0,
            unique_words_this_week: uniqueWords,
            longest_sentence_words: longestWords,
            messages_this_week: weekCount,
            created_at: user.created_at,
            last_active: user.last_active,
            favorite_rooms,
            languages_stats,
        });
    } catch (e) {
        console.error('Stats error:', e);
        res.status(500).json({ error: 'Error fetching stats' });
    }
});

export default router;

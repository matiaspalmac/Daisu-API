// routes/stats.js
import express from 'express';
import { db } from '../../config/database.js';
import { auth } from '../../../middleware/auth.js';

const router = express.Router();

// GET /api/user/stats/:userId — authenticated
router.get('/user/stats/:userId', auth, async (req, res) => {
    const { userId } = req.params;
    try {
        // Run all queries in parallel — all in SQL, no full table scans
        const [statsRes, uniqueWordsRes, longestRes, weekCountRes, userRes, favoriteRoomsRes, langsRes] = await Promise.all([
            // Basic stats from user_stats
            db.execute({
                sql: 'SELECT * FROM user_stats WHERE user_id = ?',
                args: [userId],
            }),
            // Unique words this week: count distinct words >4 chars in SQL
            db.execute({
                sql: `SELECT COUNT(DISTINCT word) as unique_count FROM (
                    SELECT LOWER(TRIM(value)) as word
                    FROM messages, json_each('["' || REPLACE(REPLACE(content, '"', ''), ' ', '","') || '"]')
                    WHERE user_id = ? AND sent_at >= datetime('now', '-7 days')
                      AND LENGTH(TRIM(value)) > 4
                )`,
                args: [userId],
            }),
            // Longest sentence by word count — computed in SQL
            db.execute({
                sql: `SELECT MAX(LENGTH(content) - LENGTH(REPLACE(content, ' ', '')) + 1) as max_words
                      FROM messages WHERE user_id = ?`,
                args: [userId],
            }),
            // Messages this week count
            db.execute({
                sql: `SELECT COUNT(*) as count FROM messages WHERE user_id = ? AND sent_at >= datetime('now', '-7 days')`,
                args: [userId],
            }),
            // Member since
            db.execute({ sql: 'SELECT created_at, last_active FROM users WHERE id = ?', args: [userId] }),
            // Favorite Rooms (top 5)
            db.execute({
                sql: `SELECT r.id, r.name, COUNT(m.id) as message_count
                      FROM messages m
                      JOIN rooms r ON m.room_id = r.id
                      WHERE m.user_id = ?
                      GROUP BY r.id, r.name
                      ORDER BY message_count DESC
                      LIMIT 5`,
                args: [userId],
            }),
            // Languages Statistics
            db.execute({
                sql: `SELECT r.language, COUNT(m.id) as msg_count
                      FROM messages m
                      JOIN rooms r ON m.room_id = r.id
                      WHERE m.user_id = ? AND r.language IS NOT NULL AND r.language != ''
                      GROUP BY r.language
                      ORDER BY msg_count DESC`,
                args: [userId],
            }),
        ]);

        const stats = statsRes.rows[0] || { messages_sent: 0, words_sent: 0, corrections_given: 0, streak: 0 };
        const uniqueWords = uniqueWordsRes.rows[0]?.unique_count || 0;
        const longestWords = longestRes.rows[0]?.max_words || 0;
        const weekCount = weekCountRes.rows[0]?.count || 0;
        const user = userRes.rows[0] || {};
        const favorite_rooms = favoriteRoomsRes.rows || [];
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

// GET /api/user/stats/:userId/heatmap — daily message counts (last 365 days)
router.get('/user/stats/:userId/heatmap', auth, async (req, res) => {
    const { userId } = req.params;
    try {
        const result = await db.execute({
            sql: `SELECT DATE(sent_at) as day, COUNT(*) as count
                  FROM messages
                  WHERE user_id = ? AND sent_at > datetime('now', '-365 days') AND deleted_at IS NULL
                  GROUP BY day
                  ORDER BY day ASC`,
            args: [userId],
        });

        const days = result.rows.map(row => ({
            date: row.day,
            count: Number(row.count) || 0,
        }));

        res.json({ days });
    } catch (e) {
        console.error('Heatmap error:', e);
        res.status(500).json({ error: 'Error fetching heatmap data' });
    }
});

// GET /api/user/stats/:userId/progress — weekly progress over the last 12 weeks
router.get('/user/stats/:userId/progress', auth, async (req, res) => {
    const { userId } = req.params;
    try {
        const [messagesRes, vocabRes] = await Promise.all([
            db.execute({
                sql: `SELECT strftime('%Y-%W', sent_at) as week,
                             COUNT(*) as messages,
                             COUNT(DISTINCT DATE(sent_at)) as active_days,
                             COUNT(DISTINCT room_id) as rooms_used
                      FROM messages
                      WHERE user_id = ? AND sent_at > datetime('now', '-84 days') AND deleted_at IS NULL
                      GROUP BY week
                      ORDER BY week ASC`,
                args: [userId],
            }),
            db.execute({
                sql: `SELECT strftime('%Y-%W', created_at) as week, COUNT(*) as words_added
                      FROM user_vocabulary
                      WHERE user_id = ? AND created_at > datetime('now', '-84 days')
                      GROUP BY week`,
                args: [userId],
            }),
        ]);

        const vocabByWeek = {};
        for (const row of vocabRes.rows) {
            vocabByWeek[row.week] = Number(row.words_added) || 0;
        }

        const weeks = messagesRes.rows.map(row => ({
            week: row.week,
            messages: Number(row.messages) || 0,
            active_days: Number(row.active_days) || 0,
            rooms_used: Number(row.rooms_used) || 0,
            words_added: vocabByWeek[row.week] || 0,
        }));

        res.json({ weeks });
    } catch (e) {
        console.error('Progress error:', e);
        res.status(500).json({ error: 'Error fetching progress data' });
    }
});

// GET /api/user/stats/:userId/digest — weekly summary / recap
router.get('/user/stats/:userId/digest', auth, async (req, res) => {
    const { userId } = req.params;
    try {
        const [
            currentMsgRes,
            previousMsgRes,
            vocabRes,
            streakRes,
            achievementsRes,
            topRoomRes,
            langsRes,
        ] = await Promise.all([
            // Messages this week
            db.execute({
                sql: `SELECT COUNT(*) as count FROM messages
                      WHERE user_id = ? AND sent_at >= datetime('now', '-7 days') AND deleted_at IS NULL`,
                args: [userId],
            }),
            // Messages previous week
            db.execute({
                sql: `SELECT COUNT(*) as count FROM messages
                      WHERE user_id = ? AND sent_at >= datetime('now', '-14 days') AND sent_at < datetime('now', '-7 days') AND deleted_at IS NULL`,
                args: [userId],
            }),
            // Vocabulary stats this week
            db.execute({
                sql: `SELECT
                        COUNT(*) FILTER (WHERE created_at >= datetime('now', '-7 days')) as added,
                        COUNT(*) FILTER (WHERE last_reviewed >= datetime('now', '-7 days')) as reviewed,
                        COUNT(*) FILTER (WHERE mastered_at >= datetime('now', '-7 days')) as mastered
                      FROM user_vocabulary
                      WHERE user_id = ?`,
                args: [userId],
            }),
            // Current streak
            db.execute({
                sql: `SELECT streak FROM user_stats WHERE user_id = ?`,
                args: [userId],
            }),
            // Achievements earned this week
            db.execute({
                sql: `SELECT a.id, a.name, a.icon
                      FROM user_achievements ua
                      JOIN achievements a ON ua.achievement_id = a.id
                      WHERE ua.user_id = ? AND ua.earned_at >= datetime('now', '-7 days')`,
                args: [userId],
            }),
            // Most active room this week
            db.execute({
                sql: `SELECT r.id, r.name, COUNT(m.id) as messages
                      FROM messages m
                      JOIN rooms r ON m.room_id = r.id
                      WHERE m.user_id = ? AND m.sent_at >= datetime('now', '-7 days') AND m.deleted_at IS NULL
                      GROUP BY r.id, r.name
                      ORDER BY messages DESC
                      LIMIT 1`,
                args: [userId],
            }),
            // Languages practiced this week
            db.execute({
                sql: `SELECT r.language, COUNT(m.id) as messages
                      FROM messages m
                      JOIN rooms r ON m.room_id = r.id
                      WHERE m.user_id = ? AND m.sent_at >= datetime('now', '-7 days') AND m.deleted_at IS NULL
                        AND r.language IS NOT NULL AND r.language != ''
                      GROUP BY r.language
                      ORDER BY messages DESC`,
                args: [userId],
            }),
        ]);

        const currentMessages = Number(currentMsgRes.rows[0]?.count) || 0;
        const previousMessages = Number(previousMsgRes.rows[0]?.count) || 0;
        const changePct = previousMessages > 0
            ? Math.round(((currentMessages - previousMessages) / previousMessages) * 100)
            : currentMessages > 0 ? 100 : 0;

        const vocab = vocabRes.rows[0] || {};
        const streak = Number(streakRes.rows[0]?.streak) || 0;

        const achievementsEarned = achievementsRes.rows.map(row => ({
            id: row.id,
            name: row.name,
            icon: row.icon,
        }));

        const topRoomRow = topRoomRes.rows[0];
        const topRoom = topRoomRow
            ? { id: topRoomRow.id, name: topRoomRow.name, messages: Number(topRoomRow.messages) || 0 }
            : null;

        const totalLangMessages = langsRes.rows.reduce((sum, r) => sum + (Number(r.messages) || 0), 0);
        const languages = langsRes.rows.map(row => ({
            language: row.language,
            messages: Number(row.messages) || 0,
            pct: totalLangMessages > 0 ? Math.round((Number(row.messages) / totalLangMessages) * 100) : 0,
        }));

        const now = new Date();
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const period = `${weekAgo.toISOString().split('T')[0]} to ${now.toISOString().split('T')[0]}`;

        res.json({
            period,
            messages: { current: currentMessages, previous: previousMessages, change_pct: changePct },
            vocabulary: {
                added: Number(vocab.added) || 0,
                reviewed: Number(vocab.reviewed) || 0,
                mastered: Number(vocab.mastered) || 0,
            },
            streak,
            achievements_earned: achievementsEarned,
            top_room: topRoom,
            languages,
        });
    } catch (e) {
        console.error('Digest error:', e);
        res.status(500).json({ error: 'Error fetching weekly digest' });
    }
});

export default router;

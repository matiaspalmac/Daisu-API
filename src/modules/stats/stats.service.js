import { db } from '../../config/database.js';
import { config } from '../../config/index.js';

export const StatsService = {
  async getUserStats(userId) {
    const [statsRes, uniqueWordsRes, longestRes, weekCountRes, userRes, favoriteRoomsRes, langsRes] = await Promise.all([
      db.execute({ sql: 'SELECT * FROM user_stats WHERE user_id = ?', args: [userId] }),
      db.execute({ sql: `SELECT COUNT(DISTINCT word) as unique_count FROM (SELECT LOWER(TRIM(value)) as word FROM messages, json_each('["' || REPLACE(REPLACE(content, '"', ''), ' ', '","') || '"]') WHERE user_id = ? AND sent_at >= datetime('now', '-7 days') AND LENGTH(TRIM(value)) > 4)`, args: [userId] }),
      db.execute({ sql: "SELECT MAX(LENGTH(content) - LENGTH(REPLACE(content, ' ', '')) + 1) as max_words FROM messages WHERE user_id = ?", args: [userId] }),
      db.execute({ sql: "SELECT COUNT(*) as count FROM messages WHERE user_id = ? AND sent_at >= datetime('now', '-7 days')", args: [userId] }),
      db.execute({ sql: 'SELECT created_at, last_active FROM users WHERE id = ?', args: [userId] }),
      db.execute({ sql: 'SELECT r.id, r.name, COUNT(m.id) as message_count FROM messages m JOIN rooms r ON m.room_id = r.id WHERE m.user_id = ? GROUP BY r.id, r.name ORDER BY message_count DESC LIMIT 5', args: [userId] }),
      db.execute({ sql: "SELECT r.language, COUNT(m.id) as msg_count FROM messages m JOIN rooms r ON m.room_id = r.id WHERE m.user_id = ? AND r.language IS NOT NULL AND r.language != '' GROUP BY r.language ORDER BY msg_count DESC", args: [userId] }),
    ]);
    const stats = statsRes.rows[0] || { messages_sent: 0, words_sent: 0, corrections_given: 0, streak: 0 };
    const totalMsgsByLang = langsRes.rows.reduce((sum, row) => sum + (row.msg_count || 0), 0);
    return {
      messages_sent: Number(stats.messages_sent) || 0, words_sent: Number(stats.words_sent) || 0,
      corrections_given: Number(stats.corrections_given) || 0, streak: Number(stats.streak) || 0,
      unique_words_this_week: uniqueWordsRes.rows[0]?.unique_count || 0,
      longest_sentence_words: longestRes.rows[0]?.max_words || 0,
      messages_this_week: weekCountRes.rows[0]?.count || 0,
      created_at: userRes.rows[0]?.created_at, last_active: userRes.rows[0]?.last_active,
      favorite_rooms: favoriteRoomsRes.rows || [],
      languages_stats: langsRes.rows.map(row => ({ language: row.language || 'unknown', message_count: row.msg_count || 0, percentage: totalMsgsByLang > 0 ? (row.msg_count / totalMsgsByLang) * 100 : 0 })),
    };
  },

  async getHeatmap(userId) {
    const result = await db.execute({
      sql: `SELECT DATE(sent_at) as day, COUNT(*) as count FROM messages WHERE user_id = ? AND sent_at > datetime('now', '-${config.limits.heatmapDays} days') AND deleted_at IS NULL GROUP BY day ORDER BY day ASC`,
      args: [userId],
    });
    return { days: result.rows.map(row => ({ date: row.day, count: Number(row.count) || 0 })) };
  },

  async getProgress(userId) {
    const [messagesRes, vocabRes] = await Promise.all([
      db.execute({ sql: `SELECT strftime('%Y-%W', sent_at) as week, COUNT(*) as messages, COUNT(DISTINCT DATE(sent_at)) as active_days, COUNT(DISTINCT room_id) as rooms_used FROM messages WHERE user_id = ? AND sent_at > datetime('now', '-${config.limits.progressWeeks} days') AND deleted_at IS NULL GROUP BY week ORDER BY week ASC`, args: [userId] }),
      db.execute({ sql: `SELECT strftime('%Y-%W', created_at) as week, COUNT(*) as words_added FROM user_vocabulary WHERE user_id = ? AND created_at > datetime('now', '-${config.limits.progressWeeks} days') GROUP BY week`, args: [userId] }),
    ]);
    const vocabByWeek = {};
    for (const row of vocabRes.rows) vocabByWeek[row.week] = Number(row.words_added) || 0;
    return { weeks: messagesRes.rows.map(row => ({ week: row.week, messages: Number(row.messages) || 0, active_days: Number(row.active_days) || 0, rooms_used: Number(row.rooms_used) || 0, words_added: vocabByWeek[row.week] || 0 })) };
  },

  async getDigest(userId) {
    const [currentMsgRes, previousMsgRes, vocabRes, streakRes, achievementsRes, topRoomRes, langsRes] = await Promise.all([
      db.execute({ sql: "SELECT COUNT(*) as count FROM messages WHERE user_id = ? AND sent_at >= datetime('now', '-7 days') AND deleted_at IS NULL", args: [userId] }),
      db.execute({ sql: "SELECT COUNT(*) as count FROM messages WHERE user_id = ? AND sent_at >= datetime('now', '-14 days') AND sent_at < datetime('now', '-7 days') AND deleted_at IS NULL", args: [userId] }),
      db.execute({ sql: "SELECT COUNT(*) FILTER (WHERE created_at >= datetime('now', '-7 days')) as added, COUNT(*) FILTER (WHERE last_reviewed >= datetime('now', '-7 days')) as reviewed, COUNT(*) FILTER (WHERE mastered_at >= datetime('now', '-7 days')) as mastered FROM user_vocabulary WHERE user_id = ?", args: [userId] }),
      db.execute({ sql: 'SELECT streak FROM user_stats WHERE user_id = ?', args: [userId] }),
      db.execute({ sql: "SELECT a.id, a.name, a.icon FROM user_achievements ua JOIN achievements a ON ua.achievement_id = a.id WHERE ua.user_id = ? AND ua.earned_at >= datetime('now', '-7 days')", args: [userId] }),
      db.execute({ sql: "SELECT r.id, r.name, COUNT(m.id) as messages FROM messages m JOIN rooms r ON m.room_id = r.id WHERE m.user_id = ? AND m.sent_at >= datetime('now', '-7 days') AND m.deleted_at IS NULL GROUP BY r.id, r.name ORDER BY messages DESC LIMIT 1", args: [userId] }),
      db.execute({ sql: "SELECT r.language, COUNT(m.id) as messages FROM messages m JOIN rooms r ON m.room_id = r.id WHERE m.user_id = ? AND m.sent_at >= datetime('now', '-7 days') AND m.deleted_at IS NULL AND r.language IS NOT NULL AND r.language != '' GROUP BY r.language ORDER BY messages DESC", args: [userId] }),
    ]);
    const currentMessages = Number(currentMsgRes.rows[0]?.count) || 0;
    const previousMessages = Number(previousMsgRes.rows[0]?.count) || 0;
    const changePct = previousMessages > 0 ? Math.round(((currentMessages - previousMessages) / previousMessages) * 100) : currentMessages > 0 ? 100 : 0;
    const vocab = vocabRes.rows[0] || {};
    const topRoomRow = topRoomRes.rows[0];
    const totalLangMessages = langsRes.rows.reduce((sum, r) => sum + (Number(r.messages) || 0), 0);
    const now = new Date(); const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return {
      period: `${weekAgo.toISOString().split('T')[0]} to ${now.toISOString().split('T')[0]}`,
      messages: { current: currentMessages, previous: previousMessages, change_pct: changePct },
      vocabulary: { added: Number(vocab.added) || 0, reviewed: Number(vocab.reviewed) || 0, mastered: Number(vocab.mastered) || 0 },
      streak: Number(streakRes.rows[0]?.streak) || 0,
      achievements_earned: achievementsRes.rows.map(row => ({ id: row.id, name: row.name, icon: row.icon })),
      top_room: topRoomRow ? { id: topRoomRow.id, name: topRoomRow.name, messages: Number(topRoomRow.messages) || 0 } : null,
      languages: langsRes.rows.map(row => ({ language: row.language, messages: Number(row.messages) || 0, pct: totalLangMessages > 0 ? Math.round((Number(row.messages) / totalLangMessages) * 100) : 0 })),
    };
  },
};
